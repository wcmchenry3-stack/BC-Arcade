"""
pytest suite for draw_lobby_tile_art.py (#4011, #4004, #4012): the lobby tiles' gameplay vignettes.

Renders the real scenes (they are small), but writes only into tmp_path.
"""

import itertools
import json
import re
import string
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
NAMES += ["blackjack", "hearts", "mahjong", "starswarm", "cascade"]  # #4013, hidden games

# The owner's budget is 3,400 B per tile (#4010). Measured 2026-11-21 at quality 82 / alpha
# quality 70 with the pinned Pillow (bytes in the comments); the budget is the hard cap, not
# measured + headroom, so a libwebp change that crosses it is a design question, not a bump.
MEASURED = {
    "sort": 3030,
    "yacht": 3198,
    "twenty48": 3052,
    "sudoku": 2578,
    "solitaire": 2916,  # #4012, the owner's round-2 picks
    "freecell": 3276,
    "daily_word": 3352,
    "blackjack": 2738,  # #4013, the owner's picks (hidden games)
    "hearts": 3096,
    "mahjong": 2930,
    "starswarm": 3202,
    "cascade": 2954,
}
# The least ink a scene may have (`test_open_scene_no_frame`): Star Swarm's swarm is a few small
# sprites on open space, not a filled object.
MIN_COVERAGE = {"starswarm": 0.03}


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
    assert MIN_COVERAGE.get(name, 0.12) < coverage < 0.8, coverage  # not empty, not filled


@pytest.mark.parametrize("name", [n for n in NAMES if n not in art.OUTLINE_EXEMPT])
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


RANKS = ["A", *[str(n) for n in range(2, 11)], "J", "Q", "K"]


def _value(face: str) -> int:
    return RANKS.index(face[:-1]) + 1


def _cards(name: str) -> list[str]:
    if name == "solitaire":
        return [*art.SOL_WASTE, *art.SOL_COLUMN, art.SOL_MOVING]
    return [f for faces in art.FC_CASCADES for f in faces]


@pytest.mark.parametrize("name", ["solitaire", "freecell"])
def test_every_card_is_a_real_card_drawn_once(name):
    cards = _cards(name)
    assert len(set(cards)) == len(cards)  # one deck
    for f in cards:
        assert f[:-1] in RANKS and f[-1] in "SHDC", f


@pytest.mark.parametrize("name", ["solitaire", "freecell"])
def test_card_scenes_show_red_and_black_suits(name):
    im = np.asarray(art.render(name))
    assert _mask(im, _rgb(art.CARD_RED)).sum() > 150
    assert _mask(im, _rgb(art.CARD_INK)).sum() > 150


def test_card_draws_its_index_in_the_suit_colour():
    for face, ink in (("7H", art.CARD_RED), ("7S", art.CARD_INK), ("10D", art.CARD_RED)):
        c = art.TileCanvas()
        art.card(c, 40, 40, 50, 70, face)
        im = np.asarray(c.image())
        top = im[40 : 40 + 2 * art.CARD_INDEX]  # the index strip
        assert _mask(top, _rgb(ink)).sum() > 60, face
        other = art.CARD_INK if ink is art.CARD_RED else art.CARD_RED
        assert _mask(top, _rgb(other)).sum() == 0, face


@pytest.mark.parametrize("face", ["AH", "10S", "JC", "QD", "KS"])
def test_card_draws_every_real_rank(face):
    art.card(art.TileCanvas(), 40, 40, 50, 70, face)


@pytest.mark.parametrize(
    ("face", "message"),
    [
        ("1H", "rank must be one of"),
        ("11S", "rank must be one of"),
        ("ZD", "rank must be one of"),
        ("7X", "suit must be one of"),
        ("7", "rank must be one of"),
    ],
)
def test_card_rejects_faces_it_cannot_draw(face, message):
    with pytest.raises(ValueError, match=message):
        art.card(art.TileCanvas(), 40, 40, 50, 70, face)


def test_pip_card_rejects_unknown_suits():
    with pytest.raises(ValueError, match="suit must be one of"):
        art.pip_card(art.TileCanvas(), 40, 40, 19, 30, "7X")


# --------------------------------------------------------------------------------------------
# Solitaire (Klondike; the owner's pick B, #4012): stock, waste, a card moving off the waste


def test_solitaire_column_alternates_and_descends_over_a_face_down_card():
    assert art.SOL_COLUMN_DOWN >= 1
    for a, b in itertools.pairwise(art.SOL_COLUMN):
        assert art.is_red(a) != art.is_red(b), (a, b)
        assert _value(a) - _value(b) == 1, (a, b)


def test_solitaire_moving_card_is_the_wastes_and_a_legal_move_onto_the_column():
    """The 7S came off the waste (Klondike's draw pile) and goes onto the 8H at the column's foot:
    black on red, one rank down. It is drawn between the two: right of the column, below the
    waste, lower than the waste's top and higher than where it lands."""
    mv, target = art.SOL_MOVING, art.SOL_COLUMN[-1]
    assert art.is_red(mv) != art.is_red(target) and _value(target) - _value(mv) == 1
    w, _ = art.SOL_SIZE
    mx, my = art.SOL_MOVING_AT
    cx, cy = art.SOL_COLUMN_AT
    landing = cy + art.SOL_COLUMN_DOWN * art.DOWN_STEP + len(art.SOL_COLUMN) * art.SOL_STEP
    wx, wy = art.SOL_WASTE_AT
    assert cx < mx < cx + w  # overlapping the column, offset to its right
    assert wy < my < landing
    assert mx >= wx + (len(art.SOL_WASTE) - 1) * art.SOL_WASTE_FAN  # past the waste's fan


def test_solitaire_shows_the_stock_face_down():
    """Klondike's tell, and what sets the tile apart from FreeCell: the stock's teal backs, and
    the face-down card under the column's run."""
    im = np.asarray(art.render("solitaire"))
    back = _mask(im, _rgb(art.CARD_BACK))
    sx, sy = art.SOL_STOCK_AT
    w, h = art.SOL_SIZE
    assert back[sy : sy + h, sx : sx + w].mean() > 0.5  # the stock's top card
    cx, cy = art.SOL_COLUMN_AT
    assert back[cy : cy + art.DOWN_STEP, cx : cx + w].sum() > 40  # under the run


def test_solitaire_waste_is_fanned_face_up_beside_the_stock():
    w, _ = art.SOL_SIZE
    assert art.SOL_WASTE_AT[0] > art.SOL_STOCK_AT[0] + w  # its own pile
    assert 0 < art.SOL_WASTE_FAN < w  # overlapping, each index showing
    im = np.asarray(art.render("solitaire"))
    wx, wy = art.SOL_WASTE_AT
    strip = (slice(wy + 2, wy + 2 * art.CARD_INDEX), slice(wx + 2, wx + art.SOL_WASTE_FAN))
    ink = _rgb(art.CARD_RED if art.is_red(art.SOL_WASTE[0]) else art.CARD_INK)
    assert _mask(im, ink)[strip].sum() > 20  # the first waste card's rank shows under the fan


# --------------------------------------------------------------------------------------------
# FreeCell (the owner's pick B, #4012): the deal, eight cascades all face up


def test_freecell_deals_eight_cascades_of_uneven_length():
    assert len(art.FC_CASCADES) == 8
    lengths = [len(f) for f in art.FC_CASCADES]
    assert min(lengths) >= 2 and len(set(lengths)) > 1


def test_freecell_cards_are_all_face_up_with_no_backs():
    im = np.asarray(art.render("freecell"))
    assert _mask(im, _rgb(art.CARD_BACK)).sum() == 0


def test_freecell_draws_eight_columns_side_by_side():
    """Eight separate columns of cards across the tile: eight white card faces, each edged in
    the outline grey, along a row through the first cards."""
    im = np.asarray(art.render("freecell"))
    y = art.FC_TOP + art.FC_SIZE[1] - 6
    white = _mask(im, _rgb(art.CARD_FACE), tol=2)[y].astype(int)
    assert (np.diff(white) == 1).sum() == 8


def test_freecell_each_card_shows_its_suit_colour():
    im = np.asarray(art.render("freecell"))
    red, ink = _mask(im, _rgb(art.CARD_RED)), _mask(im, _rgb(art.CARD_INK))
    w, _ = art.FC_SIZE
    x0 = (art.TILE_PX - (8 * art.FC_PITCH - (art.FC_PITCH - w))) // 2
    for i, faces in enumerate(art.FC_CASCADES):
        for j, f in enumerate(faces):
            x, y = x0 + i * art.FC_PITCH, art.FC_TOP + j * art.FC_STEP
            box = (slice(y + 2, y + 2 * art.FC_PIP_Y - 1), slice(x + 2, x + w - 2))
            want, other = (red, ink) if art.is_red(f) else (ink, red)
            assert want[box].sum() > 5 and other[box].sum() == 0, f


def test_solitaire_and_freecell_tiles_differ_at_a_glance():
    """At 64 pt (the 1x tile) the two card tiles must not look alike (owner, #4012)."""
    small = [
        np.asarray(art.render(n).resize((art.DISPLAY_PT,) * 2, Image.LANCZOS)).astype(float)
        for n in ("solitaire", "freecell")
    ]
    a0, a1 = (s[..., 3] / 255 for s in small)
    assert np.abs(a0 - a1).mean() > 0.15


# --------------------------------------------------------------------------------------------
# Daily Word (the owner's pick A, #4012): real guesses, scored as the game scores them


def test_dailyword_colours_are_the_games():
    src = _theme("theme.dailyword.ts")
    assert f'DAILYWORD_CORRECT = "{_hex(art.DW_CORRECT)}"' in src
    assert f'DAILYWORD_PRESENT = "{_hex(art.DW_PRESENT)}"' in src
    assert f'DAILYWORD_ABSENT = "{_hex(art.DW_ABSENT)}"' in src
    assert f'DAILYWORD_LETTER_TEXT = "{_hex(art.DW_LETTER)}"' in src


@pytest.mark.parametrize(
    ("guess", "answer", "marks"),
    [
        ("PIANO", "FINAL", "acppa"),
        ("FOCAL", "FINAL", "caacc"),
        ("FINAL", "FINAL", "ccccc"),
        ("CANAL", "FINAL", "aaccc"),  # the second A is green, so the first one is grey
        ("LLAMA", "FINAL", "papaa"),  # one L and one A left over: only the first of each is yellow
    ],
)
def test_dailyword_scores_like_the_game(guess, answer, marks):
    assert art.score(guess, answer) == marks


def test_dailyword_words_are_answers_in_every_language_the_game_plays():
    words = REPO / "backend/daily_word/words"
    for lang in ("en", "es", "fr"):
        answers = set((words / f"answers_{lang}.txt").read_text(encoding="utf-8").split())
        for w in [*art.DW_GUESSES, art.DW_ANSWER]:
            assert w.lower() in answers, (lang, w)


def test_dailyword_guesses_end_solved_and_use_hit_near_and_miss():
    assert art.DW_GUESSES[-1] == art.DW_ANSWER
    marks = "".join(art.score(g, art.DW_ANSWER) for g in art.DW_GUESSES[:-1])
    assert set(marks) == {"c", "p", "a"}
    im = np.asarray(art.render("daily_word"))
    for colour in (art.DW_CORRECT, art.DW_PRESENT, art.DW_ABSENT):
        assert _mask(im, _rgb(colour), tol=6).sum() > 300, colour


def test_dailyword_draws_every_letter_in_white(monkeypatch):
    drawn = []
    real = art.text
    monkeypatch.setattr(art, "text", lambda c, s, *a: (drawn.append(s), real(c, s, *a)))
    im = np.asarray(art.render("daily_word"))
    assert "".join(drawn) == "".join(art.DW_GUESSES)
    assert _mask(im, _rgb(art.DW_LETTER), tol=8).sum() > 600


# --------------------------------------------------------------------------------------------
# Batch 3 (#4013): the hidden premium games, the owner's picks


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("blackjack", "hearts"),
        ("blackjack", "solitaire"),
        ("blackjack", "freecell"),
        ("hearts", "solitaire"),
        ("hearts", "freecell"),
    ],
)
def test_the_card_game_tiles_differ_at_a_glance(a, b):
    """At 64 pt (the 1x tile) the four card games' tiles must not look alike (#4013 AC)."""
    small = [
        np.asarray(art.render(n).resize((art.DISPLAY_PT,) * 2, Image.LANCZOS)).astype(float)
        for n in (a, b)
    ]
    diff = np.abs(small[0] - small[1])
    assert diff[..., 3].mean() / 255 > 0.15 or diff[..., :3].mean() > 30


# Blackjack (pick A): a natural


@pytest.mark.parametrize(
    ("hand", "total"),
    [(["AS", "KH"], 21), (["AS", "AD", "9C"], 21), (["AS", "KH", "5C"], 16), (["7D", "9S"], 16)],
)
def test_blackjack_counts_a_hand_as_the_game_does(hand, total):
    assert art.blackjack_total(hand) == total


def test_blackjack_hand_is_a_natural_and_the_pill_says_21(monkeypatch):
    cards = [f for f, _ in art.BJ_HAND]
    assert cards == ["AS", "KH"] and art.blackjack_total(cards) == 21
    assert {f[:-1] for f in cards} == {"A", "K"}  # an ace and a ten: a natural
    drawn = []
    real = art.text
    monkeypatch.setattr(art, "text", lambda c, s, *a: (drawn.append(s), real(c, s, *a)))
    im = np.asarray(art.render("blackjack"))
    assert drawn == ["A", "K", "21"]
    cx, cy, w, h = art.BJ_PILL
    box = im[cy - h // 2 + 3 : cy + h // 2 - 3, cx - w // 2 + 3 : cx + w // 2 - 3]
    assert _mask(box, _rgb(art.BJ_WIN), tol=6).mean() > 0.3  # the win colour


def test_blackjack_colours_are_the_games():
    ctx = _theme("ThemeContext.tsx")
    assert f'accentDark: "{_hex(art.BJ_ACCENT)}"' in ctx
    assert f'darkSurface: "{_hex(art.BJ_RIM)}"' in ctx
    assert f'bonusDark: "{_hex(art.BJ_WIN)}"' in ctx
    assert f'textOnAccent: "{_hex(art.BJ_ON)}"' in ctx
    im = np.asarray(art.render("blackjack"))
    assert _mask(im, _rgb(art.BJ_ACCENT), tol=6).sum() > 50  # the chips' faces


# Hearts (pick C): hearts broken


def test_hearts_heart_and_crack_are_the_games():
    src = (REPO / "frontend/src/components/hearts/HeartsBrokenAnimation.tsx").read_text("utf-8")
    first = art.HEART_CUBICS[0][0]
    path = f"M {first[0]} {first[1]} " + " ".join(
        "C " + " ".join(f"{x} {y}" for x, y in seg[1:]) for seg in art.HEART_CUBICS
    )
    assert f'"{path} Z"' in src
    crack = " ".join(f"L{x} {y}" for x, y in art.HEART_CRACK[1:])
    assert f'CRACK_POINTS = "{crack}"' in src
    assert f"M{art.HEART_CRACK[0][0]} {art.HEART_CRACK[0][1]} " in src
    assert f'HEARTS_BROKEN_HEART = "{_hex(art.HEARTS_BROKEN)}"' in _theme("theme.hearts.ts")


def test_hearts_a_heart_is_played_and_the_heart_breaks_in_two():
    assert art.HEARTS_PLAYED == "AH"  # a heart on the trick is what breaks hearts
    im = np.asarray(art.render("hearts"))
    red = _mask(im, _rgb(art.HEARTS_BROKEN), tol=6)
    cy = art.HEARTS_CENTRE[1]
    runs = np.diff(red[cy].astype(int))
    assert (runs == 1).sum() == 2  # two halves across the middle, a gap between them
    x, y = art.HEARTS_CARD_AT
    assert _mask(im[y : y + 24, x : x + 44], _rgb(art.CARD_RED)).sum() > 20  # the A-hearts index


# Mahjong (pick A): the free pair, by the game's rule


def test_mahjong_free_rule_is_the_games():
    src = (REPO / "frontend/src/game/mahjong/engine.ts").read_text("utf-8")
    assert "t.layer > tile.layer && t.col === tile.col && t.row === tile.row" in src
    assert "t.col === tile.col - 2" in src and "t.col === tile.col + 2" in src
    slots = [(1, 0, 0), (3, 0, 0), (5, 0, 0), (3, 0, 1)]
    assert not art.is_free((3, 0, 0), slots)  # covered
    assert not art.is_free((3, 0, 1), [*slots, (1, 0, 1), (5, 0, 1)])  # both sides blocked
    assert art.is_free((5, 0, 0), slots) and art.is_free((1, 0, 0), slots)


def test_mahjong_selected_pair_matches_and_is_free_on_the_drawn_layers():
    slots = [(c, r, l) for c, r, l, _ in art.MJ_SLOTS]
    faces = {(c, r, l): k for c, r, l, k in art.MJ_SLOTS}
    a, b = art.MJ_SELECTED
    assert faces[a] == faces[b] and a != b  # a matching pair
    assert art.is_free(a, slots) and art.is_free(b, slots)
    assert len({l for _, _, l in slots}) == 2  # two layers
    assert not art.is_free((2, 0, 0), slots)  # the middle bottom tile is blocked both sides


def test_mahjong_draws_the_selected_pair_gold():
    im = np.asarray(art.render("mahjong"))
    w = art.MJ_TILE[0]
    for col, _, layer in art.MJ_SELECTED:
        x, y = (round(v) for v in art.mj_slot_xy(col, layer))
        edge = im[y + 10 : y + 40, x + w - 2 : x + w + 2]  # the face's right border
        assert _mask(edge, _rgb(art.MJ_SEL), tol=30).sum() > 30, (col, layer)


def test_mahjong_colours_are_the_games():
    src = _theme("theme.mahjong.ts")
    for name, colour in (
        ("MAHJONG_TILE_FACE", art.MJ_FACE),
        ("MAHJONG_TILE_FACE_SELECTED", art.MJ_FACE_SEL),
        ("MAHJONG_BORDER_NORMAL", art.MJ_BORDER),
        ("MAHJONG_BORDER_SELECTED", art.MJ_SEL),
        ("MAHJONG_SIDE_R", art.MJ_SIDE_R),
        ("MAHJONG_SIDE_B", art.MJ_SIDE_B),
        ("MAHJONG_SIDE_IVORY", art.MJ_SIDE_IV),
    ):
        assert f'{name} = "{_hex(colour)}"' in src, name
    gen = (SCRIPT.parent / "gen_mahjong_tiles.py").read_text("utf-8")
    for colour in (art.MJ_BLUE, art.MJ_GREEN, art.MJ_RED, art.MJ_IVORY, art.MJ_DARK_GREEN):
        assert _hex(colour) in gen
    assert (SCRIPT.parent / "mahjong_glyphs.OFL.txt").exists()  # 中 is Yuji Syuku, OFL


# Star Swarm (pick B): the swarm dives, drawn from the shipped sprites


def test_starswarm_is_drawn_from_the_shipped_sprites(monkeypatch):
    red = Image.new("RGBA", (72, 72), (255, 0, 0, 255))
    blue = Image.new("RGBA", (90, 90), (0, 0, 255, 255))
    monkeypatch.setattr(art.starswarm, "grunt_wasp", lambda: red)
    monkeypatch.setattr(art.starswarm, "compose_ship", lambda *_args: blue)
    im = np.asarray(art.render("starswarm"))
    for x, y in art.SS_GRUNTS:
        assert tuple(im[y, x]) == (255, 0, 0, 255)
    sx, sy = art.SS_SHIP_AT
    assert tuple(im[sy, sx]) == (0, 0, 255, 255)


def test_starswarm_grunts_dive_in_a_v_on_the_ship():
    (lx, ly), (rx, ry), (mx, my) = art.SS_GRUNTS
    assert ly == ry and my > ly and lx < mx < rx  # a V pointing down
    assert art.SS_SHIP_AT[1] > max(y for _, y in art.SS_GRUNTS) + art.SS_GRUNT_PX
    assert art.SS_SHIP[0] == "p1-arrow" and art.SS_SHIP[0] in art.starswarm.SHIPS


def test_only_the_sprite_scene_skips_the_shared_outline():
    """Star Swarm's sprites carry their own rims and armour outline, as the game draws them."""
    assert {"starswarm"} == art.OUTLINE_EXEMPT


# Cascade (pick A): the drop


def test_cascade_drops_a_smaller_piece_onto_a_bigger_one():
    assert art.CA_TIER["cherry"] < art.CA_TIER["melon"]
    (cx, cy, cr), (mx, my, mr) = art.CA_CHERRY, art.CA_MELON
    assert cx == mx and cy + cr < my - mr  # straight above it
    (gx0, gy0), (gx1, gy1) = art.CA_GUIDE
    assert gx0 == gx1 == cx and cy + cr < gy0 < gy1 < my - mr  # the guide between them


def test_cascade_melon_rests_on_the_bin_floor_between_the_walls():
    x0, x1, top, floor = art.CA_BIN
    mx, my, mr = art.CA_MELON
    inner_floor = floor - art.CA_BAND / 2
    assert 0 <= inner_floor - (my + mr) <= 4
    assert x0 + art.CA_BAND / 2 < mx - mr and mx + mr < x1 - art.CA_BAND / 2
    cx, cy, cr = art.CA_CHERRY
    assert top < cy and x0 < cx - cr and cx + cr < x1  # falling inside the bin


def test_cascade_colours_are_the_games():
    src = _theme("theme.cascade.ts")
    for kind, theme_key in (("cherry", "cherry"), ("melon", "melon")):
        b, l, d, o, _ = art.CA_FRUIT[kind]
        assert f'{theme_key}: {{ b: "{b}", l: "{l}", d: "{d}", o: "{o}" }}' in src, kind
    inks = re.search(r"ink: \[(.*?)\]", src, re.DOTALL)[1]
    ink = re.findall(r'"(#[0-9a-f]{6})"', inks)
    assert ink[art.CA_TIER["cherry"]] == art.CA_FRUIT["cherry"][4]
    assert ink[art.CA_TIER["melon"]] == art.CA_FRUIT["melon"][4]
    assert f'accent: "{_hex(art.CA_ACCENT)}"' in src
    assert f'blushOpen: "{_hex(art.CA_BLUSH)}"' in src


# --------------------------------------------------------------------------------------------
# Digits and letters: Space Grotesk Bold outlines, extracted once with their licence


def test_numerals_cover_0_to_9_with_the_ofl_licence():
    doc = art.digits()
    assert sorted(doc["glyphs"]) == list("0123456789")
    assert "Open Font License" in doc["license"]
    ofl = (SCRIPT.parent / "lobby_numerals.OFL.txt").read_text(encoding="utf-8")
    assert "Space Grotesk" in ofl and "SIL OPEN FONT LICENSE" in ofl.upper()


def test_letters_cover_a_to_z_in_the_same_font():
    letters = json.loads(art.LETTERS_FILE.read_text(encoding="utf-8"))
    assert sorted(letters["glyphs"]) == list(string.ascii_uppercase)
    assert letters["font"] == art.digits()["font"] and "Open Font License" in letters["license"]
    assert letters["capHeight"] == art.digits()["capHeight"]
    assert set(art.glyphs()["glyphs"]) == set("0123456789" + string.ascii_uppercase)


def test_extract_reproduces_the_shipped_outlines(tmp_path, monkeypatch):
    """`extract` rewrites both outline files byte for byte from the font (needs fontTools and
    the font from `npm ci`; skipped without them)."""
    pytest.importorskip("fontTools")
    font = (
        REPO
        / "frontend/node_modules/@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf"
    )
    if not font.exists():
        pytest.skip("Space Grotesk not installed (cd frontend && npm ci)")
    digits, letters = tmp_path / "n.json", tmp_path / "g.json"
    monkeypatch.setattr(art, "DIGITS_FILE", digits)
    monkeypatch.setattr(art, "LETTERS_FILE", letters)
    art.extract(font)
    assert digits.read_bytes() == (SCRIPT.parent / "lobby_numerals.json").read_bytes()
    assert letters.read_bytes() == (SCRIPT.parent / "lobby_glyphs.json").read_bytes()


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
