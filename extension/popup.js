const $ = (s) => document.querySelector(s);
const LBL = { video: 'فيديو', audio: 'صوت', image: 'صورة', hls: 'بث HLS', dash: 'بث DASH', mse: 'بث (التقاط)' };
const ORDER = { hls: 0, dash: 0, video: 1, mse: 1, audio: 2, image: 3 };
const fmt = (n) => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
let tab;
function nameOf(it) {
  let n = '';
  if (/^https?:/i.test(it.url)) { try { n = decodeURIComponent(new URL(it.url).pathname.split('/').pop() || ''); } catch (_) {} }
  return n || it.title || it.kind;
}
function cmd(c) { chrome.tabs.sendMessage(tab.id, { mgcmd: c }).catch(() => {}); }
async function load() {
  const r = await chrome.runtime.sendMessage({ popup: 'items', tabId: tab.id });
  $('#warn').hidden = !r.drm;
  const list = $('#list'); list.textContent = '';
  const arr = r.items.sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9)).slice(0, 150);
  if (!arr.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'لا توجد وسائط بعد — شغّل الفيديو أو حدّث الصفحة.'; list.append(e); return; }
  for (const it of arr) {
    const row = document.createElement('div'); row.className = 'row';
    const inf = document.createElement('div'); inf.className = 'in';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = nameOf(it);
    const mt = document.createElement('div'); mt.className = 'mt';
    mt.textContent = [LBL[it.kind], it.w && it.h ? it.w + '×' + it.h : '', fmt(it.size)].filter(Boolean).join(' • ');
    inf.append(nm, mt);
    const b = document.createElement('button'); b.className = 'dl'; b.textContent = '⬇';
    b.onclick = () => { chrome.runtime.sendMessage({ popup: 'download', tabId: tab.id, item: it }); b.textContent = '✔'; };
    row.append(inf, b); list.append(row);
  }
}
(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('#pick').onclick = () => { cmd('pick'); window.close(); };
  $('#panel').onclick = () => { cmd('panel'); window.close(); };
  load(); setInterval(load, 2000);
})();
