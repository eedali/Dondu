"""Generate app icons (build/icon.png, build/icon.icns, build/icon.ico, resources/icon.png)
from the brand mark in logo/png. Run once when the logo changes:  python scripts/make-icons.py
Requires Pillow. Output is committed, so the npm toolchain never needs Python."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MARK = ROOT / "logo" / "png" / "mark-color-1024.png"
SIZE = 1024
# macOS Big Sur+ icon grid: 824px tile centred in 1024 canvas, corner radius ~185px
TILE = 824
RADIUS = 185
BG = (255, 255, 255, 255)


def build() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # soft single shadow (very subtle) then the white tile
    tile_box = ((SIZE - TILE) // 2, (SIZE - TILE) // 2 + 10, (SIZE + TILE) // 2, (SIZE + TILE) // 2 + 10)
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (tile_box[0], tile_box[1] + 6, tile_box[2], tile_box[3] + 6), RADIUS, fill=(26, 31, 58, 40)
    )
    canvas = Image.alpha_composite(canvas, shadow)
    ImageDraw.Draw(canvas).rounded_rectangle(tile_box, RADIUS, fill=BG)
    mark = Image.open(MARK).convert("RGBA")
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    target = int(TILE * 0.56)
    scale = target / max(mark.size)
    mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    cx = (tile_box[0] + tile_box[2]) // 2
    cy = (tile_box[1] + tile_box[3]) // 2
    canvas.alpha_composite(mark, (cx - mark.width // 2, cy - mark.height // 2))
    return canvas


def main() -> None:
    icon = build()
    (ROOT / "build").mkdir(exist_ok=True)
    (ROOT / "resources").mkdir(exist_ok=True)
    icon.save(ROOT / "build" / "icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "resources" / "icon.png")
    icon.save(ROOT / "build" / "icon.icns", sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
    icon.save(ROOT / "build" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icons written")


if __name__ == "__main__":
    main()
