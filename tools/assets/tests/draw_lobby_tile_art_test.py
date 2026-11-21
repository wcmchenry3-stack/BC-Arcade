"""
pytest suite for draw_lobby_tile_art.py (#4011, #4004): the lobby tiles' gameplay vignettes.

Renders the real scenes (they are small), but writes only into tmp_path.
"""

import itertools
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

import draw_lobby_tile_art as art

SCRIPT = Path(art.__file__)
REPO = SCRIPT.parents[2]
SHIPPED = REPO / "frontend/assets/home"
THEME = REPO / "frontend/src/theme"
NAMES = ["sort", "yacht", "twenty48", "sudoku"]

# The owner's budget is 3,400 B per tile (#4010). Measured 2026-11-21 at quality 82 / alpha
# quality 70 with the pinned Pillow (bytes in the comments); the budget is the hard cap, not
# measured + headroom, so a libwebp change that crosses it is a design question, not a bump.
MEASURED = {"sort": 3030, "yacht": 3198, "twenty48": 3052, "sudoku": 2578}


def test_the_scenes_are_the_four_tiles_of_this_story():
    assert list(art.SCENES) == NAMES


def test_display_size_and_authoring_scale():
    assert (art.DISPLAY_PT, art.SCALE, art.TILE_PX) == (64, 3, 192)
    assert art.BUDGET_BYTES == 3400


def test_the_display_size_matches_home_screen_card_art():
    src = (REPO / "frontend/src/screens/HomeScreen.tsx").read_text(encoding="utf-8")
    m = re.search(r"cardArt:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)", src)
    assert m, "HomeScreen.tsx has no cardArt style"
    assert (int(m[1]), int(m[2])) == (art.DISPLAY_PT, art.DISPLAY_PT)


@pytest.mark.parametrize("name", NAMES)
def test_open_scene_no_frame(name):
    """Drawn straight on the tile: a transparent background and a clear margin all round, so no
    badge, frame or card fill comes with the art."""
    im = np.asarray(art.render(name))
    assert im.shape == (art.TILE_PX, art.TILE_PX, 4)
    a = im[..., 3]
    ring = np.concatenate([a[:6].ravel(), a[-6:].ravel(), a[:, :6].ravel(), a[:, -6:].ravel()])
    assert ring.max() == 0
    coverage = (a > 128).mean()
    assert 0.12 < coverage < 0.8, coverage  # a scene, not an empty or a filled tile


@pytest.mark.parametrize("name", NAMES)
def test_every_scene_carries_the_shared_grey_outline(name):
    im = np.asarray(art.render(name)).astype(int)
    grey = np.array([0x8A, 0x8A, 0x98])
    hits = (np.abs(im[..., :3] - grey).max(-1) <= 4) & (im[..., 3] == 255)
    assert hits.sum() > 150, hits.sum()


@pytest.mark.parametrize("name", NAMES)
def test_deterministic_decoded_pixels(name, tmp_path):
    assert np.array_equal(np.asarray(art.render(name)), np.asarray(art.render(name)))
    for d in ("a", "b"):
        art.main(tmp_path / d, [name])
    a, b = ((tmp_path / d / f"{name}-tile.webp").read_bytes() for d in ("a", "b"))
    assert a == b


def test_deterministic_across_processes(tmp_path):
    here = np.asarray(art.render("sort"))
    code = (
        "import sys, numpy as np; sys.path.insert(0, sys.argv[1]);"
        "import draw_lobby_tile_art as a; np.save(sys.argv[2], np.asarray(a.render('sort')))"
    )
    out = tmp_path / "other.npy"
    r = subprocess.run(
        [sys.executable, "-c", code, str(SCRIPT.parent), str(out)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert np.array_equal(here, np.load(out))


@pytest.mark.parametrize("name", NAMES)
def test_webp_stays_under_the_owner_budget(name):
    data = art.to_webp(art.render(name))
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    assert len(data) <= art.BUDGET_BYTES, f"{name}: {len(data)} B"


@pytest.mark.parametrize("name", NAMES)
def test_shipped_tile_is_the_generator_output(name):
    """The committed WebP decodes to exactly what the generator draws (no stale or hand-edited
    file), and stays inside the budget."""
    path = SHIPPED / f"{name}-tile.webp"
    want = np.asarray(art.decode_webp(art.to_webp(art.render(name))))
    got = np.asarray(Image.open(path).convert("RGBA"))
    assert np.array_equal(want, got)
    assert path.stat().st_size <= art.BUDGET_BYTES
    assert path.stat().st_size == MEASURED[name]


@pytest.mark.parametrize("name", NAMES)
def test_lossy_webp_stays_close_to_the_render(name):
    src = np.asarray(art.render(name)).astype(float)
    out = np.asarray(art.decode_webp(art.to_webp(art.render(name)))).astype(float)
    alpha_err = np.abs(src[..., 3] - out[..., 3])
    assert alpha_err.mean() <= 1.5
    solid = src[..., 3] > 250
    assert np.abs(src[..., :3] - out[..., :3])[solid].mean() <= 10


# --------------------------------------------------------------------------------------------
# The games' own colours: each constant mirrors the game's theme file


def _hex(rgba) -> str:
    return "#" + "".join(f"{round(v * 255):02x}" for v in rgba[:3])


def _theme(file: str) -> str:
    return (THEME / file).read_text(encoding="utf-8")


def test_sort_liquids_are_the_games_dark_liquids():
    src = _theme("theme.bottle.ts")
    dark = src[src.index("dark: {") : src.index("light: {")]
    for name, colour in (
        ("teal", art.SORT_TEAL),
        ("blue", art.SORT_BLUE),
        ("pink", art.SORT_PINK),
        ("indigo", art.SORT_INDIGO),
    ):
        assert f'{name}: "{_hex(colour)}"' in dark, name


def test_sort_flask_is_the_games_flask():
    src = (REPO / "frontend/src/components/sort/BottleView.tsx").read_text(encoding="utf-8")
    assert "Q 6 52 6 154" in src and "Q 50 52 38 36" in src  # the curves flask_outline() copies
    assert "export const NECK_LEFT = 18;" in src and "export const NECK_RIGHT = 38;" in src
    pts = art.flask_outline()
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    assert (min(xs), max(xs), min(ys), max(ys)) == (6, 50, 0, 166)


def test_twenty48_colours_are_the_games():
    src = _theme("theme.twenty48.ts")
    assert f'1024: {{ bg: "{_hex(art.T48_1024)}"' in src
    assert f'dark: "{_hex(art.T48_SLOT)}"' in src
    assert f'TWENTY48_TEXT_DARK = "{_hex(art.T48_TEXT)}"' in src
    assert f'TWENTY48_TOP_TILE_GLOW = "{_hex(art.T48_GLOW)}"' in src


def test_sudoku_peer_wash_is_the_games():
    assert 'peer: "rgba(143,245,255,0.11)"' in _theme("theme.sudoku.ts")
    assert art.SUDOKU_PEER == (143 / 255, 245 / 255, 1.0, 0.11)


def test_yacht_die_is_the_light_theme_die():
    src = _theme("ThemeContext.tsx")
    assert f'lightSurface: "{_hex(art.DIE_FACE)}"' in src
    assert f'text: "{_hex(art.DIE_PIP)}"' in src


# --------------------------------------------------------------------------------------------
# Sort: the owner-approved composition (#4010)


def _alpha_cols(name: str) -> np.ndarray:
    return np.asarray(art.render(name))[..., 3]


def test_sort_upright_flasks_share_one_baseline_and_the_tipped_one_is_above():
    a = _alpha_cols("sort")
    k = art.K
    # The two upright flasks: the bottom row of each column band ends on the same pixel row.
    half = 10  # inside the flask's 27-unit width
    left = a[:, int((art.SORT_LEFT_X - half) * k) : int((art.SORT_LEFT_X + half) * k)]
    mid = a[:, int((art.SORT_MID_X - half) * k) : int((art.SORT_MID_X + half) * k)]
    bottom = [int(np.nonzero(m.max(1) > 128)[0].max()) for m in (left, mid)]
    assert bottom[0] == bottom[1]
    # The tipped flask sits up and to the right: the top-right quarter has ink, above the row.
    assert a[: art.TILE_PX // 4, art.TILE_PX // 2 :].max() == 255
    assert art.SORT_TILT == 120


def test_sort_pours_pink_into_the_middle_neck():
    im = np.asarray(art.render("sort")).astype(int)
    pink = np.array([0xFF, 0x33, 0xBB])
    k = art.K
    neck_top = art.SORT_BASE - art.FLASK_FLOOR * art.FLASK_S
    x = round(art.SORT_MID_X * k)
    y = round((neck_top + 6) * k)  # just inside the middle flask's mouth
    assert np.abs(im[y, x, :3] - pink).max() <= 12 and im[y, x, 3] == 255


# --------------------------------------------------------------------------------------------
# Yacht: all five dice (owner, #4011)


def _die_faces(im: np.ndarray) -> int:
    """Counts the dice: connected regions of the die face colour, big enough to be a face (the
    rest are a few anti-aliased pixels at the rounded corners)."""
    from scipy import ndimage

    face = np.array([0xFB, 0xF4, 0xE2])
    mask = (np.abs(im[..., :3].astype(int) - face).max(-1) <= 6) & (im[..., 3] == 255)
    labels, _ = ndimage.label(mask)
    return int((np.bincount(labels.ravel())[1:] >= 200).sum())


def test_yacht_shows_all_five_dice():
    assert len(art.yacht_landed_centres()) + 1 == 5  # four landed, one tumbling
    assert _die_faces(np.asarray(art.render("yacht"))) == 5


def test_yacht_landed_dice_sit_in_one_row_on_the_pixel_grid_below_the_tumbling_one():
    centres = art.yacht_landed_centres()
    assert len({round(y, 6) for _, y in centres}) == 1  # one baseline
    xs = [x for x, _ in centres]
    pitch = (art.YACHT_DIE_PX + art.YACHT_GAP_PX) / art.K
    assert all(abs(b - a - pitch) < 1e-9 for a, b in itertools.pairwise(xs))  # even, no overlap
    for px in (art.YACHT_DIE_PX, art.YACHT_GAP_PX, art.YACHT_ROW_X_PX, art.YACHT_ROW_Y_PX):
        assert isinstance(px, int)  # whole pixels
    assert art.YACHT_TUMBLE[1] < centres[0][1] - art.YACHT_DIE_PX / art.K  # above the row


# --------------------------------------------------------------------------------------------
# Digits: Space Grotesk Bold outlines, extracted once with their licence


def test_numerals_cover_0_to_9_with_the_ofl_licence():
    doc = art.digits()
    assert sorted(doc["glyphs"]) == list("0123456789")
    assert "Open Font License" in doc["license"]
    ofl = (SCRIPT.parent / "lobby_numerals.OFL.txt").read_text(encoding="utf-8")
    assert "Space Grotesk" in ofl and "SIL OPEN FONT LICENSE" in ofl.upper()


def test_counters_are_cut_out_of_the_digits():
    """`8` has two counters: the canvas fills even-odd, so its middle stays clear."""
    c = art.TileCanvas()
    art.text(c, "8", 84, 84, 120, (1, 1, 1, 1))
    a = np.asarray(c.image())[..., 3]
    col = a[:, round(84 * art.K)]
    runs = np.diff((col > 128).astype(int))
    assert (runs == 1).sum() == 3  # ink, hole, ink, hole, ink down the middle column


# --------------------------------------------------------------------------------------------
# CLI


def _cli(*args, cwd=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args)],
        check=False,
        capture_output=True,
        text=True,
        cwd=cwd,
    )


def test_main_writes_only_the_requested_names(tmp_path, capsys):
    art.main(tmp_path, ["yacht"])
    assert [p.name for p in tmp_path.iterdir()] == ["yacht-tile.webp"]
    out = capsys.readouterr().out
    assert "yacht" in out and "total" in out


@pytest.mark.parametrize("argv", [("nope",), ("yacht", "nope"), ("--sheet", "nope")])
def test_cli_rejects_unknown_names_before_writing(tmp_path, argv):
    out = tmp_path / "out"
    r = _cli("--out", out, *argv)
    assert r.returncode != 0
    assert "nope" in r.stderr and "twenty48" in r.stderr  # lists the valid names
    assert not out.exists()


def test_cli_sheet_shows_every_tile(tmp_path):
    r = _cli("--out", tmp_path, "sudoku", "--sheet")
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "contact-sheet.png").stat().st_size > 10_000
    assert [p.name for p in sorted(tmp_path.glob("*.webp"))] == ["sudoku-tile.webp"]
