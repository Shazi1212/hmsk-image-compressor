"""Make the test images in tests/fixtures/: small photos with a GPS position, camera, serial number and date.

    python3 tools/make_fixtures.py      (needs Pillow)
The position is the Brandenburg Gate in Berlin (52.516272 N, 13.377722 E), a public place.
"""
import io, os
from PIL import Image, ImageDraw
from PIL.ExifTags import IFD, GPS, Base

OUT = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures")
os.makedirs(OUT, exist_ok=True)


def dms(v):
    d = int(v); m = int((v - d) * 60); s = round(((v - d) * 60 - m) * 60, 2)
    return (d, m, s)


def exif(orientation=1):
    e = Image.Exif()
    e[Base.Make] = "Apple"
    e[Base.Model] = "iPhone 15 Pro"
    e[Base.Software] = "17.6.1"
    e[Base.DateTime] = "2026:10:12 14:03:22"
    e[Base.Orientation] = orientation
    e[Base.Artist] = "Erika Mustermann"
    ex = {}
    ex[Base.DateTimeOriginal] = "2026:10:12 14:03:22"
    ex[Base.OffsetTimeOriginal] = "+02:00"
    ex[Base.LensModel] = "iPhone 15 Pro back triple camera 6.765mm f/1.78"
    ex[Base.BodySerialNumber] = "F2LXK0Q1PJ"
    g = {}
    g[GPS.GPSLatitudeRef] = "N"; g[GPS.GPSLatitude] = dms(52.516272)
    g[GPS.GPSLongitudeRef] = "E"; g[GPS.GPSLongitude] = dms(13.377722)
    g[GPS.GPSAltitudeRef] = b"\x00"; g[GPS.GPSAltitude] = 34.5
    e[IFD.Exif] = ex
    e[IFD.GPSInfo] = g
    return e


def picture(w, h):
    im = Image.new("RGB", (w, h), (30, 92, 64))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w // 2, h // 4], fill=(255, 181, 71))  # amber block marks the top-left corner
    d.text((4, h - 14), "TOP-LEFT is amber", fill=(228, 242, 232))
    return im


# Landscape JPEG, orientation 1
picture(320, 240).save(os.path.join(OUT, "gps.jpg"), quality=90, exif=exif(1),
                       comment=b"shot at home")
# Stored as 320x240 but orientation 6 (rotate 90 CW to display): browsers must show it as 240x320
picture(320, 240).save(os.path.join(OUT, "gps-rotated.jpg"), quality=90, exif=exif(6))
# PNG with eXIf and a text chunk
from PIL.PngImagePlugin import PngInfo
info = PngInfo(); info.add_text("Author", "Erika Mustermann"); info.add_text("Location", "Pariser Platz, Berlin")
picture(200, 150).save(os.path.join(OUT, "gps.png"), exif=exif(1), pnginfo=info)
# WebP with EXIF
picture(200, 150).save(os.path.join(OUT, "gps.webp"), quality=80, exif=exif(1))
# Large photo stored landscape with orientation 6, to test the resize presets and the rotation together
picture(3200, 2400).save(os.path.join(OUT, "big-rotated.jpg"), quality=70, exif=exif(6))
# Clean JPEG without metadata
picture(100, 80).save(os.path.join(OUT, "clean.jpg"), quality=80)
print("fixtures written to", os.path.abspath(OUT))
