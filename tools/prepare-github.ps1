# 按明确清单创建分享副本，不读取私钥、不复制浏览器资料、不删除或覆盖原材料。
param([string]$DirectoryName = '夜航-GitHub')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([IO.Path]::GetFileName($DirectoryName) -ne $DirectoryName -or $DirectoryName -in @('.', '..')) { throw 'DirectoryName 需要是单个文件夹名。' }
$shareRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot $DirectoryName))
if (-not $shareRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '分享目录必须位于项目内。' }
if (Test-Path -LiteralPath $shareRoot) { throw "分享目录已经存在，保留现有内容：$shareRoot" }

$files = @('.gitignore','package.json','CHANGELOG.md','TESTING.md')
$runtime = @('manifest.json','README.md','content.js','backdrop.html','backdrop.css','backdrop.js','options.html','options.css','options.js','popup.html','popup.css','popup.js')
$files += $runtime | ForEach-Object { "chatgpt-nebula-extension/$_" }
foreach ($folder in @('assets','shared','styles')) {
    $folderRoot = Join-Path $projectRoot "chatgpt-nebula-extension/$folder"
    $files += Get-ChildItem -LiteralPath $folderRoot -File -Recurse | ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1).Replace('\','/') }
}
$files += @('browser-smoke.cjs','work-style-smoke.cjs','layout-style-smoke.cjs','composer-visual-smoke.cjs','wireframe-preset-smoke.cjs','dynamic-wireframe-smoke.cjs') | ForEach-Object { "chatgpt-nebula-extension/tests/$_" }
$files += @('chatgpt.html','chatgpt-work.html','chatgpt-layout.html','chatgpt-composer.html','chatgpt-wireframe.html') | ForEach-Object { "chatgpt-nebula-extension/tests/fixtures/$_" }
$files += @('results-0.1.5.json','work-results-0.1.5.json','dynamic-wireframe-results-0.1.5.json','syntax-results-0.1.5.json','release-0.1.5.json') | ForEach-Object { "chatgpt-nebula-extension/tests/$_" }
$files += @('ChatGPT网页皮肤插件规划书.md','维护与验证说明.md','人物双态背景说明-0.1.5.md','人物双态素材生成记录-0.1.4.md','线框蓝光素材生成记录.md','壁纸素材生成记录.md','验证记录-0.1.5.md','上传材料说明.md') | ForEach-Object { "docs/$_" }
$files += @('人物双态-0.1.5-线框相.png','人物双态-0.1.5-人物相.png','线框蓝光-0.1.3-夹具实渲染.png','夜航-成品效果图-v1.png','夜航-0.1.5-设置页.png') | ForEach-Object { "docs/assets/$_" }
$files += @('tools/build-release.ps1','tools/verify-release.ps1','tools/prepare-github.ps1','releases/夜航-Chrome-0.1.5.zip','releases/夜航-Chrome-0.1.4.zip')
foreach ($file in $files) { if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $file) -PathType Leaf)) { throw "缺少整理材料：$file" } }

New-Item -ItemType Directory -Path $shareRoot | Out-Null
foreach ($file in $files) {
    $source = Join-Path $projectRoot $file
    $target = Join-Path $shareRoot $file
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    if ($file.StartsWith('docs/') -and $file.EndsWith('.md')) {
        $text = [IO.File]::ReadAllText($source)
        # 生成提示词和实际素材保留，个人电脑的原始生成路径省略。
        $text = [regex]::Replace($text, 'C:\\Users\\[^\\]+\\\.codex\\generated_images\\[^`\r\n]+', '<本机生成输出路径已省略>')
        $text = $text.Replace($projectRoot, '<项目根目录>')
        # 素材记录保留生成时的历史日期，当前使用方式指向本次附带说明。
        $text = $text.Replace('(人物双态背景说明-0.1.4.md)', '(人物双态背景说明-0.1.5.md)')
        $text = $text.Replace('开启 固定 10 秒', '开启固定 10 秒')
        $text = $text.Replace('；0.1.3 冻结证据在 `验证记录-0.1.3.md`', '')
        [IO.File]::WriteAllText($target,$text,[Text.UTF8Encoding]::new($false))
    } elseif ($file.StartsWith('chatgpt-nebula-extension/tests/') -and $file.EndsWith('.json')) {
        # 只改分享副本中的本机路径，不改断言、尺寸、版本、哈希或时间戳。
        $text = [IO.File]::ReadAllText($source).Replace($projectRoot.Replace('\','\\'), '<project-root>').Replace($projectRoot, '<project-root>')
        $text = [regex]::Replace($text, 'C:\\\\Users\\\\[^\\"\r\n]+', '<local-user>')
        $text = [regex]::Replace($text, '^\s*\{', "{`n  `"publicationNote`": `"分享副本仅归一化本机路径；断言、数值、版本、时间与运行文件哈希保留。原始运行工件留在本机。`",")
        $null = $text | ConvertFrom-Json
        [IO.File]::WriteAllText($target,$text,[Text.UTF8Encoding]::new($false))
    } else { Copy-Item -LiteralPath $source -Destination $target }
}

$readme = @'
# 夜航 · ChatGPT 网页皮肤

个人使用的 Chrome 扩展，版本 **0.1.5**。用本机壁纸、青蓝色光效和半透明面板，为 ChatGPT 网页留一点自己的空间。代码包含中文注释。

![人物画面](docs/assets/人物双态-0.1.5-人物相.png)

## 加载与使用

1. 在 Chrome 中打开 `chrome://extensions`，开启开发者模式。
2. 选择“加载已解压的扩展程序”，定位到本仓库的 **chatgpt-nebula-extension** 文件夹，它直接包含 manifest.json。
3. 刷新 ChatGPT。打开夜航完整设置，选择“线框蓝光”，开启“动态效果”和“人物画面切换”。

人物切换固定 **10 秒一轮**：0–2 秒线框，2–4 秒渐变为人物，4–6 秒人物，6–8 秒回到线框，8–10 秒线框。新增开关默认关闭；升级保留已有选择。一键“应用原版风格”可以同时应用参考配色和透明度，但保留原总动态开关。

升级时沿用原加载目录，重载扩展并整页刷新网页，以继续使用原有设置与本机素材。也可从 releases 解压当前版本的运行包；不要把整个仓库根目录当作扩展加载目录。

## 目录

| 路径 | 内容 |
| --- | --- |
| chatgpt-nebula-extension/ | 可直接加载的插件源码、本机壁纸、设置界面 |
| chatgpt-nebula-extension/tests/ | 六类回归脚本、匿名 HTML 夹具和当前冻结报告 |
| docs/ | 规划、维护、10 秒效果说明、素材提示词和验证范围 |
| docs/assets/ | 设计图及模拟页面中的实际扩展渲染图 |
| tools/ | 打包、包内文件核对和材料整理工具 |
| releases/ | 0.1.5 当前运行包及 0.1.4 对照包 |

完整用法见 [扩展说明](chatgpt-nebula-extension/README.md)，开发测试见 [TESTING.md](TESTING.md)，修订历史见 [CHANGELOG.md](CHANGELOG.md)。最新证据见 [0.1.5 验证记录](docs/验证记录-0.1.5.md)，材料处理范围见 [上传材料说明](docs/上传材料说明.md)。

## 实现与验证范围

人物变化采用两张同构图静态壁纸叠化，运行时不调用模型。只使用 storage 权限；内容脚本匹配 chatgpt.com，背景在独立扩展 iframe 内绘制，不读取会话内容。自定义图片和视频留在本机。

演示图来自离线模拟页面，不是实际登录账号；测试通过不保证未来网页改版自动兼容。后台暂停通过可见性通知模拟，页面恢复使用合成事件。具体实测范围与限制写在验证记录中。

本目录经过独立复制整理，原文件和历史版本留在原工程；没有执行 GitHub 上传、提交或推送。
'@
[IO.File]::WriteAllText((Join-Path $shareRoot 'README.md'),$readme,[Text.UTF8Encoding]::new($false))

# 对分享文件生成清单；清单本身不纳入自己的哈希，避免自引用。
$items = Get-ChildItem -LiteralPath $shareRoot -File -Recurse | ForEach-Object {
    [ordered]@{ file=$_.FullName.Substring($shareRoot.Length + 1).Replace('\','/'); sizeBytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
}
$inventory = [ordered]@{ version='0.1.5'; preparedAt=[DateTimeOffset]::Now.ToString('o'); fileCount=$items.Count; files=@($items) }
[IO.File]::WriteAllText((Join-Path $shareRoot 'docs/整理清单.json'),($inventory | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
[PSCustomObject]@{ directory=$shareRoot; files=$items.Count + 1; totalBytes=($items | ForEach-Object sizeBytes | Measure-Object -Sum).Sum }
