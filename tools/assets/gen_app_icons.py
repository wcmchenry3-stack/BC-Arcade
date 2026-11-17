"""Generate the splash and Android launcher art from the BC Arcade mascot (#3935).

The mascot (a Gemini-generated image, see docs/BRANDING.md "App icon and logo provenance") is the
only third-party-tool input. Everything drawn around it is code: the circular crop, the neon ring and
glow, the dark backdrop and the Android themed (monochrome) silhouette.

Writes (all derived, so edit this script and re-run rather than editing the PNGs):
  frontend/assets/splash-icon.png, adaptive-icon.png          (1024 px masters named in app.json)
  frontend/android/.../mipmap-*/ic_launcher{,_round,_foreground,_monochrome}.webp
  frontend/android/.../drawable-*/splashscreen_logo.png
  frontend/ios/.../SplashScreenLegacy.imageset/image{,@2x,@3x}.png

Not touched: assets/icon.png and the iOS AppIcon (the mascot itself), logo.png, favicon.png.

Usage: python tools/assets/gen_app_icons.py [--check]
Needs Pillow (tools/assets/requirements.txt).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parents[2]
FRONTEND = REPO / "frontend"
ASSETS = FRONTEND / "assets"
RES = FRONTEND / "android/app/src/main/res"
IOS_SPLASH = FRONTEND / "ios/GamingApp/Images.xcassets/SplashScreenLegacy.imageset"
# The mascot master. The iOS AppIcon is the unquantised copy of assets/icon.png.
SOURCE = FRONTEND / "ios/GamingApp/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"

BACKGROUND = (13, 13, 26)  # #0d0d1a, app.json splash and adaptive backgroundColor
RING = (143, 245, 255)  # #8ff5ff, the synthwave cyan in docs/BRANDING.md
GLOW = (163, 79, 196)  # #a34fc4, the BC Arcade purple

MASTER = 1024
SS = 4  # supersampling for the circle mask

# Medallion diameter as a share of the canvas. Android keeps the launcher subject inside the central
# 66 % (72 dp of 108 dp); the splash also has to survive the Android 12 circular mask (192 of 288 dp).
ADAPTIVE_SHARE = 0.64  # no glow on the launcher, so the ring can sit near the 66 % edge
SPLASH_SHARE = 0.56
RING_WIDTH = 0.035  # of the medallion diameter
MONO_CROP = (150, 60, 874, 784)  # head and ears of the mascot master, for the themed layer

MIPMAP_FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
MIPMAP_LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SPLASH_LOGO = {"mdpi": 288, "hdpi": 432, "xhdpi": 576, "xxhdpi": 864, "xxxhdpi": 1152}


def _circle_mask(size: int) -> Image.Image:
    big = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(big).ellipse((0, 0, size * SS - 1, size * SS - 1), fill=255)
    return big.resize((size, size), Image.LANCZOS)


def medallion(diameter: int, canvas: int, *, glow: bool = True) -> Image.Image:
    """The mascot in a circle with a neon ring, centred on a transparent canvas."""
    art = Image.open(SOURCE).convert("RGB").resize((diameter, diameter), Image.LANCZOS)
    disc = art.convert("RGBA")
    disc.putalpha(_circle_mask(diameter))

    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    off = (canvas - diameter) // 2

    ring_w = max(2, round(diameter * RING_WIDTH))
    ring_mask = Image.new("L", (canvas * SS, canvas * SS), 0)
    d = ImageDraw.Draw(ring_mask)
    box = (off * SS, off * SS, (off + diameter) * SS - 1, (off + diameter) * SS - 1)
    d.ellipse(box, outline=255, width=ring_w * SS)
    ring_mask = ring_mask.resize((canvas, canvas), Image.LANCZOS)

    if glow:
        halo = ring_mask.filter(ImageFilter.GaussianBlur(diameter * 0.03))
        halo = halo.point(lambda v: min(255, v * 2) * 0.55)
        out.alpha_composite(Image.merge("RGBA", (*[Image.new("L", out.size, c) for c in GLOW], halo)))

    out.alpha_composite(disc, (off, off))
    ring = Image.merge("RGBA", (*[Image.new("L", out.size, c) for c in RING], ring_mask))
    out.alpha_composite(ring)
    return out


def monochrome(canvas: int) -> Image.Image:
    """Themed-icon layer (Android 13 tints it, only alpha matters): ring plus the mascot's head.

    Zoomed on the head and ears, the bright line work thickened so it survives the tint and small
    sizes. Strokes are dilated at master size, then the layer is downscaled with the rest.
    """
    d = round(canvas * ADAPTIVE_SHARE)
    ring_w = max(2, round(d * RING_WIDTH * 1.4))
    inner = d - 2 * ring_w - round(d * 0.04)
    src = Image.open(SOURCE).convert("L").crop(MONO_CROP).resize((inner * 2, inner * 2), Image.LANCZOS)
    lines = src.point(lambda v: 255 if v > 150 else (v - 120) * 255 // 30 if v > 120 else 0)
    # Opening drops the hairline circuit traces behind the dog; the dog's own outline is thicker.
    lines = lines.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    lines = lines.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(0.8))
    # Fade the busy side circuitry; the subject sits in the middle.
    fade = Image.new("L", (inner * 2, inner * 2), 0)
    ImageDraw.Draw(fade).ellipse((inner * 0.08, 0, inner * 1.92, inner * 2), fill=255)
    lines = ImageChops.multiply(lines, fade.filter(ImageFilter.GaussianBlur(inner * 0.05)))
    lines = lines.resize((inner, inner), Image.LANCZOS)
    lines = ImageChops.multiply(lines, _circle_mask(inner))

    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    off = (canvas - d) // 2
    white = Image.new("RGBA", (inner, inner), (255, 255, 255, 255))
    white.putalpha(lines)
    layer.alpha_composite(white, ((canvas - inner) // 2, (canvas - inner) // 2))

    m = Image.new("L", (canvas * SS, canvas * SS), 0)
    ImageDraw.Draw(m).ellipse(
        (off * SS, off * SS, (off + d) * SS - 1, (off + d) * SS - 1), outline=255, width=ring_w * SS
    )
    ring = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
    ring.putalpha(m.resize((canvas, canvas), Image.LANCZOS))
    layer.alpha_composite(ring)
    return layer


def legacy_square(size: int) -> Image.Image:
    """Pre-API-26 launcher icon: the mascot on its own, rounded square (~22 % radius)."""
    art = Image.open(SOURCE).convert("RGB").resize((size * SS, size * SS), Image.LANCZOS)
    mask = Image.new("L", art.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, art.width - 1, art.height - 1), radius=int(art.width * 0.22), fill=255)
    art = art.convert("RGBA")
    art.putalpha(mask)
    return art.resize((size, size), Image.LANCZOS)


def legacy_round(size: int) -> Image.Image:
    art = Image.open(SOURCE).convert("RGB").resize((size, size), Image.LANCZOS).convert("RGBA")
    art.putalpha(_circle_mask(size))
    return art


def adaptive_master() -> Image.Image:
    return medallion(round(MASTER * ADAPTIVE_SHARE), MASTER, glow=False)


def splash_master() -> Image.Image:
    return medallion(round(MASTER * SPLASH_SHARE), MASTER)


def build() -> dict[Path, Image.Image]:
    out: dict[Path, Image.Image] = {}
    adaptive, splash, mono = adaptive_master(), splash_master(), monochrome(MASTER)
    out[ASSETS / "adaptive-icon.png"] = adaptive
    out[ASSETS / "splash-icon.png"] = splash
    for density, px in MIPMAP_FOREGROUND.items():
        out[RES / f"mipmap-{density}/ic_launcher_foreground.webp"] = adaptive.resize((px, px), Image.LANCZOS)
        out[RES / f"mipmap-{density}/ic_launcher_monochrome.webp"] = mono.resize((px, px), Image.LANCZOS)
    for density, px in MIPMAP_LEGACY.items():
        out[RES / f"mipmap-{density}/ic_launcher.webp"] = legacy_square(px)
        out[RES / f"mipmap-{density}/ic_launcher_round.webp"] = legacy_round(px)
    for density, px in SPLASH_LOGO.items():
        out[RES / f"drawable-{density}/splashscreen_logo.png"] = splash.resize((px, px), Image.LANCZOS)
    for name in ("image.png", "image@2x.png", "image@3x.png"):
        out[IOS_SPLASH / name] = splash
    return out


def save(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # The existing launcher files are PNG data with a .webp name; Android sniffs content, so keep
    # PNG for every file and the diff stays a pure content change.
    image.save(path, format="PNG", optimize=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if a shipped file is not what this script writes")
    args = ap.parse_args(argv)
    files = build()
    stale = []
    for path, image in files.items():
        if args.check:
            have = Image.open(path).convert("RGBA") if path.exists() else None
            if have is None or have.size != image.size or ImageChops.difference(have, image).getbbox():
                stale.append(path)
        else:
            save(path, image)
    if args.check:
        for p in stale:
            print(f"stale: {p.relative_to(REPO)}")
        return 1 if stale else 0
    print(f"wrote {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
