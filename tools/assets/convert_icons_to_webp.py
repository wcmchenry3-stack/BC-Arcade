#!/usr/bin/env python3
"""
convert_icons_to_webp.py
========================
Convert PNG icon assets to WebP in-place.

Usage
-----
  python tools/assets/convert_icons_to_webp.py frontend/assets/fruit-icons
  python tools/assets/convert_icons_to_webp.py frontend/assets/celestial-icons

The script discovers all *.png files in the target directory (non-recursive),
converts each one to WebP at quality=90 method=6, deletes the original PNG,
and prints per-file savings plus a final summary.

Guards
------
- Refuses to run on any directory whose name matches *-baked (Skia pipeline
  textures must stay PNG).
- Exits non-zero on Pillow import failure or any conversion error.
"""

import argparse
import sys
from pathlib import Path


def _require_pillow():
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print(
            "error: Pillow is not installed. Run: pip install Pillow",
            file=sys.stderr,
        )
        sys.exit(1)


def convert_directory(directory: Path) -> None:
    if directory.name.endswith("-baked"):
        print(
            f"error: '{directory.name}' is a baked-texture directory — skipping to "
            "avoid corrupting Skia pipeline assets. Run on fruit-icons or celestial-icons instead.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not directory.is_dir():
        print(f"error: '{directory}' is not a directory", file=sys.stderr)
        sys.exit(1)

    from PIL import Image

    png_files = sorted(directory.glob("*.png"))
    if not png_files:
        print(f"No *.png files found in {directory}")
        return

    total_saved = 0
    for png_path in png_files:
        webp_path = png_path.with_suffix(".webp")
        original_size = png_path.stat().st_size
        try:
            with Image.open(png_path) as img:
                img.save(webp_path, "WEBP", quality=90, method=6)
        except Exception as exc:
            print(f"error: failed to convert {png_path.name}: {exc}", file=sys.stderr)
            sys.exit(1)

        new_size = webp_path.stat().st_size
        saved = original_size - new_size
        pct = (saved / original_size * 100) if original_size else 0
        total_saved += saved
        png_path.unlink()
        print(
            f"  {png_path.name} → {webp_path.name}  "
            f"{original_size / 1024:.1f} KB → {new_size / 1024:.1f} KB  "
            f"(−{pct:.1f}%)"
        )

    total_mb = total_saved / 1_048_576
    print(f"\nTotal saved: {total_mb:.2f} MB across {len(png_files)} file(s)")


def main() -> None:
    _require_pillow()
    parser = argparse.ArgumentParser(description="Convert PNG icon assets to WebP in-place.")
    parser.add_argument("directory", type=Path, help="Directory containing *.png icon files")
    args = parser.parse_args()
    convert_directory(args.directory)


if __name__ == "__main__":
    main()
