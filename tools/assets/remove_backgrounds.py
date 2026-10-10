#!/usr/bin/env python3
"""
remove-backgrounds.py
=====================
Remove baked-in opaque backgrounds from PNG sprite assets.

Usage
-----
  python tools/assets/remove_backgrounds.py            # process both default asset dirs
  python tools/assets/remove_backgrounds.py <path>     # single file or directory

Algorithm
---------
1. Sample the background colour from 3×3 pixel regions at each of the four
   corners separately, producing up to four reference colours.
2. For every pixel compute the Euclidean RGB distance to the NEAREST corner
   reference.  This handles images where the background colour isn't uniform
   (e.g. gray-white in three corners but pure-white in the fourth).
3. Apply a two-threshold alpha fade using that minimum distance:
     dist < HARD_THRESHOLD  → alpha = 0   (definitely background)
     dist < SOFT_THRESHOLD  → alpha lerped 0→original (anti-aliased edge)
     dist >= SOFT_THRESHOLD → alpha unchanged (definitely foreground)

The script is *idempotent*: if any corner pixel already has alpha < 200 the
file is assumed to have already been processed and is skipped (color mode only).

Modes
-----
  color   — colour-distance background removal. Suitable for sprites that have a
             solid or near-solid opaque background (fruit icons). Samples up to
             four corner regions for reference background colours.

  circle    — circular alpha mask. Suitable for spherical assets where the subject
               fills the entire frame.

  celestial — two-pass mode for celestial/kawaii sprites with baked-in checkerboard
               backgrounds. Uses colour-distance removal with tight thresholds
               (CELESTIAL_HARD / CELESTIAL_SOFT) followed by a circle mask.
               The tight thresholds remove the checkerboard (which clusters at
               distance 0–5 from corner references) without eating grey artwork
               (Moon, Venus, Saturn) that starts at distance 10+.
"""

import math
import sys
from pathlib import Path

HARD_THRESHOLD = 25  # pixels closer than this to background → fully transparent
SOFT_THRESHOLD = 80  # pixels beyond this from background → fully opaque

# Circular-mask parameters (used for celestial-icons)
CIRCLE_RADIUS_FACTOR = 0.48  # planet radius as fraction of min(w,h)
CIRCLE_FEATHER_FACTOR = 0.01  # soft-edge width as fraction of min(w,h)

# Tighter colour-distance thresholds for celestial icons (two-pass mode).
# The checkerboard background tones are close to the grey artwork on some bodies
# (Moon, Venus, Saturn), so the standard 25/80 thresholds eat too much artwork.
# Checkerboard pixels cluster at distance 0–5 from corner references; artwork
# starts at ~10+, so 8/12 captures the checkerboard while preserving artwork.
CELESTIAL_HARD = 8
CELESTIAL_SOFT = 10

# Default pipeline: (source_dir, output_dir, mode)
# source_dir  — original PNGs with opaque backgrounds (committed, never modified)
# output_dir  — processed PNGs written here (may be the same dir for in-place runs)
_SCRIPT_DIR = Path(__file__).resolve().parent
_FRONTEND_DIR = _SCRIPT_DIR.parent.parent / "frontend"
# Output goes to the full-resolution masters (#2833); run make_icon_thumbnails.py
# afterwards to refresh the 256 px runtime icons in frontend/assets/*-icons/.
_MASTERS_DIR = _SCRIPT_DIR.parent.parent / "cascade_icon_masters"
DEFAULT_PIPELINE: list[tuple[Path, Path, str]] = [
    (
        _FRONTEND_DIR / "assets" / "source-icons" / "fruits",
        _MASTERS_DIR / "fruit-icons",
        "color",
    ),
    (
        _FRONTEND_DIR / "assets" / "source-icons" / "cosmos",
        _MASTERS_DIR / "celestial-icons",
        "celestial",
    ),
]


# ---------------------------------------------------------------------------
# Core algorithm (operates on raw RGBA pixel lists for testability)
# ---------------------------------------------------------------------------


def _sample_background(
    pixels: list[tuple[int, int, int, int]], width: int, height: int
) -> list[tuple[float, float, float]]:
    """
    Return one average RGB colour per corner (top-left, top-right, bottom-left,
    bottom-right), each averaged over a 3×3 pixel sample region.

    Using per-corner references rather than a single global average handles
    images where the background colour varies across the image (e.g. one corner
    is gray-white while another is pure white).
    """
    sample_size = min(3, width, height)
    result = []
    for row_start in (0, height - sample_size):
        for col_start in (0, width - sample_size):
            samples = []
            for r in range(row_start, row_start + sample_size):
                for c in range(col_start, col_start + sample_size):
                    px = pixels[r * width + c]
                    samples.append(px[:3])
            avg_r = sum(p[0] for p in samples) / len(samples)
            avg_g = sum(p[1] for p in samples) / len(samples)
            avg_b = sum(p[2] for p in samples) / len(samples)
            result.append((avg_r, avg_g, avg_b))
    return result


def _is_already_transparent(
    pixels: list[tuple[int, int, int, int]], width: int, height: int
) -> bool:
    """Return True if any corner pixel already has alpha < 200 (already processed)."""
    sample_size = min(3, width, height)
    for row_start in (0, height - sample_size):
        for col_start in (0, width - sample_size):
            for r in range(row_start, row_start + sample_size):
                for c in range(col_start, col_start + sample_size):
                    if pixels[r * width + c][3] < 200:
                        return True
    return False


def apply_circle_mask(
    pixels: list[tuple[int, int, int, int]],
    width: int,
    height: int,
    radius_factor: float = CIRCLE_RADIUS_FACTOR,
    feather_factor: float = CIRCLE_FEATHER_FACTOR,
) -> list[tuple[int, int, int, int]]:
    """
    Apply a circular alpha mask centred on the image.

    Used for spherical assets (planets/celestial bodies) where the planet fills
    most of the square frame.  The colour-distance approach incorrectly makes
    interior planet pixels semi-transparent because the planet's limb/atmosphere
    is often close in colour to the sampled corner "background".  A circle mask
    avoids this: pixels inside the inscribed circle stay opaque, pixels outside
    fade to transparent, with a soft feathered edge.

    Parameters
    ----------
    radius_factor  : planet radius as a fraction of min(width, height).
                     0.48 keeps 96% of the inscribed circle, cutting only
                     transparent corner space.
    feather_factor : width of the soft edge as a fraction of min(width, height).
    """
    cx, cy = width / 2.0, height / 2.0
    r = min(width, height) * radius_factor
    feather = max(1.0, min(width, height) * feather_factor)
    result = []
    for idx in range(len(pixels)):
        row = idx // width
        col = idx % width
        dist = math.hypot(col - cx, row - cy)
        px_r, px_g, px_b, px_a = pixels[idx]
        if dist <= r - feather:
            result.append((px_r, px_g, px_b, px_a))
        elif dist <= r + feather:
            t = (r + feather - dist) / (2.0 * feather)
            t = max(0.0, min(1.0, t))
            new_a = int(px_a * t)
            if new_a == 0:
                result.append((0, 0, 0, 0))
            else:
                result.append((px_r, px_g, px_b, new_a))
        else:
            result.append((0, 0, 0, 0))
    return result


def remove_background(
    pixels: list[tuple[int, int, int, int]],
    width: int,
    height: int,
    hard_threshold: int = HARD_THRESHOLD,
    soft_threshold: int = SOFT_THRESHOLD,
) -> list[tuple[int, int, int, int]]:
    """
    Return a new pixel list with background pixels made transparent.

    Parameters
    ----------
    pixels:          flat list of (R, G, B, A) tuples, row-major
    width, height:   image dimensions
    hard_threshold:  pixels within this Euclidean distance of background → alpha 0
    soft_threshold:  pixels beyond this distance from background → alpha unchanged

    Returns
    -------
    New flat list of (R, G, B, A) with modified alpha values.
    """
    bg_refs = _sample_background(pixels, width, height)
    soft_range = soft_threshold - hard_threshold
    result = []
    for r, g, b, a in pixels:
        dist = min(
            math.sqrt((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2)
            for bg_r, bg_g, bg_b in bg_refs
        )
        if dist < hard_threshold:
            result.append((0, 0, 0, 0))
        elif dist < soft_threshold:
            t = (dist - hard_threshold) / soft_range
            new_a = round(a * t)
            if new_a == 0:
                result.append((0, 0, 0, 0))
            else:
                result.append((r, g, b, new_a))
        else:
            result.append((r, g, b, a))
    return result


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------


def _load_rgba(path: Path) -> tuple[list[tuple[int, int, int, int]], int, int]:
    """Load a PNG as RGBA pixel list using Pillow."""
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise SystemExit("Pillow is required: pip install Pillow") from exc

    img = Image.open(path).convert("RGBA")
    width, height = img.size
    raw = list(img.get_flattened_data())
    return raw, width, height


def _save_rgba(
    path: Path, pixels: list[tuple[int, int, int, int]], width: int, height: int
) -> None:
    """Save pixel list back to PNG via Pillow."""
    from PIL import Image  # type: ignore

    img = Image.new("RGBA", (width, height))
    img.putdata(pixels)
    img.save(path, format="PNG")


# ---------------------------------------------------------------------------
# File-level processing
# ---------------------------------------------------------------------------


def process_file(  # noqa: PLR0912 - one linear per-mode pipeline; splitting adds no clarity
    path: Path, mode: str = "color", out_path: Path | None = None
) -> str:
    """
    Process a single PNG file and write the result to out_path (default: in-place).

    mode="color"     — colour-distance background removal (fruits).
    mode="circle"    — circular alpha mask only (generic spherical assets).
    mode="celestial" — colour-distance with tight thresholds then circle mask.
                       Handles baked-in checkerboard backgrounds on celestial PNGs
                       without eating grey artwork (Moon, Venus, Saturn, etc.).

    Returns a human-readable status string.
    """
    if out_path is None:
        out_path = path
    pixels, width, height = _load_rgba(path)

    if mode == "celestial":
        # Two-pass colour + circle removal for celestial sprites with baked-in
        # checkerboard backgrounds.  The checkerboard tones overlap with grey
        # artwork (Moon, Venus, Saturn), so we use a radial strategy:
        #   - Inner region (< 0.30 radius): tight thresholds to preserve artwork
        #   - Outer ring  (>= 0.30 radius): standard thresholds to strip checker
        # The fruit-colour fill in the Skia renderer covers any small artefacts
        # at the boundary where thresholds transition.
        bg_refs = _sample_background(pixels, width, height)
        cx, cy = width / 2.0, height / 2.0
        dim = min(width, height)
        inner_r = dim * 0.30

        processed: list[tuple[int, int, int, int]] = []
        for idx, (r, g, b, a) in enumerate(pixels):
            row = idx // width
            col = idx % width
            dist_center = math.hypot(col - cx, row - cy)

            # Pick thresholds based on distance from centre
            if dist_center < inner_r:
                hard, soft = CELESTIAL_HARD, CELESTIAL_SOFT
            else:
                hard, soft = HARD_THRESHOLD, SOFT_THRESHOLD

            colour_dist = min(
                math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2) for br, bg, bb in bg_refs
            )
            soft_range = soft - hard
            if colour_dist < hard:
                processed.append((0, 0, 0, 0))
            elif colour_dist < soft:
                t = (colour_dist - hard) / soft_range
                new_a = round(a * t)
                if new_a == 0:
                    processed.append((0, 0, 0, 0))
                else:
                    processed.append((r, g, b, new_a))
            else:
                processed.append((r, g, b, a))

        # Pass 2: circle mask to clean up remaining corner artefacts.
        processed = apply_circle_mask(processed, width, height)
    elif mode == "circle":
        processed = apply_circle_mask(pixels, width, height)
    else:
        if _is_already_transparent(pixels, width, height):
            return f"{path.name} — skipped (already transparent)"
        processed = remove_background(pixels, width, height)

    cleared = sum(
        1 for orig, new in zip(pixels, processed, strict=False) if orig[3] > 0 and new[3] == 0
    )
    pct = cleared / (width * height) * 100

    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save_rgba(out_path, processed, width, height)
    return f"{path.name} ({mode}) -> {out_path.parent.name}/{out_path.name} -- {pct:.1f}% pixels cleared"


def process_path(target: Path, mode: str = "color", out_dir: Path | None = None) -> list[str]:
    """Process a single file or all PNGs in a directory. Returns status lines.

    If out_dir is given, processed files are written there instead of in-place.
    """
    if target.is_file():
        if target.suffix.lower() != ".png":
            return [f"Skipped (not a PNG): {target}"]
        out_path = (out_dir / target.name) if out_dir else None
        return [process_file(target, mode, out_path)]

    if target.is_dir():
        pngs = sorted(target.glob("*.png"))
        if not pngs:
            return [f"No PNG files found in {target}"]
        return [process_file(p, mode, (out_dir / p.name) if out_dir else None) for p in pngs]

    return [f"Path not found: {target}"]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """
    Usage
    -----
      python remove_backgrounds.py                        # process DEFAULT_DIRS
      python remove_backgrounds.py <path>                 # color mode (default)
      python remove_backgrounds.py <path> --mode circle   # circular mask mode
      python remove_backgrounds.py <path> --mode color    # explicit color mode

    When processing a new asset set, pass --mode circle for spherical subjects
    (planets, balls, coins, …) or --mode color for flat sprites with solid
    opaque backgrounds (fruits, gems, …). Add the new directory to DEFAULT_DIRS
    with the appropriate mode so future unattended runs pick it up automatically.
    """
    if len(sys.argv) > 1:
        # Parse CLI: path [--mode <mode>] [--out <dir>]
        args = sys.argv[1:]
        mode = "color"
        out_dir: Path | None = None
        if "--mode" in args:
            idx = args.index("--mode")
            mode = args[idx + 1]
            args = [a for i, a in enumerate(args) if i not in (idx, idx + 1)]
        if "--out" in args:
            idx = args.index("--out")
            out_dir = Path(args[idx + 1])
            args = [a for i, a in enumerate(args) if i not in (idx, idx + 1)]
        if not args:
            print(
                "Usage: remove_backgrounds.py <path> [--mode color|circle] [--out <dir>]",
                file=sys.stderr,
            )
            sys.exit(1)
        targets = [(Path(a), mode, out_dir) for a in args]
    else:
        targets = [(src, mode, out) for src, out, mode in DEFAULT_PIPELINE]

    all_results = []
    for target, mode, out_dir in targets:
        all_results.extend(process_path(target, mode, out_dir))

    for line in all_results:
        print(line)


if __name__ == "__main__":
    main()
