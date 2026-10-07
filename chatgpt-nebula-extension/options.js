/* 设置页控制器：所有写入串行合并；本机素材导入验证后才替换旧记录。 */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const RANGE_KEYS = ['dim', 'panelOpacity', 'blur', 'positionX', 'positionY'];
  const BOOLEAN_KEYS = ['enabled', 'motion', 'portraitCycle', 'scanlines'];
  // 独立按钮明确应用整套外观；普通预设按钮只换背景，保留用户微调。
  // 动态开关、启停状态与已导入素材不属于这套样式，不改写它们。
  const WIREFRAME_LOOK = Object.freeze({ preset: 'wireframe', backgroundType: 'preset', mode: 'glass', accent: '#52deff', dim: 18, panelOpacity: 48, blur: 8, positionX: 75, positionY: 50, scanlines: true, portraitCycle: true });
  let settings = { ...NebulaSettings.DEFAULTS };
  let pendingPatch = {};
  let saveTimer;
  let revision = 0;
  let savingCount = 0;
  let mediaRecord = null;
  let mediaBusy = false;
  let mediaAvailable = false;
  let mediaFailureMessage = '';
  let mediaLoadGeneration = 0;
  let confirmationTarget = null;

  function announce(message, error = false) {
    byId('save-status').textContent = message;
    byId('save-status').classList.toggle('error', error);
  }

  // 预览只绘制示意面板，不访问或复制真实 ChatGPT 会话。
  function render() {
    for (const key of BOOLEAN_KEYS) byId(key).checked = settings[key];
    byId('mode').value = settings.mode;
    for (const key of RANGE_KEYS) {
      byId(key).value = settings[key];
      byId(`${key}-value`).value = `${settings[key]}${key === 'blur' ? ' px' : '%'}`;
    }
    byId('accent').value = settings.accent;
    byId('accent-value').value = settings.accent.toUpperCase();
    document.documentElement.style.setProperty('--accent', settings.accent);
    const preview = byId('preview');
    preview.dataset.mode = settings.mode;
    preview.dataset.preset = settings.backgroundType === 'preset' ? settings.preset : 'custom';
    preview.style.setProperty('--preview-panel', settings.panelOpacity / 100);
    preview.style.setProperty('--preview-blur', `${settings.blur}px`);
    preview.classList.toggle('disabled', !settings.enabled);
    byId('preview-paused').hidden = settings.enabled;
    for (const button of document.querySelectorAll('button[data-preset]')) {
      button.setAttribute('aria-pressed', String(settings.backgroundType === 'preset' && settings.preset === button.dataset.preset));
    }
    byId('media-file').disabled = !mediaAvailable || mediaBusy;
    byId('use-custom').disabled = !mediaAvailable || !mediaRecord || mediaBusy;
    byId('clear-media').disabled = !mediaAvailable || !mediaRecord || mediaBusy;
    byId('confirm-clear').disabled = !mediaAvailable || mediaBusy;
  }

  function queuePatch(patch, immediate = false) {
    revision += 1;
    settings = NebulaSettings.normalize({ ...settings, ...patch });
    pendingPatch = { ...pendingPatch, ...patch };
    render();
    announce('正在保存…');
    clearTimeout(saveTimer);
    if (immediate) return flushChanges();
    saveTimer = setTimeout(() => { void flushChanges(); }, 180);
    return Promise.resolve();
  }

  // 每轮只保存自本轮开始的修改，后续拖动保留在下一轮，避免旧结果回写控件。
  async function flushChanges() {
    clearTimeout(saveTimer);
    const patch = pendingPatch;
    pendingPatch = {};
    if (!Object.keys(patch).length) return;
    const savedRevision = revision;
    savingCount += 1;
    try {
      const saved = await NebulaSettings.set(patch);
      if (revision === savedRevision) {
        const mediaChanged = settings.assetVersion !== saved.assetVersion;
        settings = saved;
        render();
        announce('已自动保存到本机');
        if (mediaChanged && !mediaBusy) void refreshMedia();
      }
      return true;
    } catch (error) {
      announce(error.message || '设置暂时未能保存，请重试。', true);
      return false;
    } finally {
      savingCount -= 1;
    }
  }

  function showMedia(message, error = false) {
    byId('media-status').textContent = message;
    byId('media-status').classList.toggle('error', error);
  }

  function describeMedia() {
    if (!mediaAvailable) {
      showMedia(mediaFailureMessage || '正在读取本机素材…', Boolean(mediaFailureMessage));
      return;
    }
    if (!mediaRecord) { showMedia('还没有导入本机素材。先选一个预设也很好。'); return; }
    const size = (mediaRecord.blob.size / 1024 / 1024).toFixed(1);
    const active = settings.backgroundType === 'custom' ? '正在使用' : '已保留，当前使用预设';
    showMedia(`${mediaRecord.name} · ${size} MiB · ${active}`);
  }

  function setMediaBusy(value) {
    mediaBusy = value;
    byId('media-file').disabled = value;
    byId('reset-settings').disabled = value;
    byId('confirm-clear').disabled = value;
    render();
  }

  function openClearConfirmation() {
    if (!mediaRecord) return;
    confirmationTarget = { updatedAt: mediaRecord.updatedAt, name: mediaRecord.name };
    byId('clear-description').textContent = `将从本扩展的本机空间清除「${mediaRecord.name}」。原始文件不受影响。确认后使用当前预设。`;
    byId('clear-confirmation').hidden = false;
    byId('confirm-clear').focus();
  }

  async function refreshMedia() {
    const generation = ++mediaLoadGeneration;
    try {
      const loaded = await NebulaMedia.load();
      // 慢的旧读取不会覆盖另一轮导入、清除或更新后的素材信息。
      if (generation !== mediaLoadGeneration || mediaBusy) return;
      mediaAvailable = true;
      mediaFailureMessage = '';
      mediaRecord = loaded;
      const hadConfirmation = !byId('clear-confirmation').hidden;
      byId('clear-confirmation').hidden = true;
      confirmationTarget = null;
      render();
      describeMedia();
      if (hadConfirmation) showMedia('素材已经变化。请查看最新文件，再点击“清除本机素材”确认。');
    } catch (error) {
      if (generation === mediaLoadGeneration) {
        mediaAvailable = false;
        mediaFailureMessage = `本机素材暂时不可用，仍可使用预设与基本外观设置。${error.message || ''}`;
        render();
        describeMedia();
      }
    }
  }

  async function importMedia(event) {
    const file = event.target.files && event.target.files[0];
    if (!file || !mediaAvailable || mediaBusy) return;
    byId('clear-confirmation').hidden = true;
    confirmationTarget = null;
    mediaLoadGeneration += 1;
    setMediaBusy(true);
    showMedia(`正在检查并保存 ${file.name}…`);
    try {
      // NebulaMedia.save 在解码和生成封面成功之前不会覆盖旧素材。
      mediaRecord = await NebulaMedia.save(file);
      const saved = await queuePatch({ backgroundType: 'custom', assetVersion: mediaRecord.updatedAt }, true);
      if (saved) describeMedia();
      else showMedia('素材已保存在本机，但背景切换未能保存。请点击“使用已保存素材”重试。', true);
    } catch (error) {
      showMedia(error.message || '素材未能导入，原素材仍被保留。', true);
    } finally {
      event.target.value = '';
      setMediaBusy(false);
    }
  }

  async function clearMedia() {
    if (!mediaAvailable || !mediaRecord || !confirmationTarget || mediaBusy) return;
    const expected = { ...confirmationTarget };
    mediaLoadGeneration += 1;
    setMediaBusy(true);
    try {
      // 用户先看到文件名并点击确认；恢复默认不调用这个删除入口。
      await NebulaMedia.clear(expected.updatedAt);
      mediaRecord = null;
      await queuePatch({ backgroundType: 'preset', assetVersion: Date.now() }, true);
      byId('clear-confirmation').hidden = true;
      confirmationTarget = null;
      describeMedia();
    } catch (error) {
      if (error.code === 'NEBULA_MEDIA_CHANGED') {
        mediaRecord = await NebulaMedia.load();
        byId('clear-confirmation').hidden = true;
        confirmationTarget = null;
        showMedia(error.message, true);
      } else showMedia(error.message || '素材未能清除，请重试。', true);
    } finally {
      setMediaBusy(false);
    }
  }

  async function resetSettings() {
    if (mediaBusy) return;
    byId('reset-settings').disabled = true;
    try {
      await flushChanges();
      revision += 1;
      const resetRevision = revision;
      settings = { ...NebulaSettings.DEFAULTS };
      render();
      announce('正在恢复默认…');
      const saved = await NebulaSettings.reset();
      // 若恢复过程中又操作控件，后续操作会排在 reset 后保存。
      if (revision === resetRevision) { settings = saved; render(); }
      describeMedia();
      if (revision === resetRevision) announce('已恢复默认；本机素材仍然保留');
    } catch (error) {
      announce(error.message || '默认设置未能保存，请重试。', true);
    } finally {
      byId('reset-settings').disabled = false;
    }
  }

  function renderRuntimeStatus(status) {
    const fallback = status && status.state === 'fallback';
    byId('runtime-status').closest('.runtime-card').classList.toggle('fallback', Boolean(fallback));
    if (fallback) {
      byId('runtime-status').textContent = typeof status.message === 'string' && status.message.trim()
        ? status.message : '背景已使用安全回退。请尝试切换预设或重新导入素材。';
    } else if (status && status.state === 'ready') {
      byId('runtime-status').textContent = '背景已加载。此状态可能来自预览，不能作为真实账号网页兼容性验证。';
    } else {
      byId('runtime-status').textContent = '尚未收到网页或背景的状态报告。预览不代表真实账号网页已验证。';
    }
  }

  function bindControls() {
    for (const key of BOOLEAN_KEYS) byId(key).addEventListener('change', () => { void queuePatch({ [key]: byId(key).checked }, true); });
    byId('mode').addEventListener('change', () => { void queuePatch({ mode: byId('mode').value }, true); });
    for (const key of RANGE_KEYS) {
      byId(key).addEventListener('input', () => { void queuePatch({ [key]: Number(byId(key).value) }); });
      // 松手或完成键盘调整时立即提交，减少关闭设置页前的防抖等待窗口。
      byId(key).addEventListener('change', () => { void flushChanges(); });
    }
    byId('accent').addEventListener('input', () => { void queuePatch({ accent: byId('accent').value }); });
    byId('accent').addEventListener('change', () => { void flushChanges(); });
    for (const button of document.querySelectorAll('button[data-preset]')) button.addEventListener('click', () => {
      void queuePatch({ preset: button.dataset.preset, backgroundType: 'preset' }, true);
      describeMedia();
    });
    byId('apply-wireframe-look').addEventListener('click', () => {
      void queuePatch(WIREFRAME_LOOK, true);
      describeMedia();
    });
    byId('media-file').addEventListener('change', importMedia);
    byId('use-custom').addEventListener('click', () => {
      if (!mediaRecord) return;
      void queuePatch({ backgroundType: 'custom', assetVersion: Date.now() }, true);
      describeMedia();
    });
    byId('clear-media').addEventListener('click', () => {
      if (!mediaRecord) return;
      openClearConfirmation();
    });
    byId('confirm-clear').addEventListener('click', clearMedia);
    byId('cancel-clear').addEventListener('click', () => { byId('clear-confirmation').hidden = true; confirmationTarget = null; byId('clear-media').focus(); });
    byId('reset-settings').addEventListener('click', resetSettings);
    // 关闭设置页前尽早触发待保存内容；外观调整不依赖持续打开设置页。
    window.addEventListener('pagehide', () => { void flushChanges(); });
  }

  async function initialize() {
    try {
      // 基本配置不依赖媒体数据库；IndexedDB 不可用时仍允许预设和启停皮肤。
      const loaded = await Promise.all([NebulaSettings.get(), chrome.storage.local.get('nebulaMediaStatus')]);
      settings = loaded[0];
      render();
      renderRuntimeStatus(loaded[1].nebulaMediaStatus);
      bindControls();
      announce('已自动保存到本机');
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.nebulaMediaStatus) renderRuntimeStatus(changes.nebulaMediaStatus.newValue);
        if (changes[NebulaSettings.KEY] && !savingCount && !Object.keys(pendingPatch).length) {
          const mediaChanged = settings.assetVersion !== changes[NebulaSettings.KEY].newValue?.assetVersion;
          settings = NebulaSettings.normalize(changes[NebulaSettings.KEY].newValue);
          render();
          describeMedia();
          if (mediaChanged) void refreshMedia();
        }
      });
      // 素材初始化独立捕获，失败只停用素材入口，不禁用设置页其他控件。
      await refreshMedia();
    } catch (error) {
      announce(error.message || '设置页暂时无法初始化，请重新打开。', true);
      showMedia('本机素材暂时无法读取；没有执行覆盖或清除。', true);
      for (const control of document.querySelectorAll('input, select, button')) control.disabled = true;
    }
  }
  void initialize();
})();
