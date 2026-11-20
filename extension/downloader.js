// تنزيل HLS (بما فيه AES-128 المفتوح) و DASH غير المشفّر، ثم دمج المقاطع في ملف واحد
const q = new URLSearchParams(location.search);
const srcUrl = q.get('u'), baseName = q.get('n') || 'video', kind = q.get('k') || 'hls';
const $ = (id) => document.getElementById(id);
const log = (t) => { $('st').textContent = t; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const abs = (u, b) => new URL(u, b).href;
async function getBuf(u) { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }
async function getText(u) { return new TextDecoder().decode(await getBuf(u)); }
function attrs(s) { const o = {}; const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g; let m; while ((m = re.exec(s))) o[m[1]] = m[2].replace(/^"|"$/g, ''); return o; }
const tail = (l) => l.slice(l.indexOf(':') + 1);

function ivBytes(iv, n) {
  const b = new Uint8Array(16);
  if (iv) { const hx = iv.replace(/^0x/i, '').padStart(32, '0'); for (let i = 0; i < 16; i++) b[i] = parseInt(hx.substr(i * 2, 2), 16); }
  else new DataView(b.buffer).setUint32(12, n >>> 0);
  return b;
}
const keyCache = new Map();
async function decrypt(buf, s) {
  let k = keyCache.get(s.key.uri);
  if (!k) { k = crypto.subtle.importKey('raw', await getBuf(s.key.uri), 'AES-CBC', false, ['decrypt']); keyCache.set(s.key.uri, k); }
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes(s.key.iv, s.n) }, await k, buf);
}
async function fetchSeg(s) {
  let err;
  for (let t = 0; t < 3; t++) {
    try { let b = await getBuf(s.url); if (s.key) b = await decrypt(b, s); return new Uint8Array(b); }
    catch (e) { err = e; await sleep(500 * (t + 1)); }
  }
  throw err;
}
function save(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function grab(segs, filename, mime) {
  const parts = new Array(segs.length); let idx = 0, done = 0;
  const worker = async () => {
    while (idx < segs.length) { const i = idx++; parts[i] = await fetchSeg(segs[i]); done++; $('bar').value = done / segs.length; log(filename + ' — ' + done + '/' + segs.length); }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  save(new Blob(parts, { type: mime }), filename);
}

/* ---------- HLS ---------- */
async function hlsMedia(u, text, name) {
  const segs = []; let seq = 0, key = null, map = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = +tail(l) || 0;
    else if (l.startsWith('#EXT-X-KEY:')) {
      const a = attrs(tail(l));
      if (a.METHOD === 'NONE') key = null;
      else {
        if (a.METHOD !== 'AES-128') throw new Error('تشفير غير مدعوم (' + a.METHOD + ') — محتوى محمي بـ DRM');
        if (a.KEYFORMAT && a.KEYFORMAT !== 'identity') throw new Error('مفتاح DRM غير مدعوم');
        key = { uri: abs(a.URI, u), iv: a.IV };
      }
    } else if (l.startsWith('#EXT-X-MAP:')) map = abs(attrs(tail(l)).URI, u);
    else if (l[0] !== '#') segs.push({ url: abs(l, u), key, n: seq + segs.length });
  }
  if (!segs.length) throw new Error('لا توجد مقاطع في القائمة');
  if (map) segs.unshift({ url: map, key: null, n: 0 });
  await grab(segs, name + (map ? '.mp4' : '.ts'), map ? 'video/mp4' : 'video/mp2t');
}
async function hls(u, name) {
  let text = await getText(u), audioUrl = null;
  if (/#EXT-X-STREAM-INF/.test(text)) {
    const lines = text.split(/\r?\n/); let best = null; const media = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('#EXT-X-STREAM-INF:')) {
        const a = attrs(tail(l)); let j = i + 1;
        while (j < lines.length && (!lines[j].trim() || lines[j].startsWith('#'))) j++;
        const bw = +a.BANDWIDTH || 0;
        if (j < lines.length && (!best || bw > best.bw)) best = { bw, uri: abs(lines[j].trim(), u), audio: a.AUDIO };
      } else if (l.startsWith('#EXT-X-MEDIA:')) { const a = attrs(tail(l)); if (a.TYPE === 'AUDIO' && a.URI) media.push(a); }
    }
    if (!best) throw new Error('قائمة تشغيل غير صالحة');
    const au = media.find(m => m['GROUP-ID'] === best.audio); if (au) audioUrl = abs(au.URI, u);
    u = best.uri; text = await getText(u);
  }
  await hlsMedia(u, text, name);
  if (audioUrl) await hlsMedia(audioUrl, await getText(audioUrl), name + '.audio');
}

/* ---------- DASH (غير مشفّر) ---------- */
const isoDur = (s) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const kid = (e, n) => [...e.children].find(c => c.localName === n);
function baseOf(u, ...els) { let b = u; for (const e of els) { const bu = kid(e, 'BaseURL'); if (bu) b = abs(bu.textContent.trim(), b); } return b; }
async function dashRep(s, r, u, mpd, period, total, name, type) {
  const base = baseOf(u, mpd, period, s, r);
  const tpl = kid(r, 'SegmentTemplate') || kid(s, 'SegmentTemplate');
  let urls = [];
  const sub = (t, n, time) => t.replace(/\$RepresentationID\$/g, r.getAttribute('id')).replace(/\$Bandwidth\$/g, r.getAttribute('bandwidth'))
    .replace(/\$(Number|Time)(?:%0(\d+)d)?\$/g, (_, k, w) => { const v = k === 'Number' ? n : time; return w ? String(v).padStart(+w, '0') : String(v); });
  if (tpl) {
    const ts = +tpl.getAttribute('timescale') || 1, start = +tpl.getAttribute('startNumber') || 1;
    const init = tpl.getAttribute('initialization'), media = tpl.getAttribute('media');
    if (init) urls.push(abs(sub(init, 0, 0), base));
    const tl = kid(tpl, 'SegmentTimeline');
    if (tl) {
      let t = 0, n = start;
      for (const S of tl.children) {
        if (S.getAttribute('t')) t = +S.getAttribute('t');
        const d = +S.getAttribute('d'), rep = +S.getAttribute('r') || 0;
        for (let i = 0; i <= rep; i++) { urls.push(abs(sub(media, n, t), base)); t += d; n++; }
      }
    } else {
      const d = +tpl.getAttribute('duration'); if (!d || !total) throw new Error('بث DASH مباشر/غير مدعوم');
      const cnt = Math.ceil(total * ts / d); for (let i = 0; i < cnt; i++) urls.push(abs(sub(media, start + i, i * d), base));
    }
  } else if (kid(r, 'BaseURL')) urls = [base];
  else throw new Error('نمط DASH غير مدعوم');
  await grab(urls.map((url, i) => ({ url, key: null, n: i })), name + (type === 'audio' ? '.m4a' : '.mp4'), type === 'audio' ? 'audio/mp4' : 'video/mp4');
}
async function dash(u, name) {
  const xml = new DOMParser().parseFromString(await getText(u), 'application/xml');
  if (xml.querySelector('ContentProtection')) throw new Error('المحتوى محمي (DRM/CENC) — غير مدعوم');
  const mpd = xml.documentElement, period = xml.querySelector('Period');
  const total = isoDur(mpd.getAttribute('mediaPresentationDuration'));
  const sets = [...period.children].filter(c => c.localName === 'AdaptationSet');
  for (const type of ['video', 'audio']) {
    let best = null;
    for (const s of sets) {
      const mt = s.getAttribute('contentType') || s.getAttribute('mimeType') || (kid(s, 'Representation') && kid(s, 'Representation').getAttribute('mimeType')) || '';
      if (!mt.startsWith(type)) continue;
      for (const r of s.children) if (r.localName === 'Representation') { const bw = +r.getAttribute('bandwidth') || 0; if (!best || bw > best.bw) best = { bw, s, r }; }
    }
    if (best) await dashRep(best.s, best.r, u, mpd, period, total, type === 'audio' ? name + '.audio' : name, type);
  }
}

(async () => {
  try {
    if (!srcUrl) throw new Error('لا يوجد رابط');
    if (kind === 'dash') await dash(srcUrl, baseName); else await hls(srcUrl, baseName);
    log('✔ اكتمل التنزيل — ملفات TS تعمل في VLC/MX Player');
  } catch (e) { $('bar').hidden = true; log('✖ ' + e.message); }
})();
