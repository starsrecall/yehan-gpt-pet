/* 夜航的配置边界：所有页面通过同一入口读取、校验与保存外观设置。 */
(function () {
  'use strict';

  const KEY = 'nebulaSettings';
  const DEFAULTS = Object.freeze({
    enabled: true,
    mode: 'soft',
    preset: 'aurora',
    accent: '#76d9ff',
    dim: 35,
    panelOpacity: 82,
    blur: 8,
    positionX: 65,
    positionY: 50,
    motion: true,
    // 升级时保留原有静态线框；用户明确启用后才加载另一张人物图。
    portraitCycle: false,
    scanlines: false,
    backgroundType: 'preset',
    assetVersion: 0
  });

  const ENUMS = Object.freeze({
    mode: ['soft', 'glass'],
    preset: ['aurora', 'midnight', 'paper', 'character', 'wireframe'],
    backgroundType: ['preset', 'custom']
  });
  const NUMBERS = Object.freeze({
    dim: [0, 90],
    panelOpacity: [20, 100],
    blur: [0, 24],
    positionX: [0, 100],
    positionY: [0, 100],
    assetVersion: [0, Number.MAX_SAFE_INTEGER]
  });
  let writeQueue = Promise.resolve();

  // 只保留已知字段，避免过期或损坏的设置进入网页样式。
  function normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const result = { ...DEFAULTS };
    for (const key of ['enabled', 'motion', 'portraitCycle', 'scanlines']) {
      if (typeof source[key] === 'boolean') result[key] = source[key];
    }
    for (const [key, allowed] of Object.entries(ENUMS)) {
      if (allowed.includes(source[key])) result[key] = source[key];
    }
    for (const [key, [min, max]] of Object.entries(NUMBERS)) {
      const candidate = source[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        result[key] = Math.round(Math.min(max, Math.max(min, candidate)));
      }
    }
    if (typeof source.accent === 'string' && /^#[0-9a-f]{6}$/i.test(source.accent)) {
      result.accent = source.accent.toLowerCase();
    }
    return result;
  }

  function storage() {
    if (!globalThis.chrome || !chrome.storage || !chrome.storage.local) {
      throw new Error('请在已安装的夜航扩展中打开设置页。');
    }
    return chrome.storage.local;
  }

  async function readStored() {
    const values = await storage().get(KEY);
    return normalize(values[KEY]);
  }

  async function get() {
    await writeQueue;
    return readStored();
  }

  // popup 与 options 属于同一扩展源；Web Locks 把跨页面的读取—合并—保存设为临界区。
  // 若运行环境未提供锁，保留单页面队列，但不能声称跨页面写入仍然受保护。
  function withSettingsLock(action) {
    if (globalThis.navigator && navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request('nebula-settings-write', action);
    }
    return action();
  }

  // 同一个页面内的修改串行合并，拖动滑块时也不会用旧值覆盖新值。
  function set(partial) {
    const patch = partial && typeof partial === 'object' && !Array.isArray(partial) ? { ...partial } : {};
    const next = writeQueue.then(() => withSettingsLock(async () => {
      const current = await readStored();
      const normalized = normalize({ ...current, ...patch });
      await storage().set({ [KEY]: normalized });
      return normalized;
    }));
    // 保留本次错误供调用方显示，但允许下一次操作继续保存。
    writeQueue = next.catch(() => undefined);
    return next;
  }

  function reset() {
    const next = writeQueue.then(() => withSettingsLock(async () => {
      const normalized = { ...DEFAULTS };
      await storage().set({ [KEY]: normalized });
      return normalized;
    }));
    writeQueue = next.catch(() => undefined);
    return next;
  }

  globalThis.NebulaSettings = Object.freeze({ DEFAULTS, normalize, get, set, reset, KEY });
})();
