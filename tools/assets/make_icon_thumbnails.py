#!/usr/bin/env python3
"""
make_icon_thumbnails.py
=======================
Write the runtime Cascade theme icons (frontend/assets/fruit-icons/ and
frontend/assets/celestial-icons/) as small WebP thumbnails, made from the
full-resolution processed icons in cascade_icon_masters/ (#2833).

Why two copies
--------------
The runtime icons are only drawn by FruitGlyph (React Native <Image>): 22 pt at
most in the shipped UI (NextFruitPreview), 32 pt in the __DEV__ tier panel.
32 pt x 3x density = 96 px, so a 2048 px icon wastes ~95% of its bytes in the
app. The full-resolution processed (background-removed) icons are still the
input for bake_sprites.py and extract_vertices.py, so they live outside
frontend/assets/ in cascade_icon_masters/, where Metro never bundles them.

Output: longest side MAX_SIZE px (aspect ratio kept, never upscaled), Lanczos,
lossy WebP quality 90 with lossless-quality alpha. Alpha is preserved.

Usage
-----
  python tools/assets/make_icon_thumbnails.py              # both themes
  python tools/assets/make_icon_thumbnails.py --size 384   # bigger, if a UI needs it
"""

import argparse
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MASTERS_DIR = _REPO_ROOT / "cascade_icon_masters"
_ASSETS_DIR = _REPO_ROOT / "frontend" / "assets"

# 32 pt (largest FruitGlyph size) x 3x = 96 px; 256 px leaves a 2.6x margin.
MAX_SIZE = 256
WEBP_QUALITY = 90

DEFAULT_PAIRS: list[tuple[Path, Path]] = [
    (_MASTERS_DIR / "fruit-icons", _ASSETS_DIR / "fruit-icons"),
    (_MASTERS_DIR / "celestial-icons", _ASSETS_DIR / "celestial-icons"),
]


def make_thumbnail(src: Path, dst: Path, max_size: int = MAX_SIZE) -> tuple[int, int]:
    """Resize src to fit in max_size x max_size and save it as WebP at dst.

    Returns the output (width, height).
    """
    from PIL import Image

    with Image.open(src) as im:
        img = im.convert("RGBA")
    w, h = img.size
    scale = min(1.0, max_size / max(w, h))
    out_size = (max(1, round(w * scale)), max(1, round(h * scale)))
    if out_size != (w, h):
        # Pillow premultiplies alpha for RGBA resizes, so edges get no dark fringe.
        img = img.resize(out_size, Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", quality=WEBP_QUALITY, alpha_quality=100, method=6)
    return out_size


def make_directory(src_dir: Path, dst_dir: Path, max_size: int = MAX_SIZE) -> int:
    """Write a thumbnail in dst_dir for every *.webp / *.png in src_dir.

    Returns the number of files written.
    """
    if dst_dir.name.endswith("-baked"):
        print(f"error: refusing to write into baked directory {dst_dir}", file=sys.stderr)
        sys.exit(1)
    if not src_dir.is_dir():
        print(f"error: '{src_dir}' is not a directory", file=sys.stderr)
        sys.exit(1)

    # One source per icon. When a stem has both, the PNG wins: it is what
    # remove_backgrounds.py just wrote, and the WebP may be a stale conversion.
    by_stem: dict[str, Path] = {}
    for p in sorted(src_dir.iterdir()):
        suffix = p.suffix.lower()
        if suffix not in (".webp", ".png"):
            continue
        if p.stem not in by_stem or suffix == ".png":
            by_stem[p.stem] = p
    sources = [by_stem[stem] for stem in sorted(by_stem)]
    for src in sources:
        dst = dst_dir / f"{src.stem}.webp"
        w, h = make_thumbnail(src, dst, max_size)
        print(f"  {src.name} -> {dst.name} {w}x{h} {dst.stat().st_size / 1024:.0f} KB")
    return len(sources)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--size", type=int, default=MAX_SIZE, help="longest side in px")
    args = parser.parse_args()
    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("error: Pillow is not installed. Run: pip install Pillow")
    for src_dir, dst_dir in DEFAULT_PAIRS:
        print(f"{src_dir.relative_to(_REPO_ROOT)} -> {dst_dir.relative_to(_REPO_ROOT)}")
        make_directory(src_dir, dst_dir, args.size)


if __name__ == "__main__":
    main()
