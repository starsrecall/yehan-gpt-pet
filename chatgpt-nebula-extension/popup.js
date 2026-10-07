/* 弹窗只提交发生变化的字段，避免用打开弹窗时的旧快照覆盖设置页的新调整。 */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  let revision = 0;
  let pendingWrites = 0;

  function announce(message, error = false) {
    byId('save-status').textContent = message;
    byId('save-status').classList.toggle('error', error);
  }

  function render(settings) {
    byId('enabled').checked = settings.enabled;
    byId('mode').value = settings.mode;
    byId('motion').checked = settings.motion;
    document.documentElement.style.setProperty('--accent', settings.accent);
  }

  async function save(patch) {
    const edit = ++revision;
    pendingWrites += 1;
    announce('正在保存…');
    try {
      const settings = await NebulaSettings.set(patch);
      // 快速操作时仅用最后一轮结果刷新，旧 Promise 的结果不改动新控件状态。
      if (edit === revision) { render(settings); announce('已保存到本机'); }
    } catch (error) {
      announce(error.message || '设置暂时未能保存，请重试。', true);
    } finally {
      pendingWrites -= 1;
    }
  }

  async function initialize() {
    // openOptionsPage 是扩展内置入口，不需要 tabs 权限或读取用户其他标签页。
    byId('open-options').addEventListener('click', async () => {
      try {
        // 等当前弹窗的写队列完成后再关闭，避免最后一次开关设置因页面卸载而中断。
        await NebulaSettings.get();
        await chrome.runtime.openOptionsPage();
        window.close();
      }
      catch (error) { announce(error.message || '设置页未能打开，请从扩展管理页重试。', true); }
    });
    try {
      render(await NebulaSettings.get());
      announce('已读取本机设置');
      byId('enabled').addEventListener('change', () => { void save({ enabled: byId('enabled').checked }); });
      byId('mode').addEventListener('change', () => { void save({ mode: byId('mode').value }); });
      byId('motion').addEventListener('change', () => { void save({ motion: byId('motion').checked }); });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[NebulaSettings.KEY] && !pendingWrites) {
          render(NebulaSettings.normalize(changes[NebulaSettings.KEY].newValue));
        }
      });
    } catch (error) {
      announce(error.message || '本机设置暂时无法读取，请重新打开弹窗。', true);
      for (const control of document.querySelectorAll('input,select')) control.disabled = true;
    }
  }
  void initialize();
})();
