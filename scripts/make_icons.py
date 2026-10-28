"""Erzeugt die PNG-App-Icons aus der Logo-Geometrie (static/icons/logo.svg) – ohne Zusatzbibliotheken.

Aufruf: python scripts/make_icons.py
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', 'icons')
C1, C2 = (0xff, 0x2d, 0x55), (0xff, 0x7a, 0x3d)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


PULSE = [(130, 256), (185, 256), (216, 149), (260, 363), (296, 256), (335, 256)]


def coverage_mark(x, y):
    """Deckkraft des weissen Zeichens (0..1): schwacher Ring, Pulslinie, Endpunkt (512er-Koordinaten)."""
    if math.hypot(x - 367, y - 256) <= 22:
        return 1.0
    for (ax, ay), (bx, by) in zip(PULSE, PULSE[1:]):
        if seg_dist(x, y, ax, ay, bx, by) <= 14:
            return 1.0
    if abs(math.hypot(x - 256, y - 256) - 150) <= 14:
        return 0.35
    return 0.0


def inside_rounded(x, y, rad):
    if rad <= 0:
        return 0 <= x <= 512 and 0 <= y <= 512
    cx = min(max(x, rad), 512 - rad)
    cy = min(max(y, rad), 512 - rad)
    return math.hypot(x - cx, y - cy) <= rad


def render(size, rounded, ss=3):
    scale = 512.0 / size
    rad = 116 if rounded else 0
    rows = []
    for j in range(size):
        row = bytearray()
        for i in range(size):
            acc_r = acc_g = acc_b = acc_a = 0.0
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + .5) / ss) * scale
                    y = (j + (sj + .5) / ss) * scale
                    if not inside_rounded(x, y, rad):
                        continue
                    t = (x + y) / 1024.0
                    br = C1[0] + (C2[0] - C1[0]) * t
                    bg = C1[1] + (C2[1] - C1[1]) * t
                    bb = C1[2] + (C2[2] - C1[2]) * t
                    hi = max(0.0, .32 * (1 - y / (512 * .55)))
                    br, bg, bb = br + (255 - br) * hi, bg + (255 - bg) * hi, bb + (255 - bb) * hi
                    m = coverage_mark(x, y)
                    acc_r += br + (255 - br) * m
                    acc_g += bg + (255 - bg) * m
                    acc_b += bb + (255 - bb) * m
                    acc_a += 255
            n = ss * ss
            a = acc_a / n
            if a > 0:
                row += bytes((int(min(255, acc_r / (acc_a / 255))), int(min(255, acc_g / (acc_a / 255))),
                              int(min(255, acc_b / (acc_a / 255))), int(a)))
            else:
                row += b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, size, rounded in (('icon-192.png', 192, True), ('icon-512.png', 512, True),
                                ('maskable-192.png', 192, False), ('maskable-512.png', 512, False),
                                ('apple-touch-icon.png', 180, False)):
        write_png(os.path.join(OUT, name), render(size, rounded, 2 if size > 256 else 3), size)
        print('geschrieben:', name)
