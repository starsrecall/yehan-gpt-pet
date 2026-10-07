/*
 * 新 Work 语义节点 / 局部主题变量的真实 Chrome 适配回归。
 * 页面是公开源码线索派生的本机夹具，不代表已获取用户实机 DOM。
 * --before 保留旧版失败证据；默认结果写入独立 after 文件，不改原验证记录。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
let playwright;
if (process.env.NEBULA_PLAYWRIGHT_PATH) playwright = require(process.env.NEBULA_PLAYWRIGHT_PATH);
else {
  try { playwright = require('playwright'); }
  catch { throw new Error("需要 Playwright 测试依赖；请使用项目开发依赖或设置 NEBULA_PLAYWRIGHT_PATH。"); }
}
const { chromium } = playwright;
const extensionDir = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'chatgpt-work.html'), 'utf8');
const before = process.argv.includes('--before');
const resultPath = path.join(__dirname, before ? 'work-results-before.json' : 'work-results-after.json');
// 当前回归按版本保存图片，历史 before 证据不由新运行覆盖。
const screenshotDir = path.resolve(extensionDir, '..', 'docs', 'assets', 'regression-' + JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version);
const report = {
  startedAt: new Date().toISOString(),
  environment: '真实 Chrome / 独立临时 profile / 本地 route.fulfill 来源派生夹具',
  scope: '验证新颜色变量、Work 语义节点及局部主题的样式规则；并非实机 DOM、真实账号页面验证。',
  phase: before ? 'before' : 'after',
  sourceReferences: [
    {url:'https://gist.github.com/alexchexes/d2ff0b9137aa3ac9de8b0448138125ce',scriptVersion:'2026-09-26',use:'现代颜色 token'},
    {url:'https://github.com/yanhuuo/Codex-Xuanling-Theme/blob/e6bc7e8bb600017fa306f6ce6bf97e0969184c76/windows/engine/theme-base.css',use:'侧栏与输入框语义类；跨产品适配经验，非 ChatGPT 实机 DOM'},
    {url:'https://raw.githubusercontent.com/dboyza/GPTskins/master/content/content.js',use:'@layer utilities 层叠覆盖思路；未确认最新提交日期'}
  ],
  fixtureSha256: crypto.createHash('sha256').update(fixture).digest('hex'),
  extensionVersion: JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version,
  stylesheetSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'styles', 'site.css'))).digest('hex'),
  browserVersion: '', checks: [], remoteRequests: [], errors: []
};
let context, settingsPage, page;

async function check(name, action) {
  const start = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, passed: true, durationMs: Date.now() - start, detail });
    process.stdout.write('PASS ' + name + '\n');
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Date.now() - start, error: error.message });
    process.stdout.write('FAIL ' + name + ': ' + error.message + '\n');
  }
}

// rgba/rgb 的 alpha 是底色遮挡关键；没有 alpha 即不透明。
function alpha(color) {
  if (color === 'transparent') return 0;
  const match = color.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error('无法解析浏览器颜色 ' + color);
  const parts = match[1].split(',').map(Number);
  return parts.length === 4 ? parts[3] : 1;
}
function assertTranslucent(node, label) {
  assert.ok(alpha(node.background) < 0.95, label + ' 仍被不透明灰底遮挡: ' + JSON.stringify(node));
}
async function patchSettings(patch) {
  await settingsPage.evaluate(value => NebulaSettings.set(value), patch);
  await page.waitForFunction(value => document.documentElement.dataset.nebulaEnabled === String(value.enabled) && document.documentElement.dataset.nebulaMode === value.mode, { enabled: patch.enabled, mode: patch.mode });
  await page.waitForTimeout(50);
}
async function configure(theme, sidebar) {
  await page.evaluate(({ theme, sidebar }) => {
    const root = document.documentElement;
    const shell = document.getElementById('work-shell');
    root.removeAttribute('data-theme'); root.classList.remove('dark'); shell.removeAttribute('data-theme');
    if (theme === 'root-class') root.classList.add('dark');
    if (theme === 'html-theme') root.dataset.theme = 'dark';
    if (theme === 'nested-theme') shell.dataset.theme = 'dark';
    const aside = document.querySelector('aside');
    aside.className = sidebar === 'desktop' ? 'app-shell-left-panel' : '';
    aside.id = sidebar === 'desktop' ? 'fixture-sidebar' : 'stage-slideover-sidebar';
  }, { theme, sidebar });
}
async function styles() {
  return page.evaluate(() => {
    const ids = ['sidebar-inner','sidebar-footer','fixture-composer','work-form','composer-inner','composer-footer','selected-item','hover-item','work-send'];
    const nodeStyle = node => {
      const s = getComputedStyle(node), b = node.getBoundingClientRect();
      return { background:s.backgroundColor, blur:s.backdropFilter, color:s.color, width:b.width, height:b.height, x:b.x, y:b.y };
    };
    const result = { sidebar:nodeStyle(document.querySelector('aside')) };
    for (const id of ids) result[id] = nodeStyle(document.getElementById(id));
    return result;
  });
}

/*
 * 回归片段用明确的原生语义标记构造，不依赖随机 CSS Modules 后缀。
 * 在视口外挂载以免影响截图及原夹具布局；每项结束移除这一测试节点。
 */
async function inspectBoundary(markup) {
  return page.evaluate(html => {
    document.getElementById('work-boundary-fixture')?.remove();
    const holder = document.createElement('section');
    holder.id = 'work-boundary-fixture';
    holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:360px;';
    holder.innerHTML = '<style>@layer utilities { .boundary-solid {background:#444a56 !important;} .bg-token-bg-primary {background:var(--bg-primary) !important;} .bg-token-main-surface-primary {background:var(--main-surface-primary) !important;} [class~="bg-(--composer-surface-primary)"] {background:var(--composer-surface-primary) !important;} }</style>' + html;
    document.querySelector('main').appendChild(holder);
    return [...holder.querySelectorAll('[data-boundary-node]')].map(node => ({
      name:node.dataset.boundaryNode,
      background:getComputedStyle(node).backgroundColor,
      blur:getComputedStyle(node).backdropFilter
    }));
  }, markup);
}
async function clearBoundary() {
  await page.evaluate(() => document.getElementById('work-boundary-fixture')?.remove());
}

async function main() {
  fs.mkdirSync(screenshotDir, { recursive:true });
  const profileParent = path.resolve(extensionDir, '..', '.test-profiles');
  fs.mkdirSync(profileParent, { recursive:true });
  // 保留路径供诊断；不删除用户未确认的文件或目录。
  report.profile = fs.mkdtempSync(path.join(profileParent, 'nebula-work-'));
  context = await chromium.launchPersistentContext(report.profile, {
    executablePath:process.env.NEBULA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless:true, ignoreDefaultArgs:['--disable-extensions'],
    args:['--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check'],
    viewport:{width:1600,height:1000}, reducedMotion:'no-preference'
  });
  report.browserVersion = context.browser().version();
  const cdp = await context.browser().newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked', { path:extensionDir });
  report.extensionId = loaded.id;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['http:','https:'].includes(url.protocol)) return route.continue();
    if (url.hostname === 'chatgpt.com') return route.fulfill({ status:200, contentType:'text/html; charset=utf-8',body:fixture,
      headers:{'content-security-policy':"default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'"} });
    report.remoteRequests.push(route.request().url());
    return route.abort();
  });
  context.on('page', candidate => candidate.on('pageerror', error => report.errors.push({url:candidate.url(),message:error.message})));
  settingsPage = await context.newPage();
  await settingsPage.goto('chrome-extension://' + loaded.id + '/options.html');
  await settingsPage.waitForFunction(() => typeof NebulaSettings !== 'undefined');
  await settingsPage.evaluate(() => NebulaSettings.reset());
  page = await context.newPage();
  await page.goto('https://chatgpt.com/nebula-work-regression');
  await page.waitForFunction(() => document.documentElement.dataset.nebulaEnabled === 'true');

  await check('来源派生夹具确实没有旧版 sidebar/composer id', async () => {
    assert.equal(await page.locator('#sidebar,[data-testid="sidebar"],#composer-background,#prompt-textarea,[data-testid="composer"]').count(),0);
    return '模拟新增语义结构，未沿用旧夹具适配锚点。';
  });
  await settingsPage.evaluate(() => NebulaSettings.set({enabled:false}));
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-nebula-enabled'));
  const original = await styles();
  report.original = original;
  await patchSettings({enabled:true,mode:'soft',panelOpacity:60,blur:14,preset:'character',dim:35,motion:false});

  for (const mode of ['soft','glass']) {
    await patchSettings({enabled:true,mode});
    for (const theme of ['root-class','html-theme','nested-theme']) {
      for (const sidebar of ['desktop','slideover']) {
        await configure(theme,sidebar);
        await check(mode + ' / ' + theme + ' / ' + sidebar + ' 侧栏及输入框多层灰底消除', async () => {
          const actual = await styles();
          // 单个外层与内层均不能残留 alpha=1；组合也不能接近不透明。
          // 用户底栏遮挡滚动项目，需要实底；其余已识别表面仍保持单层透明。
          for (const key of ['sidebar','sidebar-inner','fixture-composer','work-form','composer-inner','composer-footer']) assertTranslucent(actual[key],key);
          assert.equal(alpha(actual['sidebar-footer'].background),1,'用户底栏不能透出项目文字');
          const sideAlpha = 1 - (1-alpha(actual.sidebar.background)) * (1-alpha(actual['sidebar-inner'].background));
          const composerAlpha = 1 - ['fixture-composer','work-form','composer-inner'].reduce((v,key)=>v*(1-alpha(actual[key].background)),1);
          assert.ok(sideAlpha < .95,'侧栏多层底色叠加后仍不透明: '+sideAlpha);
          assert.ok(composerAlpha < .95,'输入框多层底色叠加后仍不透明: '+composerAlpha);
          assert.equal(actual.sidebar.blur,original.sidebar.blur,'侧栏容器不能新增会改变 fixed 定位的 filter');
          assert.ok(actual['fixture-composer'].blur.includes('14px') || actual['work-form'].blur.includes('14px'),'输入框 blur 未使用设置值');
          assert.equal(actual['work-send'].background, original['work-send'].background,'原生发送按钮强调色被改写');
          return {sideAlpha,composerAlpha,styles:actual};
        });
      }
    }
  }

  await configure('nested-theme','desktop');
  await check('选择状态与悬停具有独立可读底色', async () => {
    await page.locator('#hover-item').hover();
    const actual = await styles();
    for (const key of ['selected-item','hover-item']) {
      assert.ok(alpha(actual[key].background)>0,'导航状态底色不可见: '+key);
      assert.notEqual(actual[key].background, actual['sidebar-inner'].background,'导航状态与普通侧栏底色完全相同: '+key);
      assert.notEqual(actual[key].color, actual[key].background,'文字与底色相同: '+key);
    }
    return {selected:actual['selected-item'],hover:actual['hover-item']};
  });
  await check('嵌套局部主题的 dialog/alertdialog/menu/listbox 仍为实色', async () => {
    const actual = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')].map(el => ({role:el.getAttribute('role'),parent:el.closest('aside')?'sidebar':'main',background:getComputedStyle(el).backgroundColor,inner:getComputedStyle(el.querySelector('.protected-inner')).backgroundColor})));
    assert.equal(actual.length,8);
    for (const node of actual) { assert.equal(alpha(node.background),1,JSON.stringify(node)); assert.equal(alpha(node.inner),1,'保护区域内层被透明化: '+JSON.stringify(node)); }
    return actual;
  });
  await check('body 的独立层叠上下文仍然有效', async () => {
    try {
      await page.evaluate(()=>{const style=document.createElement('style');style.id='body-isolation-fixture';style.textContent='body { isolation:auto; }';document.head.appendChild(style);});
      assert.equal(await page.evaluate(()=>getComputedStyle(document.body).isolation),'isolate');
      return '原网页未分层 isolation:auto 没有压过壁纸的 body 负层级上下文。';
    } finally {await page.evaluate(()=>document.getElementById('body-isolation-fixture')?.remove());}
  });

  for (const [name,markup] of [
    ['旧 composer id 外壳 + Work 内层', '<div id="composer-background" class="boundary-solid" data-boundary-node="outer"><div class="composer-surface-chrome boundary-solid" data-boundary-node="surface"><form data-type="unified-composer" class="boundary-solid" data-boundary-node="form"><div class="ProseMirror" contenteditable="true"></div></form></div></div>'],
    ['旧 composer test-id 外壳 + Work 内层', '<div data-testid="composer" class="boundary-solid" data-boundary-node="outer"><div class="composer-surface-chrome boundary-solid" data-boundary-node="surface"><form data-type="unified-composer" class="boundary-solid" data-boundary-node="form"><div class="ProseMirror" contenteditable="true"></div></form></div></div>'],
    ['两种 recognized surface 真嵌套', '<div class="composer-surface-chrome boundary-solid" data-boundary-node="outer"><div class="bg-(--composer-surface-primary)" data-boundary-node="surface"><form data-type="unified-composer" class="boundary-solid" data-boundary-node="form"><div class="ProseMirror" contenteditable="true"></div></form></div></div>'],
    ['普通聊天 group/composer 外壳 + primary 内层', '<form class="group/composer boundary-solid" data-boundary-node="outer"><div class="bg-(--composer-surface-primary)" data-boundary-node="surface"><div class="ProseMirror" contenteditable="true"></div></div></form>'],
    ...['bg-token-main-surface-primary','bg-token-bg-primary'].flatMap(token=>[
      ['显式 Work 表面兼有 '+token,'<div class="composer-surface-chrome boundary-solid '+token+'" data-boundary-node="surface"><form data-type="unified-composer" class="boundary-solid" data-boundary-node="form"><div class="ProseMirror" contenteditable="true"></div></form></div>'],
      ['fallback composer id 兼有 '+token,'<div id="composer-background" class="boundary-solid '+token+'" data-boundary-node="surface"><div class="ProseMirror" contenteditable="true"></div></div>']
    ])
  ]) {
    await check(name + ' 只绘制一层输入玻璃', async () => {
      try {
        const actual = await inspectBoundary(markup);
        const combinedAlpha = 1 - actual.reduce((product,node)=>product*(1-alpha(node.background)),1);
        assert.ok(Math.abs(combinedAlpha-.65)<.01,'合成不透明度应为一层 .65，实际 '+combinedAlpha+' / '+JSON.stringify(actual));
        assert.equal(actual.filter(node=>alpha(node.background)>0).length,1,'输入区域残留多层底色: '+JSON.stringify(actual));
        assert.ok(actual.some(node=>node.blur.includes('14px')),'识别到的输入表面均未应用 blur: '+JSON.stringify(actual));
        return {combinedAlpha,nodes:actual};
      } finally { await clearBoundary(); }
    });
  }
  await check('侧栏与输入内层自行挂局部主题仍无叠色', async () => {
    try {
      await page.evaluate(()=>{document.getElementById('sidebar-inner').dataset.theme='dark';document.getElementById('composer-inner').dataset.theme='dark';});
      const actual=await styles();
      const sideAlpha=1-(1-alpha(actual.sidebar.background))*(1-alpha(actual['sidebar-inner'].background));
      const composerAlpha=1-['fixture-composer','work-form','composer-inner'].reduce((product,key)=>product*(1-alpha(actual[key].background)),1);
      assert.ok(Math.abs(sideAlpha-.6)<.01,'侧栏内层 data-theme 重设透明变量: '+sideAlpha);
      assert.ok(Math.abs(composerAlpha-.65)<.01,'输入内层 data-theme 重设透明变量: '+composerAlpha);
      return {sideAlpha,composerAlpha,sidebarInner:actual['sidebar-inner'],composerInner:actual['composer-inner']};
    } finally { await page.evaluate(()=>{document.getElementById('sidebar-inner').removeAttribute('data-theme');document.getElementById('composer-inner').removeAttribute('data-theme');}); }
  });

  for (const role of ['dialog','alertdialog','menu','listbox']) {
    await check('form[role='+role+'] 自身和输入表面不被清底', async () => {
      try {
        const actual=await inspectBoundary('<form role="'+role+'" class="boundary-solid" data-boundary-node="form"><div class="composer-surface-chrome boundary-solid" data-boundary-node="surface"><div class="bg-token-bg-primary" data-theme="dark" data-boundary-node="inner"></div></div></form>');
        for(const node of actual) assert.equal(alpha(node.background),1,'受保护表单被透明化: '+JSON.stringify(node));
        return actual;
      } finally {await clearBoundary();}
    });
  }
  for (const [name,markup] of [
    ['Radix wrapper 内 primary 工具类', '<div data-radix-popper-content-wrapper data-boundary-node="wrapper"><div class="bg-token-bg-primary" data-boundary-node="primary"><div data-theme="dark" class="bg-token-bg-primary" data-boundary-node="nested"></div></div></div>'],
    ['Radix wrapper 自身兼有 composer/form 语义', '<form data-radix-popper-content-wrapper data-type="unified-composer" class="composer-surface-chrome" data-boundary-node="wrapper"><div class="bg-token-bg-primary" data-theme="dark" data-boundary-node="nested"></div></form>'],
    ['main[role=dialog] 与自身 header', '<main role="dialog" class="boundary-solid" data-boundary-node="main"><header class="boundary-solid" data-boundary-node="header"><div class="bg-token-bg-primary" data-boundary-node="inner"></div></header></main>'],
    ['dialog 中 main/header 与 header 自身弹层', '<div role="dialog" data-boundary-node="dialog"><main class="boundary-solid" data-boundary-node="main"><header class="boundary-solid" data-boundary-node="header"><div class="bg-token-bg-primary" data-boundary-node="inner"></div></header></main></div><header role="menu" class="boundary-solid" data-boundary-node="menu-header"><div class="bg-token-bg-primary" data-theme="dark" data-boundary-node="menu-inner"></div></header>']
  ]) {
    await check(name + ' 保留实色', async()=>{
      try {
        const actual=await inspectBoundary(markup);
        for(const node of actual) assert.equal(alpha(node.background),1,'受保护弹层被透明化: '+JSON.stringify(node));
        return actual;
      } finally {await clearBoundary();}
    });
  }
  await check('无旧编辑器 id 的 ProseMirror 与发送按钮仍可操作', async () => {
    await page.evaluate(() => document.getElementById('work-send').addEventListener('click',()=>{document.getElementById('sent-message').textContent=document.getElementById('work-editor').textContent;}));
    await page.locator('#work-editor').fill('Work 新输入结构 ✓');
    await page.locator('#work-send').click();
    assert.equal(await page.locator('#sent-message').textContent(),'Work 新输入结构 ✓');
    return '原编辑器内容、原按钮事件正常工作。';
  });
  await check('窄屏样式没有更改网页原生布局尺寸', async () => {
    await page.setViewportSize({width:760,height:1000});
    const enabled = await styles();
    await settingsPage.evaluate(() => NebulaSettings.set({enabled:false}));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-nebula-enabled'));
    const disabled = await styles();
    for (const key of ['sidebar','sidebar-inner','fixture-composer','work-form','composer-footer']) for (const prop of ['width','height','x','y']) assert.equal(enabled[key][prop],disabled[key][prop],key+' / '+prop+' 布局被改动');
    await patchSettings({enabled:true,mode:'glass'});
    await page.setViewportSize({width:1600,height:1000});
    return {width:760,sidebarWidth:enabled.sidebar.width,composerWidth:enabled['fixture-composer'].width};
  });
  await check('关闭插件恢复所有原始灰底及清理注入', async () => {
    await configure('html-theme','desktop');
    await settingsPage.evaluate(() => NebulaSettings.set({enabled:false}));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-nebula-enabled'));
    const disabled = await styles();
    for (const key of ['sidebar','sidebar-inner','sidebar-footer','fixture-composer','work-form','composer-inner','composer-footer','work-send']) assert.equal(disabled[key].background,original[key].background,'关闭后原底色未恢复: '+key);
    assert.equal(await page.locator('#nebula-backdrop').count(),0);
    return {sidebar:disabled.sidebar.background,composer:disabled['fixture-composer'].background};
  });
  await patchSettings({enabled:true,mode:'glass'});
  await page.locator('#work-editor').fill('');
  await page.evaluate(()=>{document.getElementById('sent-message').textContent='';});
  await page.mouse.move(1500,900);
  await page.waitForTimeout(500);
  const screenshot = path.join(screenshotDir,before?'修复验证-Work-修复前.png':'修复验证-Work.png');
  await page.screenshot({path:screenshot,fullPage:true});
  report.screenshot = screenshot;
  await check('未产生脚本错误或额外远程请求', async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.remoteRequests,[]);return '测试账户网络与外部资源均未参与。';});
}

main().catch(error=>{report.fatal={message:error.message,stack:error.stack};process.stdout.write('FATAL '+error.message+'\n');}).finally(async()=>{
  if(context) await context.close();
  report.finishedAt=new Date().toISOString();
  report.passed=!report.fatal && report.checks.every(item=>item.passed);
  fs.writeFileSync(resultPath,JSON.stringify(report,null,2));
  process.stdout.write('RESULT '+resultPath+'\n');
  process.exitCode=report.passed?0:1;
});
