# 发布后核对 ZIP：运行文件逐一比对哈希，不解压、不安装、不删除历史文件。
param([string]$PackagePath = '', [string]$PreviousVersion = '0.1.4', [string[]]$ExpectedPreviousVersions = @(), [string]$ReportName = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'chatgpt-nebula-extension'
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
if (-not $PackagePath) { $PackagePath = Join-Path $projectRoot "releases\夜航-Chrome-$($manifest.version).zip" }
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
if (-not $ReportName) { $ReportName = "release-$($manifest.version).json" }
# 复核可以指定新报告名，但不能把输出写到 tests 目录之外或覆盖既有证据。
if ([IO.Path]::GetFileName($ReportName) -ne $ReportName -or -not $ReportName.EndsWith('.json')) { throw 'ReportName 需要是以 .json 结尾的单个文件名。' }
$reportPath = Join-Path $extensionRoot "tests\$ReportName"
if (Test-Path -LiteralPath $reportPath) { throw "核对记录已存在，保留原证据：$reportPath" }

function Get-EntryHash($Entry) {
    $stream = $Entry.Open()
    $digest = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-', '') }
    finally { $digest.Dispose(); $stream.Dispose() }
}

$runtimeNames = @('manifest.json','README.md','content.js','backdrop.html','backdrop.css','backdrop.js','options.html','options.css','options.js','popup.html','popup.css','popup.js')
foreach ($folder in @('assets','shared','styles')) {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $extensionRoot $folder) -File -Recurse) {
        $runtimeNames += $file.FullName.Substring($extensionRoot.Length + 1).Replace('\','/')
    }
}
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedPackage)
if ($PreviousVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'PreviousVersion 需要是三段数字版本号。' }
$previousPath = Join-Path $projectRoot "releases\夜航-Chrome-$PreviousVersion.zip"
$previous = if (Test-Path -LiteralPath $previousPath) { [IO.Compression.ZipFile]::OpenRead($previousPath) } else { $null }
try {
    $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if ($entries.Count -ne $runtimeNames.Count) { throw "ZIP 文件数量不符：$($entries.Count) / $($runtimeNames.Count)" }
    $items = foreach ($name in $runtimeNames) {
        $entry = $archive.GetEntry($name)
        if (-not $entry) { throw "ZIP 缺少文件：$name" }
        $zipHash = Get-EntryHash $entry
        $sourceHash = (Get-FileHash -LiteralPath (Join-Path $extensionRoot $name) -Algorithm SHA256).Hash
        if ($zipHash -ne $sourceHash) { throw "ZIP 与源码不一致：$name" }
        $oldEntry = if ($previous) { $previous.GetEntry($name) } else { $null }
        $changed = if ($oldEntry) { (Get-EntryHash $oldEntry) -ne $zipHash } else { $true }
        [ordered]@{ file=$name; sha256=$zipHash; matchesSource=$true; changedFromPrevious=$changed }
    }
    $reader = [IO.StreamReader]::new($archive.GetEntry('manifest.json').Open(), [Text.Encoding]::UTF8)
    try { $packedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($packedManifest.version -ne $manifest.version) { throw 'ZIP 的版本与源码不一致' }
    # 分享目录可只保留明确附带的上一版；核对范围由参数说明，不暗示附带所有历史包。
    if (-not $ExpectedPreviousVersions.Count) { $ExpectedPreviousVersions = @($PreviousVersion) }
    foreach ($version in $ExpectedPreviousVersions) { if ($version -notmatch '^\d+\.\d+\.\d+$') { throw '历史版本需要是三段数字版本号。' } }
    $oldPreserved = $ExpectedPreviousVersions | ForEach-Object { Test-Path -LiteralPath (Join-Path $projectRoot "releases\夜航-Chrome-$_.zip") }
    $report = [ordered]@{
        verifiedAt=[DateTimeOffset]::Now.ToString('o'); path=$resolvedPackage; version=$manifest.version
        sizeBytes=(Get-Item -LiteralPath $resolvedPackage).Length
        sha256=(Get-FileHash -LiteralPath $resolvedPackage -Algorithm SHA256).Hash
        filesCount=$items.Count; runtimeFilesMatchSource=$true; manifestAtRoot=$true
        oldReleasesPreserved=($oldPreserved -notcontains $false)
        expectedPreviousVersions=@($ExpectedPreviousVersions)
        comparedWithVersion=$PreviousVersion; previousPackageFound=($null -ne $previous)
        changedRuntimeFiles=@($items | Where-Object changedFromPrevious | ForEach-Object file)
        files=@($items)
    }
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    [PSCustomObject]$report | Select-Object version, sizeBytes, sha256, filesCount, runtimeFilesMatchSource, oldReleasesPreserved
}
finally { $archive.Dispose(); if ($previous) { $previous.Dispose() } }
