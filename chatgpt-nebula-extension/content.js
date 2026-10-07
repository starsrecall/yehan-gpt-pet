/*
 * 网页入口：只挂载背景和设置自身属性，不读取对话、不改 React 或页面接口。
 * 所有依赖 ChatGPT 页面结构的外观规则都在 styles/site.css，日后优先维护该文件。
 */
(function () {
  'use strict';
  if (globalThis.__nebulaSkinInstalled) return;
  globalThis.__nebulaSkinInstalled = true;

  const root = document.documentElement;
  const FRAME_ID = 'nebula-backdrop';
  const extensionOrigin = 'chrome-extension://' + chrome.runtime.id;
  // 预设只通过自有属性选择配色；停用时连同旧值一起恢复。
  const attributes = ['data-nebula-enabled', 'data-nebula-mode', 'data-nebula-preset'];
  const originalAttributes = new Map();
  const originalProperties = new Map();
  let settings = { ...NebulaSettings.DEFAULTS, enabled: false };
  let frame = null;
  let bodyObserver = null;
  let rootObserver = null;
  let observedBody = null;
  let repairTimer = null;
  let readVersion = 0;
  let active = false;

  function preserveAndSet(name, value) {
    // 使用独有前缀；停用时恢复原有的同名内联值和优先级。
    if (!originalProperties.has(name)) {
      originalProperties.set(name, [root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
    }
    root.style.setProperty(name, value, 'important');
  }

  function sendVisibility() {
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: 'nebula-host-visibility', visible: !document.hidden }, extensionOrigin);
    } catch (error) {
      // 扩展重载使旧脚本失效时，只撤销本页皮肤，不影响网页本身。
      console.warn('[夜航] 背景连接已失效，可刷新网页恢复。', error);
      disable();
    }
  }

  function observeBody() {
    if (document.body === observedBody) return;
    bodyObserver?.disconnect();
    observedBody = document.body;
    if (observedBody) {
      bodyObserver = new MutationObserver(scheduleRepair);
      // 只看 body 的直接孩子；流式回答的内部 DOM 变化不会触发遍历。
      bodyObserver.observe(observedBody, { childList: true });
    }
  }

  function mount() {
    if (!active || !document.body) return;
    observeBody();
    if (frame?.isConnected) return;
    frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.src = chrome.runtime.getURL('backdrop.html');
    frame.title = '夜航背景';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.inert = true;
    frame.addEventListener('load', sendVisibility);
    // 独立放在 body 下，页面子应用重新渲染时不会替换背景内部结构。
    document.body.appendChild(frame);
  }

  function scheduleRepair() {
    if (!active || (frame?.isConnected && document.body === observedBody) || repairTimer !== null) return;
    repairTimer = setTimeout(() => {
      repairTimer = null;
      mount();
    }, 120);
  }

  function enable(next) {
    settings = next;
    if (!active) {
      active = true;
      for (const attribute of attributes) originalAttributes.set(attribute, root.getAttribute(attribute));
      rootObserver = new MutationObserver(scheduleRepair);
      // 检测整个 body 被网页替换；仍不监听整棵树。
      rootObserver.observe(root, { childList: true });
    }
    root.setAttribute('data-nebula-enabled', 'true');
    root.setAttribute('data-nebula-mode', settings.mode);
    root.setAttribute('data-nebula-preset', settings.backgroundType === 'preset' ? settings.preset : 'custom');
    const rgb = [1, 3, 5].map(index => parseInt(settings.accent.slice(index, index + 2), 16)).join(' ');
    preserveAndSet('--nebula-accent', settings.accent);
    preserveAndSet('--nebula-accent-rgb', rgb);
    preserveAndSet('--nebula-panel-alpha', String(settings.panelOpacity / 100));
    preserveAndSet('--nebula-composer-alpha', String(Math.max(0.65, settings.panelOpacity / 100)));
    preserveAndSet('--nebula-blur', settings.blur + 'px');
    mount();
  }

  function disable() {
    active = false;
    if (repairTimer !== null) clearTimeout(repairTimer);
    repairTimer = null;
    rootObserver?.disconnect();
    bodyObserver?.disconnect();
    rootObserver = bodyObserver = null;
    observedBody = null;
    frame?.remove();
    frame = null;
    for (const [attribute, value] of originalAttributes) {
      if (value === null) root.removeAttribute(attribute); else root.setAttribute(attribute, value);
    }
    originalAttributes.clear();
    for (const [name, [value, priority]] of originalProperties) {
      if (value) root.style.setProperty(name, value, priority); else root.style.removeProperty(name);
    }
    originalProperties.clear();
  }

  async function refresh() {
    const version = ++readVersion;
    try {
      const next = await NebulaSettings.get();
      if (version !== readVersion) return;
      if (next.enabled) enable(next); else disable();
    } catch (error) {
      if (version !== readVersion) return;
      disable();
      console.warn('[夜航] 设置不可用，本页已恢复原有外观。', error);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[NebulaSettings.KEY]) refresh();
  });
  document.addEventListener('visibilitychange', sendVisibility);
  // bfcache 返回时重新读取，普通 SPA 切换由现有 CSS 自动匹配。
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', disable);
  refresh();
})();
