"""pytest suite for gen_mahjong_tiles.py (#3611): our own code-drawn Mahjong tile faces."""

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import gen_mahjong_tiles as g

SHIPPED = g.OUT_DEFAULT
NAMES = sorted(g.FACES)


def test_there_are_42_faces_under_the_names_the_app_loads():
    assert len(NAMES) == 42
    assert NAMES[0] == "01-white-dragon" and NAMES[-1] == "42-bamboo"
    tile_assets = (SHIPPED.parents[1] / "src/components/mahjong/tileAssets.ts").read_text()
    required = re.findall(r"assets/mahjong/([\w-]+)\.svg", tile_assets)
    assert required == NAMES


def test_every_face_is_valid_svg_with_the_300_by_420_art_box(tmp_path):
    g.build(tmp_path)
    for name in NAMES:
        root = ET.fromstring((tmp_path / f"{name}.svg").read_text())
        assert root.tag == "{http://www.w3.org/2000/svg}svg", name
        assert root.get("viewBox") == "0 0 300 420", name
        assert len(root) > 0, name


def test_the_build_is_deterministic(tmp_path):
    g.build(tmp_path / "a")
    g.build(tmp_path / "b")
    for name in NAMES:
        assert (tmp_path / "a" / f"{name}.svg").read_bytes() == (
            tmp_path / "b" / f"{name}.svg"
        ).read_bytes()


def test_the_shipped_faces_are_exactly_the_generator_output(tmp_path):
    g.build(tmp_path)
    for name in NAMES:
        assert (tmp_path / f"{name}.svg").read_bytes() == (
            SHIPPED / f"{name}.svg"
        ).read_bytes(), name


def test_the_set_is_smaller_than_the_third_party_set_it_replaced():
    total = sum((SHIPPED / f"{name}.svg").stat().st_size for name in NAMES)
    assert total <= 200_000  # the replaced set was 226,819 B


def test_the_glyph_cache_holds_every_character_and_names_its_licence():
    doc = json.loads(g.GLYPHS_FILE.read_text())
    assert doc["license"] == "SIL Open Font License 1.1"
    assert set(doc["glyphs"]) == set(g.CHARS)
    assert (
        (g.HERE / "mahjong_glyphs.OFL.txt")
        .read_text()
        .startswith("Copyright 2021 The Yuji Project Authors")
    )


def test_the_reshaping_moves_the_points_it_should():
    b = [0, 0, 1000, 1000]
    tail = g.warp_for("中", b)
    assert tail(500, 100)[1] < 100  # the tail below the box is stretched downward
    assert tail(500, 900) == (500, 900)  # the box itself is untouched
    flare = g.warp_for("東", b)
    assert abs(flare(900, 0)[0] - 500) > abs(900 - 500)  # the base flares out
    assert g.warp_for("一", b)(123, 456) == (123, 456)  # other characters keep their shape
