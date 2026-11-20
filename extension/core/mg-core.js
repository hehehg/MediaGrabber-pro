/* Media Grabber core — يعمل داخل صفحة الويب (إضافة المتصفح + Android WebView) */
(() => {
  'use strict';
  if (window.__MG) return;
  const TOP = window.top === window;
  const MAX_CAPTURE = 800 * 1024 * 1024;
  const rid = Math.random().toString(36).slice(2, 6);
  let seq = 0, drm = false, picking = false, filter = 'all';
  const items = new Map(), remote = new Map(), blobInfo = new Map();
  const msRec = new WeakMap();
  const origCreate = URL.createObjectURL.bind(URL);

  const MIME_EXT = { 'video/mp4': 'mp4', 'audio/mp4': 'm4a', 'video/webm': 'webm', 'audio/webm': 'weba', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'video/ogg': 'ogv', 'video/quicktime': 'mov', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/flac': 'flac', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };
  const LBL = { video: 'فيديو', audio: 'صوت', image: 'صورة', hls: 'بث HLS', dash: 'بث DASH', mse: 'بث (التقاط)' };
  const ICON = { video: '🎬', audio: '🎵', image: '🖼', hls: '📡', dash: '📡', mse: '📡' };
  const isVid = k => k === 'video' || k === 'hls' || k === 'dash' || k === 'mse';
  const fmt = n => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const h = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  const SEG_URL = /\.(ts|m4s|cmfv|cmfa|cmft)(?:$|[?#])/i;
  function kindOf(url, mime) {
    mime = (mime || '').toLowerCase();
    if (SEG_URL.test(url) || /mp2t|iso\.segment/.test(mime)) return null;
    const u = url.split(/[?#]/)[0].toLowerCase();
    if (/\.m3u8$/.test(u) || /mpegurl/.test(mime)) return 'hls';
    if (/\.mpd$/.test(u) || /dash\+xml/.test(mime)) return 'dash';
    if (mime.startsWith('video/') || /\.(mp4|m4v|webm|mkv|mov|avi|flv|3gp|ogv)$/.test(u)) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(u)) return 'audio';
    if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(u)) return 'image';
    return null;
  }
  function extOf(it) {
    const m = (it.mime || '').split(';')[0].trim();
    if (MIME_EXT[m]) return MIME_EXT[m];
    return { video: 'mp4', audio: 'mp3', image: 'jpg', hls: 'mp4', dash: 'mp4', mse: 'mp4' }[it.kind] || 'bin';
  }
  function makeName(it) {
    let n = '';
    if (/^https?:/i.test(it.url)) { try { n = decodeURIComponent(new URL(it.url).pathname.split('/').pop() || ''); } catch (e) {} }
    if (!/\.[a-z0-9]{2,5}$/i.test(n)) n = (it.title || document.title || it.kind || 'media').trim().slice(0, 80) + '.' + extOf(it);
    return n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120);
  }

  /* ---------- إرسال الرسائل (إضافة أو أندرويد) ---------- */
  function send(type, data) {
    const msg = { __mg: 1, type, data };
    try {
      if (window.MGAndroid) window.MGAndroid.post(JSON.stringify(msg));
      else window.postMessage(msg, '*');
    } catch (e) {}
  }

  /* ---------- مخزن الوسائط ---------- */
  function addItem(p) {
    let url = p.url; if (!url) return null;
    try { url = new URL(url, document.baseURI).href; } catch (e) { return null; }
    if (!/^(https?:|blob:|data:)/i.test(url)) return null;
    let mime = p.mime || '';
    if (url.startsWith('data:')) mime = mime || url.slice(5).split(/[;,]/)[0];
    const kind = p.kind || kindOf(url, mime);
    if (!kind) return null;
    const key = p.key || url;
    let it = items.get(key);
    if (it) {
      for (const k of ['w', 'h', 'size', 'title', 'poster', 'mime']) if (p[k] && !it[k]) it[k] = p[k];
      return it;
    }
    it = { id: rid + (++seq), key, url, kind, mime, title: p.title || '', poster: p.poster || '', w: p.w || 0, h: p.h || 0, size: p.size || 0, page: !!p.page || url.startsWith('blob:') };
    items.set(key, it); changed();
    return it;
  }
  function mseRec(it) { const b = blobInfo.get(it.url); return b && b.ms && msRec.get(b.ms); }
  function mseSize(it) { const r = mseRec(it); return r ? r.tracks.reduce((s, t) => s + t.size, 0) : 0; }
  function all() { const m = new Map(); remote.forEach((v, k) => m.set(k, v)); items.forEach((v, k) => m.set(v.url, v)); return [...m.values()]; }
  function list() {
    return [...items.values()].map(it => ({ id: it.id, key: it.key, url: it.url, kind: it.kind, mime: it.mime, title: it.title, poster: it.poster, w: it.w, h: it.h, page: it.page, size: it.kind === 'mse' ? mseSize(it) : it.size }));
  }
  let nt = 0;
  function changed() {
    clearTimeout(nt);
    nt = setTimeout(() => {
      const l = list();
      send('items', { items: l, drm });
      if (!TOP) { try { window.top.postMessage({ __mgframe: 1, items: l.filter(i => !i.page), drm }, '*'); } catch (e) {} }
      renderUI();
    }, 250);
  }

  /* ---------- الاعتراضات (hooks) ---------- */
  try {
    URL.createObjectURL = function (obj) {
      const url = origCreate(obj);
      try {
        if (window.MediaSource && obj instanceof MediaSource) blobInfo.set(url, { ms: obj });
        else if (obj instanceof Blob && obj.size > 2000 && /^(video|audio|image)\//.test(obj.type)) addItem({ url, mime: obj.type, size: obj.size, page: true });
      } catch (e) {}
      return url;
    };
  } catch (e) {}

  try {
    if (window.MediaSource) {
      const add = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = function (type) {
        const sb = add.apply(this, arguments);
        try {
          let rec = msRec.get(this); if (!rec) { rec = { tracks: [] }; msRec.set(this, rec); }
          const tr = { type, chunks: [], size: 0 }; rec.tracks.push(tr);
          const ap = sb.appendBuffer;
          sb.appendBuffer = function (data) {
            try {
              if (tr.size < MAX_CAPTURE) {
                const c = data instanceof ArrayBuffer ? data.slice(0) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
                tr.chunks.push(c); tr.size += c.byteLength;
              }
            } catch (e) {}
            return ap.apply(this, arguments);
          };
        } catch (e) {}
        return sb;
      };
    }
  } catch (e) {}

  try {
    if (navigator.requestMediaKeySystemAccess) {
      const o = navigator.requestMediaKeySystemAccess.bind(navigator);
      navigator.requestMediaKeySystemAccess = function () { drm = true; changed(); return o.apply(null, arguments); };
    }
  } catch (e) {}

  const STREAMY = k => k === 'hls' || k === 'dash' || k === 'video' || k === 'audio';
  try {
    const _fetch = window.fetch;
    window.fetch = function (...a) {
      const p = _fetch.apply(this, a);
      try {
        const req = a[0]; const url = typeof req === 'string' ? req : (req && req.url) || String(req);
        p.then(r => {
          try {
            const ct = r.headers.get('content-type') || ''; const k = kindOf(r.url || url, ct);
            if (STREAMY(k)) addItem({ url: r.url || url, mime: ct, kind: k, size: +r.headers.get('content-length') || 0 });
          } catch (e) {}
        }, () => {});
      } catch (e) {}
      return p;
    };
    const xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__mgu = u;
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 2) return;
        try {
          const ct = this.getResponseHeader('content-type') || ''; const url = this.responseURL || this.__mgu; const k = kindOf(url, ct);
          if (STREAMY(k)) addItem({ url, mime: ct, kind: k });
        } catch (e) {}
      });
      return xo.apply(this, arguments);
    };
  } catch (e) {}

  /* ---------- مسح الصفحة ---------- */
  function register(s, el) {
    const isV = el.tagName === 'VIDEO';
    const base = { title: el.title || el.getAttribute('aria-label') || document.title, w: el.videoWidth || 0, h: el.videoHeight || 0, poster: el.poster || '' };
    if (s.startsWith('blob:')) {
      const b = blobInfo.get(s);
      return addItem({ ...base, url: s, kind: b && b.ms ? 'mse' : (isV ? 'video' : 'audio'), page: true });
    }
    return addItem({ ...base, url: s, kind: kindOf(s) || (isV ? 'video' : 'audio') });
  }
  function scan() {
    document.querySelectorAll('video,audio').forEach(el => {
      const srcs = new Set([el.currentSrc, el.src]); el.querySelectorAll('source').forEach(s => srcs.add(s.src));
      srcs.forEach(s => s && register(s, el));
    });
    document.querySelectorAll('img').forEach(im => {
      const u = im.currentSrc || im.src; if (!u) return;
      const w = im.naturalWidth, hh = im.naturalHeight;
      if (im.complete && w && hh && w * hh < 14400) return;
      addItem({ url: u, kind: 'image', w, h: hh });
    });
    document.querySelectorAll('a[href]').forEach(a => { const k = kindOf(a.href); if (k && k !== 'image') addItem({ url: a.href, kind: k }); });
    document.querySelectorAll('meta[property^="og:video"],meta[property="og:audio"]').forEach(m => m.content && addItem({ url: m.content }));
    layout();
  }
  function bestFor(el) {
    const src = el.currentSrc || el.src || (el.querySelector('source') || {}).src;
    let it = src ? register(src, el) : null;
    if (!it || it.kind === 'mse') {
      const hls = all().find(i => i.kind === 'hls');
      if (hls) return hls;
    }
    return it;
  }

  /* ---------- التنزيل ---------- */
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function saveBlob(blob, name) {
    if (window.MGAndroid) {
      const id = 'b' + Date.now() + Math.random().toString(36).slice(2, 6);
      const CH = 512 * 1024, total = Math.max(1, Math.ceil(blob.size / CH));
      for (let i = 0; i < total; i++) {
        const buf = await blob.slice(i * CH, (i + 1) * CH).arrayBuffer();
        window.MGAndroid.chunk(id, name, blob.type || 'application/octet-stream', i, i === total - 1, b64(buf));
      }
    } else {
      const a = document.createElement('a'); a.href = origCreate(blob); a.download = name; a.style.display = 'none';
      document.documentElement.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
    }
  }
  function saveMse(it) {
    const rec = mseRec(it); const tr = rec && rec.tracks.filter(t => t.size > 0);
    if (!tr || !tr.length) { toast('لا توجد بيانات ملتقطة بعد — شغّل الفيديو أولًا'); return; }
    const base = makeName(it).replace(/\.[^.]+$/, '');
    tr.forEach(t => {
      const mt = t.type.split(';')[0].trim(); const ext = MIME_EXT[mt] || 'mp4';
      const suf = tr.length > 1 ? (mt.startsWith('audio') ? '.audio' : '.video') : '';
      saveBlob(new Blob(t.chunks, { type: mt }), base + suf + '.' + ext);
    });
    toast(tr.length > 1 ? 'حُفظ مسارا الفيديو والصوت منفصلين (يلزم دمجهما)' : 'تم حفظ البث الملتقط');
  }
  async function download(it) {
    if (!it) return;
    const name = makeName(it);
    try {
      if (it.kind === 'mse') return saveMse(it);
      if (it.url.startsWith('blob:') || it.url.startsWith('data:')) { await saveBlob(await (await fetch(it.url)).blob(), name); toast('تم الحفظ: ' + name); return; }
      send('download', { url: it.url, kind: it.kind, name, mime: it.mime, title: it.title, referer: location.href });
      toast('أُضيف للتنزيل: ' + name);
    } catch (e) { toast('تعذّر التنزيل: ' + e.message); }
  }

  /* ---------- الواجهة ---------- */
  const STYLE = `<style>
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
[hidden]{display:none!important}
button{font:inherit;cursor:pointer;border:0;color:inherit;background:#374151;border-radius:8px;padding:6px 10px}
#fab{position:fixed;bottom:16px;right:16px;width:48px;height:48px;border-radius:50%;background:#0f766e;color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;box-shadow:0 2px 10px #0006;user-select:none}
#fab b{position:absolute;top:-4px;left:-4px;min-width:18px;height:18px;border-radius:9px;background:#dc2626;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 4px}
#panel{position:fixed;bottom:72px;right:12px;width:min(92vw,380px);max-height:62vh;background:#111827;color:#f9fafb;border-radius:14px;box-shadow:0 8px 30px #0008;display:flex;flex-direction:column;pointer-events:auto;direction:rtl;overflow:hidden;font-size:13px}
.hd{display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid #374151}.tt{flex:1;font-weight:700}
#pk.on{background:#dc2626}
#warn{background:#7c2d12;padding:6px 10px;font-size:12px}
.tabs{display:flex;gap:4px;padding:6px 10px}.tabs button{padding:3px 9px;font-size:12px}.tabs .on{background:#0f766e}
#list{overflow-y:auto;flex:1}
.row{display:flex;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid #1f2937}
.th{width:48px;height:48px;border-radius:8px;background:#1f2937;display:flex;align-items:center;justify-content:center;font-size:22px;overflow:hidden;flex:none}.th img{width:100%;height:100%;object-fit:cover}
.in{flex:1;min-width:0}.nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt{font-size:11px;color:#9ca3af}
.ic{background:#0f766e;padding:6px 9px}.empty{padding:18px;text-align:center;color:#9ca3af}
.ft{padding:8px 10px;border-top:1px solid #374151}.ft button{width:100%;background:#0f766e}
#ovl .vb{position:fixed;width:34px;height:34px;border-radius:50%;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;pointer-events:auto;cursor:pointer;opacity:.88;box-shadow:0 1px 6px #0007}
#hl{position:fixed;border:3px solid #f59e0b;background:#f59e0b33;pointer-events:none;border-radius:4px}
#toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#000d;color:#fff;padding:8px 14px;border-radius:20px;font-size:13px;max-width:86vw;direction:rtl;pointer-events:none}
</style>`;
  const HTML = `<div id="ovl"></div><div id="hl" hidden></div><div id="toast" hidden></div>
<div id="fab" hidden><span>⬇</span><b id="cnt">0</b></div>
<div id="panel" hidden>
<div class="hd"><span class="tt">وسائط الصفحة</span><button id="pk">🎯 التقاط بالنقر</button><button id="cl">✕</button></div>
<div id="warn" hidden>⚠ هذه الصفحة تستخدم حماية DRM — المحتوى المحمي لا يمكن تنزيله.</div>
<div class="tabs" id="tabs"><button data-f="all" class="on">الكل</button><button data-f="video">فيديو</button><button data-f="audio">صوت</button><button data-f="image">صور</button></div>
<div id="list"></div><div class="ft"><button id="all">تنزيل الكل</button></div></div>`;
  let hostEl, root; const $ui = {};
  function ensureUI() {
    if (hostEl) return true;
    if (!document.documentElement) return false;
    hostEl = h('div'); hostEl.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;';
    root = hostEl.attachShadow({ mode: 'closed' });
    root.innerHTML = STYLE + HTML;
    for (const id of ['ovl', 'hl', 'toast', 'fab', 'cnt', 'panel', 'pk', 'cl', 'warn', 'list', 'all', 'tabs']) $ui[id] = root.getElementById(id);
    $ui.fab.onclick = () => togglePanel();
    $ui.cl.onclick = () => { $ui.panel.hidden = true; };
    $ui.pk.onclick = () => setPick(!picking);
    $ui.all.onclick = () => shown().forEach((it, i) => setTimeout(() => download(it), i * 400));
    $ui.tabs.onclick = e => {
      const f = e.target.dataset && e.target.dataset.f; if (!f) return; filter = f;
      [...$ui.tabs.children].forEach(b => b.classList.toggle('on', b.dataset.f === f)); renderUI();
    };
    document.documentElement.appendChild(hostEl);
    return true;
  }
  let tt = 0;
  function toast(msg) { if (!ensureUI()) return; const t = $ui.toast; t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 3000); }
  function copy(text) { try { navigator.clipboard.writeText(text).then(() => toast('تم نسخ الرابط'), () => toast('تعذّر النسخ')); } catch (e) { toast('تعذّر النسخ'); } }
  const shown = () => all().filter(it => filter === 'all' || (filter === 'video' ? isVid(it.kind) : it.kind === filter)).reverse();
  function row(it) {
    const r = h('div', 'row'), th = h('div', 'th');
    const pic = it.kind === 'image' ? it.url : it.poster;
    if (pic) { const im = h('img'); im.src = pic; th.append(im); } else th.textContent = ICON[it.kind] || '📄';
    const inf = h('div', 'in');
    const size = it.kind === 'mse' ? mseSize(it) : it.size;
    inf.append(h('div', 'nm', makeName(it)), h('div', 'mt', [LBL[it.kind], it.w && it.h ? it.w + '×' + it.h : '', fmt(size), it.kind === 'mse' && !size ? 'شغّل الفيديو أولًا' : ''].filter(Boolean).join(' • ')));
    const dl = h('button', 'ic', '⬇'); dl.onclick = () => download(it);
    r.append(th, inf, dl);
    if (/^https?:/i.test(it.url)) { const cp = h('button', '', '🔗'); cp.onclick = () => copy(it.url); r.append(cp); }
    return r;
  }
  function buildList() {
    const L = $ui.list, st = L.scrollTop; L.textContent = '';
    const arr = shown();
    if (!arr.length) { L.append(h('div', 'empty', 'لا توجد وسائط بعد — شغّل الفيديو أو مرّر الصفحة.')); return; }
    arr.slice(0, 200).forEach(it => L.append(row(it)));
    L.scrollTop = st;
  }
  function renderUI() {
    if (!TOP || !ensureUI()) return;
    const n = all().length;
    $ui.cnt.textContent = n; $ui.fab.hidden = n === 0 && !picking;
    $ui.warn.hidden = !drm; $ui.pk.classList.toggle('on', picking);
    if (!$ui.panel.hidden) buildList();
  }
  function togglePanel() { if (!TOP || !ensureUI()) return; $ui.panel.hidden = !$ui.panel.hidden; renderUI(); }

  /* أزرار التنزيل فوق مشغّلات الفيديو */
  const vbtn = new Map();
  function layout() {
    const vids = [...document.querySelectorAll('video')];
    const seen = new Set();
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      if (r.width < 160 || r.height < 90 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (!ensureUI()) return;
      const it = bestFor(v); if (!it) continue;
      let b = vbtn.get(v);
      if (!b) { b = h('div', 'vb', '⬇'); b.onclick = e => { e.stopPropagation(); e.preventDefault(); download(bestFor(v)); }; $ui.ovl.append(b); vbtn.set(v, b); }
      b.style.top = (Math.max(r.top, 0) + 8) + 'px'; b.style.left = (Math.min(r.right, innerWidth) - 42) + 'px';
      seen.add(v);
    }
    vbtn.forEach((b, v) => { if (!seen.has(v)) { b.remove(); vbtn.delete(v); } });
  }

  /* ---------- وضع الالتقاط بالنقر ---------- */
  const BLOCK = ['click', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'];
  function deepQuery(sel, rootNode, out) {
    out = out || []; rootNode = rootNode || document;
    rootNode.querySelectorAll(sel).forEach(e => out.push(e));
    rootNode.querySelectorAll('*').forEach(e => { if (e.shadowRoot) deepQuery(sel, e.shadowRoot, out); });
    return out;
  }
  const hit = (el, x, y) => { const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 50 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  function mediaEl(x, y, deep) {
    const stack = document.elementsFromPoint(x, y).filter(el => el !== hostEl);
    // 1) الفيديو/الصوت له الأولوية حتى لو كانت فوقه طبقات شفافة أو صور أيقونات
    for (const el of stack) if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return { el, t: 'media' };
    // 2) فيديو تحت غلاف المشغّل (حتى داخل Shadow DOM) عند النقر
    if (deep) {
      const v = deepQuery('video,audio').find(el => hit(el, x, y));
      if (v) return { el: v, t: 'media' };
    }
    // 3) ثم الصور والخلفيات والروابط
    for (const el of stack) {
      if (el.tagName === 'IMG' && (el.currentSrc || el.src)) return { el, t: 'img', url: el.currentSrc || el.src };
      let bg = ''; try { bg = getComputedStyle(el).backgroundImage; } catch (e) {}
      const m = bg && bg !== 'none' && bg.match(/url\((['"]?)(.*?)\1\)/);
      if (m && m[2]) return { el, t: 'bg', url: m[2] };
      const a = el.closest && el.closest('a[href]');
      if (a && kindOf(a.href)) return { el: a, t: 'a', url: a.href };
    }
    return null;
  }
  function resolveItem(m) {
    if (m.t === 'media') return bestFor(m.el);
    if (m.t === 'img') return addItem({ url: m.url, kind: 'image', w: m.el.naturalWidth, h: m.el.naturalHeight });
    return addItem({ url: m.url });
  }
  function onBlock(e) {
    if (e.target === hostEl) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'click') {
      const m = mediaEl(e.clientX, e.clientY, true);
      if (!m) { toast('لا توجد وسائط هنا'); return; }
      const it = resolveItem(m);
      if (!it) { toast('لم يُعثر على مصدر قابل للتنزيل (قد يكون محميًا)'); return; }
      download(it);
    }
  }
  function onMove(e) {
    if (!ensureUI()) return;
    const m = mediaEl(e.clientX, e.clientY), hl = $ui.hl;
    if (!m) { hl.hidden = true; return; }
    const r = m.el.getBoundingClientRect();
    hl.style.cssText = `top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`; hl.hidden = false;
  }
  function onKey(e) { if (e.key === 'Escape') setPick(false); }
  function setPick(on) {
    if (picking === on) return;
    picking = on;
    if (on) {
      BLOCK.forEach(t => window.addEventListener(t, onBlock, true));
      window.addEventListener('pointermove', onMove, true); window.addEventListener('keydown', onKey, true);
      toast('وضع الالتقاط: اضغط على أي صورة أو فيديو لتنزيله فورًا (Esc للإنهاء)');
    } else {
      BLOCK.forEach(t => window.removeEventListener(t, onBlock, true));
      window.removeEventListener('pointermove', onMove, true); window.removeEventListener('keydown', onKey, true);
      if (ensureUI()) $ui.hl.hidden = true; toast('انتهى وضع الالتقاط');
    }
    renderUI();
    document.querySelectorAll('iframe,frame').forEach(f => { try { f.contentWindow.postMessage({ __mgcmd: 1, cmd: on ? 'pick:on' : 'pick:off' }, '*'); } catch (e) {} });
  }

  /* ---------- الأوامر القادمة من الإضافة/التطبيق ---------- */
  function cmd(c, arg) {
    if (c === 'panel') togglePanel();
    else if (c === 'pick') setPick(!picking);
    else if (c === 'pick:on') setPick(true);
    else if (c === 'pick:off') setPick(false);
    else if (c === 'scan') scan();
    else if (c === 'download') { const it = [...items.values()].find(i => i.id === arg); if (it) download(it); }
  }
  window.addEventListener('message', e => {
    const d = e.data; if (!d || typeof d !== 'object') return;
    if (d.__mgcmd === 1) cmd(d.cmd, d.arg);
    else if (d.__mgframe === 1 && TOP && Array.isArray(d.items)) {
      d.items.forEach(i => { if (i && typeof i.url === 'string' && /^(https?:|blob:|data:)/i.test(i.url)) remote.set(i.url, { ...i, remote: true }); });
      if (d.drm) drm = true; renderUI();
    }
  });

  window.__MG = {
    scan, list, togglePanel, setPick, download: id => cmd('download', id),
    saveBlobUrl: (url, name) => fetch(url).then(r => r.blob()).then(b => saveBlob(b, name || 'file')).then(() => toast('تم الحفظ')).catch(e => toast('تعذّر الحفظ: ' + e.message))
  };

  /* ---------- التشغيل ---------- */
  let st = 0; const sched = () => { clearTimeout(st); st = setTimeout(scan, 600); };
  function start() {
    scan();
    new MutationObserver(sched).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'href'] });
    ['loadedmetadata', 'loadeddata', 'play'].forEach(ev => document.addEventListener(ev, sched, true));
    window.addEventListener('scroll', () => requestAnimationFrame(layout), true);
    window.addEventListener('resize', layout);
    setInterval(layout, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
