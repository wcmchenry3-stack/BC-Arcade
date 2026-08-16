#!/usr/bin/env python3
"""
extract_vertices.py
===================
Extract convex-hull polygon vertices from processed PNG sprite assets.

The output JSON is used at runtime by the cascade physics engine to create
polygon-shaped Matter.js bodies that match the actual fruit/planet outlines,
replacing the previous circle-only approach.

Usage
-----
  python scripts/extract_vertices.py            # process both default asset dirs
  python scripts/extract_vertices.py <path>     # single PNG (prints to stdout)
                                                 # or directory (writes adjacent JSON)

Output
------
  frontend/assets/fruit-vertices.json     — keys = fruit PNG filename stems
  frontend/assets/cosmos-vertices.json    — keys = celestial PNG filename stems

JSON format
-----------
  { "cherry": [[-0.12, 0.95], [0.38, 0.82], ...], "apple": [...], ... }

Each vertex array is the convex hull of the opaque pixels, normalized so that:
  - area-weighted centroid = (0, 0)  ← matches Matter.js Vertices.centre
  - max distance from centroid = 1.0

Scale by the fruit's physics radius at runtime to get world-space vertices.

Algorithm
---------
1. Load PNG as RGBA via Pillow.
2. Collect all pixels with alpha > 128 (the opaque fruit pixels).
3. Compute the convex hull (scipy.spatial.ConvexHull if available, else
   Graham scan implemented inline with no extra dependencies).
4. Normalize: subtract centroid, scale so max_dist = 1.0.
5. Store as list of [x, y] float pairs, rounded to 6 decimal places.
"""

import json
import math
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_FRONTEND_DIR = _SCRIPT_DIR.parent
_ASSETS_DIR = _FRONTEND_DIR / "assets"

DEFAULT_TARGETS = [
    (_ASSETS_DIR / "fruit-icons", _ASSETS_DIR / "fruit-vertices.json"),
    (_ASSETS_DIR / "celestial-icons", _ASSETS_DIR / "cosmos-vertices.json"),
]


# ---------------------------------------------------------------------------
# Core algorithm (pure functions — no file I/O — tested independently)
# ---------------------------------------------------------------------------

def _opaque_pixels(
    pixels: list[tuple[int, int, int, int]],
    width: int,
    height: int,
    alpha_threshold: int = 200,
) -> list[tuple[int, int]]:
    """Return (x, y) coordinates of every pixel whose alpha > alpha_threshold."""
    result = []
    for idx, px in enumerate(pixels):
        if px[3] > alpha_threshold:
            x = idx % width
            y = idx // width
            result.append((x, y))
    return result


def _cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """2-D cross product of vectors OA and OB."""
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _graham_scan(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """
    Compute the convex hull of *points* using a Graham scan.

    Returns the hull vertices in counter-clockwise order.
    Collinear points on the hull boundary are excluded (strict left turns only).

    Returns [] for fewer than 3 non-collinear points.
    """
    pts = list(set(points))  # deduplicate
    if len(pts) < 3:
        return []

    # Pivot: lowest y, then leftmost x
    pivot = min(pts, key=lambda p: (p[1], p[0]))

    def polar_key(p: tuple[float, float]) -> tuple[float, float]:
        dx = p[0] - pivot[0]
        dy = p[1] - pivot[1]
        return (math.atan2(dy, dx), dx * dx + dy * dy)

    sorted_pts = sorted([p for p in pts if p != pivot], key=polar_key)

    stack: list[tuple[float, float]] = [pivot]
    for p in sorted_pts:
        while len(stack) >= 2 and _cross(stack[-2], stack[-1], p) <= 0:
            stack.pop()
        stack.append(p)

    return stack if len(stack) >= 3 else []


def _area_centroid(hull: list[tuple[float, float]]) -> tuple[float, float]:
    """
    Compute the area-weighted (polygon) centroid of a convex hull.

    Uses the standard shoelace formula — the same method Matter.js uses
    internally in Vertices.centre().  For symmetric shapes the result equals
    the arithmetic mean; for asymmetric shapes (grapes, cherry, apple, …) it
    can differ significantly.

    Falls back to the arithmetic mean for degenerate cases (near-zero area).
    """
    n = len(hull)
    area = cx = cy = 0.0
    for i in range(n):
        j = (i + 1) % n
        cross = hull[i][0] * hull[j][1] - hull[j][0] * hull[i][1]
        area += cross
        cx += (hull[i][0] + hull[j][0]) * cross
        cy += (hull[i][1] + hull[j][1]) * cross
    area /= 2.0
    if abs(area) < 1e-10:
        # Degenerate polygon — fall back to arithmetic mean
        return sum(p[0] for p in hull) / n, sum(p[1] for p in hull) / n
    return cx / (6 * area), cy / (6 * area)


def _normalize_hull(
    hull: list[tuple[float, float]],
    img_width: int | None = None,
    img_height: int | None = None,
) -> list[tuple[float, float]]:
    """
    Normalize hull vertices to match how the sprite is rendered at runtime.

    The canvas draws each sprite with ``drawImage(img, -r, -r, 2r, 2r)``,
    which stretches the full image into a square of side ``2 * radius``
    centred on the body position.  A pixel at ``(px, py)`` in an image of
    size ``(W, H)`` therefore maps to world offset::

        ( (px / W - 0.5) * 2r,  (py / H - 0.5) * 2r )

    which equals ``(nx * r, ny * r)`` when we define::

        nx = 2 * px / W - 1      (range [-1, 1])
        ny = 2 * py / H - 1      (range [-1, 1])

    This per-axis normalisation guarantees the collision polygon lines up
    with the rendered sprite regardless of image aspect ratio or shape
    asymmetry (cherry stems, pineapple crowns, etc.).

    When *img_width* / *img_height* are not provided, falls back to the
    legacy centroid-and-max-distance normalisation (for tests / standalone
    use).

    Returns [] if hull is empty or all vertices are coincident.
    """
    if not hull:
        return []

    if img_width is not None and img_height is not None:
        # Bounding-box normalisation — centre on the opaque content's bbox
        # centre, scale by max(bbox_w, bbox_h)/2 so the hull fills [-1, 1].
        # This ensures the collision shape fills the physics radius regardless
        # of how much transparent padding the source PNG has.
        xs = [p[0] for p in hull]
        ys = [p[1] for p in hull]
        bbox_cx = (min(xs) + max(xs)) / 2.0
        bbox_cy = (min(ys) + max(ys)) / 2.0
        half_size = max(max(xs) - min(xs), max(ys) - min(ys)) / 2.0
        if half_size < 1e-9:
            return []
        return [((p[0] - bbox_cx) / half_size, (p[1] - bbox_cy) / half_size) for p in hull]

    # Legacy fallback: area-weighted centroid, max distance = 1.0
    cx, cy = _area_centroid(hull)

    centered = [(p[0] - cx, p[1] - cy) for p in hull]

    max_dist = max(math.hypot(p[0], p[1]) for p in centered)
    if max_dist < 1e-9:
        return []

    return [(p[0] / max_dist, p[1] / max_dist) for p in centered]


def extract_hull(
    pixels,
    width: int,
    height: int,
) -> dict:
    """
    Extract a normalized convex hull from pixel data.

    *pixels* can be either a numpy array of shape ``(H, W, 4)`` or a flat
    list of ``(R, G, B, A)`` tuples.

    Returns a dict with:
      - ``verts``: normalised hull vertices ([-1, 1] based on opaque bbox)
      - ``spriteOffset``: [ox, oy] — how much to shift the sprite so its
        opaque content aligns with the collision hull centre, in normalised
        [-1, 1] coordinates (multiply by radius at runtime).

    Returns ``{"verts": [], "spriteOffset": [0, 0]}`` on failure.
    """
    empty = {"verts": [], "spriteOffset": [0.0, 0.0]}
    try:
        import numpy as np  # type: ignore
        from scipy.spatial import ConvexHull  # type: ignore

        # Fast numpy path
        arr = np.asarray(pixels)
        if arr.ndim == 3:
            alpha = arr[:, :, 3]
            ys, xs = np.where(alpha > 200)
            if len(xs) < 3:
                return empty
            points = np.column_stack((xs.astype(float), ys.astype(float)))
        else:
            opaque = _opaque_pixels(pixels, width, height)
            if len(opaque) < 3:
                return empty
            points = np.array(opaque, dtype=float)

        hull_obj = ConvexHull(points)
        hull_pts = [tuple(points[i]) for i in hull_obj.vertices]
    except ImportError:
        opaque = _opaque_pixels(pixels, width, height)
        if len(opaque) < 3:
            return empty
        hull_pts = _graham_scan([(float(x), float(y)) for x, y in opaque])

    hull_verts = _normalize_hull(hull_pts, img_width=width, img_height=height)
    if not hull_verts:
        return empty

    # Compute sprite offset: the hull is centred on the opaque bbox centre,
    # but drawImage centres on the image centre.  The offset tells the
    # renderer how far to shift the image so they align.
    hxs = [p[0] for p in hull_pts]
    hys = [p[1] for p in hull_pts]
    bbox_cx = (min(hxs) + max(hxs)) / 2.0
    bbox_cy = (min(hys) + max(hys)) / 2.0
    half_size = max(max(hxs) - min(hxs), max(hys) - min(hys)) / 2.0
    # Image centre in hull-normalised coords
    img_cx_norm = (width / 2.0 - bbox_cx) / half_size
    img_cy_norm = (height / 2.0 - bbox_cy) / half_size
    # Sprite scale: image spans from -img_half_norm to +img_half_norm
    img_half_x = (width / 2.0) / half_size
    img_half_y = (height / 2.0) / half_size

    return {
        "verts": hull_verts,
        "spriteOffset": [
            round(img_cx_norm, 6),
            round(img_cy_norm, 6),
        ],
        "spriteScale": [
            round(img_half_x, 6),
            round(img_half_y, 6),
        ],
    }


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------

def _load_rgba(path: Path) -> tuple[list[tuple[int, int, int, int]], int, int]:
    """Load a PNG as an RGBA flat pixel list via Pillow."""
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise SystemExit("Pillow is required: pip install Pillow") from exc

    img = Image.open(path).convert("RGBA")
    width, height = img.size

    # Fast path: use numpy to extract opaque pixel coordinates directly,
    # avoiding the extremely slow pure-Python list-of-tuples path for
    # large images (2048×2048 = 4M pixels).
    try:
        import numpy as np  # type: ignore

        arr = np.array(img)  # shape (H, W, 4)
        return arr, width, height  # type: ignore[return-value]
    except ImportError:
        raw = list(img.get_flattened_data())
        return raw, width, height


# ---------------------------------------------------------------------------
# Directory and file processing
# ---------------------------------------------------------------------------

def process_directory(
    png_dir: Path,
    output_json: Path,
) -> dict[str, list[list[float]]]:
    """
    Process all PNGs in *png_dir*, write results to *output_json*.

    Returns the vertex map written.
    """
    result: dict[str, dict] = {}

    # Prefer .png over .webp when both exist (PNG is lossless → cleaner hull edges).
    stem_map: dict[str, Path] = {}
    for ext in ("*.webp", "*.png"):
        for p in png_dir.glob(ext):
            stem_map[p.stem] = p
    assets = [stem_map[k] for k in sorted(stem_map)]
    for png_path in assets:
        pixels, width, height = _load_rgba(png_path)
        data = extract_hull(pixels, width, height)
        key = png_path.stem  # filename without extension
        verts = data["verts"]
        result[key] = {
            "verts": [[round(x, 6), round(y, 6)] for x, y in verts],
            "spriteOffset": data["spriteOffset"],
            "spriteScale": data["spriteScale"],
        }
        status = f"{len(verts)} vertices" if verts else "no hull (too few opaque pixels)"
        print(f"  {png_path.name}: {status}")

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Written to {output_json.relative_to(_FRONTEND_DIR)}")
    return result


def process_single_file(path: Path) -> None:
    """Process a single PNG and print the vertex JSON to stdout."""
    pixels, width, height = _load_rgba(path)
    data = extract_hull(pixels, width, height)
    result = {path.stem: {
        "verts": [[round(x, 6), round(y, 6)] for x, y in data["verts"]],
        "spriteOffset": data["spriteOffset"],
        "spriteScale": data["spriteScale"],
    }}
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) > 1:
        target = Path(sys.argv[1])
        if not target.exists():
            print(f"Path not found: {target}", file=sys.stderr)
            sys.exit(1)
        if target.is_file():
            if target.suffix.lower() not in {".png", ".webp"}:
                print(f"Expected a PNG or WebP file, got: {target}", file=sys.stderr)
                sys.exit(1)
            process_single_file(target)
        else:
            # Directory — write JSON next to it
            output_json = target.parent / f"{target.name}-vertices.json"
            process_directory(target, output_json)
    else:
        for png_dir, output_json in DEFAULT_TARGETS:
            print(f"\nProcessing {png_dir.name}/")
            process_directory(png_dir, output_json)


if __name__ == "__main__":
    main()
