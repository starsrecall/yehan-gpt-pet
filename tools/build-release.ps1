# 夜航发布工具：明确列举运行文件，不打包测试资料，也不删除旧包。
# 执行位置不限；输出路径保持在项目的 releases 目录内。
param([string]$OutputName = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'chatgpt-nebula-extension'
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
$runtimeItems = @(
    'manifest.json', 'README.md', 'content.js',
    'backdrop.html', 'backdrop.css', 'backdrop.js',
    'options.html', 'options.css', 'options.js',
    'popup.html', 'popup.css', 'popup.js',
    'assets', 'shared', 'styles'
)
$runtimePaths = foreach ($item in $runtimeItems) {
    $itemPath = Join-Path $extensionRoot $item
    if (-not (Test-Path -LiteralPath $itemPath)) { throw "运行文件缺失：$item" }
    $itemPath
}
# 检查 manifest 的本机入口，避免得到看似完整却不能加载的压缩包。
$referencedFiles = @($manifest.action.default_popup, $manifest.options_ui.page)
# 内置壁纸在背景脚本中选择，不在 manifest 图标清单里；发布前另行核对。
$referencedFiles += @('assets/character-wallpaper.png', 'assets/wireframe-wallpaper.png', 'assets/wireframe-color-v1.png')
$referencedFiles += $manifest.icons.PSObject.Properties.Value
foreach ($entry in $manifest.content_scripts) { $referencedFiles += $entry.js; $referencedFiles += $entry.css }
foreach ($entry in $manifest.web_accessible_resources) { $referencedFiles += $entry.resources }
foreach ($file in $referencedFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot $file) -PathType Leaf)) {
        throw "manifest 引用不存在：$file"
    }
}
if (-not $OutputName) { $OutputName = "夜航-Chrome-$($manifest.version).zip" }
# 输出名只允许单文件名，用户参数不能把包写到项目外部。
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName -or -not $OutputName.EndsWith('.zip')) {
    throw 'OutputName 需要是以 .zip 结尾的单个文件名。'
}
$releaseRoot = Join-Path $projectRoot 'releases'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$releasePath = Join-Path $releaseRoot $OutputName
if (Test-Path -LiteralPath $releasePath) {
    throw "发布包已存在，保留原文件。请指定新 OutputName：$releasePath"
}
Compress-Archive -LiteralPath $runtimePaths -DestinationPath $releasePath -CompressionLevel Optimal
Get-Item -LiteralPath $releasePath | Select-Object FullName, Length
