/*
 * 背景播放与素材生命周期。所有 Blob 地址仅在扩展源内创建和使用。
 * GIF 暂停时解除原 src 并换封面，视频保留当前帧，网页失配与这里无关。
 */
(function () {
  'use strict';
  const image = document.getElementById('wallpaper-image');
  const colorImage = document.getElementById('wallpaper-color');
  const video = document.getElementById('wallpaper-video');
  const poster = document.getElementById('wallpaper-poster');
  const preset = document.getElementById('preset');
  const scanlines = document.getElementById('scanlines');
  const wireframeEffects = document.getElementById('wireframe-effects');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const isPreview = new URL(location.href).searchParams.has('preview');
  let settings = { ...NebulaSettings.DEFAULTS };
  let parentVisible = true;
  let revision = 0;
  let loadedKey = '';
  let kind = 'preset';
  let mediaUrl = '';
  let posterUrl = '';
  let effectivePreset = 'aurora';
  const blobUrls = new Set();
  let destroyed = false;
  // 只有释放素材时递增。调暗度等同素材更新不能废弃正在进行的解码。
  let portraitGeneration = 0;
  let portraitPending = false;
  let portraitReady = false;
  let portraitFailed = false;

  function releasePortrait() {
    portraitGeneration++;
    portraitPending = portraitReady = portraitFailed = false;
    colorImage.hidden = true;
    colorImage.removeAttribute('src');
    document.body.dataset.portraitCycle = 'false';
    document.body.dataset.portraitReady = 'false';
  }

  function wantsPortrait() {
    return !destroyed && effectivePreset === 'wireframe' && settings.backgroundType === 'preset'
      && settings.preset === 'wireframe' && settings.portraitCycle && settings.enabled
      && settings.motion && !reducedMotion.matches;
  }

  function syncPortrait() {
    if (!wantsPortrait()) {
      // 不加载关闭的功能；关闭、减少动态与换背景均解除叠层并重置相位。
      const recoveredStatic = portraitFailed && effectivePreset === 'wireframe'
        && settings.backgroundType === 'preset' && settings.preset === 'wireframe'
        && image.complete && image.naturalWidth > 0 && image.hasAttribute('src');
      if (portraitPending || portraitReady || portraitFailed || colorImage.hasAttribute('src')) releasePortrait();
      // 主动返回可用的静态线框后清除叠层故障提示，不掩盖底图/视频故障。
      if (recoveredStatic) report('ready');
      return;
    }
    if (portraitReady) {
      colorImage.hidden = false;
      document.body.dataset.portraitCycle = 'true';
      return;
    }
    if (portraitPending || portraitFailed) return;
    portraitPending = true;
    const generation = portraitGeneration;
    const baseSource = image.getAttribute('src');
    const colorSource = chrome.runtime.getURL('assets/wireframe-color-v1.png');
    colorImage.src = colorSource;
    const current = () => !destroyed && generation === portraitGeneration
      && image.getAttribute('src') === baseSource && colorImage.getAttribute('src') === colorSource;
    // 两图均成功解码且大小一致才揭开叠层；旧解码回调不能影响新背景。
    Promise.all([image.decode(), colorImage.decode()]).then(() => {
      if (!current()) return;
      // 同代数加载期间系统偏好可能已经改变；先同步最新动态状态，不能悬挂 pending。
      if (!wantsPortrait()) { portraitPending = false; syncMotion(); return; }
      if (!image.naturalWidth || colorImage.naturalWidth !== image.naturalWidth
        || colorImage.naturalHeight !== image.naturalHeight) throw new Error('人物素材尺寸不一致');
      portraitPending = false;
      portraitReady = true;
      document.body.dataset.portraitReady = 'true';
      syncPortrait();
      report('ready');
    }).catch(() => {
      if (!current()) return;
      if (!wantsPortrait()) { portraitPending = false; syncMotion(); return; }
      portraitPending = false;
      portraitFailed = true;
      colorImage.hidden = true;
      colorImage.removeAttribute('src');
      document.body.dataset.portraitCycle = 'false';
      // 不调用整体 fallback：叠层失败时正常的线框底图仍可使用。
      report('fallback', '人物画面切换暂时不可用，已保留静态线框。可关闭再开启“人物画面切换”重试。');
    });
  }

  function objectUrl(blob) {
    const url = URL.createObjectURL(blob);
    blobUrls.add(url);
    return url;
  }

  function releaseMedia() {
    releasePortrait();
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
    image.removeAttribute('src');
    poster.removeAttribute('src');
    image.hidden = video.hidden = poster.hidden = true;
    for (const url of blobUrls) URL.revokeObjectURL(url);
    blobUrls.clear();
    mediaUrl = posterUrl = '';
    kind = 'preset';
  }

  async function report(state, message = '') {
    // 设置页预览不覆盖实际网页状态；该状态仅报告媒体，不宣称网页验证完成。
    if (isPreview || destroyed) return;
    try {
      const status = { state, message, updatedAt: Date.now() };
      await chrome.storage.local.set({ nebulaMediaStatus: status });
    } catch { /* 扩展更新/关闭时的旧连接错误无需影响网页。 */ }
  }

  function moving() {
    return settings.enabled && settings.motion && !reducedMotion.matches && !document.hidden && parentVisible;
  }

  function syncMotion() {
    if (destroyed) return;
    const run = moving();
    document.body.dataset.moving = String(run);
    syncPortrait();
    if (kind === 'video') {
      if (run) {
        video.play().catch(error => {
          // 主动暂停/换背景造成的 AbortError 不是自动播放故障。
          if (!moving() || kind !== 'video' || destroyed || error.name === 'AbortError') return;
          // 浏览器拒绝自动播放时保留可见静态帧并提示；不循环重试。
          report('fallback', '视频自动播放未成功，可在设置中重新开启动态，或选择图片。');
        });
      } else video.pause();
    }
    if (kind === 'gif') {
      if (run) {
        poster.hidden = true;
        image.hidden = false;
        if (image.getAttribute('src') !== mediaUrl) image.src = mediaUrl;
      } else {
        // 隐藏 GIF 仍可能持续解码，必须清除原地址后显示静态封面。
        image.hidden = true;
        image.removeAttribute('src');
        poster.hidden = false;
        if (poster.getAttribute('src') !== posterUrl) poster.src = posterUrl;
      }
    }
  }

  function fallback(message) {
    releaseMedia();
    effectivePreset = 'aurora';
    wireframeEffects.hidden = true;
    preset.hidden = false;
    document.body.dataset.preset = effectivePreset;
    syncMotion();
    report('fallback', message);
  }

  function mediaFailed(event) {
    // 已解除 src 的旧媒体可能发事件，忽略空地址，防止撤销新背景。
    if (!event.target.getAttribute('src') || destroyed) return;
    fallback('背景无法正常显示，已切回蓝色氛围。请重新选择可播放的素材。');
  }
  image.addEventListener('error', mediaFailed);
  poster.addEventListener('error', mediaFailed);
  video.addEventListener('error', mediaFailed);

  async function apply(next) {
    settings = next;
    const token = ++revision;
    document.body.style.setProperty('--wallpaper-dim', String(settings.dim / 100));
    document.body.style.setProperty('--wallpaper-x', settings.positionX + '%');
    document.body.style.setProperty('--wallpaper-y', settings.positionY + '%');
    scanlines.hidden = !settings.scanlines;
    const key = settings.backgroundType === 'custom' ? 'custom:' + settings.assetVersion : 'preset:' + settings.preset;
    if (key === loadedKey) { syncMotion(); return; }

    try {
      let record = null;
      if (settings.backgroundType === 'custom') record = await NebulaMedia.load();
      if (token !== revision || destroyed) return;
      releaseMedia();
      effectivePreset = next.backgroundType === 'custom' ? 'custom' : next.preset;
      document.body.dataset.preset = effectivePreset;
      // 自定义素材不叠加特定预设光效，避免把保留的 preset 字段误当当前背景。
      wireframeEffects.hidden = next.backgroundType !== 'preset' || next.preset !== 'wireframe';
      preset.hidden = false;
      loadedKey = key;
      if (next.backgroundType === 'custom') {
        if (!record?.blob || !record.posterBlob) throw new Error('没有找到完整的本机素材，请在设置中重新选择。');
        mediaUrl = objectUrl(record.blob);
        posterUrl = objectUrl(record.posterBlob);
        if (record.mimeType.startsWith('video/')) {
          kind = 'video';
          video.src = mediaUrl;
          video.poster = posterUrl;
          video.hidden = false;
          video.load();
        } else if (record.mimeType === 'image/gif') {
          kind = 'gif';
        } else {
          kind = 'image';
          image.src = mediaUrl;
          image.hidden = false;
        }
        preset.hidden = true;
      } else if (next.preset === 'character' || next.preset === 'wireframe') {
        kind = 'image';
        // 本机底图不循环换地址，人物叠化由另一张同构图叠层与 CSS 动画表达。
        image.src = chrome.runtime.getURL(next.preset === 'wireframe' ? 'assets/wireframe-wallpaper.png' : 'assets/character-wallpaper.png');
        image.hidden = false;
        preset.hidden = true;
      }
      syncMotion();
      report('ready');
    } catch (error) {
      if (token !== revision || destroyed) return;
      loadedKey = key;
      fallback(error.message || '背景加载失败，已切回蓝色氛围。');
    }
  }

  let readVersion = 0;
  async function refresh() {
    const version = ++readVersion;
    try {
      const next = await NebulaSettings.get();
      if (version === readVersion && !destroyed) await apply(next);
    } catch (error) {
      if (!destroyed) fallback('外观设置暂时无法读取，请刷新网页或重新打开设置。');
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[NebulaSettings.KEY]) refresh();
  });
  window.addEventListener('message', event => {
    // 网页只能发送可见性提示，不能传素材、设置或执行命令。
    if (event.source !== parent || event.origin !== 'https://chatgpt.com') return;
    if (event.data?.type !== 'nebula-host-visibility' || typeof event.data.visible !== 'boolean') return;
    parentVisible = event.data.visible;
    syncMotion();
  });
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  window.addEventListener('pagehide', () => {
    destroyed = true;
    // 生命周期离开也暂停 CSS 光效；恢复后由最新配置重新决定是否运行。
    document.body.dataset.moving = 'false';
    revision++;
    releaseMedia();
  });
  window.addEventListener('pageshow', () => {
    // 设置预览页也可能进入 bfcache：恢复后重建 Blob 地址和监听状态。
    if (!destroyed) return;
    destroyed = false;
    loadedKey = '';
    refresh();
  });
  refresh();
})();
