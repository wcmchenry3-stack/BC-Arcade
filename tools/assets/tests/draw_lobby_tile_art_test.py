"""
pytest suite for draw_lobby_tile_art.py (#4011, #4004, #4012): the lobby tiles' gameplay vignettes.

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
NAMES = ["sort", "yacht", "twenty48", "sudoku", "solitaire", "freecell", "daily_word"]

# The owner's budget is 3,400 B per tile (#4010). Measured 2026-11-21 at quality 82 / alpha
# quality 70 with the pinned Pillow (bytes in the comments); the budget is the hard cap, not
# measured + headroom, so a libwebp change that crosses it is a design question, not a bump.
MEASURED = {
    "sort": 3030,
    "yacht": 3198,
    "twenty48": 3052,
    "sudoku": 2578,
    "solitaire": 3348,  # #4012
    "freecell": 3238,
    "daily_word": 3100,
}


def test_the_scenes_are_the_lobby_tiles_drawn_so_far():
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
# Playing cards (#4012): the games' own card colours


def test_card_colours_are_the_games():
    ctx = _theme("ThemeContext.tsx")
    assert f'cardFace: "{_hex(art.CARD_FACE)[:4]}"' in ctx  # "#fff"
    assert f'cardInk: "{_hex(art.CARD_INK)}"' in ctx
    assert f'cardBack: "{_hex(art.CARD_BACK)}"' in ctx
    assert f'CARD_RED_SUIT = "{_hex(art.CARD_RED)}"' in _theme("theme.cards.ts")


def _mask(im: np.ndarray, rgb, tol: int = 10) -> np.ndarray:
    return (np.abs(im[..., :3].astype(int) - np.array(rgb)).max(-1) <= tol) & (im[..., 3] == 255)


def _rgb(colour) -> list[int]:
    return [round(v * 255) for v in colour[:3]]


def _cards(name: str) -> list[str]:
    if name == "solitaire":
        return [f for *_, faces in art.SOL_COLUMNS for f in faces] + [art.SOL_MOVING]
    cells = [f for f in art.FC_CELLS if f]
    return cells + [f for faces in art.FC_CASCADES.values() for f in faces] + [art.FC_MOVING]


@pytest.mark.parametrize("name", ["solitaire", "freecell"])
def test_every_card_is_a_real_card_drawn_once(name):
    cards = _cards(name)
    assert len(set(cards)) == len(cards)  # one deck
    for f in cards:
        assert f[:-1] in [str(n) for n in range(2, 10)] and f[-1] in "SHDC", f


@pytest.mark.parametrize("name", ["solitaire", "freecell"])
def test_card_scenes_show_red_and_black_suits(name):
    im = np.asarray(art.render(name))
    assert _mask(im, _rgb(art.CARD_RED)).sum() > 150
    assert _mask(im, _rgb(art.CARD_INK)).sum() > 150


def test_card_draws_its_index_in_the_suit_colour():
    for face, ink in (("7H", art.CARD_RED), ("7S", art.CARD_INK)):
        c = art.TileCanvas()
        art.card(c, 40, 40, 50, 70, face)
        im = np.asarray(c.image())
        top = im[40 : 40 + 2 * art.CARD_INDEX]  # the index strip
        assert _mask(top, _rgb(ink)).sum() > 60, face
        other = art.CARD_INK if ink is art.CARD_RED else art.CARD_RED
        assert _mask(top, _rgb(other)).sum() == 0, face


# --------------------------------------------------------------------------------------------
# Solitaire (Klondike, #4012)


def test_solitaire_runs_alternate_red_and_black_and_descend():
    for *_, faces in art.SOL_COLUMNS:
        assert len(faces) >= 2
        for a, b in itertools.pairwise(faces):
            assert art.is_red(a) != art.is_red(b), (a, b)
            assert int(a[:-1]) - int(b[:-1]) == 1, (a, b)


def test_solitaire_moving_card_is_a_legal_move_onto_a_column():
    last = [faces[-1] for *_, faces in art.SOL_COLUMNS]
    mv = art.SOL_MOVING
    assert any(art.is_red(t) != art.is_red(mv) and int(t[:-1]) - int(mv[:-1]) == 1 for t in last)


def test_solitaire_columns_sit_on_face_down_cards():
    """Klondike's tell, and what sets the tile apart from FreeCell: each column's run sits on
    face-down cards, whose teal backs show above it."""
    assert all(down >= 1 for _, _, down, _ in art.SOL_COLUMNS)
    im = np.asarray(art.render("solitaire"))
    back = _mask(im, _rgb(art.CARD_BACK))
    for x, y, down, _ in art.SOL_COLUMNS:
        strip = back[y : y + down * art.DOWN_STEP + 4, x : x + art.SOL_SIZE[0]]
        assert strip.sum() > 40 * down, (x, strip.sum())


def test_solitaire_alternates_colours_down_the_drawn_columns():
    """The rank colours down each column, read from the pixels, alternate red and black."""
    im = np.asarray(art.render("solitaire"))
    red, ink = _mask(im, _rgb(art.CARD_RED)), _mask(im, _rgb(art.CARD_INK))
    for x, y, down, faces in art.SOL_COLUMNS:
        top = y + down * art.DOWN_STEP
        seen = []
        for i in range(len(faces)):
            y0 = top + i * art.SOL_STEP
            box = (slice(y0 + 2, y0 + 2 * art.CARD_INDEX), slice(x + 2, x + art.SOL_SIZE[0] - 2))
            seen.append("r" if red[box].sum() > ink[box].sum() else "k")
        assert seen == ["r" if art.is_red(f) else "k" for f in faces]
        assert all(a != b for a, b in itertools.pairwise(seen))


# --------------------------------------------------------------------------------------------
# FreeCell (#4012): its free cells must tell it apart from Solitaire at a glance


def test_freecell_has_four_free_cells_some_holding_a_card():
    assert len(art.FC_CELLS) == 4
    assert any(art.FC_CELLS) and None in art.FC_CELLS
    assert art.FC_CELLS[art.FC_TARGET] is None  # the moving card goes into an empty cell


def test_freecell_free_cells_are_drawn_across_the_top_above_the_cascades():
    im = np.asarray(art.render("freecell"))
    w, h = art.FC_SIZE
    grey = _mask(im, [0x8A, 0x8A, 0x98], tol=4)
    white = _mask(im, _rgb(art.CARD_FACE), tol=2)
    for i, f in enumerate(art.FC_CELLS):
        x, y = art.FC_X0 + i * art.FC_PITCH, art.FC_CELLS_Y
        left_edge = grey[y + 8 : y + 24, x - 1 : x + 3]  # above any moving card
        assert left_edge.sum() > 6, i
        inside = white[y + 8 : y + 24, x + 6 : x + w - 6]
        if f is None and i != art.FC_TARGET:
            assert inside.sum() == 0, i  # an empty cell: open
        elif f is not None:
            assert inside.mean() > 0.5, i
    assert art.FC_CELLS_Y + h < art.FC_CASCADES_Y  # the row sits above the cascades


def test_freecell_empty_cells_are_dashed():
    dash = art.dashes(
        art.rounded_rect(0, 0, *art.FC_SIZE, art.CARD_R), art.FC_DASH, art.FC_DASH_GAP
    )
    perimeter = 2 * sum(art.FC_SIZE)
    assert len(dash) >= perimeter / (art.FC_DASH + art.FC_DASH_GAP) - 2
    im = np.asarray(art.render("freecell"))
    x = art.FC_X0 + 2 * art.FC_PITCH  # an empty cell that no card covers
    col = im[art.FC_CELLS_Y + 6 : art.FC_CELLS_Y + art.FC_SIZE[1] - 6, round(x + art.CARD_SNAP), 3]
    runs = np.diff((col > 128).astype(int))
    assert (runs == 1).sum() >= 3  # broken into dashes down its left side


def test_freecell_cascades_are_dealt_face_up_with_no_backs():
    im = np.asarray(art.render("freecell"))
    assert _mask(im, _rgb(art.CARD_BACK)).sum() == 0
    assert all(len(f) >= 2 for f in art.FC_CASCADES.values())


def test_freecell_moving_card_rises_into_its_cell():
    w, h = art.FC_SIZE
    x = art.FC_X0 + art.FC_TARGET * art.FC_PITCH
    assert art.FC_CELLS_Y < art.FC_MOVING_Y < art.FC_CELLS_Y + h  # overlapping the cell
    im = np.asarray(art.render("freecell"))
    red = _mask(im, _rgb(art.CARD_RED))
    y = art.FC_MOVING_Y
    assert red[y : y + 2 * art.CARD_INDEX, x : x + w].sum() > 40  # its index shows
    # Its motion marks trail below it, over no cascade.
    assert art.FC_TARGET not in art.FC_CASCADES


def test_solitaire_and_freecell_tiles_differ_at_a_glance():
    """At 64 pt (the 1x tile) the two card tiles must not look alike (owner, #4012)."""
    small = [
        np.asarray(art.render(n).resize((art.DISPLAY_PT,) * 2, Image.LANCZOS)).astype(float)
        for n in ("solitaire", "freecell")
    ]
    a0, a1 = (s[..., 3] / 255 for s in small)
    assert np.abs(a0 - a1).mean() > 0.15


# --------------------------------------------------------------------------------------------
# Daily Word (#4012): the guessing grid, language-neutral


def test_dailyword_colours_are_the_games():
    src = _theme("theme.dailyword.ts")
    assert f'DAILYWORD_CORRECT = "{_hex(art.DW_CORRECT)}"' in src
    assert f'DAILYWORD_PRESENT = "{_hex(art.DW_PRESENT)}"' in src
    assert f'DAILYWORD_ABSENT = "{_hex(art.DW_ABSENT)}"' in src


def test_dailyword_is_the_six_by_five_grid_with_hit_near_and_miss():
    assert len(art.DW_ROWS) == 6 and all(len(r) == 5 for r in art.DW_ROWS)
    marks = "".join(art.DW_ROWS)
    assert set(marks) == {"c", "p", "a", "f", "-"}
    im = np.asarray(art.render("daily_word"))
    for colour in (art.DW_CORRECT, art.DW_PRESENT, art.DW_ABSENT):
        assert _mask(im, _rgb(colour), tol=6).sum() > 300, colour
    # Scored rows come first, then the row being revealed, then the empty ones.
    scored = [r for r in art.DW_ROWS if "-" not in r]
    assert art.DW_ROWS[: len(scored)] == scored and art.DW_ROWS[-1] == "-----"


def test_dailyword_has_no_letters(monkeypatch):
    """Language-neutral (the lobby is in 13 locales): the scene draws no glyphs at all."""
    calls = []
    monkeypatch.setattr(art, "text", lambda *a, **_: calls.append(a))
    im = np.asarray(art.render("daily_word"))
    assert calls == []
    assert _mask(im, [255, 255, 255], tol=8).sum() == 0  # no white letter ink on any tile


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
