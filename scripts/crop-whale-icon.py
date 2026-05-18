"""Regenerate public/whale-icon.png from public/whale-logo.png (transparent, tight crop)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "whale-logo.png"
OUT = ROOT / "public" / "whale-icon.png"
APP_ICON = ROOT / "app" / "icon.png"
PAD = 6
BLACK_THRESH = 48


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if r < BLACK_THRESH and g < BLACK_THRESH and b < BLACK_THRESH:
                px[x, y] = (0, 0, 0, 0)

    bbox = img.getbbox()
    if not bbox:
        raise SystemExit("No visible pixels after background removal.")

    l = max(0, bbox[0] - PAD)
    t = max(0, bbox[1] - PAD)
    r = min(w, bbox[2] + PAD)
    b = min(h, bbox[3] + PAD)
    cropped = img.crop((l, t, r, b))
    cropped.save(OUT)
    cropped.save(APP_ICON)
    print(f"Wrote {OUT} ({cropped.size[0]}x{cropped.size[1]})")


if __name__ == "__main__":
    main()
