/*
 * 动态线框回归：真实 Chrome 加载扩展，本地夹具代替账号网页。
 * 使用独立 profile / 独立工件目录，不安装到日常 Chrome，不删除已有证据。
 * 动画取样通过 Web Animations 时间轴完成；同时检查真实时间推进，避免
 * 只查 CSS 字符串却没有验证渲染、暂停、资源失败与媒体切换的情况。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// 支持项目依赖或环境提供的依赖目录，不把维护者的用户名写进脚本。
const playwright = require(process.env.NEBULA_PLAYWRIGHT_PATH || 'playwright');

const extensionDir = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version;
const versionedReport = path.join(__dirname, 'dynamic-wireframe-results-' + version + '.json');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'chatgpt-wireframe.html'), 'utf8').replace('夜航 0.1.3 · 夹具截图', '夜航 ' + version + ' · 动态夹具截图');
const artifactRoot = path.join(__dirname, 'dynamic-wireframe-artifacts');
fs.mkdirSync(artifactRoot, { recursive: true });
const artifactDir = fs.mkdtempSync(path.join(artifactRoot, 'run-'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const report = {
  startedAt: new Date().toISOString(),
  extensionVersion: version,
  scope: '真实 Chrome / 本地模拟页面 / 独立 profile；非用户账号实机验证。合成生命周期事件不证明真实 bfcache 命中。',
  runtimeHashes: Object.fromEntries(['backdrop.js', 'backdrop.css', 'backdrop.html', 'shared/settings.js'].map(file => [file, hash(fs.readFileSync(path.join(extensionDir, file)))])),
  artifactDir, checks: [], errors: [], unexpectedRemoteRequests: [], screenshots: [], intentionallyFailedRequests: []
};
let context, options, page, extensionOrigin;
let failNormal = false, failWireframe = false, delayNormal = false;
const pendingNormals = [];

async function check(name, work) {
  const startedAt = Date.now();
  try {
    const detail = await work();
    report.checks.push({ name, passed: true, durationMs: Date.now() - startedAt, detail });
    process.stdout.write('PASS ' + name + '\n');
  } catch (error) {
    report.checks.push({ name, passed: false, durationMs: Date.now() - startedAt, error: error.message });
    process.stdout.write('FAIL ' + name + ': ' + error.message + '\n');
  }
}

async function settings(patch) {
  return options.evaluate(value => NebulaSettings.set(value), patch);
}

async function background() {
  await page.locator('#nebula-backdrop').waitFor({ state: 'attached' });
  for (let attempt = 0; attempt < 80; attempt++) {
    const frame = page.frames().find(item => item.url().startsWith(extensionOrigin + '/backdrop.html'));
    if (frame && await frame.locator('#wireframe-effects').count()) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error('扩展背景没有挂载。');
}

async function geometry() {
  return page.evaluate(() => Object.fromEntries(['sidebar', 'main', 'thread', 'composer-form', 'composer-surface', 'prompt-textarea', 'sidebar-footer'].map(id => {
    const item = document.getElementById(id), rect = item.getBoundingClientRect(), style = getComputedStyle(item);
    return [id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, padding: style.padding, margin: style.margin, borderRadius: style.borderRadius }];
  })));
}

async function screenshot(name) {
  const file = path.join(artifactDir, name + '.png');
  const bytes = await page.screenshot({ path: file });
  report.screenshots.push(file);
  return { path: file, sha256: hash(bytes) };
}

async function hostVisibility(visible) {
  await page.evaluate(({ origin, visible }) => document.querySelector('#nebula-backdrop').contentWindow.postMessage({ type: 'nebula-host-visibility', visible }, origin), { origin: extensionOrigin, visible });
}

async function waitPortrait(frame, ready) {
  await frame.waitForFunction(value => document.body.dataset.portraitReady === String(value), ready, { timeout: 10000 });
}

async function mediaStatus(state) {
  await options.waitForFunction(async value => (await chrome.storage.local.get('nebulaMediaStatus')).nebulaMediaStatus?.state === value, state);
  return options.evaluate(async () => (await chrome.storage.local.get('nebulaMediaStatus')).nebulaMediaStatus);
}

async function layerState(frame) {
  return frame.evaluate(() => {
    const state = {};
    for (const id of ['wallpaper-image', 'wallpaper-color']) {
      const element = document.getElementById(id), rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      state[id] = { hidden: element.hidden, src: element.getAttribute('src'), complete: element.complete,
        width: element.naturalWidth, height: element.naturalHeight, opacity: Number(style.opacity),
        display: style.display, objectFit: style.objectFit, objectPosition: style.objectPosition,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        animations: element.getAnimations().map(animation => ({ name: animation.animationName, state: animation.playState, time: animation.currentTime })) };
    }
    return { preset: document.body.dataset.preset, moving: document.body.dataset.moving,
      ready: document.body.dataset.portraitReady, cycle: document.body.dataset.portraitCycle, layers: state };
  });
}

/* 暂停全部背景动画再取一相；不改产品 CSS，只在本次截图中控制时间。 */
async function samplePhase(frame, phase) {
  return frame.evaluate(async selectedPhase => {
    for (const animation of document.getAnimations()) animation.pause();
    const color = document.getElementById('wallpaper-color');
    const animation = color.getAnimations().find(item => item.animationName === 'nebula-portrait-cycle');
    if (!animation) throw new Error('人物叠层没有 CSS 动画实例。');
    const { duration, delay } = animation.effect.getTiming();
    if (typeof duration !== 'number' || !Number.isFinite(duration)) throw new Error('叠层动画没有有限周期。');
    const progress = typeof selectedPhase === 'number' ? selectedPhase : selectedPhase === 'color' ? 0.5 : 0.1;
    animation.currentTime = delay + duration * progress;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { name: animation.animationName, duration, currentTime: animation.currentTime, opacity: Number(getComputedStyle(color).opacity), baseOpacity: Number(getComputedStyle(document.getElementById('wallpaper-image')).opacity) };
  }, phase);
}

async function assertStatic(frame) {
  const state = await layerState(frame);
  assert.equal(state.cycle, 'false');
  assert.equal(state.layers['wallpaper-color'].hidden, true);
  assert.equal(state.layers['wallpaper-color'].src, null);
  assert.equal(state.layers['wallpaper-color'].animations.length, 0);
  assert.equal(state.layers['wallpaper-image'].hidden, false);
  assert.equal(state.layers['wallpaper-image'].opacity, 1);
  assert.ok(state.layers['wallpaper-image'].width > 1000);
  return state;
}

async function activatePortrait() {
  await settings({ enabled: true, preset: 'wireframe', backgroundType: 'preset', motion: true, portraitCycle: true });
  await page.bringToFront();
  const frame = await background();
  await hostVisibility(true);
  await frame.waitForFunction(() => document.body.dataset.preset === 'wireframe' && document.body.dataset.moving === 'true');
  await waitPortrait(frame, true);
  await frame.waitForFunction(() => document.body.dataset.portraitCycle === 'true');
  return frame;
}

async function main() {
  const profileParent = path.resolve(extensionDir, '..', '.test-profiles');
  fs.mkdirSync(profileParent, { recursive: true });
  report.profile = fs.mkdtempSync(path.join(profileParent, 'nebula-dynamic-wireframe-'));
  context = await playwright.chromium.launchPersistentContext(report.profile, {
    executablePath: process.env.NEBULA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference'
  });
  // 本地扩展资源允许正常读取；只对本轮指定图片进行可控故障注入。
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    const isNormal = url.protocol === 'chrome-extension:' && url.pathname === '/assets/wireframe-color-v1.png';
    if (isNormal && delayNormal) { pendingNormals.push(route); return; }
    if (isNormal && failNormal || url.protocol === 'chrome-extension:' && url.pathname === '/assets/wireframe-wallpaper.png' && failWireframe) {
      report.intentionallyFailedRequests.push(url.href); return route.abort();
    }
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.hostname === 'chatgpt.com') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
    report.unexpectedRemoteRequests.push(url.href); return route.abort();
  });
  context.on('page', item => item.on('pageerror', error => report.errors.push({ url: item.url(), message: error.message })));
  const cdp = await context.browser().newBrowserCDPSession();
  report.browserVersion = (await cdp.send('Browser.getVersion')).product;
  extensionOrigin = 'chrome-extension://' + (await cdp.send('Extensions.loadUnpacked', { path: extensionDir })).id;
  options = await context.newPage();
  await options.goto(extensionOrigin + '/options.html');
  await options.waitForFunction(() => typeof NebulaSettings !== 'undefined' && document.querySelector('#save-status').textContent.includes('已自动保存'));
  await settings({ enabled: false, preset: 'wireframe', backgroundType: 'preset', motion: false, portraitCycle: false });
  page = await context.newPage();
  await page.goto('https://chatgpt.com/nebula-dynamic-wireframe-test');
  const nativeGeometry = await geometry();
  report.nativeGeometry = nativeGeometry;
  await check('旧设置与非法值不会意外开启人物叠化', async () => {
    const result = await options.evaluate(() => ({ default: NebulaSettings.DEFAULTS.portraitCycle, old: NebulaSettings.normalize({ preset: 'wireframe', motion: true }).portraitCycle, invalid: NebulaSettings.normalize({ portraitCycle: 'yes' }).portraitCycle }));
    assert.deepEqual(result, { default: false, old: false, invalid: false }); return result;
  });
  await check('一键风格显式开启人物叠化，保留用户停用与动态开关', async () => {
    await options.locator('#apply-wireframe-look').click();
    await options.waitForFunction(async () => (await NebulaSettings.get()).portraitCycle === true);
    const result = await options.evaluate(() => NebulaSettings.get());
    assert.equal(result.enabled, false); assert.equal(result.motion, false); assert.equal(result.portraitCycle, true); return result;
  });
  await check('人物复选框只修改自己的开关，不覆盖其他已保存外观项', async () => {
    const before = await options.evaluate(() => NebulaSettings.get());
    await options.locator('#portraitCycle').uncheck();
    await options.waitForFunction(async () => (await NebulaSettings.get()).portraitCycle === false);
    const after = await options.evaluate(() => NebulaSettings.get());
    assert.deepEqual(after, { ...before, portraitCycle: false });
    await options.locator('#portraitCycle').check();
    await options.waitForFunction(async () => (await NebulaSettings.get()).portraitCycle === true);
    return { before, after };
  });
  await check('两张本机图片实际解码，叠层与底图使用相同覆盖范围', async () => {
    const frame = await activatePortrait();
    const state = await layerState(frame), base = state.layers['wallpaper-image'], color = state.layers['wallpaper-color'];
    assert.ok(base.complete && base.width > 1000); assert.ok(color.complete && color.width > 1000);
    assert.equal(base.src, extensionOrigin + '/assets/wireframe-wallpaper.png'); assert.equal(color.src, extensionOrigin + '/assets/wireframe-color-v1.png');
    assert.deepEqual(color.rect, base.rect); assert.equal(color.objectFit, base.objectFit); assert.equal(color.objectPosition, base.objectPosition);
    assert.equal(base.opacity, 1); assert.equal(color.hidden, false);
    for (const file of ['wireframe-wallpaper.png', 'wireframe-color-v1.png']) report.runtimeHashes['assets/' + file] = hash(fs.readFileSync(path.join(extensionDir, 'assets', file)));
    return state;
  });
  await check('浏览器使用固定 10 秒周期，停留与叠化相位符合预期且底图始终可见', async () => {
    const frame = await background();
    const samples = [];
    try {
      // 直接检查浏览器实际创建的动画时间，而不是只匹配 CSS 源文本。
      // 1/5/9 秒应停留在完整一相，3/7 秒应位于渐入与渐出的中间。
      for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const sample = await samplePhase(frame, progress);
        assert.equal(sample.duration, 10000, '人物循环周期应固定为 10000 毫秒。');
        assert.equal(sample.baseOpacity, 1, '叠化时线框底图不能消失。');
        if (progress === 0.1 || progress === 0.9) assert.ok(sample.opacity < 0.02, '线框停留相位出现了有色图。');
        else if (progress === 0.5) assert.ok(sample.opacity > 0.98, '人物停留相位没有完全显示。');
        else assert.ok(sample.opacity > 0.25 && sample.opacity < 0.75, '过渡中间相位没有产生叠化。');
        samples.push({ progress, ...sample });
      }
      return { periodMs: 10000, samples };
    } finally {
      // 时间取样只服务于本项检查；恢复播放后继续验证真实推进与生命周期。
      await frame.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 0; animation.play(); }));
    }
  });
  await check('人物动画真实推进，并能渲染线框与有色两个相位', async () => {
    const frame = await background();
    const first = await frame.locator('#wallpaper-color').evaluate(element => element.getAnimations()[0].currentTime);
    await page.waitForTimeout(260);
    const second = await frame.locator('#wallpaper-color').evaluate(element => element.getAnimations()[0].currentTime);
    assert.ok(second - first > 100, '动画时间没有实际推进。');
    const wire = await samplePhase(frame, 'wire'); assert.ok(wire.opacity < 0.02); assert.equal(wire.baseOpacity, 1);
    const wireShot = await screenshot('wireframe-phase');
    const color = await samplePhase(frame, 'color'); assert.ok(color.opacity > 0.98); assert.equal(color.baseOpacity, 1);
    const colorShot = await screenshot('color-phase'); assert.notEqual(colorShot.sha256, wireShot.sha256, '两相合成截图完全一致。');
    // 恢复真实播放，后续暂停测试不会受到截图暂停状态影响。
    await frame.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
    return { realTimeAdvanceMs: second - first, wire, color, screenshots: [wireShot, colorShot] };
  });
  await check('新增背景不改变聊天几何，编辑和发送按钮仍可操作', async () => {
    assert.deepEqual(await geometry(), nativeGeometry);
    const initial = await page.locator('#prompt-textarea').textContent();
    await page.evaluate(() => { window.__nebulaDynamicSendCount = 0; document.querySelector('#send-button').addEventListener('click', () => window.__nebulaDynamicSendCount++); });
    await page.locator('#prompt-textarea').fill('本地输入验证'); assert.equal(await page.locator('#prompt-textarea').textContent(), '本地输入验证');
    await page.locator('#send-button').click(); assert.equal(await page.evaluate(() => window.__nebulaDynamicSendCount), 1);
    await page.locator('#prompt-textarea').fill(initial); assert.deepEqual(await geometry(), nativeGeometry);
    assert.equal(await page.locator('#nebula-backdrop').getAttribute('aria-hidden'), 'true'); assert.equal(await page.locator('#nebula-backdrop').evaluate(element => element.inert), true);
  });
  await check('关闭人物叠化释放有色资源，保留原来的动态装饰', async () => {
    await settings({ portraitCycle: false }); const frame = await background();
    await frame.waitForFunction(() => document.body.dataset.portraitCycle === 'false' && !document.querySelector('#wallpaper-color').getAttribute('src'));
    const result = await assertStatic(frame); assert.equal(result.moving, 'true');
    assert.equal(await frame.locator('.wireframe-sweep').evaluate(element => getComputedStyle(element).animationPlayState), 'running'); return result;
  });
  await check('总动态开关关闭后回到静态线框，重新开启从线框起播', async () => {
    let frame = await activatePortrait(); await samplePhase(frame, 'color');
    await settings({ motion: false }); await frame.waitForFunction(() => document.body.dataset.moving === 'false');
    await frame.waitForFunction(() => !document.querySelector('#wallpaper-color').getAttribute('src')); await assertStatic(frame);
    await settings({ motion: true }); await waitPortrait(frame, true);
    const result = await layerState(frame); assert.equal(result.cycle, 'true'); assert.ok(result.layers['wallpaper-color'].opacity < 0.02); return result;
  });
  await check('人物解码返回值仍挂起时切换减少动态，旧回调不复活叠层且恢复后重新解码', async () => {
    const frame = await background(); await settings({ portraitCycle: false });
    await frame.waitForFunction(() => !document.querySelector('#wallpaper-color').getAttribute('src'));
    // 只挂起本次测试背景节点的 decode 返回值。图片仍由 Chrome 真正解码，
    // nativeReady 确认已解码后才保留异步回调，避免依赖机器快慢碰运气。
    await frame.evaluate(() => {
      const element = document.getElementById('wallpaper-color');
      const descriptor = Object.getOwnPropertyDescriptor(element, 'decode');
      const original = element.decode;
      const state = { calls: 0, nativeReady: 0, resolvers: [], restore: null };
      state.restore = () => {
        if (descriptor) Object.defineProperty(element, 'decode', descriptor);
        else delete element.decode;
        state.resolvers.splice(0).forEach(resolve => resolve());
      };
      element.decode = function () {
        state.calls++;
        return original.call(this).then(value => {
          state.nativeReady++;
          return new Promise(resolve => state.resolvers.push(() => resolve(value)));
        });
      };
      window.__nebulaDynamicDecodeHold = state;
    });
    try {
      await settings({ portraitCycle: true });
      await frame.waitForFunction(() => window.__nebulaDynamicDecodeHold.nativeReady > 0 && document.body.dataset.portraitReady === 'false');
      const pending = await layerState(frame); assert.equal(pending.cycle, 'false'); assert.equal(pending.moving, 'true');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // 偏好刚改变便送达挂起回调，不提前等待暂停/释放完成，覆盖回调与
      // MediaQueryList change 的先后竞态。无论谁先到，都应收敛为静态。
      await frame.evaluate(() => window.__nebulaDynamicDecodeHold.restore());
      await frame.waitForFunction(() => document.body.dataset.moving === 'false' && !document.querySelector('#wallpaper-color').getAttribute('src'));
      const reduced = await assertStatic(frame);
      await page.waitForTimeout(80);
      const afterOldCallback = await assertStatic(frame); assert.equal(afterOldCallback.moving, 'false');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await waitPortrait(frame, true);
      await frame.waitForFunction(() => document.body.dataset.moving === 'true' && document.body.dataset.portraitCycle === 'true');
      const restored = await layerState(frame); assert.ok(restored.layers['wallpaper-color'].width > 1000);
      assert.deepEqual(await geometry(), nativeGeometry);
      return { pending, reduced, afterOldCallback, restored, mechanism: 'Chrome 已解码图片 + 单节点 decode Promise 受控挂起；验证偏好切换与迟到回调。' };
    } finally {
      await frame.evaluate(() => { window.__nebulaDynamicDecodeHold?.restore(); delete window.__nebulaDynamicDecodeHold; });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  });
  await check('系统减少动态设置覆盖人物循环与装饰动画', async () => {
    const frame = await background(); await page.emulateMedia({ reducedMotion: 'reduce' });
    await frame.waitForFunction(() => document.body.dataset.moving === 'false' && !document.querySelector('#wallpaper-color').getAttribute('src'));
    await assertStatic(frame); assert.equal(await frame.locator('.wireframe-sweep').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await waitPortrait(frame, true); await frame.waitForFunction(() => document.body.dataset.moving === 'true');
  });
  await check('父页后台可见性提示暂停同一相位，恢复后继续推进', async () => {
    const frame = await background(); await hostVisibility(false); await frame.waitForFunction(() => document.body.dataset.moving === 'false');
    // CSS pause 先进入 pending 状态，在下一次绘制提交实际暂停时间。
    // 等绘制稳定后才取基线；否则一次正常的提交帧会被误判为后台继续播放。
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await layerState(frame); assert.equal(before.cycle, 'true'); assert.equal(before.layers['wallpaper-color'].hidden, false);
    await page.waitForTimeout(240); const after = await layerState(frame);
    assert.equal(after.layers['wallpaper-color'].animations[0].state, 'paused');
    assert.ok(Math.abs(after.layers['wallpaper-color'].animations[0].time - before.layers['wallpaper-color'].animations[0].time) < 1, '已提交暂停后的时间仍从 ' + before.layers['wallpaper-color'].animations[0].time + ' 推进到 ' + after.layers['wallpaper-color'].animations[0].time);
    assert.equal(after.layers['wallpaper-color'].opacity, before.layers['wallpaper-color'].opacity);
    await hostVisibility(true); await frame.waitForFunction(() => document.body.dataset.moving === 'true');
    await page.waitForTimeout(180); const resumed = await layerState(frame);
    assert.ok(resumed.layers['wallpaper-color'].animations[0].time > after.layers['wallpaper-color'].animations[0].time + 80);
    return { before, after, resumed, mechanism: '从真实宿主页发送受限可见性消息；不是系统后台状态注入。' };
  });
  await check('记录真实标签切换的可见性证据，不把 headless 常驻 visible 当成后台验证', async () => {
    await options.bringToFront(); await page.waitForTimeout(160);
    const hidden = await page.evaluate(() => document.hidden), frame = await background();
    const moving = await frame.evaluate(() => document.body.dataset.moving);
    if (hidden) assert.equal(moving, 'false');
    await page.bringToFront(); await page.waitForTimeout(160);
    await hostVisibility(true); await frame.waitForFunction(() => document.body.dataset.moving === 'true');
    return { actualDocumentHidden: hidden, actualBackgroundPauseVerified: hidden, limitation: hidden ? '' : '本次 Chrome headless 标签切换没有产生 hidden；后台暂停仅由上一项可见性协议测试覆盖。' };
  });
  await check('背景 pagehide/pageshow 合成恢复释放并重建两张资源', async () => {
    const frame = await background();
    await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const hidden = await layerState(frame); assert.equal(hidden.moving, 'false'); assert.equal(hidden.layers['wallpaper-color'].src, null); assert.equal(hidden.layers['wallpaper-image'].src, null);
    await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await waitPortrait(frame, true); await frame.waitForFunction(() => document.querySelector('#wallpaper-image').complete && document.querySelector('#wallpaper-image').naturalWidth > 1000);
    assert.deepEqual(await geometry(), nativeGeometry); return { lifecycle: '合成 persisted 事件，未验证真实 bfcache 缓存命中。', restored: await layerState(frame) };
  });
  await check('切换普通预设与本机素材没有有色叠层或线框动画残留', async () => {
    await settings({ preset: 'midnight' }); let frame = await background();
    await frame.waitForFunction(() => document.body.dataset.preset === 'midnight');
    let state = await layerState(frame); assert.equal(state.cycle, 'false'); assert.equal(state.layers['wallpaper-color'].src, null);
    assert.equal(await frame.locator('#wireframe-effects').evaluate(element => element.hidden), true);
    await options.locator('#media-file').setInputFiles(path.join(extensionDir, 'assets', 'icon-16.png'));
    await options.waitForFunction(async () => (await NebulaMedia.load())?.name === 'icon-16.png');
    await settings({ backgroundType: 'custom' }); frame = await background();
    await frame.waitForFunction(() => document.body.dataset.preset === 'custom' && document.querySelector('#wallpaper-image').naturalWidth === 16);
    state = await layerState(frame); assert.equal(state.cycle, 'false'); assert.equal(state.layers['wallpaper-color'].src, null);
    assert.equal(await frame.locator('#wireframe-effects').evaluate(element => element.hidden), true);
    assert.ok(state.layers['wallpaper-image'].src.startsWith('blob:' + extensionOrigin)); assert.deepEqual(await geometry(), nativeGeometry); return state;
  });
  await check('有色图加载失败只降级为静态线框，输入仍可用', async () => {
    failNormal = true; await settings({ preset: 'aurora', backgroundType: 'preset' });
    let frame = await background(); await frame.waitForFunction(() => document.body.dataset.preset === 'aurora');
    await settings({ preset: 'wireframe', portraitCycle: true });
    await frame.waitForFunction(() => document.body.dataset.preset === 'wireframe' && document.querySelector('#wallpaper-image').complete && document.querySelector('#wallpaper-image').naturalWidth > 1000);
    await frame.waitForFunction(() => document.body.dataset.portraitCycle === 'false' && !document.querySelector('#wallpaper-color').getAttribute('src'));
    const status = await mediaStatus('fallback');
    const result = await assertStatic(frame); assert.equal(result.preset, 'wireframe');
    const text = await page.locator('#prompt-textarea').textContent(); await page.locator('#prompt-textarea').fill('降级后继续输入'); await page.locator('#prompt-textarea').fill(text);
    assert.deepEqual(await geometry(), nativeGeometry); failNormal = false; return { status, result };
  });
  await check('失败后关闭叠化清除旧提示，再开启能够在同一线框预设重试', async () => {
    const frame = await background(); await settings({ portraitCycle: false });
    await frame.waitForFunction(() => document.body.dataset.portraitReady === 'false' && !document.querySelector('#wallpaper-color').getAttribute('src'));
    const staticStatus = await mediaStatus('ready'); assert.equal(staticStatus.message, '');
    await settings({ portraitCycle: true }); await waitPortrait(frame, true);
    const result = await layerState(frame); assert.equal(result.preset, 'wireframe'); assert.equal(result.cycle, 'true');
    assert.ok(result.layers['wallpaper-color'].width > 1000); assert.deepEqual(await geometry(), nativeGeometry);
    const status = await mediaStatus('ready');
    return { result, staticStatus, status };
  });
  await check('叠层失败后主动关闭总动态同样清除旧故障提示并保留静态线框', async () => {
    const frame = await background(); await settings({ portraitCycle: false });
    await frame.waitForFunction(() => !document.querySelector('#wallpaper-color').getAttribute('src'));
    failNormal = true; await settings({ portraitCycle: true }); await mediaStatus('fallback');
    await settings({ motion: false }); await frame.waitForFunction(() => document.body.dataset.moving === 'false');
    const staticStatus = await mediaStatus('ready'); assert.equal(staticStatus.message, '');
    const result = await assertStatic(frame); assert.equal(result.preset, 'wireframe');
    failNormal = false; await settings({ motion: true }); await waitPortrait(frame, true);
    return { result, staticStatus };
  });
  await check('加载中修改同一预设亮度不会取消有效的人物解码', async () => {
    await settings({ preset: 'aurora' }); let frame = await background(); await frame.waitForFunction(() => document.body.dataset.preset === 'aurora');
    delayNormal = true; await settings({ preset: 'wireframe' });
    for (let attempt = 0; attempt < 60 && pendingNormals.length === 0; attempt++) await page.waitForTimeout(80);
    assert.ok(pendingNormals.length > 0, '没有捕获到可控有色资源请求。');
    const current = await options.evaluate(() => NebulaSettings.get()); await settings({ dim: current.dim === 18 ? 19 : 18 });
    delayNormal = false; for (const route of pendingNormals.splice(0)) await route.continue();
    await waitPortrait(frame, true); assert.equal((await layerState(frame)).cycle, 'true'); return await layerState(frame);
  });
  await check('换背景后迟到的有色失败不会撤销新的本机素材', async () => {
    await settings({ preset: 'aurora' }); let frame = await background(); await frame.waitForFunction(() => document.body.dataset.preset === 'aurora');
    delayNormal = true; await settings({ preset: 'wireframe' });
    for (let attempt = 0; attempt < 60 && pendingNormals.length === 0; attempt++) await page.waitForTimeout(80);
    assert.ok(pendingNormals.length > 0, '没有捕获到待取消的有色请求。');
    await settings({ backgroundType: 'custom' }); await frame.waitForFunction(() => document.body.dataset.preset === 'custom' && document.querySelector('#wallpaper-image').naturalWidth === 16);
    delayNormal = false; for (const route of pendingNormals.splice(0)) { try { await route.abort(); } catch {} }
    await page.waitForTimeout(180); const result = await layerState(frame); assert.equal(result.preset, 'custom'); assert.equal(result.layers['wallpaper-image'].width, 16); assert.equal(result.layers['wallpaper-color'].src, null);
    const status = await options.evaluate(() => chrome.storage.local.get('nebulaMediaStatus')); assert.equal(status.nebulaMediaStatus.state, 'ready'); return { result, status };
  });
  await check('线框底图失败仍使用既有极光降级，没有半张有色孤层', async () => {
    failWireframe = true; await settings({ preset: 'wireframe', backgroundType: 'preset' }); const frame = await background();
    await frame.waitForFunction(() => document.body.dataset.preset === 'aurora');
    const result = await layerState(frame); assert.equal(result.layers['wallpaper-color'].src, null); assert.equal(result.layers['wallpaper-color'].hidden, true);
    assert.equal(await frame.locator('#preset').evaluate(element => element.hidden), false); assert.deepEqual(await geometry(), nativeGeometry);
    const failedStatus = await mediaStatus('fallback');
    // 底图已失败时不能把“关闭动态”当成故障恢复；只有叠层的错误可被清除。
    await settings({ motion: false }); await frame.waitForFunction(() => document.body.dataset.moving === 'false');
    const stoppedStatus = await options.evaluate(async () => (await chrome.storage.local.get('nebulaMediaStatus')).nebulaMediaStatus);
    assert.equal(stoppedStatus.state, 'fallback'); assert.equal(stoppedStatus.message, failedStatus.message);
    await settings({ motion: true }); failWireframe = false; return { result, failedStatus, stoppedStatus };
  });
  await check('宿主页停用及恢复不遗留叠层，并恢复原生属性和几何', async () => {
    await settings({ enabled: false }); await page.waitForFunction(() => !document.querySelector('#nebula-backdrop'));
    assert.equal(await page.locator('html').getAttribute('data-nebula-preset'), 'host-before'); assert.deepEqual(await geometry(), nativeGeometry);
    await activatePortrait(); assert.deepEqual(await geometry(), nativeGeometry);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.waitForFunction(() => !document.querySelector('#nebula-backdrop'));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    const frame = await background(); await waitPortrait(frame, true); assert.deepEqual(await geometry(), nativeGeometry);
  });
  await check('动态背景无脚本错误、主动外部请求或隐式改写本机素材', async () => {
    const record = await options.evaluate(() => NebulaMedia.load()); assert.equal(record.name, 'icon-16.png');
    assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedRemoteRequests, []);
    assert.ok(report.intentionallyFailedRequests.some(url => url.endsWith('/wireframe-color-v1.png')));
    assert.ok(report.intentionallyFailedRequests.some(url => url.endsWith('/wireframe-wallpaper.png')));
    return { requestedFailureInjection: report.intentionallyFailedRequests.length };
  });
}

main().catch(error => { report.errors.push({ fatal: error.stack }); process.exitCode = 1; }).finally(async () => {
  // 故障注入中挂起的请求必须结束，正常媒体与用户文件均不被删除。
  for (const route of pendingNormals.splice(0)) { try { await route.abort(); } catch {} }
  if (context) await context.close();
  report.finishedAt = new Date().toISOString();
  report.passed = report.errors.length === 0 && !report.checks.some(item => !item.passed);
  const bytes = JSON.stringify(report, null, 2);
  const runReport = path.join(artifactDir, 'report.json');
  fs.writeFileSync(runReport, bytes);
  // 首次运行留下版本快照；重复测试保留历史，结果仍存入独立 run 目录。
  // wx 原子地拒绝覆盖，已有快照不算测试失败，也不需要用户删除材料。
  try { fs.writeFileSync(versionedReport, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    process.stdout.write('PRESERVED ' + versionedReport + '\n');
  }
  if (!report.passed) process.exitCode = 1;
  process.stdout.write('RESULT ' + runReport + '\n');
});
