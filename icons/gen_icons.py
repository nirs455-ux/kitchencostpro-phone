import struct, zlib, os

def make_png(path, size, bg=(168, 84, 27), fg=(255, 255, 255)):
    cx = cy = size / 2
    r_outer = size * 0.34
    r_inner = size * 0.22
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # filter type
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if r_inner <= d <= r_outer:
                px = fg
            else:
                px = bg
            row.extend(px)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

here = os.path.dirname(os.path.abspath(__file__))
make_png(os.path.join(here, "icon-192.png"), 192)
make_png(os.path.join(here, "icon-512.png"), 512)
print("done")
