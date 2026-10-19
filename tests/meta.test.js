import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMetadata, stripMetadata, isClean, detectFormat, formatDeg, dmsToDeg } from '../public/meta.js';

const fx = name => new Uint8Array(readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const has = (u8, str) => Buffer.from(u8).includes(Buffer.from(str));
const GATE = { lat: 52.516272, lon: 13.377722 };

test('detects formats', () => {
  assert.equal(detectFormat(fx('gps.jpg')), 'jpeg');
  assert.equal(detectFormat(fx('gps.png')), 'png');
  assert.equal(detectFormat(fx('gps.webp')), 'webp');
  assert.equal(detectFormat(new Uint8Array(4)), null);
});

for (const f of ['gps.jpg', 'gps.png', 'gps.webp']) {
  test(`reads GPS, camera, serial and date from ${f}`, () => {
    const m = readMetadata(fx(f));
    assert.ok(m.gps, 'gps found');
    assert.ok(Math.abs(m.gps.lat - GATE.lat) < 1e-5);
    assert.ok(Math.abs(m.gps.lon - GATE.lon) < 1e-5);
    assert.equal(m.gps.alt, 34.5);
    assert.equal(m.camera, 'Apple iPhone 15 Pro');
    assert.equal(m.serial, 'F2LXK0Q1PJ');
    assert.equal(m.owner, 'Erika Mustermann');
    assert.equal(m.date, '2026:10:12 14:03:22');
    assert.equal(m.offset, '+02:00');
    assert.match(m.lens, /iPhone 15 Pro back/);
    assert.ok(m.blocks.includes('EXIF'));
    assert.equal(isClean(m), false);
  });

  test(`byte-level strip of ${f} removes every metadata block`, () => {
    const src = fx(f);
    const out = stripMetadata(src);
    const m = readMetadata(out);
    assert.equal(m.gps, null);
    assert.equal(m.exifTags, 0);
    assert.ok(isClean(m), JSON.stringify(m.blocks));
    assert.ok(!has(out, 'Exif'), 'no Exif marker');
    assert.ok(!has(out, 'F2LXK0Q1PJ'), 'no serial');
    assert.ok(!has(out, 'Mustermann'), 'no name');
    assert.ok(out.length < src.length);
    assert.equal(detectFormat(out), detectFormat(src));
  });
}

test('reads the orientation and stored size', () => {
  const m = readMetadata(fx('gps-rotated.jpg'));
  assert.equal(m.orientation, 6);
  assert.deepEqual([m.width, m.height], [320, 240]);
});

test('JPEG comment and PNG text chunks are listed', () => {
  assert.equal(readMetadata(fx('gps.jpg')).comment, 'shot at home');
  assert.deepEqual(readMetadata(fx('gps.png')).texts, ['Author', 'Location']);
});

test('a photo without metadata is clean', () => {
  const m = readMetadata(fx('clean.jpg'));
  assert.ok(isClean(m));
  assert.equal(m.gps, null);
  assert.equal(m.camera, '');
});

test('finds EXIF inside a HEIC container by scanning', () => {
  const jpg = fx('gps.jpg');
  const tiffAt = Buffer.from(jpg).indexOf(Buffer.from('Exif\0\0')) + 6;
  const tiff = jpg.subarray(tiffAt, tiffAt + 2000);
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic')]);
  const heic = new Uint8Array(Buffer.concat([ftyp, Buffer.alloc(100), Buffer.from([0, 0, 0, 6]), Buffer.from('Exif\0\0'), tiff]));
  const m = readMetadata(heic);
  assert.equal(m.format, 'heic');
  assert.ok(m.gps && Math.abs(m.gps.lat - GATE.lat) < 1e-5);
  assert.equal(m.camera, 'Apple iPhone 15 Pro');
});

test('survives truncated and random input', () => {
  const jpg = fx('gps.jpg');
  for (let n = 0; n < jpg.length; n += 97) readMetadata(jpg.subarray(0, n));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) & 0xFF;
  for (let k = 0; k < 50; k++) {
    const b = Uint8Array.from({ length: 600 }, rnd);
    b.set([0xFF, 0xD8, 0xFF, 0xE1, 0x01, 0x00, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0, 0x2A]);
    readMetadata(b);
    stripMetadata(b);
  }
});

test('southern and western coordinates are negative', () => {
  assert.equal(dmsToDeg([33, 52, 4.8], 'S').toFixed(4), '-33.8680');
  assert.equal(dmsToDeg([70, 0, 0], 'W'), -70);
  assert.deepEqual(formatDeg(-33.868, 'N', 'S'), { dec: '33.86800° S', dms: `33°52'04.8"S` });
});
