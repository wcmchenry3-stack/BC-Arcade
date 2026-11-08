"""
pytest suite for draw_starswarm_art.py (#3591).

Renders the real recipes (they are small), but writes only into tmp_path.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")
ImageFilter = pytest.importorskip("PIL.ImageFilter")

import draw_starswarm_art as art

SCRIPT = Path(art.__file__)
SHIP_NAMES = ["p1-arrow", "p2-forward-swept", "p3-twin-boom"]
PLAYER_SIZE = (34 * art.SCALE + 2 * art.PAD,) * 2  # 102 px box + padding
GRUNT_SIZE = (24 * art.SCALE + 2 * art.PAD,) * 2  # 72 px box + padding

# Byte budgets: measured 2026-11-08 (see the guide). They assume the repo's Pillow and libwebp
# (Pillow is deliberately not pinned) and carry ~25% headroom, so a different libwebp build
# should still pass; if one does not, re-measure and raise the budget rather than pin Pillow.
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


def _bbox(im):
    """(x0, y0, x1, y1) of the non-transparent pixels, x1/y1 exclusive."""
    ys, xs = np.nonzero(np.asarray(im)[..., 3])
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


@pytest.mark.parametrize("ship", SHIP_NAMES)
def test_player_layers_share_canvas_and_stay_inside_the_padded_box(ship):
    layers = {layer: art.render(f"{ship}-{layer}") for layer in art.LAYERS}
    assert {im.size for im in layers.values()} == {PLAYER_SIZE}
    for layer, im in layers.items():
        x0, y0, x1, y1 = _bbox(im)
        # content may use the padding (glows, strokes) but never touch the canvas edge
        assert x0 >= 1 and y0 >= 1, layer
        assert x1 <= PLAYER_SIZE[0] - 1 and y1 <= PLAYER_SIZE[1] - 1, layer
    # layers register on one origin: the base hull is centred on the canvas
    bx0, _, bx1, _ = _bbox(layers["base"])
    assert abs((bx0 + bx1) / 2 - PLAYER_SIZE[0] / 2) <= 2


@pytest.mark.parametrize("ship", SHIP_NAMES)
@pytest.mark.parametrize("hull", [1, 2])
@pytest.mark.parametrize("guns", [1, 2, 3])
def test_armour_outline_never_reaches_the_canvas_border(ship, hull, guns):
    cache = {n: art.render(n) for n in art.RECIPES if n.startswith(ship)}
    alpha = np.asarray(art.compose_ship(ship, guns, hull, cache))[..., 3]
    border = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    assert border.max() == 0


@pytest.mark.parametrize("ship", SHIP_NAMES)
def test_armour_outline_follows_the_hull_not_the_glows(ship):
    cache = {n: art.render(n) for n in art.RECIPES if n.startswith(ship)}
    hull = art.hull_alpha(ship, "base")
    glow_only = (np.asarray(cache[f"{ship}-base"])[..., 3] > 40) & (hull == 0)
    assert glow_only.sum() > 20  # the engine halos do extend beyond the hull
    out = np.asarray(art.compose_ship(ship, 1, 2, cache))[..., 3] > 40
    plain = np.asarray(art.compose_ship(ship, 1, 0, cache))[..., 3] > 40
    mask = np.maximum.reduce(
        [art.hull_alpha(ship, layer) for layer in art.LAYERS[:1] + art.LAYERS[3:]]
    )
    # radius 12 covers the grow (4) plus the blur (~5), with slack; halos would reach ~18
    near = Image.fromarray(((mask > 40) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(25))
    rim = out & ~plain
    assert not (rim & ~(np.asarray(near) > 0)).any()  # rim stays within the hull's dilation


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


def test_deterministic_across_processes(tmp_path):
    name = "p2-forward-swept-base"
    here = np.asarray(art.render(name))
    code = (
        "import sys, numpy as np; sys.path.insert(0, sys.argv[1]);"
        "import draw_starswarm_art as a; np.save(sys.argv[2], np.asarray(a.render(sys.argv[3])))"
    )
    out = tmp_path / "other.npy"
    r = subprocess.run(
        [sys.executable, "-c", code, str(SCRIPT.parent), str(out), name],
        check=False,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert np.array_equal(here, np.load(out))


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


def _cli(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args)],
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize(
    "argv",
    [
        ("nope",),  # a single typo is never taken as an output directory
        ("grunt-wasp", "nope"),
        ("nope", "grunt-wasp"),
        ("--sheet", "nope"),
        ("nope", "--sheet"),
    ],
)
def test_cli_rejects_unknown_names_before_writing(tmp_path, argv):
    out = tmp_path / "out"
    r = _cli("--out", out, *argv)
    assert r.returncode != 0
    assert "nope" in r.stderr and "p1-arrow-base" in r.stderr  # lists the valid names
    assert not out.exists()


def test_cli_single_typo_creates_nothing_in_the_working_directory(tmp_path):
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "grunt-wasq"],
        check=False,
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert r.returncode != 0
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("order", ["sheet-first", "sheet-middle", "sheet-last"])
def test_cli_sheet_works_in_any_position(tmp_path, order):
    names = ["grunt-wasp", "p1-arrow-base"]
    args = {
        "sheet-first": ["--sheet", *names],
        "sheet-middle": [names[0], "--sheet", names[1]],
        "sheet-last": [*names, "--sheet"],
    }[order]
    r = _cli("--out", tmp_path, *args)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "contact-sheet.png").stat().st_size > 10_000
    assert (tmp_path / "starswarm-grunt-wasp.webp").exists()
    assert (tmp_path / "starswarm-p1-arrow-base.webp").exists()


def test_cli_out_flag_is_used_and_default_is_a_temp_dir(tmp_path):
    out = tmp_path / "nested" / "dir"
    r = _cli("--out", out, "grunt-wasp")
    assert r.returncode == 0, r.stderr
    assert [p.name for p in out.iterdir()] == ["starswarm-grunt-wasp.webp"]
    r = _cli("grunt-wasp")  # no --out: a fresh temp dir, reported on stdout
    assert r.returncode == 0, r.stderr
    default = Path(r.stdout.strip().splitlines()[-1].removeprefix("output: "))
    try:
        assert (default / "starswarm-grunt-wasp.webp").exists()
        assert default.parent == Path(tempfile.gettempdir())
    finally:
        shutil.rmtree(default, ignore_errors=True)
