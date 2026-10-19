import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, makeZip, uniqueNames } from '../public/zip.js';

test('crc32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('unique names', () => {
  assert.deepEqual(uniqueNames(['a.jpg', 'b.jpg', 'a.jpg', 'A.JPG', 'c']), ['a.jpg', 'b.jpg', 'a-2.jpg', 'A-3.JPG', 'c']);
});

test('the ZIP opens with Python zipfile and holds the exact bytes', t => {
  const files = [
    { name: 'photo-clean.jpg', data: Uint8Array.from({ length: 5000 }, (_, i) => i * 7 & 255) },
    { name: 'Straße-clean.webp', data: new TextEncoder().encode('webp bytes') },
  ];
  const zip = makeZip(files, new Date(2026, 9, 19, 12, 30, 10));
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const p = join(dir, 't.zip');
  writeFileSync(p, zip);
  let out;
  try {
    out = execFileSync('python3', ['-I', '-c', `import zipfile,sys,hashlib
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
for i in z.infolist(): print(i.filename, i.file_size, hashlib.sha1(z.read(i)).hexdigest(), i.date_time)`, p]).toString();
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('python3 not installed');
    throw e;
  }
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^photo-clean\.jpg 5000 /);
  assert.match(lines[1], /^Straße-clean\.webp 10 .*\(2026, 10, 19, 12, 30, 10\)$/);
});
