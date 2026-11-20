// جسر بين سكربت الصفحة (MAIN world) وخدمة الخلفية
(() => {
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__mg !== 1) return;
    try { chrome.runtime.sendMessage({ from: 'mg', type: d.type, data: d.data }); } catch (_) {}
  });
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.mgcmd) window.postMessage({ __mgcmd: 1, cmd: m.mgcmd, arg: m.arg }, '*');
    });
  } catch (_) {}
})();
