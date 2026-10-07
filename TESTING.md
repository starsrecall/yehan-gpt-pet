# 夜航开发测试

加载扩展只需要 Chrome，不需要 Node 或 Playwright。本文件用于修改源码后的本地回归；不会使用真实 ChatGPT 账号。

## 依赖与执行

测试可从项目的 `playwright` 开发依赖读取，也可通过 `NEBULA_PLAYWRIGHT_PATH` 指向已有模块。本次实际使用 Playwright **1.62.1**，该版本取自本机已提供运行库的 package.json；项目将此版本固定在开发依赖中。本次整理没有执行安装。

开发者需要自行准备 Node 20 或更新版本以及 Playwright，之后在项目根目录运行：

```text
npm run test:dynamic
npm run test:browser
npm run test:wireframe
npm run test:work
npm run test:layout
npm run test:composer
```

如果已经有可用 Playwright，可在自己的终端设置 `NEBULA_PLAYWRIGHT_PATH` 后直接使用上述脚本，无需重复安装。`NEBULA_CHROME_PATH` 可以覆盖 Chrome 路径；默认使用 Windows 的 `C:\Program Files\Google\Chrome\Application\chrome.exe`。测试没有写死维护者用户名或个人依赖目录。

脚本自动创建独立 `.test-profiles/`，通过扩展调试接口加载源码；网站响应由本地 HTML 夹具提供，外部请求记录或阻断。测试结束后会关闭自己启动的浏览器，保留资料与证据，不自动删除文件。

## 结果与重复运行

动态回归每次生成独立 `dynamic-wireframe-artifacts/run-…/report.json` 和相位截图。版本冻结报告已经存在时会保留它，本次结果以终端输出的当次报告路径为准。其他脚本的共享最新结果会更新，明确版本报告保留为冻结证据。

本次实际运行情况与浏览器版本见 [0.1.5 验证记录](docs/验证记录-0.1.5.md)。不要将旧版本的通过数直接描述为新版本重新执行的结果。

## 发布工具

```powershell
.\tools\build-release.ps1
.\tools\verify-release.ps1 -PreviousVersion 0.1.4 -ReportName release-0.1.5-recheck.json
```

默认打包名取 manifest 版本；已存在的 ZIP 会保留并提示，可用 `-OutputName` 给新包命名。核对脚本只读 ZIP、比较运行文件哈希，不解压或安装。已有报告不会覆盖，重新核对请用新的 `-ReportName`。分享目录附带 0.1.4 对照包，历史包核对默认仅检查该明确上一版；如需核对更多历史版本，可通过 `-ExpectedPreviousVersions` 指定。

## 证据范围

这些是离线夹具中的扩展和界面行为检查，不代表当前登录账号的完整网页兼容性。动态截图是浏览器动画相位采样；自然时间推进单独测量。headless 标签切换未产生真实隐藏状态，后台暂停通过可见性通知模拟；`pagehide/pageshow` 为合成事件，不证明真实 BFCache 命中。

分享副本的报告只归一化本机路径；断言、测量值、版本与运行文件哈希保留。原始参考界面截图、浏览器 profile、签名私钥及临时 run 未纳入分享目录。
