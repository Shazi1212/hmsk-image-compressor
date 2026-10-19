"""Browser self-test: runs the real app in headless Chrome on photos that contain GPS, then checks the cleaned files
independently with Pillow (no EXIF, no GPS, no serial or name bytes, correct rotation) and the ZIP with zipfile.

    python3 tools/selftest.py        (needs Google Chrome and Pillow)
"""
import base64, io, json, os, shutil, socket, subprocess, sys, tempfile, threading, zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


RESULT = {}
DONE = threading.Event()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):  # the test page posts its results here
        RESULT["body"] = self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(204); self.end_headers()
        DONE.set()


def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    srv = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="selftest-chrome-")
    chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--remote-debugging-port=0", f"--user-data-dir={profile}",
                               f"http://127.0.0.1:{port}/tests/browser/selftest.html"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not DONE.wait(90):
            sys.exit("self-test did not finish within 90 s")
    finally:
        chrome.terminate(); chrome.wait(10); srv.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
    results = json.loads(RESULT["body"])
    if "error" in results:
        sys.exit("self-test page failed: " + results["error"])

    fails = 0
    def check(cond, msg):
        nonlocal fails
        print(("  ok   " if cond else "  FAIL ") + msg)
        fails += not cond

    for run, r in results.items():
        print(run)
        for it in r["items"]:
            o = it["out"]
            check(o is not None and not it["error"], f"{it['name']}: processed")
            if not o:
                continue
            raw = base64.b64decode(o["b64"])
            im = Image.open(io.BytesIO(raw))
            exif = im.getexif()
            check(len(exif) == 0, f"{o['name']}: Pillow finds no EXIF ({len(exif)} tags)")
            check(not exif.get_ifd(0x8825), f"{o['name']}: no GPS IFD")
            for needle in (b"Exif\x00", b"F2LXK0Q1PJ", b"Mustermann", b"iPhone", b"shot at home", b"Pariser"):
                check(needle not in raw, f"{o['name']}: bytes do not contain {needle!r}")
            check(not any(k in im.info for k in ("exif", "xmp", "Author", "Location", "comment")), f"{o['name']}: no metadata in Pillow info")
            check(o["clean"], f"{o['name']}: app marked it clean")
            check(im.size == (o["w"], o["h"]), f"{o['name']}: size {im.size}")
            if it["name"].startswith("gps"):
                rgb = im.convert("RGB")
                w, h = rgb.size
                # The amber block is top-left in the stored pixels; orientation 6 means "rotate 90° clockwise", so the
                # block must end up top-right, and the result must be portrait.
                rotated = "rotated" in it["name"]
                x = int(w * (0.85 if rotated else 0.15)); y = int(h * 0.1)
                px = rgb.getpixel((x, y))
                check(px[0] > 200 and px[1] > 140 and px[2] < 130, f"{o['name']}: amber corner at the right place {px}")
                if rotated:
                    check(h > w, f"{o['name']}: portrait after rotation ({w}x{h})")
            if it["name"] == "big-rotated.jpg":
                want = {"original": (2400, 3200), "kleinanzeigen": (1200, 1600), "instagram": (1013, 1350)}[run.split("-")[0]]
                check(im.size == want, f"{o['name']}: resized to {im.size}, expected {want}")
        z = zipfile.ZipFile(io.BytesIO(base64.b64decode(r["zip"])))
        check(z.testzip() is None and len(z.namelist()) == len(r["items"]), f"zip: {len(z.namelist())} files, CRC ok")
    print("PASS" if not fails else f"{fails} FAILED")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
