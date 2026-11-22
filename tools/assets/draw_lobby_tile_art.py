"""Deterministic lobby tile art: a gameplay vignette per game (#4011-#4013; style decided in #4010).

Each lobby tile shows a small drawn scene of the game being played, drawn straight on the tile:
transparent background, no badge or frame, and a mid-grey outline (`OUTLINE`) so it reads on the
dark card (`surfaceHigh` #25252c) and on the light one (#fff8e8). No emoji. The colours are the
games' own (`frontend/src/theme/theme.*.ts`; the Yacht dice and the playing cards in
`ThemeContext.tsx`).

    sort       two flasks in a row; a third, lifted and tipped, pours pink into the middle one
    yacht      all five dice: four landed on fives in a row, the fifth tumbling in
    twenty48   two 1024 tiles sliding together on a slice of the board, toward 2048
    sudoku     one 3x3 box: given digits, and a digit just placed in the selected cell
    solitaire  the stock, the waste fanned, and the waste's seven of spades on its way onto the
               eight of hearts at the foot of a tableau column
    freecell   the deal: eight cascades of uneven length, every card face up
    daily_word three guesses at FINAL, scored: PIANO, FOCAL, then FINAL solved (all three words
               are answers in the English, Spanish and French lists)

The hidden premium games (#4013; their tiles never reach a store bundle, see HIDDEN_GAMES):

    blackjack  a natural: A-spades and K-hearts, the green 21 pill, the bet's chips
    hearts     hearts broken: the game's broken heart cracked in two over the A-hearts just played
    mahjong    a corner of the board on two layers, the free pair of 3-coins selected in gold
    starswarm  the swarm dives: three Wasp Grunts in a V on the Arrow, the game's own sprites
    cascade    the drop: a cherry falling on its guide line into the bin, onto the watermelon

Usage:
    python tools/assets/draw_lobby_tile_art.py [--out DIR] [--sheet] [name ...]
    python tools/assets/draw_lobby_tile_art.py extract FONT.ttf   # refresh lobby_numerals.json and lobby_glyphs.json

    --out DIR  where to write `<name>-tile.webp` (default: a new temporary directory, printed at
               the end). The shipped files are `frontend/assets/home/<name>-tile.webp`: copy them
               there unchanged.
    name       scenes to draw (default: all). Unknown names exit non-zero before anything is written.
    --sheet    also write `contact-sheet.png`: every tile at 3x, then at the 64 pt display size on
               the dark and the light lobby card (built from the decoded WebPs: the shipped look).

The art is authored in a 168-unit box (the approved Sort composition's box) and drawn at
`TILE_PX` = 192 px, 3x the 64 pt display size (`cardArt` in `HomeScreen.tsx`). Each WebP's byte
size is printed; `BUDGET_BYTES` per tile is the owner's budget.

The digits and letters (2048 tiles, Sudoku, the card ranks, the Daily Word guesses) are Space
Grotesk Bold outlines, the face the games draw their numbers and the BC decks their indices in
(SIL Open Font License 1.1, see `lobby_numerals.OFL.txt`). They are extracted once, 0-9 into
`lobby_numerals.json` and A-Z into `lobby_glyphs.json`, so drawing needs neither the font nor
fontTools. `extract` takes
`frontend/node_modules/@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf` (after
`cd frontend && npm ci`) and needs fontTools. The Mahjong tile's red dragon is drawn from
`mahjong_glyphs.json` (Yuji Syuku, SIL OFL 1.1, `mahjong_glyphs.OFL.txt`), as the game's faces are.

The pipeline is `draw_starswarm_art.py`'s: shapes rasterized at 8x, LANCZOS down, composited over
premultiplied float RGBA, and the same WebP settings. The same code gives identical pixels.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import string
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

import draw_starswarm_art as starswarm  # the shipped sprites, looked up at call time
from draw_starswarm_art import (
    RGBA,
    SS,
    Canvas,
    Point,
    Radial,
    decode_webp,
    ellipse_pts,
    hexrgb,
    to_webp,
    xf,
)

# --------------------------------------------------------------------------------------------
# Constants

HERE = Path(__file__).resolve().parent
DIGITS_FILE = HERE / "lobby_numerals.json"
LETTERS_FILE = HERE / "lobby_glyphs.json"  # A-Z, the same font (#4012: Daily Word, card ranks)
FONT_NAME = "Space Grotesk Bold (@expo-google-fonts/space-grotesk 0.4.1, SpaceGrotesk_700Bold.ttf)"

DISPLAY_PT = 64  # HomeScreen's `cardArt`, inside the 68 pt TILE_ICON_ZONE (#4005)
SCALE = 3  # authored at 3x the display size
TILE_PX = DISPLAY_PT * SCALE  # 192
BOX = 168  # authoring units across the tile
K = TILE_PX / BOX  # authoring unit -> pixel
BUDGET_BYTES = 3400  # per tile WebP (owner, #4010)

OUTLINE = hexrgb("#8a8a98")  # one mid grey, reads on both lobby cards
OUTLINE_W = 2.4  # px at 3x (0.8 pt): every scene's outline weight
MOTION = OUTLINE  # motion marks share the outline grey
HIGHLIGHT = (1.0, 1.0, 1.0, 0.55)  # the light comes from the top left in every scene

CARD_DARK = (0x25, 0x25, 0x2C, 255)  # surfaceHigh, dark
CARD_LIGHT = (0xFF, 0xF8, 0xE8, 255)  # surfaceHigh, light (cream)

# Sort (theme.bottle.ts, dark liquids, which are also the lighter, readable set on both cards)
SORT_TEAL = hexrgb("#00ddcc")
SORT_BLUE = hexrgb("#3366dd")
SORT_PINK = hexrgb("#ff33bb")
SORT_INDIGO = hexrgb("#cc99ff")
# The glass is left clear: the game's is 6% white (BOTTLE_BODY_FILL_DEFAULT), next to invisible,
# and a translucent fill cost ~500 B of the budget.
# Yacht (ThemeContext: the light die, `dieBg` lightSurface, pips `text`)
DIE_FACE = hexrgb("#fbf4e2")  # lightSurface
DIE_PIP = hexrgb("#1a1412")
# 2048 (theme.twenty48.ts)
T48_SLOT = hexrgb("#2d2d38")  # TWENTY48_SLOT.dark
T48_1024 = hexrgb("#12908e")
T48_TEXT = hexrgb("#14141a")  # TWENTY48_TEXT_DARK
T48_GLOW = hexrgb("#ffd36a")  # TWENTY48_TOP_TILE_GLOW: the 2048 spark where the tiles meet
# Sudoku (ThemeContext dark board and theme.sudoku.ts washes)
SUDOKU_CELL = hexrgb("#19191f")  # darkSurface
SUDOKU_LINE = hexrgb("#4a4a56")  # the thin cell lines, lifted from `border` to show at 64 pt
SUDOKU_GIVEN = hexrgb("#e8e8f0")  # text
SUDOKU_ACCENT = hexrgb("#8ff5ff")  # accent: the selected cell
SUDOKU_ON_ACCENT = hexrgb("#0e0e13")  # textOnAccent
SUDOKU_PEER = (143 / 255, 245 / 255, 1.0, 0.11)  # SUDOKU_WASHES.dark.peer

SHEET_BG = (14, 14, 19, 255)  # darkBg

# --------------------------------------------------------------------------------------------
# Geometry helpers (authoring units; `P` maps them to canvas pixels)


def P(pts: Sequence[Point]) -> list[Point]:
    return [(x * K, y * K) for x, y in pts]


def quad(p0: Point, p1: Point, p2: Point, n: int = 12) -> list[Point]:
    """A quadratic Bezier as points, without p0."""
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return out


def cubic(p0: Point, p1: Point, p2: Point, p3: Point, n: int = 12) -> list[Point]:
    """A cubic Bezier as points, without p0."""
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return out


def rounded_rect(cx: float, cy: float, w: float, h: float, r: float, ang: float = 0.0):
    """A rounded rectangle centred on (cx, cy), turned by `ang` radians."""
    pts: list[Point] = []
    hw, hh = w / 2, h / 2
    for (qx, qy), a0 in (
        ((hw - r, -hh + r), -math.pi / 2),
        ((hw - r, hh - r), 0.0),
        ((-hw + r, hh - r), math.pi / 2),
        ((-hw + r, -hh + r), math.pi),
    ):
        for i in range(9):
            a = a0 + (math.pi / 2) * i / 8
            pts.append((qx + r * math.cos(a), qy + r * math.sin(a)))
    return xf(pts, cx, cy, ang)


def clip_below(pts: Sequence[Point], level: float) -> list[Point]:
    """The part of a polygon at or below the horizontal line y = level (y grows down)."""
    out: list[Point] = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        ina, inb = a[1] >= level, b[1] >= level
        if ina:
            out.append(a)
        if ina != inb:
            t = (level - a[1]) / (b[1] - a[1])
            out.append((a[0] + t * (b[0] - a[0]), level))
    return out


def clip_band(pts: Sequence[Point], top: float, bottom: float) -> list[Point]:
    """The part of a polygon between y = top and y = bottom."""
    flipped = [(x, -y) for x, y in clip_below(pts, top)]
    return [(x, -y) for x, y in clip_below(flipped, -bottom)]


class TileCanvas(Canvas):
    """The Star Swarm canvas, square, no padding, plus even-odd compound shapes (digits)."""

    def __init__(self) -> None:
        super().__init__(TILE_PX, TILE_PX, pad=0)

    def compound(self, contours: Sequence[Sequence[Point]], fill: RGBA) -> None:
        """Fill contours even-odd (a counter cuts its outer contour), in canvas pixels."""
        win = self._window([p for c in contours for p in c], 0)
        x0, y0, x1, y1 = win
        acc = np.zeros(((y1 - y0) * SS, (x1 - x0) * SS), np.uint8)
        for c in contours:
            m = Image.new("L", ((x1 - x0) * SS, (y1 - y0) * SS), 0)
            ImageDraw.Draw(m).polygon([((x - x0) * SS, (y - y0) * SS) for x, y in c], fill=1)
            acc ^= np.asarray(m, np.uint8)
        small = Image.fromarray(acc * 255, "L").resize((x1 - x0, y1 - y0), Image.LANCZOS)
        self._paint(win, np.clip(np.asarray(small, np.float32) / 255, 0, 1), fill)

    def outline(self, pts: Sequence[Point], width: float = OUTLINE_W, closed: bool = True) -> None:
        self.stroke(pts, width, OUTLINE, closed=closed)


# --------------------------------------------------------------------------------------------
# Digits and letters: Space Grotesk Bold outlines


def extract(font_path: Path) -> None:
    """Write lobby_numerals.json (0-9) and lobby_glyphs.json (A-Z): the glyph outlines as
    M/L/Q/C/Z ops in font units (y up)."""
    from fontTools.pens.basePen import BasePen
    from fontTools.ttLib import TTFont

    class OpsPen(BasePen):
        def __init__(self, glyphset):
            super().__init__(glyphset)
            self.ops: list[list] = []

        def _moveTo(self, p):
            self.ops.append(["M", *p])

        def _lineTo(self, p):
            self.ops.append(["L", *p])

        def _qCurveToOne(self, p1, p2):
            self.ops.append(["Q", *p1, *p2])

        def _curveToOne(self, p1, p2, p3):
            self.ops.append(["C", *p1, *p2, *p3])

        def _closePath(self):
            self.ops.append(["Z"])

    font = TTFont(font_path)
    cmap, gs = font.getBestCmap(), font.getGlyphSet()
    for path, chars in ((DIGITS_FILE, "0123456789"), (LETTERS_FILE, string.ascii_uppercase)):
        glyphs = {}
        for ch in chars:
            pen = OpsPen(gs)
            gs[cmap[ord(ch)]].draw(pen)
            ops = [[o[0], *[round(v) for v in o[1:]]] for o in pen.ops]
            glyphs[ch] = {"ops": ops, "advance": gs[cmap[ord(ch)]].width}
        doc = {
            "font": FONT_NAME,
            "license": "SIL Open Font License 1.1 (lobby_numerals.OFL.txt)",
            "capHeight": font["OS/2"].sCapHeight,
            "glyphs": glyphs,
        }
        path.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")


_DIGITS: dict | None = None
_GLYPHS: dict | None = None


def digits() -> dict:
    global _DIGITS
    if _DIGITS is None:
        _DIGITS = json.loads(DIGITS_FILE.read_text(encoding="utf-8"))
    return _DIGITS


def glyphs() -> dict:
    """The digits and the letters together (one font, one cap height)."""
    global _GLYPHS
    if _GLYPHS is None:
        letters = json.loads(LETTERS_FILE.read_text(encoding="utf-8"))
        assert letters["capHeight"] == digits()["capHeight"]
        _GLYPHS = {**digits(), "glyphs": {**digits()["glyphs"], **letters["glyphs"]}}
    return _GLYPHS


def _contours(ch: str) -> list[list[Point]]:
    """A glyph's contours in font units (y up), curves flattened."""
    out: list[list[Point]] = []
    cur: list[Point] = []
    for op in glyphs()["glyphs"][ch]["ops"]:
        kind, v = op[0], op[1:]
        if kind == "M":
            cur = [(v[0], v[1])]
        elif kind == "L":
            cur.append((v[0], v[1]))
        elif kind == "Q":
            cur += quad(cur[-1], (v[0], v[1]), (v[2], v[3]), 6)
        elif kind == "C":
            cur += cubic(cur[-1], (v[0], v[1]), (v[2], v[3]), (v[4], v[5]), 8)
        elif kind == "Z":
            out.append(cur)
            cur = []
    return out


def text(c: TileCanvas, s: str, cx: float, cy: float, cap: float, fill: RGBA) -> None:
    """Digits and capitals centred on (cx, cy) (authoring units), `cap` units tall (the cap
    height)."""
    d = glyphs()
    k = cap / d["capHeight"]
    width = sum(d["glyphs"][ch]["advance"] for ch in s) * k
    x = cx - width / 2
    contours = []
    for ch in s:
        for cont in _contours(ch):
            contours.append(P([(x + px * k, cy + cap / 2 - py * k) for px, py in cont]))
        x += d["glyphs"][ch]["advance"] * k
    c.compound(contours, fill)


# --------------------------------------------------------------------------------------------
# Sort: the game's chem flask (BottleView.tsx FLASK_OUTLINE, a 56 x 168 viewBox)

FLASK_UNIT = 38  # one liquid unit (INNER_H / BOTTLE_DEPTH)
FLASK_FLOOR = 166  # BODY_BOTTOM


def flask_outline() -> list[Point]:
    pts: list[Point] = [(18, 0), (18, 36)]
    pts += quad((18, 36), (6, 52), (6, 154))
    pts += quad((6, 154), (6, 166), (18, 166), 6)
    pts.append((38, 166))
    pts += quad((38, 166), (50, 166), (50, 154), 6)
    pts += quad((50, 154), (50, 52), (38, 36))
    pts.append((38, 0))
    return pts


FLASK_S = 0.49  # flask units -> authoring units: 27 x 81, the game's 1:3 flask
SORT_TILT = 120  # degrees: the lifted flask, mouth down, pouring (owner, #4010)
SORT_BASE = 156  # the upright row's floor (authoring units)
SORT_LEFT_X, SORT_MID_X = 32, 66  # the upright flasks' centres: a flask width plus a gap apart


def flask(anchor: Point, at: Point, ang: float = 0.0) -> Callable[[Sequence[Point]], list[Point]]:
    """Maps flask units to authoring units: `anchor` (flask units) lands on `at`, turned `ang`."""

    def f(pts: Sequence[Point]) -> list[Point]:
        local = [((x - anchor[0]) * FLASK_S, (y - anchor[1]) * FLASK_S) for x, y in pts]
        return xf(local, at[0], at[1], ang)

    return f


def draw_flask(
    c: TileCanvas, f, bands: Sequence[tuple[RGBA, float, float]], gloss_x: float = 12
) -> None:
    """The liquid bands (colour, top y, bottom y in authoring units: levels are horizontal in the
    world), a gloss stripe down the lit side (`gloss_x`, flask units), then the outline."""
    body = f(flask_outline())
    for col, top, bottom in bands:
        band = clip_band(body, top, bottom)
        if len(band) >= 3:
            c.polygon(P(band), col)
    gloss = f([(gloss_x, 60), (gloss_x + 2, 58), (gloss_x + 2, 146), (gloss_x, 148)])
    c.polygon(P(gloss), HIGHLIGHT)
    c.outline(P(body))


def upright_bands(base: float, colours: Sequence[RGBA], top_fill: float = 1.0):
    """Liquid units from the floor up in an upright flask whose floor is at `base`."""
    unit = FLASK_UNIT * FLASK_S
    out = []
    for i, col in enumerate(colours):
        h = unit * (top_fill if i == len(colours) - 1 else 1.0)
        bottom = base - i * unit
        out.append((col, bottom - h, bottom + 1))
    return out


def sort_scene(c: TileCanvas) -> None:
    base, left_x, mid_x = SORT_BASE, SORT_LEFT_X, SORT_MID_X
    # Left: a finished stack, four teal units (full to the neck).
    draw_flask(c, flask((28, FLASK_FLOOR), (left_x, base)), upright_bands(base, [SORT_TEAL] * 4))
    # Middle: two blue units, one pink, and pink arriving into the fourth.
    draw_flask(
        c,
        flask((28, FLASK_FLOOR), (mid_x, base)),
        upright_bands(base, [SORT_BLUE, SORT_BLUE, SORT_PINK, SORT_PINK], top_fill=0.4),
    )
    neck_top = base - FLASK_FLOOR * FLASK_S  # the middle flask's mouth
    # The lifted flask, tipped SORT_TILT so its body rises up and to the right and its mouth
    # hangs just above and right of the middle flask's neck.
    mouth = (mid_x + 11, neck_top - 13)
    tipped = flask((28, 0), mouth, math.radians(-SORT_TILT))
    body = tipped(flask_outline())
    lowest = max(y for _, y in body)
    draw_flask(
        c,
        tipped,
        [(SORT_PINK, lowest - 8, lowest + 1), (SORT_INDIGO, lowest - 16, lowest - 8)],
        gloss_x=42,  # tipped over, its upper (lit) side is the flask's right
    )
    # The pink stream: from the lower lip, curving down the middle neck to the liquid.
    lip = tipped([(20, 1)])[0]
    surface = base - FLASK_UNIT * FLASK_S * 3.4  # the arriving unit is 40% full
    stream = [lip, *quad(lip, (mid_x, lip[1]), (mid_x, surface), 16)]
    for i in range(len(stream) - 1):
        w = 4.4 - 1.2 * i / (len(stream) - 1)
        c.stroke(P(stream[i : i + 2]), w * K, SORT_PINK, closed=False)
    # Splash droplets at the neck.
    for dx, dy, r in ((-8, -2, 1.8), (-5, -8, 1.3)):
        c.ellipse((mid_x + dx) * K, (neck_top + dy) * K, r * K, r * K, SORT_PINK)


# --------------------------------------------------------------------------------------------
# Yacht

PIPS = {
    1: [(0, 0)],
    2: [(-1, -1), (1, 1)],
    3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
    5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)],
}


def die(c: TileCanvas, cx: float, cy: float, size: float, deg: float, face: int) -> None:
    ang = math.radians(deg)
    body = rounded_rect(cx, cy, size, size, size * 0.2, ang)
    c.polygon(P(body), DIE_FACE)
    # The lit top edge.
    rim = rounded_rect(0, -size * 0.36, size * 0.62, size * 0.07, size * 0.035)
    c.polygon(P(xf(rim, cx, cy, ang)), HIGHLIGHT)
    c.outline(P(body))
    g, r = size * 0.26, size * 0.085
    for px, py in PIPS[face]:
        ((x, y),) = xf([(px * g, py * g)], cx, cy, ang)
        c.ellipse(x * K, y * K, r * K, r * K, DIE_PIP)


def motion_marks(c: TileCanvas, marks: Sequence[tuple[Point, Point]]) -> None:
    for a, b in marks:
        c.stroke(P([a, b]), OUTLINE_W * 1.1, MOTION, closed=False)


# The landed row, in canvas pixels: whole-pixel dice on a whole-pixel pitch keep their edges
# sharp and cheap to encode (the row cost ~500 B more off the pixel grid).
YACHT_DIE_PX, YACHT_GAP_PX = 32, 4  # four landed dice, a 4 px gap between them
YACHT_ROW_X_PX, YACHT_ROW_Y_PX = 24, 120  # the row's top-left corner
YACHT_LANDED = 4  # plus one tumbling: Yacht is played with five dice (owner, #4011)


def yacht_landed_centres() -> list[Point]:
    """The landed dice's centres, in authoring units."""
    half = YACHT_DIE_PX / 2
    return [
        (
            (YACHT_ROW_X_PX + i * (YACHT_DIE_PX + YACHT_GAP_PX) + half) / K,
            (YACHT_ROW_Y_PX + half) / K,
        )
        for i in range(YACHT_LANDED)
    ]


YACHT_TUMBLE = (96, 50)  # the fifth die's centre (authoring units), still in the air


def yacht_scene(c: TileCanvas) -> None:
    """All five dice: four landed in a row on fives, square to the table, and the fifth still
    tumbling in from the top left, a five too: a Yacht in the making. Landed dice stay
    unrotated: a turned die edge costs ~400 B of WebP each."""
    tx, ty = YACHT_TUMBLE
    # Motion marks trail the tumbling die.
    marks = [((tx - 50, ty - 6), (tx - 32, ty - 12)), ((tx - 54, ty + 10), (tx - 34, ty + 4))]
    marks.append(((tx - 44, ty + 24), (tx - 28, ty + 17)))
    motion_marks(c, marks)
    size = YACHT_DIE_PX / K
    die(c, tx, ty, size, 28, 5)
    for x, y in yacht_landed_centres():
        die(c, x, y, size, 0, 5)


# --------------------------------------------------------------------------------------------
# 2048

T48_TILE, T48_GAP, T48_R = 58, 8, 7  # authoring units; the game's 8 pt radius on ~80 pt tiles


def tile48(c: TileCanvas, cx: float, cy: float, colour: RGBA, value: str | None) -> None:
    body = rounded_rect(cx, cy, T48_TILE, T48_TILE, T48_R)
    c.polygon(P(body), colour)
    if value:
        sheen = rounded_rect(cx, cy - T48_TILE * 0.4, T48_TILE * 0.78, 3.0, 1.5)
        c.polygon(P(sheen), HIGHLIGHT)
        text(c, value, cx, cy + 0.5, 12.5, T48_TEXT)
    c.outline(P(body))


def twenty48_scene(c: TileCanvas) -> None:
    """A 2 x 2 slice of the board: two empty slots above, and in the row below the left 1024
    sliding right into the other 1024, the gap between them almost closed."""
    pitch = T48_TILE + T48_GAP
    left, top = 58, 50  # the slots' centres; the group sits right to leave room for the streaks
    right, bottom = left + pitch, top + pitch
    for x in (left, right):
        tile48(c, x, top, T48_SLOT, None)
    tile48(c, left, bottom, T48_SLOT, None)
    tile48(c, right, bottom, T48_1024, "1024")
    moving = left + T48_GAP - 2  # 2 units short of touching
    tail = moving - T48_TILE / 2 - 5
    motion_marks(c, [((tail - 18, bottom + dy), (tail, bottom + dy)) for dy in (-16, 0, 16)])
    tile48(c, moving, bottom, T48_1024, "1024")
    # The 2048 spark where they meet.
    sx, sy = (moving + right) / 2, bottom - T48_TILE / 2 - 3
    for k in range(4):
        ang = k * math.pi / 2 + math.pi / 4
        c.polygon(P(xf([(0, -2.2), (9, 0), (0, 2.2), (-2, 0)], sx, sy, ang)), T48_GLOW)
    c.ellipse(sx * K, sy * K, 2.6 * K, 2.6 * K, T48_GLOW)


# --------------------------------------------------------------------------------------------
# Sudoku

SUDOKU_CELL_U = 43  # authoring units per cell
SUDOKU_GIVENS = {(0, 0): "5", (1, 0): "3", (2, 1): "7", (0, 2): "9", (2, 2): "6", (1, 2): "1"}
SUDOKU_SELECTED = (1, 1)
SUDOKU_PLACED = "8"


def sudoku_scene(c: TileCanvas) -> None:
    n = SUDOKU_CELL_U
    x0 = y0 = (BOX - 3 * n) / 2
    box = [(x0, y0), (x0 + 3 * n, y0), (x0 + 3 * n, y0 + 3 * n), (x0, y0 + 3 * n)]
    c.polygon(P(box), SUDOKU_CELL)
    sc, sr = SUDOKU_SELECTED
    # The selected cell's row and column wash (its box is the whole slice, so only those).
    for col in range(3):
        for row in range(3):
            if (col == sc) != (row == sr):
                cell = [
                    (x0 + col * n, y0 + row * n),
                    (x0 + (col + 1) * n, y0 + row * n),
                    (x0 + (col + 1) * n, y0 + (row + 1) * n),
                    (x0 + col * n, y0 + (row + 1) * n),
                ]
                c.polygon(P(cell), SUDOKU_PEER)
    # The selected cell, the accent fill with the digit just placed.
    cx, cy = x0 + (sc + 0.5) * n, y0 + (sr + 0.5) * n
    c.polygon(P(rounded_rect(cx, cy, n - 5, n - 5, 4)), SUDOKU_ACCENT)
    text(c, SUDOKU_PLACED, cx, cy, 22, SUDOKU_ON_ACCENT)
    for (col, row), ch in SUDOKU_GIVENS.items():
        text(c, ch, x0 + (col + 0.5) * n, y0 + (row + 0.5) * n, 20, SUDOKU_GIVEN)
    for i in (1, 2):
        c.stroke(P([(x0 + i * n, y0), (x0 + i * n, y0 + 3 * n)]), 1.6, SUDOKU_LINE, closed=False)
        c.stroke(P([(x0, y0 + i * n), (x0 + 3 * n, y0 + i * n)]), 1.6, SUDOKU_LINE, closed=False)
    # The box border: the board's bold line, in the shared outline grey and weight x 1.5.
    c.outline(P(box), OUTLINE_W * 1.5)
    # The placing flourish: three short accent ticks off the selected cell's top-right corner.
    tx, ty = cx + n / 2 - 1, cy - n / 2 + 1
    for a in (-75, -40, -5):
        r = math.radians(a)
        p0 = (tx + 5 * math.cos(r), ty + 5 * math.sin(r))
        p1 = (tx + 11 * math.cos(r), ty + 11 * math.sin(r))
        c.stroke(P([p0, p1]), OUTLINE_W, SUDOKU_ACCENT, closed=False)


# --------------------------------------------------------------------------------------------
# Playing cards (Solitaire, FreeCell): ThemeContext `cardFace` / `cardInk` / `cardRedSuit` and
# the teal back `cardBack`. Laid out in canvas pixels and unrotated. A full-size card outline
# costs ~300 B of WebP, so Solitaire shows only the few cards that tell its game and FreeCell's
# small cards show a pip only; the cards sit on the half pixel with a 3 px corner (measured
# ~100 B a card cheaper than whole pixels and 5 px).

CARD_FACE = hexrgb("#ffffff")  # cardFace
CARD_INK = hexrgb("#0e0e13")  # cardInk: ranks and black suits
CARD_RED = hexrgb("#d32f2f")  # CARD_RED_SUIT (theme.cards.ts)
CARD_BACK = hexrgb("#00737e")  # cardBack: the BC teal field inside the white margin
RED_SUITS = frozenset("HD")
CARD_SUITS = frozenset("SHDC")
CARD_RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")

CARD_R = 3  # corner radius (px)
CARD_SNAP = 0.5  # cards sit on the half pixel (px)
CARD_MARGIN = 3  # a face-down card's white margin around the teal field (px)
CARD_INDEX = 11  # the index's centre: this far in from the card's side and down from its top (px)
CARD_RANK_CAP = 13  # the rank's cap height (px)
CARD_SUIT_PX = 12  # the suit pip beside it (px)


def is_red(face: str) -> bool:
    return face[-1] in RED_SUITS


def _heart(cx: float, cy: float, s: float) -> list[Point]:
    """A heart `s` px wide centred on (cx, cy): the classic parametric curve."""
    out = []
    for i in range(24):
        t = 2 * math.pi * i / 24
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        out.append((cx + x * s / 32, cy - (y + 2.5) * s / 32))
    return out


def suit(c: TileCanvas, kind: str, cx: float, cy: float, s: float) -> None:
    """A suit pip `s` px across centred on (cx, cy), in canvas pixels: H, D, S or C."""
    col = CARD_RED if kind in RED_SUITS else CARD_INK
    h = s / 2
    stem = [(cx, cy), (cx + h * 0.42, cy + h * 1.05), (cx - h * 0.42, cy + h * 1.05)]
    if kind == "H":
        c.polygon(_heart(cx, cy, s), col)
    elif kind == "D":
        c.polygon(
            [(cx, cy - h * 1.2), (cx + h * 0.85, cy), (cx, cy + h * 1.2), (cx - h * 0.85, cy)], col
        )
    elif kind == "S":
        c.polygon([(x, 2 * cy - y - h * 0.3) for x, y in _heart(cx, cy, s)], col)
        c.polygon(stem, col)
    else:
        r = s * 0.25
        for dx, dy in ((0, -h * 0.5), (-h * 0.52, h * 0.2), (h * 0.52, h * 0.2)):
            c.ellipse(cx + dx, cy + dy, r, r, col)
        c.polygon(stem, col)


def card(
    c: TileCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    face: str | None,
    index: tuple[float, float, float] | None = None,
) -> None:
    """A card whose top-left corner is pixel (x, y). `face` is rank + suit ("7H"), or None for a
    face-down card. A face shows its index only (the rank, the suit beside it): a cascade shows
    each card's top strip, and the index is what a player reads there. `index` sizes it for a
    bigger card: (inset, rank cap, suit pip) px, default (CARD_INDEX, CARD_RANK_CAP, CARD_SUIT_PX).

    Raises ValueError for a rank other than A, 2-10, J, Q or K and for a suit other than S, H, D
    or C, before anything is drawn."""
    if face is not None:
        rank, kind = face[:-1], face[-1:]
        if rank not in CARD_RANKS:
            raise ValueError(f"card {face!r}: rank must be one of A, 2-10, J, Q, K, got {rank!r}")
        if kind not in CARD_SUITS:
            raise ValueError(f"card {face!r}: suit must be one of S, H, D, C, got {kind!r}")
    cx, cy = x + CARD_SNAP + w / 2, y + CARD_SNAP + h / 2
    body = rounded_rect(cx, cy, w, h, CARD_R)
    c.polygon(body, CARD_FACE)
    if face is None:
        inner = rounded_rect(cx, cy, w - 2 * CARD_MARGIN, h - 2 * CARD_MARGIN, CARD_R - 1)
        c.polygon(inner, CARD_BACK)
    else:
        inset, cap, pip = index or (CARD_INDEX, CARD_RANK_CAP, CARD_SUIT_PX)
        ink = CARD_RED if is_red(face) else CARD_INK
        ix, iy = x + CARD_SNAP + inset, y + CARD_SNAP + inset
        text(c, face[:-1], ix / K, iy / K, cap / K, ink)
        suit(c, face[-1], x + CARD_SNAP + w - inset, iy, pip)
    c.outline(body)


def cascade(
    c: TileCanvas, x: int, y: int, size: tuple[int, int], down: int, faces: Sequence[str], step: int
) -> int:
    """A tableau column from the top: `down` face-down cards DOWN_STEP apart, then `faces` face
    up, `step` apart. Returns the top y of its last card."""
    w, h = size
    for _ in range(down):
        card(c, x, y, w, h, None)
        y += DOWN_STEP
    for i, f in enumerate(faces):
        if i:
            y += step
        card(c, x, y, w, h, f)
    return y


DOWN_STEP = 8  # px between face-down cards in a Klondike column


def trail(c: TileCanvas, marks: Sequence[tuple[Point, Point]]) -> None:
    """Motion marks given in canvas pixels."""
    motion_marks(c, [((a[0] / K, a[1] / K), (b[0] / K, b[1] / K)) for a, b in marks])


# --------------------------------------------------------------------------------------------
# Solitaire (Klondike, owner's pick B in #4012's second round): the stock, the waste fanned from
# a draw of three, and the waste's top card, the 7S, on its way onto the 8H at the foot of a
# tableau column that sits over a face-down card.

SOL_SIZE = (44, 62)  # card size (px)
SOL_STOCK_AT, SOL_STOCK_DEPTH = (10, 10), 2  # the stock pile: two backs, 2 px apart
SOL_WASTE_AT, SOL_WASTE_FAN = (64, 10), 18  # the waste's first card, and the fan step (px)
SOL_WASTE = ["4C", "10D"]  # under the 7S, which has just been lifted off the fan
SOL_COLUMN_AT, SOL_STEP = (64, 84), 22  # the tableau column's top, and its face-up overlap (px)
SOL_COLUMN_DOWN, SOL_COLUMN = 1, ["9S", "8H"]  # face-down count, then the run
SOL_MOVING, SOL_MOVING_AT = "7S", (104, 70)  # black on the red 8, one rank down
SOL_TRAIL = (((148, 72), (156, 62)), ((160, 80), (170, 70)))  # back up toward the waste (px)


def solitaire_scene(c: TileCanvas) -> None:
    w, h = SOL_SIZE
    sx, sy = SOL_STOCK_AT
    for i in range(SOL_STOCK_DEPTH - 1, -1, -1):
        card(c, sx + 2 * i, sy + 2 * i, w, h, None)
    wx, wy = SOL_WASTE_AT
    for i, f in enumerate(SOL_WASTE):
        card(c, wx + i * SOL_WASTE_FAN, wy, w, h, f)
    x, y = SOL_COLUMN_AT
    cascade(c, x, y, SOL_SIZE, SOL_COLUMN_DOWN, SOL_COLUMN, SOL_STEP)
    trail(c, SOL_TRAIL)
    card(c, *SOL_MOVING_AT, w, h, SOL_MOVING)


# --------------------------------------------------------------------------------------------
# FreeCell (owner's pick B in #4012's second round): the deal, eight cascades of uneven length,
# every card face up (Klondike would show face-down cards). The cards are small, so each shows
# its suit pip only.

FC_SIZE = (19, 30)  # card size (px)
FC_PITCH, FC_STEP = 21, 22  # column pitch, and the cascade overlap (px)
FC_TOP = 59  # the cascades' top (px)
FC_PIP, FC_PIP_Y = 8, 9  # the pip's size, and its centre's depth into the card (px)
FC_CASCADES = [
    ["9S", "4D", "JC"],
    ["7H", "QC"],
    ["5C", "JD"],
    ["10H", "8C", "AD"],
    ["6D", "2S"],
    ["4S", "9H"],
    ["KD", "6C", "10S"],
    ["3S", "8D"],
]


def pip_card(c: TileCanvas, x: int, y: int, w: int, h: int, face: str) -> None:
    """A small face-up card showing only its suit pip, near its top: a cascade's strip shows it."""
    if face[-1:] not in CARD_SUITS:
        raise ValueError(f"card {face!r}: suit must be one of S, H, D, C")
    cx = x + CARD_SNAP + w / 2
    body = rounded_rect(cx, y + CARD_SNAP + h / 2, w, h, 2.5)
    c.polygon(body, CARD_FACE)
    suit(c, face[-1], cx, y + CARD_SNAP + FC_PIP_Y, FC_PIP)
    c.outline(body)


def freecell_scene(c: TileCanvas) -> None:
    w, h = FC_SIZE
    x0 = (TILE_PX - (len(FC_CASCADES) * FC_PITCH - (FC_PITCH - w))) // 2
    for i, faces in enumerate(FC_CASCADES):
        for j, f in enumerate(faces):
            pip_card(c, x0 + i * FC_PITCH, FC_TOP + j * FC_STEP, w, h, f)


# --------------------------------------------------------------------------------------------
# Daily Word (owner's pick A in #4012's second round): three guesses at FINAL, scored as the game
# scores them: PIANO, FOCAL, then FINAL solved. All three words are answers in the English,
# Spanish and French lists (backend/daily_word/words/answers_{en,es,fr}.txt), so the tile is
# right in every language the game is played in.

DW_CORRECT = hexrgb("#538d4e")  # DAILYWORD_CORRECT
DW_PRESENT = hexrgb("#8c7100")  # DAILYWORD_PRESENT
DW_ABSENT = hexrgb("#3a3a3c")  # DAILYWORD_ABSENT
DW_LETTER = hexrgb("#ffffff")  # DAILYWORD_LETTER_TEXT
DW_TILE, DW_GAP, DW_R, DW_CAP = 30, 4, 4, 15  # px; the game's 4 pt radius; the letters' cap
DW_ANSWER = "FINAL"
DW_GUESSES = ["PIANO", "FOCAL", "FINAL"]
DW_COLOURS = {"c": DW_CORRECT, "p": DW_PRESENT, "a": DW_ABSENT}


def score(guess: str, answer: str) -> str:
    """The game's scoring, per letter: "c" correct, "p" present, "a" absent. Greens first; a
    yellow only for a letter the answer still has left over (duplicates count once each)."""
    marks = ["a"] * len(guess)
    left: dict[str, int] = {}
    for i, (g, a) in enumerate(zip(guess, answer, strict=True)):
        if g == a:
            marks[i] = "c"
        else:
            left[a] = left.get(a, 0) + 1
    for i, g in enumerate(guess):
        if marks[i] != "c" and left.get(g, 0):
            marks[i] = "p"
            left[g] -= 1
    return "".join(marks)


def dailyword_scene(c: TileCanvas) -> None:
    n = len(DW_GUESSES)
    x0 = (TILE_PX - (5 * DW_TILE + 4 * DW_GAP)) // 2
    y0 = (TILE_PX - (n * DW_TILE + (n - 1) * DW_GAP)) // 2
    for r, word in enumerate(DW_GUESSES):
        for i, (ch, m) in enumerate(zip(word, score(word, DW_ANSWER), strict=True)):
            cx = x0 + i * (DW_TILE + DW_GAP) + DW_TILE / 2
            cy = y0 + r * (DW_TILE + DW_GAP) + DW_TILE / 2
            body = rounded_rect(cx, cy, DW_TILE, DW_TILE, DW_R)
            c.polygon(body, DW_COLOURS[m])
            c.outline(body)
            text(c, ch, cx / K, cy / K, DW_CAP / K, DW_LETTER)


# --------------------------------------------------------------------------------------------
# Batch 3 (#4013): the hidden premium games. Their tiles reach HomeScreen only through
# `components/home/hiddenGameTileArt.ts`, which a store bundle stubs, so none of these ship in a
# store build. The owner's picks from the #4013 proposals: Blackjack A, Hearts C, Mahjong A,
# Star Swarm B, Cascade A.


def pill(
    c: TileCanvas,
    box: tuple[float, float, float, float],
    fill: RGBA,
    label: str,
    ink: RGBA,
    cap: float,
) -> None:
    """A rounded pill (centre x, y, width, height in canvas px) with a centred label: Blackjack's
    hand total."""
    cx, cy, w, h = box
    body = rounded_rect(cx, cy, w, h, h / 2)
    c.polygon(body, fill)
    c.outline(body)
    text(c, label, cx / K, cy / K, cap / K, ink)


# --------------------------------------------------------------------------------------------
# Blackjack (pick A): a natural. The player's A-spades and K-hearts, the hand total pill in the
# win colour (TableFelt's TotalPill: `bonus` for a win), and the bet: chips in the table accent
# with the felt as their rim (ChipFace, the Classic table's `accent`).

BJ_ACCENT = hexrgb("#8ff5ff")  # accent (dark): the Classic table's chips
BJ_RIM = hexrgb("#19191f")  # surface (dark): a chip's rim
BJ_WIN = hexrgb("#4ade80")  # bonus (dark): a won hand's total pill
BJ_ON = hexrgb("#0e0e13")  # textOnAccent: the pill's label
BJ_CARD = (58, 82)  # card size (px)
BJ_INDEX = (13, 16, 15)  # the bigger cards' index: inset, rank cap, suit pip (px)
BJ_HAND = (("AS", (38, 26)), ("KH", (92, 36)))  # the two cards, top-left corners (px)
BJ_PILL = (96, 140, 44, 24)  # the total pill: centre, size (px)
BJ_PILL_CAP = 14  # its label's cap height (px)
BJ_CHIPS = (44, 150, 3)  # the chip stack: centre x, top chip's y, count
BJ_CHIP_R, BJ_CHIP_TH = 15, 4  # a chip's radius and thickness (px)


def blackjack_total(cards: Sequence[str]) -> int:
    """A hand's best total, as the game counts it: aces 11 unless that busts, faces 10."""
    total, aces = 0, 0
    for f in cards:
        rank = f[:-1]
        if rank == "A":
            total, aces = total + 11, aces + 1
        else:
            total += 10 if rank in ("J", "Q", "K") else int(rank)
    while total > 21 and aces:
        total, aces = total - 10, aces - 1
    return total


def chip_stack(c: TileCanvas, cx: float, top_y: float, n: int) -> None:
    """A short stack of chips seen from the front and a little above: n chips, the top one's
    face centred at (cx, top_y) after the stack is built up from the bottom."""
    r, th = BJ_CHIP_R, BJ_CHIP_TH
    ry = r * 0.42
    for i in range(n):
        y = top_y - i * th
        side = [(cx - r, y), (cx + r, y)]
        side += [
            (cx + r * math.cos(a), y + th + ry * math.sin(a))
            for a in [k * math.pi / 12 for k in range(13)]
        ]
        side += [(cx - r, y)]
        c.polygon(side, BJ_ACCENT)
        c.polygon(ellipse_pts(cx, y + th * 0.5, r, ry), (*BJ_RIM[:3], 0.35))
        c.stroke(side, OUTLINE_W, OUTLINE)
        top = ellipse_pts(cx, y, r, ry)
        c.polygon(top, BJ_ACCENT)
        c.stroke(ellipse_pts(cx, y, r * 0.66, ry * 0.66), 2.0, (*BJ_RIM[:3], 0.55))
        c.stroke(top, OUTLINE_W, OUTLINE)


def blackjack_scene(c: TileCanvas) -> None:
    w, h = BJ_CARD
    for face, (x, y) in BJ_HAND:
        card(c, x, y, w, h, face, BJ_INDEX)
    total = blackjack_total([f for f, _ in BJ_HAND])
    pill(c, BJ_PILL, BJ_WIN, str(total), BJ_ON, BJ_PILL_CAP)
    chip_stack(c, *BJ_CHIPS)


# --------------------------------------------------------------------------------------------
# Hearts (pick C): hearts broken. The A-hearts has just been played, and the game's broken heart
# (HeartsBrokenAnimation: its heart and crack paths in a 500-unit box, HEARTS_BROKEN_HEART) splits
# in two along the crack above it.

HEARTS_BROKEN = hexrgb("#d0342c")  # HEARTS_BROKEN_HEART
HEARTS_PLAYED = "AH"
HEARTS_CARD_AT = (114, 112)  # the played card's top-left (px); a standard 44 x 62 card
HEARTS_CARD = (44, 62)
HEARTS_SCALE, HEARTS_CENTRE = 0.24, (96, 82)  # the 500-unit heart, scaled and centred (px)
HEARTS_SPLIT = 4  # px each half moves apart along x (the right one 1 px down)
# HeartsBrokenAnimation's HEART, as its cubic segments, and its CRACK polyline (500-unit box).
HEART_CUBICS = (
    ((250, 450), (250, 450), (40, 310), (40, 180)),
    ((40, 180), (40, 95), (110, 55), (180, 75)),
    ((180, 75), (210, 84), (235, 105), (250, 130)),
    ((250, 130), (265, 105), (290, 84), (320, 75)),
    ((320, 75), (390, 55), (460, 95), (460, 180)),
    ((460, 180), (460, 310), (250, 450), (250, 450)),
)
HEART_CRACK = ((250, 130), (232, 190), (268, 240), (226, 300), (262, 360), (250, 450))


def broken_heart_halves() -> tuple[list[Point], list[Point]]:
    """The heart's left and right halves (canvas px), each closed along the crack."""
    s, (ox, oy) = HEARTS_SCALE, HEARTS_CENTRE

    def at(x: float, y: float) -> Point:
        return (ox + (x - 250) * s, oy + (y - 250) * s)

    body = [at(*HEART_CUBICS[0][0])]
    for p0, p1, p2, p3 in HEART_CUBICS:
        body += [at(x, y) for x, y in cubic(p0, p1, p2, p3, 10)]
    crack = [at(x, y) for x, y in HEART_CRACK]
    left = [p for p in body if p[0] <= ox] + crack[::-1]
    right = [p for p in body if p[0] >= ox] + crack
    d = HEARTS_SPLIT
    return [(x - d, y) for x, y in left], [(x + d, y + 1) for x, y in right]


def hearts_scene(c: TileCanvas) -> None:
    card(c, *HEARTS_CARD_AT, *HEARTS_CARD, HEARTS_PLAYED)
    for half in broken_heart_halves():
        c.polygon(half, HEARTS_BROKEN)
        c.outline(half)


# --------------------------------------------------------------------------------------------
# Mahjong (pick A): a corner of the board, two layers, the free pair of 3-coins selected. The
# tiles are laid out as the game's slots (col, row, layer; a tile spans two columns, as in
# `game/mahjong/engine.ts`), and the selected pair is free by the game's rule (`is_free`). The
# tile is the game's (theme.mahjong: ivory face, brown border, bone sides with an ivory band, the
# gold selected face); the faces are drawn as gen_mahjong_tiles.py draws them (coins, bamboo, and
# the red dragon in Yuji Syuku, SIL OFL 1.1, from mahjong_glyphs.json).

MJ_FACE = hexrgb("#f5f0e8")  # MAHJONG_TILE_FACE
MJ_FACE_SEL = hexrgb("#fff8c0")  # MAHJONG_TILE_FACE_SELECTED
MJ_BORDER = hexrgb("#8b7355")  # MAHJONG_BORDER_NORMAL
MJ_SEL = hexrgb("#ffd700")  # MAHJONG_BORDER_SELECTED
MJ_SIDE_R = hexrgb("#c8b48a")  # MAHJONG_SIDE_R
MJ_SIDE_B = hexrgb("#a98f66")  # MAHJONG_SIDE_B
MJ_SIDE_IV = hexrgb("#ece3cf")  # MAHJONG_SIDE_IVORY
MJ_BLUE = hexrgb("#1f47a6")  # gen_mahjong_tiles.py's inks
MJ_GREEN = hexrgb("#16773b")
MJ_RED = hexrgb("#c3262e")
MJ_IVORY = hexrgb("#fbf6e9")
MJ_DARK_GREEN = hexrgb("#0b4a24")
MJ_GLYPHS_FILE = HERE / "mahjong_glyphs.json"
MJ_TILE = (36, 50, 6)  # face width, height, and the depth of the bone sides (px)
MJ_ORIGIN = (20, 108)  # the face's top-left of the slot (col 0, layer 0), px
MJ_COL_PX = 19  # one column (half a tile and a 1 px gap) in px
MJ_LAYER_PX = (1, -42)  # how far up the board one layer up is drawn (px)
# (col, row, layer, face): the bottom layer's three tiles and the two on top of them.
MJ_SLOTS = (
    (0, 0, 0, "b2"),
    (2, 0, 0, "c2"),
    (4, 0, 0, "c3"),
    (1, 0, 1, "zhong"),
    (3, 0, 1, "c3"),
)
MJ_SELECTED = ((4, 0, 0), (3, 0, 1))  # the matched pair, both free


def is_free(slot: tuple[int, int, int], slots: Sequence[tuple[int, int, int]]) -> bool:
    """`isFreeTile` (game/mahjong/engine.ts): nothing on top at the same position, and the left
    or the right neighbour (two columns over, same row and layer) empty."""
    col, row, layer = slot
    if any(s[2] > layer and s[0] == col and s[1] == row for s in slots):
        return False
    left = (col - 2, row, layer) in slots
    right = (col + 2, row, layer) in slots
    return not (left and right)


_MJ_GLYPHS: dict | None = None


def _mj_glyph_contours(ch: str) -> tuple[list[list[Point]], list[float]]:
    global _MJ_GLYPHS
    if _MJ_GLYPHS is None:
        _MJ_GLYPHS = json.loads(MJ_GLYPHS_FILE.read_text(encoding="utf-8"))["glyphs"]
    out: list[list[Point]] = []
    cur: list[Point] = []
    for op in _MJ_GLYPHS[ch]["ops"]:
        kind, v = op[0], op[1:]
        if kind == "M":
            cur = [(v[0], v[1])]
        elif kind == "L":
            cur.append((v[0], v[1]))
        elif kind == "Q":
            cur += quad(cur[-1], (v[0], v[1]), (v[2], v[3]), 6)
        elif kind == "C":
            cur += cubic(cur[-1], (v[0], v[1]), (v[2], v[3]), (v[4], v[5]), 8)
        elif kind == "Z":
            out.append(cur)
            cur = []
    return out, _MJ_GLYPHS[ch]["bounds"]


def mj_glyph(c: TileCanvas, ch: str, cx: float, cy: float, size: float, fill: RGBA) -> None:
    contours, (x0, y0, x1, y1) = _mj_glyph_contours(ch)
    k = size / max(x1 - x0, y1 - y0)
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    c.compound([[(cx + (x - mx) * k, cy - (y - my) * k) for x, y in ct] for ct in contours], fill)


def coin(c: TileCanvas, cx: float, cy: float, r: float, ring: RGBA) -> None:
    c.ellipse(cx, cy, r, r, ring)
    c.ellipse(cx, cy, r * 0.78, r * 0.78, MJ_IVORY)
    c.ellipse(cx, cy, r * 0.42, r * 0.42, ring)


def bamboo_stick(c: TileCanvas, cx: float, top: float, hgt: float, w: float) -> None:
    c.polygon(rounded_rect(cx, top + hgt / 2, w, hgt, w / 2), MJ_GREEN)
    for f in (0.0, 0.5, 1.0):
        c.polygon(rounded_rect(cx, top + f * hgt, w * 1.5, 2.6, 1.3), MJ_DARK_GREEN)


def mj_face_art(c: TileCanvas, kind: str, x: float, y: float, w: float, h: float) -> None:
    """A face's art inside the face rectangle: 3-coins (diagonal, blue red green), 2-coins,
    2-bamboo, or the red dragon."""
    if kind == "c3":
        for i, col in enumerate((MJ_BLUE, MJ_RED, MJ_GREEN)):
            coin(c, x + w * (0.27 + 0.23 * i), y + h * (0.23 + 0.27 * i), w * 0.17, col)
    elif kind == "c2":
        coin(c, x + w / 2, y + h * 0.3, w * 0.2, MJ_GREEN)
        coin(c, x + w / 2, y + h * 0.7, w * 0.2, MJ_BLUE)
    elif kind == "b2":
        bamboo_stick(c, x + w / 2, y + h * 0.12, h * 0.32, w * 0.2)
        bamboo_stick(c, x + w / 2, y + h * 0.56, h * 0.32, w * 0.2)
    elif kind == "zhong":
        mj_glyph(c, "中", x + w / 2, y + h / 2, w * 0.78, MJ_RED)
    else:
        raise ValueError(f"unknown mahjong face {kind!r}")


def mj_slot_xy(col: int, layer: int) -> Point:
    """The face's top-left (px) of a tile at `col` on `layer` (one row is drawn)."""
    x0, y0 = MJ_ORIGIN
    return (x0 + col * MJ_COL_PX + layer * MJ_LAYER_PX[0], y0 + layer * MJ_LAYER_PX[1])


def mj_tile(c: TileCanvas, x: float, y: float, kind: str, selected: bool) -> None:
    """A tile whose face's top-left is (x, y); its bone sides show right and below."""
    w, h, d = MJ_TILE
    whole = rounded_rect(x + w / 2 + d / 2, y + h / 2 + d / 2, w + d, h + d, 4)
    c.polygon(whole, MJ_SIDE_B)
    c.polygon(rounded_rect(x + w / 2 + d / 2, y + h / 2 + d / 4, w + d, h + d / 2, 4), MJ_SIDE_R)
    c.polygon(rounded_rect(x + w / 2 + 1, y + h / 2 + 1, w + 2, h + 2, 4), MJ_SIDE_IV)
    face = rounded_rect(x + w / 2, y + h / 2, w, h, 3.5)
    c.polygon(face, MJ_FACE_SEL if selected else MJ_FACE)
    c.stroke(face, 2.6 if selected else 1.6, MJ_SEL if selected else MJ_BORDER)
    mj_face_art(c, kind, x, y, w, h)
    c.outline(whole)


def mahjong_scene(c: TileCanvas) -> None:
    for col, row, layer, kind in sorted(MJ_SLOTS, key=lambda s: (s[2], s[1], s[0])):
        x, y = mj_slot_xy(col, layer)
        mj_tile(c, x, y, kind, (col, row, layer) in MJ_SELECTED)


# --------------------------------------------------------------------------------------------
# Star Swarm (pick B): the swarm dives. Three Wasp Grunts in a V coming down on the Arrow, all
# drawn by the game's own sprite code (draw_starswarm_art.py: `grunt_wasp`, and the P1 Arrow with
# its second gun as `compose_ship` stacks it, armour outline included), scaled onto the tile. The
# sprites carry their own rims and armour outline, as players see them, so this scene is exempt
# from the shared grey outline (OUTLINE_EXEMPT).

SS_GRUNTS = ((58, 52), (134, 52), (96, 76))  # centres (px)
SS_GRUNT_PX = 40  # each Grunt's padded sprite, scaled to this (longest side, px)
SS_SHIP = ("p1-arrow", 2, 0)  # ship, guns level, hull plating level
SS_SHIP_AT, SS_SHIP_PX = (96, 152), 54


def _sprite(im: Image.Image, size: int) -> Image.Image:
    k = size / max(im.width, im.height)
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def starswarm_scene(_c: TileCanvas) -> list[tuple[Image.Image, Point]]:
    """Returns sprite layers (image, centre px) for `render` to composite over the canvas."""
    ss = starswarm
    grunt = _sprite(ss.grunt_wasp(), SS_GRUNT_PX)
    ship, guns, hull = SS_SHIP
    layers = ["base"] + [f"guns{n}" for n in (2, 3) if guns >= n]
    cache = {f"{ship}-{layer}": ss._ship_layer(ship, layer) for layer in layers}
    arrow = _sprite(ss.compose_ship(ship, guns, hull, cache), SS_SHIP_PX)
    return [(grunt, p) for p in SS_GRUNTS] + [(arrow, SS_SHIP_AT)]


# --------------------------------------------------------------------------------------------
# Cascade (pick A): the drop. A cherry (tier 0) falls on its guide line into the bin, onto the
# watermelon (tier 10) resting on the floor. The pieces are the game's kawaii fruits (theme.cascade
# CASCADE_ART: the body's radial tone l -> b -> d, the face with its ink, blush and glint, the
# cherry's stem and leaf); the melon shows two of its stripes (four wavy ones cost ~600 B). The bin
# is the game's thick rounded U band in the accent (game/cascade/art/bin.ts), here the light
# theme's accent so it reads on both cards.

CA_FRUIT = {  # body b, light l, dark d, outline o, face ink
    "cherry": ("#d81e3a", "#ff5a6e", "#8a0b20", "#6e0718", "#3a1418"),
    "melon": ("#2f9a3e", "#6bd06a", "#17602a", "#0f4a1f", "#0a2a10"),
}
CA_TIER = {"cherry": 0, "melon": 10}  # Fruits tiers (theme.cascade's ladder)
CA_BLUSH = hexrgb("#ff3b6b")  # CASCADE_ART.blushOpen
CA_LEAF = hexrgb("#4fae3c")  # leaf
CA_STEM = hexrgb("#7a4a22")  # stem
CA_ACCENT = hexrgb("#1bc5d4")  # CASCADE_BIN_PALETTE.light.accent
CA_BIN = (24, 168, 30, 172)  # inner-ish left x, right x, top y, floor y (px): the band's centre
CA_BAND = 7  # the band's width (px)
CA_MELON = (96, 134, 32)  # centre, radius (px)
CA_CHERRY = (96, 44, 12)
CA_GUIDE = ((96, 60), (96, 92))  # the drop guide, dashed (px)


def fruit(c: TileCanvas, kind: str, cx: float, cy: float, r: float) -> None:
    b, l, d, o, ink = (hexrgb(h) for h in CA_FRUIT[kind])
    if kind == "cherry":
        stem = [
            (cx + 0.04 * r, cy - 0.82 * r),
            (cx + 0.18 * r, cy - 1.2 * r),
            (cx + 0.3 * r, cy - 1.42 * r),
        ]
        c.stroke(stem, max(1.6, r * 0.12), CA_STEM, closed=False)
        leaf = rounded_rect(cx + 0.55 * r, cy - 1.28 * r, 0.6 * r, 0.3 * r, 0.15 * r, -0.4)
        c.polygon(leaf, CA_LEAF)
    c.ellipse(
        cx, cy, r, r, Radial((cx - 0.25 * r, cy - 0.35 * r), 1.35 * r, [(0, l), (0.55, b), (1, d)])
    )
    if kind == "melon":
        for s in (-0.55, 0.55):
            pts = []
            y = -1.0
            while y <= 1.0:
                pts.append((cx + s * math.sqrt(max(0, 1 - y * y)) * r, cy + y * r))
                y += 0.1
            c.stroke(pts, max(1.5, 0.16 * r), (*o[:3], 0.9), closed=False)
    c.outline(ellipse_pts(cx, cy, r, r))
    s, fy = 1.15, cy + 0.08 * r  # the face: open eyes with glints, blush, a smile
    for sx in (-1, 1):
        c.ellipse(
            cx + sx * 0.4 * s * r,
            fy + 0.12 * s * r,
            0.12 * s * r,
            0.055 * s * r,
            (*CA_BLUSH[:3], 0.3),
        )
        ex, ey = cx + sx * 0.36 * s * r, fy - 0.1 * s * r
        c.ellipse(ex, ey, 0.13 * s * r, 0.13 * s * r, ink)
        c.ellipse(ex - 0.04 * s * r, ey - 0.05 * s * r, 0.04 * s * r, 0.04 * s * r, (1, 1, 1, 1))
    smile = quad(
        (cx - 0.13 * s * r, fy + 0.04 * s * r),
        (cx, fy + 0.17 * s * r),
        (cx + 0.13 * s * r, fy + 0.04 * s * r),
        8,
    )
    c.stroke(smile, max(1.2, 0.05 * s * r), ink, closed=False)
    c.ellipse(cx - 0.42 * r, cy - 0.5 * r, 0.16 * r, 0.1 * r, (1, 1, 1, 0.6))  # gloss


def bin_path() -> list[Point]:
    """The bin's U: down the left wall, round the floor's corners, up the right wall."""
    x0, x1, top, floor = CA_BIN
    r = 18
    pts: list[Point] = [(x0, top), (x0, floor - r)]
    pts += [
        (x0 + r - r * math.cos(a), floor - r + r * math.sin(a))
        for a in [k * math.pi / 16 for k in range(9)]
    ]
    pts += [
        (x1 - r + r * math.cos(a), floor - r + r * math.sin(a))
        for a in [math.pi / 2 - k * math.pi / 16 for k in range(9)]
    ]
    return [*pts, (x1, top)]


def dashes(pts: Sequence[Point], dash: float, gap: float) -> list[list[Point]]:
    """An open path cut into dashes `dash` long, `gap` apart."""
    out: list[list[Point]] = []
    cur: list[Point] = []
    on, left = True, dash
    for a, b in itertools.pairwise(pts):
        seg = math.dist(a, b)
        t = 0.0
        while seg - t > 1e-9:
            step = min(left, seg - t)
            p0 = (a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg)
            t += step
            p1 = (a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg)
            if on:
                cur = cur or [p0]
                cur.append(p1)
            left -= step
            if left <= 1e-9:
                if on:
                    out.append(cur)
                    cur = []
                on, left = not on, (gap if on else dash)
    if cur:
        out.append(cur)
    return out


def cascade_scene(c: TileCanvas) -> None:
    pts = bin_path()
    c.stroke(pts, CA_BAND + 2 * OUTLINE_W, OUTLINE, closed=False)
    c.stroke(pts, CA_BAND, CA_ACCENT, closed=False)
    fruit(c, "melon", *CA_MELON)
    for d in dashes(CA_GUIDE, 4, 4):
        c.stroke(d, 1.6, OUTLINE, closed=False)
    fruit(c, "cherry", *CA_CHERRY)


# --------------------------------------------------------------------------------------------
# Registry and output

Layers = list[tuple[Image.Image, Point]]  # sprites (image, centre px), composited last

SCENES: dict[str, Callable[[TileCanvas], Layers | None]] = {
    "sort": sort_scene,
    "yacht": yacht_scene,
    "twenty48": twenty48_scene,
    "sudoku": sudoku_scene,
    "solitaire": solitaire_scene,
    "freecell": freecell_scene,
    "daily_word": dailyword_scene,
    "blackjack": blackjack_scene,
    "hearts": hearts_scene,
    "mahjong": mahjong_scene,
    "starswarm": starswarm_scene,
    "cascade": cascade_scene,
}

# Scenes drawn from a game's own sprites, which carry their own rims and armour outline (as the
# game shows them) instead of the shared grey OUTLINE.
OUTLINE_EXEMPT = frozenset({"starswarm"})


def render(name: str) -> Image.Image:
    c = TileCanvas()
    layers = SCENES[name](c)
    im = c.image()
    for sprite, (cx, cy) in layers or ():
        im.alpha_composite(sprite, (round(cx - sprite.width / 2), round(cy - sprite.height / 2)))
    return im


def _card(im: Image.Image, bg: tuple[int, int, int, int], size: int) -> Image.Image:
    cell = Image.new("RGBA", (size + 16, size + 16), bg)
    cell.alpha_composite(im.resize((size, size), Image.LANCZOS), (8, 8))
    return cell


def contact_sheet(cache: dict[str, Image.Image]) -> Image.Image:
    """Row 1: each tile at 3x on the dark card. Rows 2-3: at 64 pt (shown at 2x, the pixels a
    2x phone draws) on the dark and the light card. Row 4: the same at 1x."""
    names = list(cache)
    col_w = TILE_PX + 24
    rows = [
        [_card(cache[n], CARD_DARK, TILE_PX) for n in names],
        [_card(cache[n], CARD_DARK, DISPLAY_PT * 2) for n in names],
        [_card(cache[n], CARD_LIGHT, DISPLAY_PT * 2) for n in names],
        [_card(cache[n], CARD_DARK, DISPLAY_PT) for n in names]
        + [_card(cache[n], CARD_LIGHT, DISPLAY_PT) for n in names],
    ]
    labels = ["3x (192 px)", "64 pt at 2x, dark card", "64 pt at 2x, light card", "64 pt at 1x"]
    heights = [max(im.height for im in r) + 20 for r in rows]
    width = max(col_w * len(names), (DISPLAY_PT + 24) * 2 * len(names))
    sheet = Image.new("RGBA", (width, sum(heights)), SHEET_BG)
    d = ImageDraw.Draw(sheet)
    y = 0
    for r, (row, label) in enumerate(zip(rows, labels, strict=True)):
        step = col_w if r < 3 else DISPLAY_PT + 24
        d.text((4, y + 2), label + ("" if r else "  " + "  ".join(names)), fill=(200, 210, 230))
        for i, im in enumerate(row):
            sheet.alpha_composite(im, (i * step + 4, y + 16))
        y += heights[r]
    return sheet


def main(out_dir: Path | None, names: Sequence[str], sheet: bool = False) -> Path:
    unknown = [n for n in names if n not in SCENES]
    if unknown:
        sys.exit(f"unknown name(s): {', '.join(unknown)}\nvalid names: {', '.join(SCENES)}")
    out = out_dir if out_dir is not None else Path(tempfile.mkdtemp(prefix="lobby-tile-art-"))
    out.mkdir(parents=True, exist_ok=True)
    cache: dict[str, Image.Image] = {}
    total = 0
    for name in names or list(SCENES):
        data = to_webp(render(name))
        (out / f"{name}-tile.webp").write_bytes(data)
        cache[name] = decode_webp(data)
        total += len(data)
        print(f"{name}: {cache[name].width}x{cache[name].height}  {len(data):,} B")
    print(f"total: {total:,} B")
    if sheet:
        for n in SCENES:
            if n not in cache:
                cache[n] = decode_webp(to_webp(render(n)))
        contact_sheet(cache).save(out / "contact-sheet.png")
        print(f"contact sheet: {out / 'contact-sheet.png'}")
    return out


def parse(argv: Sequence[str]) -> tuple[Path | None, list[str], bool]:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("names", nargs="*", help="scenes to draw (default: all)")
    ap.add_argument("--out", type=Path, default=None, help="output directory (default: a temp dir)")
    ap.add_argument("--sheet", action="store_true", help="also write contact-sheet.png")
    ns = ap.parse_intermixed_args(argv)
    return ns.out, ns.names, ns.sheet


if __name__ == "__main__":
    if sys.argv[1:2] == ["extract"]:
        if len(sys.argv) != 3:
            sys.exit("usage: draw_lobby_tile_art.py extract FONT.ttf")
        extract(Path(sys.argv[2]))
        print(f"wrote {DIGITS_FILE} and {LETTERS_FILE}")
    else:
        out_dir = main(*parse(sys.argv[1:]))
        print(f"output: {out_dir}")
