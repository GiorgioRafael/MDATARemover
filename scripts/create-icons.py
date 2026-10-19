"""Generate CleanFrame application icons. Requires Pillow (development only)."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "build"
SIZE = 1024
SCALE = 3
GREEN = "#155b3d"

# The same leaf motif and green used by the desktop interface. Coordinates are
# expressed in a 24-unit viewBox; cubic curves are sampled for Pillow rendering.
LEAF = [
    ((11, 20), (6.6, 20), (3.5, 16.3), (4.1, 12)),
    ((4.1, 12), (4.5, 8.6), (7.2, 6.6), (10.2, 6.1)),
    ((10.2, 6.1), (15.5, 5.2), (17.5, 3.8), (19, 2)),
    ((19, 2), (20.5, 4.5), (21, 7), (21, 10)),
    ((21, 10), (21, 15.5), (16.3, 20), (11, 20)),
]
STEM = [((2, 22), (2, 16), (6, 12), (11, 12))]


def bezier(curves):
    points = []
    for start, control_a, control_b, end in curves:
        for index in range(61):
            t = index / 60
            inverse = 1 - t
            point = tuple(
                inverse**3 * start[axis]
                + 3 * inverse**2 * t * control_a[axis]
                + 3 * inverse * t**2 * control_b[axis]
                + t**3 * end[axis]
                for axis in range(2)
            )
            points.append(((210 + point[0] * 25) * SCALE, (205 + point[1] * 25) * SCALE))
    return points


def stroke(draw, curves):
    points = bezier(curves)
    width = 45 * SCALE
    draw.line(points, fill="white", width=width, joint="curve")
    radius = width / 2
    # Cover every join with a round brush so Pillow's wide polyline joins do not
    # leave hairline gaps at high resolution.
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill="white")


def main():
    OUTPUT.mkdir(exist_ok=True)
    source = """<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="32" y="32" width="960" height="960" rx="224" fill="#155b3d"/>
  <g transform="translate(210 205) scale(25)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20C6.6 20 3.5 16.3 4.1 12C4.5 8.6 7.2 6.6 10.2 6.1C15.5 5.2 17.5 3.8 19 2C20.5 4.5 21 7 21 10C21 15.5 16.3 20 11 20Z"/>
    <path d="M2 22C2 16 6 12 11 12"/>
  </g>
</svg>
"""
    (OUTPUT / "icon.svg").write_text(source, encoding="utf-8")
    canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((32 * SCALE, 32 * SCALE, 992 * SCALE, 992 * SCALE), radius=224 * SCALE, fill=GREEN)
    stroke(draw, LEAF)
    stroke(draw, STEM)
    icon = canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    icon.save(OUTPUT / "icon.png", optimize=True)
    icon.save(OUTPUT / "icon.ico", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
    icon.save(OUTPUT / "icon.icns", sizes=[(size, size) for size in (16, 32, 64, 128, 256, 512, 1024)])
    for name in ("icon.svg", "icon.png", "icon.ico", "icon.icns"):
        print(OUTPUT / name)


if __name__ == "__main__":
    main()
