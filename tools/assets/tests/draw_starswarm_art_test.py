"""
pytest suite for draw_starswarm_art.py (#3591).

Renders the real recipes (they are small), but writes only into tmp_path.
"""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

import draw_starswarm_art as art

SCRIPT = Path(art.__file__)
SHIP_NAMES = ["p1-arrow", "p2-forward-swept", "p3-twin-boom"]
PLAYER_SIZE = (34 * art.SCALE + 2 * art.PAD,) * 2  # 102 px box + padding
GRUNT_SIZE = (24 * art.SCALE + 2 * art.PAD,) * 2  # 72 px box + padding

# Measured 2026-11-08: base 3.9-4.8 KB, other layers 0.9-2.4 KB, Grunt 2.7 KB. Headroom ~25%.
BUDGET_BASE = 6000
BUDGET_LAYER = 3000
BUDGET_GRUNT = 3500


def _budget(name: str) -> int:
    if name == "grunt-wasp":
        return BUDGET_GRUNT
    return BUDGET_BASE if name.endswith("-base") else BUDGET_LAYER


def test_registry_has_five_layers_per_ship_and_the_grunt():
    expected = {f"{s}-{layer}" for s in SHIP_NAMES for layer in art.LAYERS} | {"grunt-wasp"}
    assert set(art.RECIPES) == expected


@pytest.mark.parametrize("name", list(art.RECIPES))
def test_recipe_size_alpha_and_content(name):
    im = art.render(name)
    assert im.mode == "RGBA"
    assert im.size == (GRUNT_SIZE if name == "grunt-wasp" else PLAYER_SIZE)
    alpha = np.asarray(im)[..., 3]
    assert alpha.max() == 255  # something opaque is drawn
    assert alpha[0, 0] == 0  # corners stay transparent (padding)
    assert (alpha[1:-1, 1:-1] > 0).sum() > 20


def test_player_layers_share_dimensions():
    for ship in SHIP_NAMES:
        sizes = {art.render(f"{ship}-{layer}").size for layer in art.LAYERS}
        assert len(sizes) == 1


@pytest.mark.parametrize("name", ["p2-forward-swept-base", "grunt-wasp", "p3-twin-boom-plating2"])
def test_deterministic_decoded_pixels(name, tmp_path):
    a = np.asarray(art.render(name))
    b = np.asarray(art.render(name))
    assert np.array_equal(a, b)
    (tmp_path / "a").mkdir()
    for d in ("a", "b"):
        (tmp_path / d).mkdir(exist_ok=True)
        art.main(tmp_path / d, [name])
    pa = np.asarray(Image.open(tmp_path / "a" / f"starswarm-{name}.webp").convert("RGBA"))
    pb = np.asarray(Image.open(tmp_path / "b" / f"starswarm-{name}.webp").convert("RGBA"))
    assert np.array_equal(pa, pb)


@pytest.mark.parametrize("name", list(art.RECIPES))
def test_webp_stays_under_byte_budget(name):
    data = art.to_webp(art.render(name))
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    assert len(data) <= _budget(name), f"{name}: {len(data)} B"


def test_hull_layers_stack_and_armour_outline_grows_the_silhouette():
    cache = {n: art.render(n) for n in art.RECIPES if n.startswith("p1-arrow")}
    plain = art.compose_ship("p1-arrow", 3, 0, cache)
    thin = art.compose_ship("p1-arrow", 3, 1, cache)
    bold = art.compose_ship("p1-arrow", 3, 2, cache)
    area = [int((np.asarray(i)[..., 3] > 10).sum()) for i in (plain, thin, bold)]
    assert area[0] < area[1] < area[2]


def test_main_writes_only_the_requested_names(tmp_path, capsys):
    art.main(tmp_path, ["grunt-wasp"])
    assert [p.name for p in tmp_path.iterdir()] == ["starswarm-grunt-wasp.webp"]
    assert "grunt-wasp" in capsys.readouterr().out


def test_cli_rejects_unknown_names_before_writing(tmp_path):
    out = tmp_path / "out"
    r = subprocess.run(
        [sys.executable, str(SCRIPT), str(out), "grunt-wasp", "nope"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert r.returncode != 0
    assert "nope" in r.stderr and "p1-arrow-base" in r.stderr  # lists the valid names
    assert not out.exists()


def test_cli_sheet_writes_a_contact_sheet(tmp_path):
    r = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "grunt-wasp", "--sheet"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "contact-sheet.png").stat().st_size > 10_000
