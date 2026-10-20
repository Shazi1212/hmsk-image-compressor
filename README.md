# Image Compressor + metadata remover

Phone photos carry the GPS position where they were taken (often your home), the phone model, a serial number and the time; this tool shows you what is inside, removes all of it, and resizes and compresses the photos for Kleinanzeigen, eBay, Vinted, Instagram or email, all in your browser.

**Use it online:** [hmsk.life/tools/image-compressor](https://hmsk.life/tools/image-compressor/) (runs in your browser, nothing is uploaded).

## What it does

- Reads EXIF, GPS, XMP, IPTC, JPEG comments, PNG text chunks and embedded preview images, and shows the GPS position (decimal and degrees/minutes/seconds, altitude, direction), camera, lens, serial number, owner, date and software **before** cleaning.
- Removes all metadata: each photo is decoded and drawn again from its pixels through a canvas, then a byte-level pass drops any EXIF/XMP/comment/text block a browser might still write. The ICC colour profile is kept.
- Checks every result with the same parser and marks it "checked: no EXIF, no GPS, no XMP"; files that fail the check cannot be downloaded.
- Applies the EXIF orientation to the pixels, so photos stay the right way up without the orientation tag.
- Presets (scale down to fit, never up): Kleinanzeigen 1600 px, eBay 1600 px, Vinted 1280 px, Instagram 1080 × 1350, email 1280 px, or a custom longest side. These are sensible sizes, not official platform limits; change them in `public/config.js`.
- Quality slider, before/after size per photo and in total, output as JPEG, WebP or PNG.
- Many photos at once, single downloads or one ZIP (written in the browser, no library).
- English and German. The page's Content-Security-Policy sets `connect-src 'none'`, so it cannot send anything over the network.

**HEIC:** Safari decodes HEIC itself. Chrome, Firefox and Edge cannot without a large WebAssembly decoder (libheif, about 1.5 MB), which this tool does not ship; it still shows the HEIC metadata and explains how to get JPEG from the iPhone.

## Quick start

No build step, no dependencies. Serve `public/` with any static web server:

```sh
python3 -m http.server 8080 --directory public
# open http://localhost:8080/
```

(ES modules do not load from `file://`, so a server is needed.) To self-host under another domain, set `LINK_BASE` in `public/config.js` for the top-strip links.

## Tests

```sh
npm test                    # node --test: metadata parser, byte-level strip, ZIP writer (Node.js 20+)
python3 tools/selftest.py   # real app in headless Chrome on photos with GPS, checked with Pillow
```

The fixtures in `tests/fixtures/` are made by `tools/make_fixtures.py` (Pillow) and carry a GPS position at the Brandenburg Gate, a camera serial number, an owner name and a comment. The browser self-test runs three settings (original size, Kleinanzeigen + WebP, Instagram + JPEG) and checks with Pillow that the output has no EXIF and no GPS, that none of those strings remain in the bytes, that rotated photos come out the right way up, that the presets give the expected sizes and that the ZIP is valid.

## Files

| File | What |
|---|---|
| `public/meta.js` | metadata reader (JPEG, PNG, WebP, HEIC/AVIF scan) and byte-level strip, no DOM |
| `public/zip.js` | stored ZIP writer with CRC-32 |
| `public/config.js` | presets, canvas limits, `LINK_BASE` |
| `public/i18n.js` | English and German texts |
| `public/app.js`, `index.html`, `app.css` | the UI |

Fonts (Newsreader, Public Sans; SIL Open Font License) are in `public/fonts/`; the shared hmsk.life look is in `public/letterpress.css`.

## License

MIT, see [LICENSE](LICENSE).
