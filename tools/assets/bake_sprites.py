#!/usr/bin/env python3
"""
Pre-bake sprite pipeline for Cascade game assets.

For each asset in both fruit themes, this script:
  1. Loads the processed PNG
  2. Zeroes semi-transparent pixels (moves cleanImage logic offline)
  3. Applies sprite offset/scale to centre the asset on a transparent canvas
  4. Clips to the spriteClipRadius circle
  5. Saves a 512×512 baked PNG — ready for a single ctx.drawImage at runtime

Also writes `bakedClipR` (normalised: clipR / radius) into each theme's
vertices JSON so the runtime renderer knows the draw half-size:

    const clipR = def.bakedClipR * def.radius;   // half-size in world px
    ctx.drawImage(baked, -clipR, -clipR, clipR*2, clipR*2);

Run from anywhere:
    python tools/assets/bake_sprites.py

Requires Pillow:
    pip install Pillow
"""

import json
import math
import pathlib

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    raise SystemExit("Pillow is required: pip install Pillow") from None

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
FRONTEND_DIR = SCRIPT_DIR.parent.parent / "frontend"
ASSETS_DIR = FRONTEND_DIR / "assets"

# Output canvas: 512×512.  The baked clipR circle fills the entire image.
# At runtime: ctx.drawImage(baked, cx-clipR, cy-clipR, clipR*2, clipR*2)
HALF = 256  # half-size of each baked PNG (pixels)

# Ringed planets have semi-transparent ring pixels (alpha 3–25) well beyond
# the disc edge.  Skipping clean_image for these preserves the ring structure
# without affecting disc-only assets.
RINGED_PLANETS: frozenset[str] = frozenset({"saturn", "uranus"})

THEMES = [
    {
        "id": "fruits",
        "icon_dir": ASSETS_DIR / "fruit-icons",
        "vertices_json": ASSETS_DIR / "fruit-vertices.json",
        "out_dir": ASSETS_DIR / "fruits-baked",
    },
    {
        "id": "cosmos",
        "icon_dir": ASSETS_DIR / "celestial-icons",
        "vertices_json": ASSETS_DIR / "cosmos-vertices.json",
        "out_dir": ASSETS_DIR / "cosmos-baked",
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def clean_image(img: Image.Image, threshold: int = 200) -> Image.Image:
    """Zero RGBA for pixels with alpha < threshold — mirrors runtime cleanImage().

    Scrubs JPEG compression halos and semi-transparent fringe so baked edges
    stay crisp.  Pass threshold=0 for ringed planets (Saturn, Uranus) to
    preserve their semi-transparent ring pixels, which have alpha values as
    low as 3–25 well beyond the disc edge.
    """
    if threshold == 0:
        return img.convert("RGBA")
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            _r, _g, _b, a = pixels[x, y]
            if a < threshold:
                pixels[x, y] = (0, 0, 0, 0)
    return img


def sprite_clip_radius_norm(sprite: dict) -> float:
    """
    Normalised spriteClipRadius (= clipR / r).

    Mirrors the JavaScript spriteClipRadius() in the asset preview tool:
      max(hypot(ox+sx, oy+sy), hypot(ox-sx, oy+sy),
          hypot(ox+sx, oy-sy), hypot(ox-sx, oy-sy))
    """
    ox, oy = sprite["spriteOffset"]
    sx, sy = sprite["spriteScale"]
    return max(
        math.hypot(ox + sx, oy + sy),
        math.hypot(ox - sx, oy + sy),
        math.hypot(ox + sx, oy - sy),
        math.hypot(ox - sx, oy - sy),
    )


def bake_asset(src_png: pathlib.Path, sprite: dict, out_png: pathlib.Path, name: str = "") -> float:
    """
    Bake one asset PNG.

    Returns normalised bakedClipR (= clipR / r) so the caller can store it in
    the vertices JSON.
    """
    ox, oy = sprite["spriteOffset"]
    sx, sy = sprite["spriteScale"]
    clip_r_norm = sprite_clip_radius_norm(sprite)

    out_size = HALF * 2  # 512

    # Scale factor: HALF pixels = 1 normalised unit of clipR.
    # So the baked clipR circle exactly fills the 512×512 canvas.
    scale = HALF / clip_r_norm

    # 1. Load + clean source image.
    # Ringed planets skip clean_image entirely so their semi-transparent ring
    # pixels (alpha 3–25 beyond the disc edge) are preserved in the bake.
    src = Image.open(src_png).convert("RGBA")
    clean_threshold = 0 if name in RINGED_PLANETS else 200
    src = clean_image(src, threshold=clean_threshold)

    # 2. Compute where the sprite sits in the output canvas.
    #    Canvas centre = (HALF, HALF).
    #    In normalised units: sprite rect is
    #      x ∈ [ox - sx, ox + sx], y ∈ [oy - sy, oy + sy]
    sprite_x = (ox - sx) * scale + HALF
    sprite_y = (oy - sy) * scale + HALF
    sprite_w = 2 * sx * scale
    sprite_h = 2 * sy * scale

    # 3. Composite sprite onto a transparent canvas
    canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    resized = src.resize(
        (max(1, round(sprite_w)), max(1, round(sprite_h))),
        Image.LANCZOS,
    )
    # PIL paste handles negative/out-of-bounds coordinates correctly
    canvas.paste(resized, (round(sprite_x), round(sprite_y)), resized)

    # 4. Intersect existing alpha with hull-polygon clip mask.
    #    The hull vertices are in normalised units where 1.0 = physics radius.
    #    Scaling by HALF/clip_r_norm converts them to pixels in the baked canvas.
    #    Clipping to the hull polygon ensures no colour bleeds outside the
    #    actual fruit/planet shape, regardless of sprite padding or disc backgrounds.
    physics_scale = HALF / clip_r_norm  # pixels per normalised unit (r=1.0)
    hull_px = [
        (round(v[0] * physics_scale + HALF), round(v[1] * physics_scale + HALF))
        for v in sprite["verts"]
    ]
    if len(hull_px) >= 3:
        poly_mask = Image.new("L", (out_size, out_size), 0)
        ImageDraw.Draw(poly_mask).polygon(hull_px, fill=255)
        existing_alpha = canvas.split()[3]
        combined_alpha = ImageChops.multiply(existing_alpha, poly_mask)
        canvas.putalpha(combined_alpha)
    # else: no hull polygon — asset has a transparent background, no clip needed.

    # 5. Save
    out_png.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_png, "PNG")
    return clip_r_norm


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    for theme in THEMES:
        print(f"\n=== {theme['id']} ===")
        vertices: dict = json.loads(theme["vertices_json"].read_text())
        baked_clip_r: dict[str, float] = {}

        for name, sprite in vertices.items():
            src_png: pathlib.Path | None = next(
                (
                    theme["icon_dir"] / f"{name}{ext}"
                    for ext in (".png", ".webp")
                    if (theme["icon_dir"] / f"{name}{ext}").exists()
                ),
                None,
            )
            if src_png is None:
                print(f"  SKIP  {name}: no .png or .webp found in {theme['icon_dir']}")
                continue

            out_png: pathlib.Path = theme["out_dir"] / f"{name}.png"
            clip_r = bake_asset(src_png, sprite, out_png, name=name)
            baked_clip_r[name] = clip_r
            print(f"  BAKED {name}: bakedClipR={clip_r:.6f}")

        # Write bakedClipR into each entry of the vertices JSON, then
        # format with Prettier so CI doesn't complain about code style.
        for name, clip_r in baked_clip_r.items():
            vertices[name]["bakedClipR"] = round(clip_r, 6)
        theme["vertices_json"].write_text(json.dumps(vertices, indent=2) + "\n")
        _prettier(theme["vertices_json"])
        print(f"  Updated {theme['vertices_json'].name}")

    print("\nDone. Commit the baked PNGs and updated vertices JSON files.")
    print("Then update fruitSets.ts with the bakedClipR values and bakedIcon imports.")


def _prettier(path: pathlib.Path) -> None:
    """Run 'npx prettier --write' on path if npx is available; silently skip if not."""
    import shutil
    import subprocess

    npx = shutil.which("npx")
    if not npx:
        print(f"  (npx not found — run: npx prettier --write {path.name})")
        return
    result = subprocess.run(
        [npx, "prettier", "--write", str(path)],
        cwd=FRONTEND_DIR,
        capture_output=True,
        text=True,
        check=False,  # returncode is inspected below
    )
    if result.returncode != 0:
        print(f"  (prettier failed: {result.stderr.strip()!r})")


if __name__ == "__main__":
    main()
