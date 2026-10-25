"""Draw MU Draw's app icons (a gold benzene ring, Kekulé style, on black) into web/public/icons/.

    python scripts/make_icons.py

Placeholders until there is real artwork. The colours are the app's --mu-black and
--mu-gold (web/src/index.css). 192 and 512 px are what Chrome needs to offer installation;
the maskable icon keeps its drawing inside the 80% safe zone.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "icons"
BACKGROUND = (0, 0, 0, 255)  # --mu-black
FOREGROUND = (238, 177, 17, 255)  # --mu-gold, #eeb111
SUPERSAMPLE = 4


def draw(size: int, maskable: bool) -> Image.Image:
    big = size * SUPERSAMPLE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)
    if maskable:
        pen.rectangle((0, 0, big, big), fill=BACKGROUND)
    else:
        pen.rounded_rectangle((0, 0, big - 1, big - 1), radius=big // 5, fill=BACKGROUND)
    centre = big / 2
    radius = big * (0.27 if maskable else 0.33)
    width = max(1, round(big * 0.045))
    corners = [
        (
            centre + radius * math.cos(math.radians(90 + 60 * i)),
            centre + radius * math.sin(math.radians(90 + 60 * i)),
        )
        for i in range(6)
    ]
    # Overlap one extra segment so the closing corner gets a proper joint too.
    pen.line(corners + corners[:2], fill=FOREGROUND, width=width, joint="curve")
    # Alternate edges are double bonds: a second, shorter line inside the ring, as chemists
    # draw them (each end pulled a quarter of the way to the centre).
    inward = 0.25
    for i in (0, 2, 4):
        ends = [corners[i], corners[(i + 1) % 6]]
        line = [(x + (centre - x) * inward, y + (centre - y) * inward) for x, y in ends]
        pen.line(line, fill=FOREGROUND, width=width)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, maskable in (
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ):
        draw(size, maskable).save(OUT / name, optimize=True)
        print(f"wrote web/public/icons/{name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
