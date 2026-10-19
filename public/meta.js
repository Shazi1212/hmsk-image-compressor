// Reads what an image file carries besides pixels: EXIF (camera, dates, GPS), XMP, IPTC, comments, colour profile,
// PNG text chunks, embedded thumbnail. Pure functions on a Uint8Array, no DOM, so it runs in Node tests too.

const ascii = (u8, start, len) => {
  let s = '';
  for (let i = start; i < start + len && i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
};
const startsWith = (u8, at, str) => ascii(u8, at, str.length) === str;

export function detectFormat(u8) {
  if (u8.length < 12) return null;
  if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'jpeg';
  if (u8[0] === 0x89 && startsWith(u8, 1, 'PNG')) return 'png';
  if (startsWith(u8, 0, 'RIFF') && startsWith(u8, 8, 'WEBP')) return 'webp';
  if (startsWith(u8, 0, 'GIF8')) return 'gif';
  if (startsWith(u8, 4, 'ftyp')) {
    const brands = ascii(u8, 8, Math.min(32, (u8[0] << 24 | u8[1] << 16 | u8[2] << 8 | u8[3]) - 8));
    if (/avif|avis/.test(brands)) return 'avif';
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brands)) return 'heic';
  }
  return null;
}

// ---- TIFF / EXIF ----------------------------------------------------------------------------------------------

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

// Tags we show by name. Everything else is only counted.
const IFD0_TAGS = { 0x010E: 'ImageDescription', 0x010F: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x0131: 'Software',
  0x0132: 'DateTime', 0x013B: 'Artist', 0x8298: 'Copyright', 0x9C9D: 'XPAuthor', 0x9C9B: 'XPTitle' };
const EXIF_TAGS = { 0x829A: 'ExposureTime', 0x829D: 'FNumber', 0x8827: 'ISO', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
  0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x920A: 'FocalLength', 0xA002: 'PixelXDimension', 0xA003: 'PixelYDimension',
  0xA420: 'ImageUniqueID', 0xA430: 'CameraOwnerName', 0xA431: 'BodySerialNumber', 0xA433: 'LensMake', 0xA434: 'LensModel',
  0xA435: 'LensSerialNumber', 0x927C: 'MakerNote' };
const GPS_TAGS = { 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef', 6: 'GPSAltitude',
  7: 'GPSTimeStamp', 16: 'GPSImgDirectionRef', 17: 'GPSImgDirection', 29: 'GPSDateStamp', 31: 'GPSHPositioningError' };

export function parseTiff(u8, start) {
  if (start + 8 > u8.length) return null;
  const order = ascii(u8, start, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = o => dv.getUint16(start + o, le);
  const u32 = o => dv.getUint32(start + o, le);
  const i32 = o => dv.getInt32(start + o, le);
  const len = u8.length - start;
  if (u16(2) !== 42) return null;

  const out = { tags: {}, count: 0, thumbnail: false, makerNote: false };
  const seen = new Set();

  function value(type, count, off) {
    const size = (TYPE_SIZE[type] || 1) * count;
    const at = size <= 4 ? off : u32(off);
    if (at + size > len) return undefined;
    switch (type) {
      case 2: { let s = ascii(u8, start + at, count); const z = s.indexOf('\0'); return (z >= 0 ? s.slice(0, z) : s).trim(); }
      case 3: return count === 1 ? u16(at) : Array.from({ length: Math.min(count, 64) }, (_, i) => u16(at + 2 * i));
      case 4: return count === 1 ? u32(at) : Array.from({ length: Math.min(count, 64) }, (_, i) => u32(at + 4 * i));
      case 9: return count === 1 ? i32(at) : Array.from({ length: Math.min(count, 64) }, (_, i) => i32(at + 4 * i));
      case 5: case 10: {
        const r = i => { const n = type === 5 ? u32(at + 8 * i) : i32(at + 8 * i); const d = type === 5 ? u32(at + 8 * i + 4) : i32(at + 8 * i + 4); return d ? n / d : 0; };
        return count === 1 ? r(0) : Array.from({ length: Math.min(count, 64) }, (_, i) => r(i));
      }
      case 1: case 7: return u8.subarray(start + at, start + at + Math.min(size, 256));
      default: return undefined;
    }
  }

  function readIfd(off, names, depth) {
    if (!off || off + 2 > len || seen.has(off) || depth > 4) return 0;
    seen.add(off);
    const n = u16(off);
    if (n > 1000 || off + 2 + n * 12 > len) return 0;
    let sub = { exif: 0, gps: 0 };
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      out.count++;
      if (tag === 0x8769) { sub.exif = u32(e + 8); continue; }
      if (tag === 0x8825) { sub.gps = u32(e + 8); continue; }
      if (tag === 0x927C) out.makerNote = true;
      const name = names[tag];
      if (!name || out.tags[name] !== undefined) continue;
      try {
        let v = value(type, count, e + 8);
        if (name.startsWith('XP') && v instanceof Uint8Array) v = utf16le(v);
        if (v !== undefined && v !== '') out.tags[name] = v;
      } catch { /* malformed entry: count it, skip the value */ }
    }
    if (sub.exif) readIfd(sub.exif, EXIF_TAGS, depth + 1);
    if (sub.gps) readIfd(sub.gps, GPS_TAGS, depth + 1);
    return off + 2 + n * 12 + 4 <= len ? u32(off + 2 + n * 12) : 0;
  }

  const ifd1 = readIfd(u32(4), IFD0_TAGS, 0);
  if (ifd1 && ifd1 + 2 <= len) {
    out.thumbnail = true;
    const n = u16(ifd1);
    if (n < 1000) out.count += n;
  }
  return out;
}

function utf16le(bytes) {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes[i] | bytes[i + 1] << 8;
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

// ---- containers ------------------------------------------------------------------------------------------------

function scanJpeg(u8, r) {
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xFF) { p++; continue; }
    const m = u8[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { p += 2; continue; }
    if (m === 0xD9 || m === 0xDA) break;
    const segLen = u8[p + 2] << 8 | u8[p + 3];
    const d = p + 4;
    if (m === 0xE1 && startsWith(u8, d, 'Exif\0')) r.tiffAt.push(d + 6);
    else if (m === 0xE1 && startsWith(u8, d, 'http://ns.adobe.com/xap/1.0/')) r.blocks.add('XMP');
    else if (m === 0xE1 && startsWith(u8, d, 'http://ns.adobe.com/xmp/extension/')) r.blocks.add('XMP');
    else if (m === 0xED && startsWith(u8, d, 'Photoshop 3.0')) r.blocks.add('IPTC');
    else if (m === 0xE2 && startsWith(u8, d, 'ICC_PROFILE')) r.blocks.add('ICC');
    else if (m === 0xE2 && startsWith(u8, d, 'MPF')) r.blocks.add('MPF');
    else if (m === 0xFE) { r.blocks.add('Comment'); r.comment = r.comment || ascii(u8, d, Math.min(segLen - 2, 200)).replace(/\0+$/, ''); }
    else if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
      r.height = u8[d + 1] << 8 | u8[d + 2];
      r.width = u8[d + 3] << 8 | u8[d + 4];
    } else if (m >= 0xE3 && m <= 0xEF && m !== 0xEE) r.blocks.add('APP' + (m - 0xE0));
    p += 2 + segLen;
  }
}

function scanPng(u8, r) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 8;
  while (p + 8 <= u8.length) {
    const n = dv.getUint32(p), type = ascii(u8, p + 4, 4), d = p + 8;
    if (type === 'IHDR') { r.width = dv.getUint32(d); r.height = dv.getUint32(d + 4); }
    else if (type === 'eXIf') r.tiffAt.push(d);
    else if (type === 'iCCP') r.blocks.add('ICC');
    else if (type === 'tIME') r.blocks.add('PNG time');
    else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const key = ascii(u8, d, Math.min(n, 80)).split('\0')[0];
      if (key === 'XML:com.adobe.xmp') r.blocks.add('XMP');
      else if (/^Raw profile type (exif|APP1)/i.test(key)) r.blocks.add('EXIF (text)');
      else { r.blocks.add('PNG text'); r.texts.push(key); }
    } else if (type === 'IEND') break;
    p = d + n + 4;
  }
}

function scanWebp(u8, r) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 12;
  while (p + 8 <= u8.length) {
    const type = ascii(u8, p, 4), n = dv.getUint32(p + 4, true), d = p + 8;
    if (type === 'EXIF') r.tiffAt.push(startsWith(u8, d, 'Exif\0') ? d + 6 : d);
    else if (type === 'XMP ') r.blocks.add('XMP');
    else if (type === 'ICCP') r.blocks.add('ICC');
    else if (type === 'VP8X') { r.width = 1 + (u8[d + 4] | u8[d + 5] << 8 | u8[d + 6] << 16); r.height = 1 + (u8[d + 7] | u8[d + 8] << 8 | u8[d + 9] << 16); }
    else if (type === 'VP8 ' && !r.width) { r.width = dv.getUint16(d + 6, true) & 0x3FFF; r.height = dv.getUint16(d + 8, true) & 0x3FFF; }
    else if (type === 'VP8L' && !r.width) { const b = dv.getUint32(d + 1, true); r.width = (b & 0x3FFF) + 1; r.height = (b >> 14 & 0x3FFF) + 1; }
    p = d + n + (n & 1);
  }
}

// HEIC/AVIF and anything else: find an "Exif\0\0" + TIFF header, or a bare TIFF header, and XMP by its packet.
function scanBytes(u8, r) {
  const lim = Math.min(u8.length, 4 * 1024 * 1024);
  for (let i = 0; i + 14 < lim; i++) {
    if (u8[i] === 0x45 && startsWith(u8, i, 'Exif\0\0') && /II\*\0|MM\0\*/.test(ascii(u8, i + 6, 4))) { r.tiffAt.push(i + 6); break; }
  }
  if (!r.tiffAt.length) {
    for (let i = 0; i + 8 < lim; i++) {
      if ((u8[i] === 0x49 && u8[i + 1] === 0x49 && u8[i + 2] === 0x2A && u8[i + 3] === 0 && u8[i + 4] === 8 && !u8[i + 5] && !u8[i + 6] && !u8[i + 7]) ||
          (u8[i] === 0x4D && u8[i + 1] === 0x4D && !u8[i + 2] && u8[i + 3] === 0x2A && !u8[i + 4] && !u8[i + 5] && !u8[i + 6] && u8[i + 7] === 8)) { r.tiffAt.push(i); break; }
    }
  }
  if (ascii(u8, 0, lim).includes('<x:xmpmeta')) r.blocks.add('XMP');
}

// ---- public API ------------------------------------------------------------------------------------------------

export function dmsToDeg(v, ref) {
  if (v == null) return null;
  const a = Array.isArray(v) ? v : [v];
  const deg = (a[0] || 0) + (a[1] || 0) / 60 + (a[2] || 0) / 3600;
  return /^[SW]/i.test(ref || '') ? -deg : deg;
}

export function readMetadata(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = detectFormat(u8);
  const r = { format, tiffAt: [], blocks: new Set(), texts: [], comment: '', width: 0, height: 0 };
  try {
    if (format === 'jpeg') scanJpeg(u8, r);
    else if (format === 'png') scanPng(u8, r);
    else if (format === 'webp') scanWebp(u8, r);
    else scanBytes(u8, r);
  } catch { /* truncated file: keep what we found */ }

  let tags = {}, count = 0, thumbnail = false, makerNote = false;
  for (const at of r.tiffAt) {
    const t = parseTiff(u8, at);
    if (!t) continue;
    tags = { ...t.tags, ...tags };
    count += t.count;
    thumbnail = thumbnail || t.thumbnail;
    makerNote = makerNote || t.makerNote;
  }
  if (count) r.blocks.add('EXIF');

  let gps = null;
  const lat = dmsToDeg(tags.GPSLatitude, tags.GPSLatitudeRef), lon = dmsToDeg(tags.GPSLongitude, tags.GPSLongitudeRef);
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
    gps = { lat, lon };
    if (typeof tags.GPSAltitude === 'number') {
      const below = tags.GPSAltitudeRef instanceof Uint8Array ? tags.GPSAltitudeRef[0] === 1 : tags.GPSAltitudeRef === 1;
      gps.alt = below ? -tags.GPSAltitude : tags.GPSAltitude;
    }
    if (typeof tags.GPSImgDirection === 'number') gps.dir = tags.GPSImgDirection;
    if (typeof tags.GPSHPositioningError === 'number') gps.err = tags.GPSHPositioningError;
  }
  const hasGpsTags = Object.keys(tags).some(k => k.startsWith('GPS'));

  const str = k => (typeof tags[k] === 'string' && tags[k]) || '';
  const camera = [str('Make'), str('Model')].filter(Boolean);
  if (camera.length === 2 && camera[1].toLowerCase().startsWith(camera[0].toLowerCase())) camera.shift();

  return {
    format,
    width: r.width, height: r.height,
    orientation: typeof tags.Orientation === 'number' ? tags.Orientation : 1,
    gps, hasGpsTags,
    camera: camera.join(' '),
    lens: [str('LensMake'), str('LensModel')].filter(Boolean).join(' '),
    serial: str('BodySerialNumber') || str('LensSerialNumber'),
    owner: str('CameraOwnerName') || str('Artist') || str('XPAuthor'),
    copyright: str('Copyright'),
    description: str('ImageDescription') || str('XPTitle'),
    software: str('Software'),
    date: str('DateTimeOriginal') || str('DateTimeDigitized') || str('DateTime'),
    offset: str('OffsetTimeOriginal') || str('OffsetTime'),
    uniqueId: str('ImageUniqueID'),
    thumbnail, makerNote,
    comment: r.comment,
    texts: r.texts,
    exifTags: count,
    blocks: [...r.blocks],
    tags,
  };
}

// True when the file carries nothing that identifies place, device, person or time.
// The ICC colour profile is not personal; everything else counts.
export function isClean(m) {
  return !m.blocks.some(b => b !== 'ICC');
}

export function formatDeg(v, pos, neg) {
  const h = v < 0 ? neg : pos;
  const a = Math.abs(v);
  const d = Math.floor(a), mf = (a - d) * 60, mi = Math.floor(mf), s = (mf - mi) * 60;
  return { dec: `${a.toFixed(5)}° ${h}`, dms: `${d}°${String(mi).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${h}` };
}

// ---- byte-level strip ------------------------------------------------------------------------------------------
// The tool re-encodes every image through a canvas, which already writes no EXIF. This second pass removes any
// metadata block a browser might still add (e.g. an EXIF block with only the colour space), so the promise holds in
// every browser. The ICC colour profile is kept, because removing it would change the colours.

export function stripMetadata(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const f = detectFormat(u8);
  try {
    if (f === 'jpeg') return stripJpeg(u8);
    if (f === 'png') return stripPng(u8);
    if (f === 'webp') return stripWebp(u8);
  } catch { /* malformed: return as is, the check after it will flag it */ }
  return u8;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of parts) { out.set(a, p); p += a.length; }
  return out;
}

function stripJpeg(u8) {
  const keep = [u8.subarray(0, 2)];
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xFF) throw new Error('bad marker');
    const m = u8[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xDA || m === 0xD9) { keep.push(u8.subarray(p)); return concat(keep); }
    if ((m >= 0xD0 && m <= 0xD7) || m === 0x01) { keep.push(u8.subarray(p, p + 2)); p += 2; continue; }
    const end = p + 2 + (u8[p + 2] << 8 | u8[p + 3]);
    const d = p + 4;
    const drop = m === 0xFE || m === 0xE1 || (m >= 0xE3 && m <= 0xEF) || (m === 0xE2 && !startsWith(u8, d, 'ICC_PROFILE'));
    if (!drop) keep.push(u8.subarray(p, end));
    p = end;
  }
  return concat(keep);
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function stripPng(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const keep = [u8.subarray(0, 8)];
  let p = 8;
  while (p + 12 <= u8.length) {
    const n = dv.getUint32(p), type = ascii(u8, p + 4, 4), end = p + 12 + n;
    if (!PNG_DROP.has(type)) keep.push(u8.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return concat(keep);
}

function stripWebp(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const keep = [];
  let p = 12;
  while (p + 8 <= u8.length) {
    const type = ascii(u8, p, 4), n = dv.getUint32(p + 4, true), end = Math.min(u8.length, p + 8 + n + (n & 1));
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = u8.slice(p, end);
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04);
      keep.push(chunk);
    }
    p = end;
  }
  const body = concat(keep);
  const head = new Uint8Array(12);
  head.set(u8.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return concat([head, body]);
}
