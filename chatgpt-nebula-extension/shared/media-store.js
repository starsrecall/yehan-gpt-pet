/* 素材只保存在扩展自己的本机空间；解码与封面生成成功后才替换旧素材。 */
(function () {
  'use strict';

  const MAX_BYTES = 50 * 1024 * 1024;
  const DATABASE = 'nebulaMedia';
  const STORE = 'assets';
  const SLOT = 'asset';
  const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
  const EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
  let databasePromise;
  let writeQueue = Promise.resolve();

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('当前页面无法保存本地素材，请从扩展的设置入口重试。'));
        return;
      }
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(new Error('本地素材空间暂时无法打开，请重试。'));
      request.onblocked = () => reject(new Error('素材空间正在被另一个设置页占用，关闭重复页面后重试。'));
    });
    databasePromise.catch(() => { databasePromise = undefined; });
    return databasePromise;
  }

  // 等待事务完成后再报告成功，避免界面提前显示“已保存”。
  async function transact(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(new Error('素材未能保存。请检查本机可用空间后重试，原素材仍被保留。'));
    });
  }

  function withWriteLock(action) {
    // 多个设置页共同使用扩展源锁；解码、封面生成和事务完成都在同一临界区。
    // 无 Web Locks 的环境仅保留本页串行能力，正常 Chrome 扩展页使用跨页锁。
    const next = writeQueue.then(() => {
      if (globalThis.navigator && navigator.locks && typeof navigator.locks.request === 'function') {
        return navigator.locks.request('nebula-media-write', action);
      }
      return action();
    });
    writeQueue = next.catch(() => undefined);
    return next;
  }

  async function load() {
    await writeQueue;
    const record = await transact('readonly', store => store.get(SLOT));
    return record && record.blob instanceof Blob ? record : null;
  }

  function validate(file) {
    if (!(file instanceof Blob) || file.size === 0) throw new Error('请选择一张完整图片或一段视频。');
    if (file.size > MAX_BYTES) throw new Error('文件超过 50 MB，请选择更小的素材。原素材仍被保留。');
    const name = typeof file.name === 'string' ? file.name : '本地素材';
    const extension = name.split('.').pop().toLowerCase();
    const mimeType = (file.type || EXTENSIONS[extension] || '').toLowerCase();
    if (!MIME_TYPES.has(mimeType)) throw new Error('暂时支持 PNG、JPG、WebP、GIF、MP4 和 WebM。');
    return { blob: new Blob([file], { type: mimeType }), name: name.slice(0, 250), mimeType };
  }

  function waitForMedia(element, readyEvent) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('素材读取超时，请选择较小或可正常播放的文件。')), 20000);
      function finish(error) {
        clearTimeout(timer);
        element.removeEventListener(readyEvent, onReady);
        element.removeEventListener('error', onError);
        if (error) reject(error); else resolve();
      }
      function onReady() { finish(); }
      function onError() { finish(new Error('这个文件无法正常显示，请换一份图片或视频。原素材仍被保留。')); }
      element.addEventListener(readyEvent, onReady, { once: true });
      element.addEventListener('error', onError, { once: true });
    });
  }

  async function drawPoster(source, width, height) {
    if (!width || !height) throw new Error('素材没有可显示的画面，请换一份文件。');
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('静态封面暂时无法生成，请重试。');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const posterBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!posterBlob || posterBlob.size === 0) throw new Error('静态封面未能生成，原素材仍被保留。');
    return posterBlob;
  }

  async function createPoster(blob, mimeType) {
    const url = URL.createObjectURL(blob);
    const isVideo = mimeType.startsWith('video/');
    const source = isVideo ? document.createElement('video') : new Image();
    try {
      if (isVideo) {
        source.muted = true;
        source.playsInline = true;
        source.preload = 'auto';
        const ready = waitForMedia(source, 'loadeddata');
        source.src = url;
        source.load();
        await ready;
        return await drawPoster(source, source.videoWidth, source.videoHeight);
      }
      const ready = waitForMedia(source, 'load');
      source.src = url;
      await ready;
      return await drawPoster(source, source.naturalWidth, source.naturalHeight);
    } finally {
      if (isVideo) {
        source.pause();
        source.removeAttribute('src');
        source.load();
      } else {
        source.removeAttribute('src');
      }
      URL.revokeObjectURL(url);
    }
  }

  function save(file) {
    return withWriteLock(async () => {
      const validated = validate(file);
      const posterBlob = await createPoster(validated.blob, validated.mimeType);
      const previous = await transact('readonly', store => store.get(SLOT));
      // 即便同毫秒连续导入，也给每份素材一个不同版本，供明确清除时核对目标。
      const previousTime = previous && Number.isFinite(previous.updatedAt) ? previous.updatedAt : 0;
      const record = { ...validated, posterBlob, updatedAt: Math.max(Date.now(), previousTime + 1) };
      // 此前发生的任何错误都不会开始覆盖事务。
      await transact('readwrite', store => store.put(record, SLOT));
      return record;
    });
  }

  function clear(expectedUpdatedAt) {
    // 只由设置页明确的“清除素材”按钮调用；恢复默认不会触发此入口。
    return withWriteLock(async () => {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const request = store.get(SLOT);
        let conflict;
        request.onsuccess = () => {
          const current = request.result;
          // 比较与删除位于同一事务，另一设置页不能在核对后偷换用户确认的文件。
          if (expectedUpdatedAt !== undefined && (!current || current.updatedAt !== expectedUpdatedAt)) {
            conflict = new Error('本机素材已在另一个设置页变化，请查看最新文件后重新确认清除。');
            conflict.code = 'NEBULA_MEDIA_CHANGED';
            transaction.abort();
            return;
          }
          store.delete(SLOT);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(conflict || new Error('素材未能清除，请重试。'));
      });
    });
  }

  globalThis.NebulaMedia = Object.freeze({ load, save, clear, MAX_BYTES });
})();
