"""pytest suite for subset_icon_fonts.py (#3843).

The jest test `frontend/src/__tests__/iconSubset.test.ts` checks the generated files against
the upstream glyph maps and the committed subset fonts' cmap (it has `node_modules`). These tests cover the parts that need neither:
reading the name lists from `iconNames.ts`, and that the committed glyph maps hold exactly
those names.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import subset_icon_fonts as sif


def test_read_names_parses_an_as_const_list():
    src = 'export const X = [\n  "a",\n  "b-c",\n] as const;\nexport const Y = ["z"] as const;\n'
    assert sif.read_names(src, "X") == ["a", "b-c"]
    assert sif.read_names(src, "Y") == ["z"]


def test_read_names_rejects_a_missing_list_or_a_duplicate():
    with pytest.raises(SystemExit):
        sif.read_names("export const X = [] as const;", "Y")
    with pytest.raises(SystemExit):
        sif.read_names('export const X = ["a", "a"] as const;', "X")


@pytest.mark.parametrize("family,const", sorted(sif.FAMILIES.items()))
def test_committed_glyph_map_matches_the_name_list(family, const):
    names = sif.read_names(sif.NAMES_TS.read_text(), const)
    committed = json.loads((sif.MAP_OUT / f"{family}.glyphmap.json").read_text())
    assert sorted(committed) == sorted(names)
    assert (sif.FONT_OUT / f"{family}.subset.ttf").is_file()


def test_committed_fonts_have_a_glyph_for_every_codepoint():
    from fontTools.ttLib import TTFont

    for family in sif.FAMILIES:
        committed = json.loads((sif.MAP_OUT / f"{family}.glyphmap.json").read_text())
        cmap = TTFont(sif.FONT_OUT / f"{family}.subset.ttf").getBestCmap()
        assert sorted(set(committed.values()) - set(cmap)) == []
