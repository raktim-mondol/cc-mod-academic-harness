#!/usr/bin/env python3
"""Draw the plugin's icon: .claude-plugin/icon.png, a square 1024 px PNG.

    python3 scripts/make-icon.py

A page with lines of text and a corner turned down, and a check mark badge on it: a manuscript that has been checked.
Drawn at twice the size and scaled down, so the edges are smooth. Needs Pillow. The picture is committed; this only
exists so that it can be changed.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SCALE = 2
S = SIZE * SCALE

NAVY = (24, 46, 82, 255)
PAGE = (250, 250, 247, 255)
FOLD = (205, 214, 226, 255)
INK = (120, 134, 156, 255)
GREEN = (46, 160, 105, 255)
WHITE = (255, 255, 255, 255)


def p(x: float) -> int:
    """A coordinate given in a 1024 grid, in drawing pixels."""
    return round(x * SCALE)


def main() -> None:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # rounded square background
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=p(200), fill=NAVY)

    # the page, with its top right corner cut and turned down
    left, top, right, bottom, cut = 262, 170, 762, 854, 150
    d.polygon([(p(left), p(top)), (p(right - cut), p(top)), (p(right), p(top + cut)), (p(right), p(bottom)), (p(left), p(bottom))], fill=PAGE)
    d.polygon([(p(right - cut), p(top)), (p(right), p(top + cut)), (p(right - cut), p(top + cut))], fill=FOLD)

    # lines of text
    for i, (y, end) in enumerate([(350, 640), (430, 680), (510, 600), (590, 560), (670, 420)]):
        d.rounded_rectangle([p(left + 60), p(y), p(end), p(y + 28)], radius=p(14), fill=INK)

    # the badge: a green disc with a white ring and a check mark
    cx, cy, r = 700, 712, 170
    d.ellipse([p(cx - r - 22), p(cy - r - 22), p(cx + r + 22), p(cy + r + 22)], fill=NAVY)
    d.ellipse([p(cx - r), p(cy - r), p(cx + r), p(cy + r)], fill=GREEN)
    d.line([(p(cx - 82), p(cy + 6)), (p(cx - 22), p(cy + 66)), (p(cx + 88), p(cy - 56))], fill=WHITE, width=p(34), joint="curve")
    for x, y in [(cx - 82, cy + 6), (cx - 22, cy + 66), (cx + 88, cy - 56)]:
        d.ellipse([p(x - 17), p(y - 17), p(x + 17), p(y + 17)], fill=WHITE)

    out = Path(__file__).resolve().parent.parent / ".claude-plugin" / "icon.png"
    img.resize((SIZE, SIZE), Image.LANCZOS).save(out, optimize=True)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
