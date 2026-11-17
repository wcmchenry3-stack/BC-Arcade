"""pytest suite for gen_app_icons.py (#3935): splash and Android launcher art from the mascot."""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gen_app_icons as g


def test_shipped_files_match_the_generator():
    # Fails when the mascot, the ring recipe or a file changed without re-running the script.
    assert g.main(["--check"]) == 0


def test_adaptive_art_stays_inside_the_android_safe_zone():
    # Android crops the foreground to the central 66 %; glow included, no pixel may leave it.
    art = g.adaptive_master()
    margin = round(g.MASTER * (1 - 0.66) / 2)
    assert art.getchannel("A").getbbox() is not None
    left, top, right, bottom = art.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    assert left >= margin and top >= margin
    assert right <= g.MASTER - margin and bottom <= g.MASTER - margin


def test_splash_and_foreground_are_transparent_so_app_json_background_shows():
    for art in (g.adaptive_master(), g.splash_master()):
        assert art.getpixel((0, 0))[3] == 0


def test_sizes_match_the_android_densities():
    for density, px in g.MIPMAP_FOREGROUND.items():
        assert Image.open(g.RES / f"mipmap-{density}/ic_launcher_foreground.webp").size == (px, px)
    for density, px in g.MIPMAP_LEGACY.items():
        assert Image.open(g.RES / f"mipmap-{density}/ic_launcher_round.webp").size == (px, px)
