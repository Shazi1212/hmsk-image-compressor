// UI: reads dropped photos, shows their metadata, re-encodes them through a canvas (which drops all metadata),
// strips any block a browser might still add, checks the result and offers single downloads or a ZIP.
// Nothing leaves the device: the page's Content-Security-Policy blocks every network request (connect-src 'none').
import { TEXT } from './i18n.js';
import { readMetadata, stripMetadata, isClean, formatDeg } from './meta.js';
import { makeZip, uniqueNames } from './zip.js';
import { LINK_BASE, PRESETS, MAX_PIXELS, MAX_PIXELS_TOUCH } from './config.js';

const STORE = 'hmsk-image-compressor-v1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let lang = pickLang();
const T = () => TEXT[lang];
const settings = loadSettings();
const items = [];
let nextId = 1, busy = false;

function pickLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'de' || q === 'en') return q;
  try { const s = localStorage.getItem(STORE + '-lang'); if (s === 'de' || s === 'en') return s; } catch {}
  return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

function loadSettings() {
  const d = { preset: 'kleinanzeigen', customLong: 2000, format: 'auto', quality: PRESETS.kleinanzeigen.quality, runs: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && PRESETS[s.preset]) d.preset = s.preset;
    if (s && ['auto', 'jpeg', 'webp', 'png'].includes(s.format)) d.format = s.format;
    if (s && s.quality >= 10 && s.quality <= 100) d.quality = Math.round(s.quality);
    if (s && s.customLong >= 100 && s.customLong <= 10000) d.customLong = Math.round(s.customLong);
    if (s && s.runs > 0) d.runs = s.runs | 0;
  } catch {}
  return d;
}
function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch {} }

const locale = () => (lang === 'de' ? 'de-DE' : 'en-GB');
function fmtBytes(n) {
  const nf = (v, d) => v.toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: d });
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${nf(n / 1024, 0)} KB`;
  return `${nf(n / 1024 / 1024, n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}
function fmtPct(before, after) {
  const p = Math.round((after / before - 1) * 100);
  return (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + ' %';
}
const fmtDate = (d, off) => d.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') + (off ? ' ' + off : '');

// ---- static texts ----------------------------------------------------------------------------------------------

function applyLang() {
  const t = T();
  document.documentElement.lang = lang;
  document.title = t.docTitle;
  for (const el of $$('[data-t]')) {
    const v = t[el.dataset.t];
    if (typeof v === 'string') el.textContent = v;
  }
  $('#langBtn').setAttribute('aria-label', t.langSwitchLabel);
  const de = lang === 'de';
  $('#lnkHome').href = $('#lnkHome2').href = LINK_BASE + (de ? '/de/tools/image-compressor/' : '/tools/image-compressor/');
  $('#lnkImprint').href = LINK_BASE + (de ? '/impressum/' : '/imprint/');
  $('#lnkPrivacy').href = LINK_BASE + (de ? '/datenschutz/' : '/privacy/');
  $('#lnkNotify').href = LINK_BASE + (de ? '/de/?topic=image-compressor#contact' : '/?topic=image-compressor#contact');
  $('#howList').innerHTML = t.how.map(s => `<li>${esc(s)}</li>`).join('');
  $('#presets').innerHTML = Object.keys(PRESETS).map(k =>
    `<label class="chip"><input type="radio" name="preset" value="${k}"${k === settings.preset ? ' checked' : ''}><span>${esc(t['p_' + k])}</span></label>`).join('');
  syncSettingsUi();
  renderAll();
}

function presetBox() {
  const p = PRESETS[settings.preset];
  return settings.preset === 'custom' ? { maxW: settings.customLong, maxH: settings.customLong } : { maxW: p.maxW, maxH: p.maxH };
}

function syncSettingsUi() {
  const t = T();
  const { maxW, maxH } = presetBox();
  $('#presetHint').textContent = t.pHint(maxW, maxH);
  $('#customBox').hidden = settings.preset !== 'custom';
  $('#customLong').value = settings.customLong;
  $('#format').value = settings.format;
  $('#quality').value = settings.quality;
  $('#qOut').textContent = settings.quality;
  const png = settings.format === 'png';
  $('#quality').disabled = png;
  $('#qHint').textContent = png ? t.qualityPng : t.qualityHint;
}

// ---- adding files ----------------------------------------------------------------------------------------------

async function addFiles(fileList) {
  const files = [...fileList].filter(f => f && f.size);
  for (const file of files) {
    const it = { id: nextId++, file, name: file.name || 'image', size: file.size, meta: null, thumb: '', out: null, error: '', note: '' };
    items.push(it);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      it.meta = readMetadata(buf);
    } catch { it.meta = null; }
    if (it.meta && it.meta.format) it.thumb = URL.createObjectURL(file);
  }
  renderAll();
}

function removeItem(id) {
  const i = items.findIndex(x => x.id === id);
  if (i < 0) return;
  const [it] = items.splice(i, 1);
  if (it.thumb) URL.revokeObjectURL(it.thumb);
  if (it.out) URL.revokeObjectURL(it.out.url);
  renderAll();
}

// ---- processing ------------------------------------------------------------------------------------------------

async function decode(it) {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(it.file, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(it.file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

// Browsers apply the EXIF orientation when decoding. If one did not (decoded size equals the stored, unrotated
// size for a 90° orientation), turn the pixels here so the cleaned photo is not sideways.
function orientIfNeeded(d, m) {
  const o = m ? m.orientation : 1;
  if (!(o >= 5 && o <= 8) || !m.width || m.width === m.height || d.w !== m.width || d.h !== m.height) return d;
  const W = d.h, H = d.w;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ({ 5: () => ctx.transform(0, 1, 1, 0, 0, 0), 6: () => ctx.transform(0, 1, -1, 0, W, 0),
     7: () => ctx.transform(0, -1, -1, 0, W, H), 8: () => ctx.transform(0, -1, 1, 0, 0, H) })[o]();
  ctx.drawImage(d.src, 0, 0);
  d.done();
  return { src: c, w: W, h: H, done: () => { c.width = c.height = 0; } };
}

function targetSize(w, h) {
  const { maxW, maxH } = presetBox();
  let s = maxW ? Math.min(1, maxW / w, maxH / h) : 1;
  const cap = navigator.maxTouchPoints > 0 ? MAX_PIXELS_TOUCH : MAX_PIXELS;
  let capped = false;
  if (w * s * h * s > cap) { s = Math.sqrt(cap / (w * h)); capped = true; }
  return { tw: Math.max(1, Math.round(w * s)), th: Math.max(1, Math.round(h * s)), capped };
}

function outFormat(inFmt) {
  if (settings.format !== 'auto') return settings.format;
  return ['jpeg', 'png', 'webp'].includes(inFmt) ? inFmt : 'jpeg';
}

const MIME = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };
const EXT = { jpeg: 'jpg', webp: 'webp', png: 'png' };

function draw(d, tw, th, opaque) {
  // Halve in steps for big reductions: a single drawImage from 4000 px to 800 px looks jagged in some browsers.
  let src = d.src, sw = d.w, sh = d.h, tmp = null;
  while (sw / 2 >= tw * 1.5 && sh / 2 >= th * 1.5) {
    const c = document.createElement('canvas');
    c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    if (tmp) tmp.width = tmp.height = 0;
    src = tmp = c; sw = c.width; sh = c.height;
  }
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  const ctx = out.getContext('2d');
  if (opaque) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);
  if (tmp) tmp.width = tmp.height = 0;
  return out;
}

const toBlob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));

async function processItem(it) {
  if (it.out) { URL.revokeObjectURL(it.out.url); it.out = null; }
  it.error = ''; it.note = '';
  let d;
  try { d = await decode(it); } catch { it.error = T().cannotDecode; return; }
  try {
    d = orientIfNeeded(d, it.meta);
    const { tw, th, capped } = targetSize(d.w, d.h);
    let fmt = outFormat(it.meta && it.meta.format);
    const canvas = draw(d, tw, th, fmt === 'jpeg');
    let blob = await toBlob(canvas, MIME[fmt], settings.quality / 100);
    if (blob && blob.type !== MIME[fmt]) {
      // e.g. a browser without a WebP encoder returns PNG: use JPEG instead
      fmt = 'jpeg';
      const c2 = draw({ src: canvas, w: tw, h: th }, tw, th, true);
      blob = await toBlob(c2, MIME.jpeg, settings.quality / 100);
      c2.width = c2.height = 0;
      it.note = T().webpFallback;
    }
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('encode');
    const bytes = stripMetadata(new Uint8Array(await blob.arrayBuffer()));
    const check = readMetadata(bytes);
    const base = it.name.replace(/\.[^.]+$/, '') || 'image';
    it.out = {
      bytes, size: bytes.length, w: tw, h: th, fmt, clean: isClean(check) && !check.gps,
      name: `${base}-clean.${EXT[fmt]}`,
      url: URL.createObjectURL(new Blob([bytes], { type: MIME[fmt] })),
    };
    if (capped) it.note = (it.note ? it.note + ' ' : '') + T().capped;
  } catch {
    it.error = T().failed;
  } finally {
    d.done();
  }
}

async function runAll() {
  if (busy || !items.length) return;
  busy = true;
  $('#runBtn').disabled = true;
  for (let i = 0; i < items.length; i++) {
    $('#summary').textContent = T().working(i + 1, items.length);
    await processItem(items[i]);
    renderItem(items[i]);
    await new Promise(r => setTimeout(r));
  }
  busy = false;
  settings.runs++;
  saveSettings();
  renderAll();
}

async function downloadZip() {
  const done = items.filter(it => it.out && it.out.clean);
  if (!done.length) return;
  const names = uniqueNames(done.map(it => it.out.name));
  const zip = makeZip(done.map((it, i) => ({ name: names[i], data: it.out.bytes })));
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'photos-clean.zip';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---- rendering -------------------------------------------------------------------------------------------------

function metaRows(m, cleaned) {
  const t = T();
  if (!m) return `<p class="none">${esc(t.failed)}</p>`;
  const rows = [];
  if (m.gps) {
    const la = formatDeg(m.gps.lat, 'N', 'S'), lo = formatDeg(m.gps.lon, 'E', 'W');
    const extra = [m.gps.alt != null ? t.mAlt(m.gps.alt) : '', m.gps.err != null ? t.mErr(m.gps.err) : '', m.gps.dir != null ? t.mDir(m.gps.dir) : ''].filter(Boolean);
    const coords = `${m.gps.lat.toFixed(6)}, ${m.gps.lon.toFixed(6)}`;
    rows.push(`<div class="r gps"><dt>! ${esc(t.mLocation)}</dt><dd><span class="coords">${esc(la.dec)}, ${esc(lo.dec)}</span>
      <span class="sub2">${esc(la.dms)} ${esc(lo.dms)}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</span>
      <span class="sub2">${esc(t.gpsWarn)} <button type="button" class="link" data-copy="${esc(coords)}">${esc(t.copyCoords)}</button></span></dd></div>`);
  } else if (m.hasGpsTags) {
    rows.push(`<div class="r"><dt>${esc(t.mLocation)}</dt><dd>${esc(t.mGpsEmpty)}</dd></div>`);
  }
  const add = (k, v) => { if (v) rows.push(`<div class="r"><dt>${esc(t[k])}</dt><dd>${esc(v)}</dd></div>`); };
  add('mCamera', m.camera);
  add('mLens', m.lens);
  add('mTaken', m.date ? fmtDate(m.date, m.offset) : '');
  add('mSerial', m.serial);
  add('mOwner', m.owner);
  add('mCopyright', m.copyright);
  add('mDesc', m.description);
  add('mSoftware', m.software);
  add('mComment', m.comment);
  const also = [];
  if (m.exifTags) also.push(t.mTags(m.exifTags));
  if (m.thumbnail) also.push(t.mThumb);
  if (m.makerNote) also.push(t.mMaker);
  for (const b of m.blocks) if (!['EXIF', 'Comment', 'PNG text'].includes(b)) also.push(b);
  if (m.texts.length) also.push(`${t.mText}: ${m.texts.slice(0, 5).join(', ')}`);
  add('mAlso', also.join(' · '));
  return rows.length ? `<p class="cap">${esc(cleaned ? t.capAfter : t.capBefore)}</p><dl class="term">${rows.join('')}</dl>` : `<p class="none">${esc(t.mNone)}</p>`;
}

function outHtml(it) {
  const t = T();
  if (it.error) return `<p class="err">${esc(it.error)}</p>`;
  if (!it.out) return '';
  const o = it.out;
  const pct = fmtPct(it.size, o.size);
  return `<div class="out ${o.clean ? 'ok' : 'bad'}">
    <p class="out__line"><span class="ps">→</span> ${o.w} × ${o.h} · ${o.fmt.toUpperCase()} · <b>${fmtBytes(o.size)}</b> <span class="muted">(${esc(pct)})</span></p>
    <p class="out__check">${o.clean ? '✓ ' + esc(t.outClean) : '✗ ' + esc(t.outDirty)}</p>
    ${o.size > it.size ? `<p class="hint">${esc(t.bigger)}</p>` : ''}
    ${it.note ? `<p class="hint">${esc(it.note)}</p>` : ''}
    ${o.clean ? `<a class="btn btn--ghost sm" href="${o.url}" download="${esc(o.name)}">${esc(t.download)} ${esc(o.name)}</a>` : ''}
  </div>`;
}

function itemHtml(it) {
  const m = it.meta;
  const fmt = m && m.format ? m.format.toUpperCase() : '?';
  const dims = m && m.width ? (m.orientation >= 5 ? ` · ${m.height} × ${m.width}` : ` · ${m.width} × ${m.height}`) : '';
  return `<li class="file${m && m.gps ? ' has-gps' : ''}" id="f-${it.id}">
    <div class="file__head">
      ${it.thumb ? `<img class="thumb" src="${it.thumb}" alt="" loading="lazy" decoding="async">` : '<span class="thumb"></span>'}
      <p class="file__name"><b>${esc(it.name)}</b><span class="muted">${fmt}${dims} · ${fmtBytes(it.size)}</span></p>
      <button type="button" class="x" data-remove="${it.id}" aria-label="${esc(T().remove)} ${esc(it.name)}">×</button>
    </div>
    ${metaRows(m, it.out && it.out.clean)}
    <div class="file__out">${outHtml(it)}</div>
  </li>`;
}

function renderItem(it) {
  const el = document.getElementById('f-' + it.id);
  if (el) el.outerHTML = itemHtml(it);
  bindThumbs();
}

function bindThumbs() {
  for (const img of $$('img.thumb')) img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'thumb' })); };
}

function renderAll() {
  const t = T();
  $('#files').innerHTML = items.map(itemHtml).join('');
  bindThumbs();
  $('#actions').hidden = !items.length;
  const anyOut = items.some(it => it.out);
  const stale = items.some(it => !it.out && !it.error) || items.some(it => it.stale);
  $('#runBtn').textContent = anyOut ? t.rerun : t.run;
  $('#runBtn').disabled = busy || !items.length || (anyOut && !stale);
  $('#zipBtn').disabled = !items.some(it => it.out && it.out.clean);
  const gps = items.filter(it => it.meta && it.meta.gps).length;
  let s = items.length ? t.summaryIn(items.length, gps) : '';
  const done = items.filter(it => it.out);
  if (done.length) {
    const a = done.reduce((x, it) => x + it.size, 0), b = done.reduce((x, it) => x + it.out.size, 0);
    s += ' · ' + t.summaryOut(fmtBytes(a), fmtBytes(b), fmtPct(a, b));
  }
  $('#summary').textContent = s;
  $('#notifyBox').hidden = settings.runs < 2 || !anyOut;
}

function settingsChanged() {
  saveSettings();
  syncSettingsUi();
  for (const it of items) if (it.out || it.error) it.stale = true;
  renderAll();
}

// ---- events ----------------------------------------------------------------------------------------------------

function bind() {
  $('#settings').addEventListener('submit', e => e.preventDefault());
  $('#file').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('#drop');
  for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer) addFiles(e.dataTransfer.files); });
  window.addEventListener('paste', e => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
    if (files.length) addFiles(files);
  });

  $('#presets').addEventListener('change', e => {
    if (e.target.name !== 'preset') return;
    settings.preset = e.target.value;
    if (settings.preset !== 'custom') settings.quality = PRESETS[settings.preset].quality;
    settingsChanged();
  });
  $('#customLong').addEventListener('change', e => {
    const v = Math.round(+e.target.value);
    settings.customLong = v >= 100 && v <= 10000 ? v : 2000;
    settingsChanged();
  });
  $('#format').addEventListener('change', e => { settings.format = e.target.value; settingsChanged(); });
  $('#quality').addEventListener('input', e => { $('#qOut').textContent = e.target.value; });
  $('#quality').addEventListener('change', e => { settings.quality = +e.target.value; settingsChanged(); });

  $('#runBtn').addEventListener('click', () => { for (const it of items) it.stale = false; runAll(); });
  $('#zipBtn').addEventListener('click', downloadZip);
  $('#clearBtn').addEventListener('click', () => { while (items.length) removeItem(items[0].id); });
  $('#files').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) return removeItem(+rm.dataset.remove);
    const cp = e.target.closest('[data-copy]');
    if (cp && navigator.clipboard) navigator.clipboard.writeText(cp.dataset.copy).then(() => { cp.textContent = T().copied; }, () => {});
  });

  $('#langBtn').addEventListener('click', () => {
    lang = lang === 'de' ? 'en' : 'de';
    try { localStorage.setItem(STORE + '-lang', lang); } catch {}
    const u = new URL(location.href); u.searchParams.set('lang', lang);
    history.replaceState(null, '', u);
    applyLang();
  });
}

bind();
applyLang();

// Used by the self-test (tests/browser/selftest.html, run with python3 tools/selftest.py).
window.__imageCompressor = { readMetadata, stripMetadata, isClean, addFiles, runAll, items, settings };
