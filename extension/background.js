'use strict';
const tabs = new Map(); // tabId -> Promise<{items:Map, drm:boolean}>
const SEG = /\.(ts|m4s|cmfv|cmfa|cmft)(?:$|[?#])/i;

function kindOf(url, mime) {
  mime = (mime || '').toLowerCase();
  if (SEG.test(url) || /mp2t|iso\.segment/.test(mime)) return null;
  const u = url.split(/[?#]/)[0].toLowerCase();
  if (/\.m3u8$/.test(u) || /mpegurl/.test(mime)) return 'hls';
  if (/\.mpd$/.test(u) || /dash\+xml/.test(mime)) return 'dash';
  if (mime.startsWith('video/') || /\.(mp4|m4v|webm|mkv|mov|avi|flv|3gp|ogv)$/.test(u)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(u)) return 'audio';
  return null;
}
const sanitize = (n) => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'media';
function extFor(d) {
  const m = (d.mime || '').split(';')[0].trim();
  const map = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
  return map[m] || { video: 'mp4', audio: 'mp3', image: 'jpg' }[d.kind] || 'bin';
}
function guessName(d) {
  let n = '';
  try { n = decodeURIComponent(new URL(d.url).pathname.split('/').pop() || ''); } catch (_) {}
  if (!/\.[a-z0-9]{2,5}$/i.test(n)) n = (d.title || d.kind || 'media').slice(0, 80) + '.' + extFor(d);
  return sanitize(n);
}

function getTab(id) {
  if (!tabs.has(id)) {
    tabs.set(id, (async () => {
      const k = 't' + id; const r = await chrome.storage.session.get(k); const s = r[k];
      return { items: new Map(((s && s.items) || []).map(i => [i.key, i])), drm: !!(s && s.drm) };
    })());
  }
  return tabs.get(id);
}
function save(id, t) { chrome.storage.session.set({ ['t' + id]: { items: [...t.items.values()], drm: t.drm } }).catch(() => {}); }
function badge(id, t) {
  const n = [...t.items.values()].filter(i => i.kind !== 'image').length;
  chrome.action.setBadgeBackgroundColor({ tabId: id, color: '#0f766e' }).catch(() => {});
  chrome.action.setBadgeText({ tabId: id, text: n ? String(n) : '' }).catch(() => {});
}
async function addItems(tabId, arr, drm) {
  const t = await getTab(tabId); let ch = false;
  if (drm && !t.drm) { t.drm = true; ch = true; }
  for (const i of arr) {
    if (!i.url || i.url.startsWith('data:')) continue;
    const key = i.key || i.url; const old = t.items.get(key);
    if (!old) { t.items.set(key, { ...i, key, title: (i.title || '').slice(0, 120) }); ch = true; }
    else {
      for (const k of ['size', 'w', 'h', 'title', 'poster', 'mime']) if (i[k] && old[k] !== i[k]) { old[k] = i[k]; ch = true; }
      if (i.id) old.id = i.id;
    }
  }
  if (ch) { save(tabId, t); badge(tabId, t); }
}

// التقاط طلبات الشبكة (فيديو/صوت/قوائم HLS و DASH)
chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0) return;
  const h = {}; for (const x of d.responseHeaders || []) h[x.name.toLowerCase()] = x.value;
  const ct = (h['content-type'] || '').toLowerCase();
  const k = kindOf(d.url, ct);
  if (!k) return;
  let size = +h['content-length'] || 0; const cr = h['content-range'];
  if (cr) { const m = cr.match(/\/(\d+)$/); if (m) size = +m[1]; }
  if (size && size < 20 * 1024 && k !== 'hls' && k !== 'dash') return;
  addItems(d.tabId, [{ url: d.url, kind: k, mime: ct.split(';')[0], size }]);
}, { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] }, ['responseHeaders']);

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  tabs.delete(d.tabId); chrome.storage.session.remove('t' + d.tabId).catch(() => {});
  chrome.action.setBadgeText({ tabId: d.tabId, text: '' }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((id) => { tabs.delete(id); chrome.storage.session.remove('t' + id).catch(() => {}); });

function handleDownload(d) {
  const name = sanitize(d.name || guessName(d));
  if (d.kind === 'hls' || d.kind === 'dash') {
    const q = new URLSearchParams({ u: d.url, n: name.replace(/\.[^.]+$/, ''), k: d.kind });
    chrome.windows.create({ url: chrome.runtime.getURL('downloader.html') + '?' + q, type: 'popup', width: 460, height: 260 });
    return;
  }
  chrome.downloads.download({ url: d.url, filename: name, conflictAction: 'uniquify' }, () => {
    if (chrome.runtime.lastError) chrome.downloads.download({ url: d.url, conflictAction: 'uniquify' }, () => void chrome.runtime.lastError);
  });
}

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m && m.from === 'mg') {
    const id = sender.tab && sender.tab.id; if (id == null) return;
    if (m.type === 'items') addItems(id, (m.data.items || []).map(i => ({ ...i, frameId: sender.frameId })), m.data.drm);
    else if (m.type === 'download') handleDownload(m.data);
    return;
  }
  if (m && m.popup === 'items') { getTab(m.tabId).then(t => respond({ items: [...t.items.values()], drm: t.drm })); return true; }
  if (m && m.popup === 'download') {
    const it = m.item;
    if (it.page) chrome.tabs.sendMessage(m.tabId, { mgcmd: 'download', arg: it.id }).catch(() => {});
    else handleDownload({ url: it.url, kind: it.kind, mime: it.mime, title: it.title });
  }
});

chrome.commands.onCommand.addListener(async (c) => {
  if (c !== 'toggle-pick') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { mgcmd: 'pick' }).catch(() => {});
});
