/*
 * 使用已安装 Chrome 的独立临时 profile 验证 MV3，不进入用户的浏览器配置。
 * chatgpt.com 的页面全部由本地夹具拦截；真实网络、账户、会话均不参与测试。
 * Chrome 137+ 的品牌浏览器通过调试接口加载测试扩展，不依赖已移除的 load-extension 参数。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// 可配置本机 Playwright；先尝试通用 module，再回退当前 Codex 随附版本。
let playwright;
if (process.env.NEBULA_PLAYWRIGHT_PATH) playwright = require(process.env.NEBULA_PLAYWRIGHT_PATH);
else {
  try { playwright = require('playwright'); }
  catch { throw new Error("需要 Playwright 测试依赖；请使用项目开发依赖或设置 NEBULA_PLAYWRIGHT_PATH。"); }
}
const { chromium } = playwright;

const extensionDir = path.resolve(__dirname, '..');
const chromePath = process.env.NEBULA_CHROME_PATH || process.env.NEBULA_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'chatgpt.html'), 'utf8');
// 新版本证据独立保存，避免回归执行覆盖旧版本文档中的截图。
const runtimeVersion = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version;
const screenshotDir = path.resolve(extensionDir, '..', 'docs', 'assets', 'regression-' + runtimeVersion);
const resultPath = path.join(__dirname, 'results-latest.json');
const report = {
  startedAt: new Date().toISOString(),
  environment: '已安装 Chrome / 独立临时 profile / 本地 route.fulfill 夹具',
  scope: '验证扩展实际加载和可控夹具；未验证真实账号 ChatGPT 页面兼容性。',
  browserVersion: '', extensionId: '', profile: '', checks: [], unexpectedRemoteRequests: [], errors: [], console: [], requestsFailed: [], screenshots: []
};
let context;
let options;
let page;
let extensionOrigin;

async function check(name, work) {
  const startedAt = Date.now();
  try {
    const detail = await work();
    report.checks.push({ name, passed: true, durationMs: Date.now() - startedAt, detail: detail || '' });
    process.stdout.write('PASS ' + name + '\n');
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Date.now() - startedAt, error: error.message });
    process.stdout.write('FAIL ' + name + ': ' + error.message + '\n');
  }
}

// 每次重新寻找 Frame，开关皮肤和修复 DOM 都可能销毁旧 iframe。
async function background() {
  await page.locator('#nebula-backdrop').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#nebula-backdrop')?.contentWindow !== null);
  for (let attempt = 0; attempt < 80; attempt++) {
    const frame = page.frames().find(item => item.url().startsWith(extensionOrigin + '/backdrop.html'));
    if (frame && await frame.locator('#preset').count()) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error('扩展源背景 iframe 没有完成加载。');
}

async function settings(patch) {
  return options.evaluate(async value => NebulaSettings.set(value), patch);
}

async function mediaRecord() {
  return options.evaluate(async () => {
    const item = await NebulaMedia.load();
    return item ? { name: item.name, mimeType: item.mimeType, size: item.blob.size, posterSize: item.posterBlob.size, updatedAt: item.updatedAt } : null;
  });
}

async function importBuffer(name, mimeType, buffer) {
  await options.locator('#media-file').setInputFiles({ name, mimeType, buffer });
}

/*
 * headless 下自动 captureStream 帧率可能没有触发合成，录制会返回空 WebM。
 * 显式 requestFrame 加画面捕获，让每帧真正进入合成管线；导入前单独检验
 * 测试视频非空且可解码，避免把夹具生成失败误报成产品媒体保存失败。
 */
async function recordTestVideo() {
  await options.bringToFront();
  await options.evaluate(() => {
    if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) throw new Error('测试视频生成失败：当前浏览器不支持 VP8 MediaRecorder。');
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
    canvas.style.cssText='position:fixed;left:0;top:0;width:96px;height:64px;z-index:999999;';document.body.appendChild(canvas);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#76d9ff';ctx.fillRect(0,0,96,64);
    const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
    if(!track || typeof track.requestFrame!=='function') throw new Error('测试视频生成失败：CanvasCaptureMediaStreamTrack.requestFrame 不可用。');
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
    recorder.addEventListener('dataavailable',event=>{if(event.data.size>0) chunks.push(event.data);});
    const finished=new Promise((resolve,reject)=>{recorder.addEventListener('stop',resolve,{once:true});recorder.addEventListener('error',event=>reject(event.error || new Error('MediaRecorder error')),{once:true});});
    window.__nebulaTestRecording={canvas,ctx,stream,track,recorder,chunks,finished,framesRequested:0};
    recorder.start(100);
  });
  try {
    for(let index=0;index<15;index++) {
      await options.evaluate(i=>{
        const state=window.__nebulaTestRecording;
        state.ctx.fillStyle=i%2?'#76d9ff':'#1e396e';state.ctx.fillRect(0,0,96,64);
        state.ctx.fillStyle='#123456';state.ctx.fillRect(i*4,10,20,40);
        state.track.requestFrame();state.framesRequested++;
      },index);
      // 不保存截图文件；此步骤推进 headless 画面合成，帧输出不依赖前台桌面。
      await options.screenshot({type:'png'});
      await options.waitForTimeout(90);
    }
    const recorded=await options.evaluate(async()=>{
      const state=window.__nebulaTestRecording;
      state.recorder.stop();await state.finished;
      const blob=new Blob(state.chunks,{type:'video/webm'});
      const bytes=[...new Uint8Array(await blob.arrayBuffer())];
      const result={bytes,type:state.recorder.mimeType,size:blob.size,documentHidden:document.hidden,framesRequested:state.framesRequested,chunks:state.chunks.length,decode:null};
      if(blob.size===0) return result;
      const url=URL.createObjectURL(blob),video=document.createElement('video');video.muted=true;
      try {
        result.decode=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('测试视频生成失败：录制结果在 5000 ms 内没有可解码帧。')),5000);
          video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,duration:video.duration});},{once:true});
          video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('测试视频生成失败：录制结果无法被浏览器解码。'));},{once:true});
          video.src=url;video.load();
        });
      } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
      return result;
    });
    report.recordedVideo={size:recorded.size,type:recorded.type,documentHidden:recorded.documentHidden,framesRequested:recorded.framesRequested,chunks:recorded.chunks,decode:recorded.decode};
    assert.ok(recorded.size>0,'测试视频生成失败：Canvas 录制结果为空，未执行产品导入。');
    assert.deepEqual(recorded.bytes.slice(0,4),[0x1a,0x45,0xdf,0xa3],'测试视频生成失败：录制结果缺少 WebM/EBML 文件头，未执行产品导入。');
    assert.equal(recorded.decode.width,96,'测试视频生成失败：宽度不符。');
    assert.equal(recorded.decode.height,64,'测试视频生成失败：高度不符。');
    assert.ok(recorded.decode.readyState>=2,'测试视频生成失败：没有已解码的视频帧。');
    return recorded;
  } finally {
    await options.evaluate(()=>{
      const state=window.__nebulaTestRecording;
      if(!state) return;
      if(state.recorder.state!=='inactive') state.recorder.stop();
      state.stream.getTracks().forEach(track=>track.stop());state.canvas.remove();delete window.__nebulaTestRecording;
    });
  }
}

// 等待 Promise 型存储读取时显式 await 返回值，避免把 Promise 本身当成 true。
async function waitAsync(target, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await target.evaluate(predicate)) return;
    await target.waitForTimeout(80);
  } while (Date.now() < deadline);
  throw new Error('异步存储条件未在 ' + timeoutMs + ' ms 内达成。');
}

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  // 保留临时 profile 的路径供诊断；不在用户未确认时删除任何目录。
  const profileParent = path.resolve(extensionDir, '..', '.test-profiles');
  fs.mkdirSync(profileParent, { recursive: true });
  report.profile = fs.mkdtempSync(path.join(profileParent, 'nebula-chrome-'));
  context = await chromium.launchPersistentContext(report.profile, {
    executablePath: chromePath, headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1600, height: 1000 }, reducedMotion: 'no-preference'
  });
  const browser = context.browser();
  report.browserVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: extensionDir });
  report.extensionId = loaded.id;
  extensionOrigin = 'chrome-extension://' + loaded.id;
  report.checks.push({ name: 'Chrome 调试接口加载真实 MV3 扩展', passed: true, detail: extensionOrigin });

  // 测试页面故意禁用 iframe；由内容脚本创建的扩展背景仍应可用。
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { await route.continue(); return; }
    if (url.hostname === 'chatgpt.com') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture,
        headers: { 'content-security-policy': "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'" } });
      return;
    }
    if (url.hostname === 'example.com') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><main>非 ChatGPT 夹具</main></body></html>' });
      return;
    }
    report.unexpectedRemoteRequests.push(route.request().url());
    await route.abort();
  });
  context.on('page', candidate => candidate.on('pageerror', error => report.errors.push({ url: candidate.url(), error: error.message })));
  context.on('requestfailed', request => report.requestsFailed.push({ url: request.url(), error: request.failure()?.errorText }));
  context.on('page', candidate => candidate.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') report.console.push({ url: candidate.url(), type: message.type(), text: message.text() });
  }));
  options = await context.newPage();
  options.on('pageerror', error => report.errors.push({ url: options.url(), error: error.message }));
  await options.goto(extensionOrigin + '/options.html');
  await options.waitForFunction(() => typeof NebulaSettings !== 'undefined' && typeof NebulaMedia !== 'undefined').catch(async error => {
    report.optionsDiagnostic = await options.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 1000), scripts: [...document.scripts].map(script => script.src), url: location.href, keys: Object.keys(window).filter(key => key.includes('Nebula')) }));
    throw error;
  });
  await options.waitForFunction(() => document.getElementById('save-status').textContent.includes('已自动保存')).catch(async error => {
    report.optionsDiagnostic = await options.evaluate(() => ({ saveStatus: document.getElementById('save-status').textContent, mediaStatus: document.getElementById('media-status').textContent, text: document.body.innerText.slice(-2000), settingsType: typeof NebulaSettings, mediaType: typeof NebulaMedia }));
    report.indexedDbDiagnostic = await options.evaluate(() => new Promise(resolve => {
      const request = indexedDB.open('nebulaDiagnostic', 1);
      request.onsuccess = () => { request.result.close(); resolve({ success: true }); };
      request.onerror = () => resolve({ name: request.error?.name, message: request.error?.message });
      request.onblocked = () => resolve({ blocked: true });
    }));
    throw error;
  });
  await options.evaluate(() => NebulaSettings.reset());
  page = await context.newPage();
  await page.goto('https://chatgpt.com/nebula-test-fixture');

  await check('站点 CSP frame-src none 下背景、脚本、样式正常加载', async () => {
    const frame = await background();
    await frame.waitForFunction(() => document.body.dataset.moving === 'true');
    const actual = await frame.evaluate(async () => ({ origin: location.origin, preset: document.body.dataset.preset, settings: await NebulaSettings.get(), hasChromeStorage: Boolean(chrome.storage.local), background: getComputedStyle(document.body).backgroundColor }));
    assert.equal(actual.origin, extensionOrigin);
    assert.equal(actual.settings.enabled, true);
    assert.equal(actual.preset, 'aurora');
    assert.equal(actual.hasChromeStorage, true);
    assert.notEqual(actual.background, 'rgba(0, 0, 0, 0)');
    return actual;
  });

  await check('原页面编辑器、发送按钮和链接可操作', async () => {
    await page.evaluate(() => {
      document.getElementById('send-button').addEventListener('click', () => {
        const message = document.createElement('p');
        message.id = 'fixture-sent';
        message.textContent = document.getElementById('prompt-textarea').textContent;
        document.getElementById('thread').appendChild(message);
      });
    });
    await page.locator('#prompt-textarea').fill('中文输入验证 ✓');
    await page.locator('#send-button').click();
    assert.equal(await page.locator('#fixture-sent').textContent(), '中文输入验证 ✓');
    await page.locator('a[href="#search"]').click();
    assert.equal(new URL(page.url()).hash, '#search');
    return { iframePointerEvents: await page.locator('#nebula-backdrop').evaluate(element => getComputedStyle(element).pointerEvents) };
  });

  await check('设置页开关实时应用，关闭无遗留属性和变量', async () => {
    // 装饰开关由其 label 接收点击，测试真实用户可点击的可见开关。
    await options.locator('label.switch').click();
    assert.equal(await options.locator('#enabled').isChecked(), false);
    await page.waitForFunction(() => !document.querySelector('#nebula-backdrop'));
    const restored = await page.evaluate(() => ({ attrs: document.documentElement.getAttributeNames().filter(name => name.startsWith('data-nebula')), vars: [...document.documentElement.style].filter(name => name.startsWith('--nebula-')) }));
    assert.deepEqual(restored, { attrs: [], vars: [] });
    await options.locator('label.switch').click();
    assert.equal(await options.locator('#enabled').isChecked(), true);
    await background();
    await options.locator('#mode').selectOption('glass');
    await page.waitForFunction(() => document.documentElement.dataset.nebulaMode === 'glass');
    return restored;
  });

  await check('页面局部重建不产生重复背景，移除背景后自动修复', async () => {
    await page.evaluate(() => { document.getElementById('thread').replaceWith(document.getElementById('thread').cloneNode(true)); });
    assert.equal(await page.locator('#nebula-backdrop').count(), 1);
    await page.evaluate(() => {
      const replacement = document.body.cloneNode(true);
      replacement.querySelector('#nebula-backdrop')?.remove();
      document.body.replaceWith(replacement);
    });
    await background();
    assert.equal(await page.locator('#nebula-backdrop').count(), 1);
    return '局部 thread 替换、背景节点移除、整个 body 替换均恢复一份背景。';
    await page.locator('#nebula-backdrop').evaluate(element => element.remove());
    await background();
    assert.equal(await page.locator('#nebula-backdrop').count(), 1);
  });

  await check('非 ChatGPT 地址没有注入', async () => {
    const other = await context.newPage();
    await other.goto('https://example.com/nebula-test-fixture');
    const actual = await other.evaluate(() => ({ iframe: Boolean(document.querySelector('#nebula-backdrop')), attrs: document.documentElement.getAttributeNames().filter(name => name.startsWith('data-nebula')) }));
    assert.deepEqual(actual, { iframe: false, attrs: [] });
    await other.close();
  });

  await check('滑块与配置保存，经页面重新加载仍有效', async () => {
    // range/color 不接受文本 fill；以浏览器原生 input 事件驱动设置控件。
    for (const [id, value] of [['dim', '44'], ['blur', '12'], ['accent', '#77ddbb']]) {
      await options.locator('#' + id).evaluate((element, next) => { element.value = next; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    }
    await waitAsync(options, async () => (await NebulaSettings.get()).dim === 44 && (await NebulaSettings.get()).blur === 12);
    await options.waitForFunction(() => document.getElementById('save-status').textContent.includes('已自动保存'));
    report.settingsBeforeReload = await options.evaluate(() => NebulaSettings.get());
    await options.reload();
    await options.waitForFunction(() => document.getElementById('save-status').textContent.includes('已自动保存'));
    report.settingsAfterReload = await options.evaluate(() => NebulaSettings.get());
    await page.reload();
    await background();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--nebula-blur') === '12px', null, { timeout: 10000 });
    const actual = await page.evaluate(() => ({ mode: document.documentElement.dataset.nebulaMode, blur: document.documentElement.style.getPropertyValue('--nebula-blur'), accent: document.documentElement.style.getPropertyValue('--nebula-accent') }));
    assert.equal(actual.mode, 'glass');
    assert.equal(actual.blur, '12px');
    assert.equal(actual.accent, '#77ddbb');
    return actual;
  });

  await check('两个扩展页面并发修改不同设置不互相覆盖', async () => {
    const second = await context.newPage();
    await second.goto(extensionOrigin + '/popup.html');
    await second.waitForFunction(() => typeof NebulaSettings !== 'undefined');
    // 连续竞争多次以覆盖跨页面“先读旧值、后写整份设置”的风险。
    for (let attempt = 0; attempt < 5; attempt++) {
      await Promise.all([
        options.evaluate(value => NebulaSettings.set({ dim: value }), 41 + attempt),
        second.evaluate(value => NebulaSettings.set({ blur: value }), 13 + attempt)
      ]);
      const saved = await options.evaluate(() => NebulaSettings.get());
      assert.equal(saved.dim, 41 + attempt);
      assert.equal(saved.blur, 13 + attempt);
    }
    await second.close();
    return '5 次并发修改 dim 与 blur，全部保留两页各自写入。';
  });

  // 用浏览器 Canvas 生成小 PNG，测试真实 File 导入与跨扩展页 IndexedDB 读取。
  const png = Buffer.from(await options.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#3259a1'; ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#76d9ff'; ctx.fillRect(30, 10, 50, 40);
    return [...new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer())];
  }));
  await check('本机 PNG 导入、静态封面及背景 iframe 跨源读取', async () => {
    await importBuffer('nebula-test.png', 'image/png', png);
    await waitAsync(options, async () => (await NebulaMedia.load())?.name === 'nebula-test.png');
    const frame = await background();
    await frame.waitForFunction(() => !document.getElementById('wallpaper-image').hidden && document.getElementById('wallpaper-image').naturalWidth === 96);
    const actual = await mediaRecord();
    assert.equal(actual.mimeType, 'image/png');
    assert(actual.posterSize > 0);
    assert.equal(new URL(await frame.locator('#wallpaper-image').getAttribute('src')).protocol, 'blob:');
    return actual;
  });

  await check('损坏素材导入失败，旧素材和配置仍被保留', async () => {
    const before = await mediaRecord();
    const configBefore = await options.evaluate(() => NebulaSettings.get());
    await importBuffer('broken.png', 'image/png', Buffer.from('not a png'));
    await options.waitForFunction(() => document.getElementById('save-status').textContent.includes('无法') || document.getElementById('media-status').textContent.includes('无法'));
    assert.deepEqual(await mediaRecord(), before);
    const after = await options.evaluate(() => NebulaSettings.get());
    assert.equal(after.assetVersion, configBefore.assetVersion);
    return { preserved: before.name, message: await options.locator('#media-status').textContent() };
  });

  // 两帧 GIF，不需要联网获取素材，也不依赖用户桌面动图。
  const gif = Buffer.from('R0lGODlhAQABAIAAAP8AAAD/ACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAQAAACwAAAAAAQABAAACAkQBACH5BAABAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
  await check('GIF 导入生成封面，关闭动态与 reduced-motion 均解除 GIF 地址', async () => {
    await importBuffer('nebula-test.gif', 'image/gif', gif);
    await waitAsync(options, async () => (await NebulaMedia.load())?.name === 'nebula-test.gif');
    const frame = await background();
    await frame.waitForFunction(() => !document.getElementById('wallpaper-image').hidden && Boolean(document.getElementById('wallpaper-image').getAttribute('src')));
    await options.locator('#motion').uncheck();
    await frame.waitForFunction(() => !document.getElementById('wallpaper-poster').hidden && !document.getElementById('wallpaper-image').getAttribute('src'));
    await options.locator('#motion').check();
    await frame.waitForFunction(() => !document.getElementById('wallpaper-image').hidden);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await frame.waitForFunction(() => !document.getElementById('wallpaper-poster').hidden && !document.getElementById('wallpaper-image').getAttribute('src'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await frame.waitForFunction(() => !document.getElementById('wallpaper-image').hidden);
    return await mediaRecord();
  });

  await check('本机 WebM 导入、播放、暂停和 reduced-motion', async () => {
    const recorded=await recordTestVideo();
    await importBuffer('nebula-test.webm', 'video/webm', Buffer.from(recorded.bytes));
    await waitAsync(options, async () => (await NebulaMedia.load())?.name === 'nebula-test.webm').catch(async error => {
      report.videoImportError = await options.locator('#media-status').textContent(); throw error;
    });
    report.videoOptionsDiagnostic = await options.evaluate(async () => ({ saveStatus: document.getElementById('save-status').textContent, mediaStatus: document.getElementById('media-status').textContent, config: await NebulaSettings.get(), media: (await NebulaMedia.load())?.name, mediaDisabled: document.getElementById('media-file').disabled }));
    await waitAsync(options, async () => {
      const record = await NebulaMedia.load(); const config = await NebulaSettings.get();
      return record?.name === 'nebula-test.webm' && config.assetVersion === record.updatedAt && !document.getElementById('media-file').disabled;
    });
    // 验证在宿主页面可见时的播放；后台页面暂停本就是产品的预期行为。
    await page.bringToFront();
    const frame = await background();
    await frame.waitForFunction(() => !document.getElementById('wallpaper-video').hidden && !document.getElementById('wallpaper-video').paused, null, { timeout: 10000 }).catch(async error => {
      report.videoDiagnostic = await frame.evaluate(async () => {
        const item = document.getElementById('wallpaper-video');
        return { hidden: item.hidden, paused: item.paused, muted: item.muted, defaultMuted: item.defaultMuted, readyState: item.readyState, duration: item.duration, source: item.getAttribute('src'), moving: document.body.dataset.moving, documentHidden: document.hidden, error: item.error?.message, status: await chrome.storage.local.get('nebulaMediaStatus'), settings: await NebulaSettings.get() };
      });
      throw error;
    });
    await options.locator('#motion').uncheck();
    await frame.waitForFunction(() => document.getElementById('wallpaper-video').paused);
    await options.locator('#motion').check();
    await frame.waitForFunction(() => !document.getElementById('wallpaper-video').paused);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await frame.waitForFunction(() => document.getElementById('wallpaper-video').paused);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    return await mediaRecord();
  });

  await check('双设置页素材同步、旧清除确认撤销与版本冲突保护', async () => {
    const before = await mediaRecord();
    await options.locator('#clear-media').click();
    await options.locator('#clear-confirmation').waitFor({ state: 'visible' });
    assert((await options.locator('#clear-description').textContent()).includes(before.name));
    const second = await context.newPage();
    await second.goto(extensionOrigin + '/options.html');
    await second.waitForFunction(() => document.getElementById('save-status').textContent.includes('已自动保存'));
    await waitAsync(second, async () => !document.getElementById('media-file').disabled);
    await second.locator('#media-file').setInputFiles({ name: 'nebula-second.png', mimeType: 'image/png', buffer: png });
    await waitAsync(second, async () => (await NebulaMedia.load())?.name === 'nebula-second.png');
    await options.waitForFunction(() => document.getElementById('clear-confirmation').hidden && document.getElementById('media-status').textContent.includes('素材已经变化'));
    const conflict = await options.evaluate(async version => {
      try { await NebulaMedia.clear(version); return { refused: false }; }
      catch (error) { return { refused: true, code: error.code, message: error.message }; }
    }, before.updatedAt);
    assert.equal(conflict.refused, true);
    assert.equal(conflict.code, 'NEBULA_MEDIA_CHANGED');
    assert.equal((await mediaRecord()).name, 'nebula-second.png');
    await second.close();
    await options.locator('#reset-settings').click();
    await options.waitForFunction(() => document.getElementById('save-status').textContent.includes('已恢复默认'));
    assert.equal((await mediaRecord()).name, 'nebula-second.png');
    assert.equal((await options.evaluate(() => NebulaSettings.get())).backgroundType, 'preset');
    return { staleFile: before.name, keptFile: 'nebula-second.png', refusedCode: conflict.code, resetKeptAsset: true };
  });

  await check('素材存储不可用时，预设与基础设置仍可操作', async () => {
    const degraded = await context.newPage();
    // 仅在测试页模拟 IDB 无法打开；不修改产品代码或其他页面存储。
    await degraded.addInitScript(() => {
      const databaseApi = indexedDB;
      databaseApi.open = function () {
        const request = { error: new DOMException('测试模拟不可写素材空间', 'UnknownError') };
        setTimeout(() => request.onerror?.(), 0);
        return request;
      };
    });
    await degraded.goto(extensionOrigin + '/options.html');
    await degraded.waitForFunction(() => document.getElementById('media-status').textContent.includes('不可用'));
    assert.equal(await degraded.locator('#media-file').isDisabled(), true);
    assert.equal(await degraded.locator('#preset-midnight').isDisabled(), false);
    assert.equal(await degraded.locator('#mode').isDisabled(), false);
    await degraded.locator('#preset-midnight').click();
    await waitAsync(degraded, async () => (await NebulaSettings.get()).preset === 'midnight');
    const message = await degraded.locator('#media-status').textContent();
    await degraded.close();
    return message;
  });

  await check('背景 pagehide/pageshow 恢复事件重新加载素材', async () => {
    await settings({ enabled: true, preset: 'character', backgroundType: 'preset' });
    const frame = await background();
    await frame.waitForFunction(() => document.getElementById('wallpaper-image').naturalWidth > 0);
    await frame.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await frame.waitForFunction(() => document.getElementById('wallpaper-image').naturalWidth > 0 && Boolean(document.getElementById('wallpaper-image').getAttribute('src')));
    return '合成持久化页面恢复事件验证生命周期；未模拟真实浏览器 bfcache 导航。';
  });

  await check('保留宿主同名属性与 CSS 内联值，停用时恢复原值', async () => {
    await settings({ enabled: false });
    await page.waitForFunction(() => !document.querySelector('#nebula-backdrop'));
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-nebula-mode', 'host-original');
      document.documentElement.style.setProperty('--nebula-accent', '#123456', 'important');
    });
    await settings({ enabled: true });
    await background();
    await settings({ enabled: false });
    await page.waitForFunction(() => !document.querySelector('#nebula-backdrop'));
    const actual = await page.evaluate(() => ({ mode: document.documentElement.getAttribute('data-nebula-mode'), color: document.documentElement.style.getPropertyValue('--nebula-accent'), priority: document.documentElement.style.getPropertyPriority('--nebula-accent') }));
    assert.deepEqual(actual, { mode: 'host-original', color: '#123456', priority: 'important' });
    await page.evaluate(() => { document.documentElement.removeAttribute('data-nebula-mode'); document.documentElement.style.removeProperty('--nebula-accent'); });
  });

  await check('内置角色壁纸加载与真实扩展截图', async () => {
    await settings({ ...await options.evaluate(() => NebulaSettings.DEFAULTS), enabled: true, mode: 'glass', preset: 'character', dim: 40, panelOpacity: 70, backgroundType: 'preset', motion: false });
    await page.reload();
    const frame = await background();
    await frame.waitForFunction(() => document.getElementById('wallpaper-image').complete && document.getElementById('wallpaper-image').naturalWidth > 0);
    await options.reload();
    await options.waitForFunction(() => document.getElementById('save-status').textContent.includes('已自动保存'));
    const webpagePath = path.join(screenshotDir, '实现验证-网页.png');
    const settingsPath = path.join(screenshotDir, '实现验证-设置.png');
    await page.screenshot({ path: webpagePath, fullPage: true });
    await options.setViewportSize({ width: 1400, height: 1000 });
    await options.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(resolve)); });
    await options.screenshot({ path: settingsPath, fullPage: true });
    report.screenshots.push(webpagePath, settingsPath);
    return { webpagePath, settingsPath };
  });

  await check('扩展弹窗与窄屏设置布局', async () => {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 540 });
    await popup.goto(extensionOrigin + '/popup.html');
    await popup.waitForFunction(() => document.getElementById('save-status').textContent.includes('已读取'));
    await popup.locator('label[for="enabled"]').click();
    await page.waitForFunction(() => !document.querySelector('#nebula-backdrop'));
    await popup.locator('label[for="enabled"]').click();
    await background();
    const popupPath = path.join(screenshotDir, '实现验证-弹窗.png');
    await popup.screenshot({ path: popupPath, fullPage: true });
    await options.setViewportSize({ width: 390, height: 844 });
    await options.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(resolve)); });
    const dimensions = await options.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert(dimensions.scrollWidth <= dimensions.width + 1, '窄屏设置页横向溢出。');
    const narrowPath = path.join(screenshotDir, '实现验证-设置-窄屏.png');
    await options.screenshot({ path: narrowPath, fullPage: true });
    report.screenshots.push(popupPath, narrowPath);
    await popup.close();
    return { popupPath, narrowPath, dimensions };
  });

  await check('测试页面没有发起主动远程请求', async () => {
    assert.deepEqual(report.unexpectedRemoteRequests, []);
    return '仅 chatgpt.com 与 example.com 本地夹具请求；其他网络请求全部记录并拦截。';
  });
}

(async () => {
  try { await main(); } catch (error) { report.fatalError = error.stack || String(error); process.stdout.write('FATAL ' + report.fatalError + '\n'); }
  finally {
    if (context) await context.close();
    report.finishedAt = new Date().toISOString();
    report.passed = !report.fatalError && report.checks.every(check => check.passed);
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write('RESULT ' + resultPath + '\n');
    process.exitCode = report.passed ? 0 : 1;
  }
})();
