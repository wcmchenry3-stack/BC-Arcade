"""Deterministic lobby tile art: a gameplay vignette per game (#4011, #4012; style decided in #4010).

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
`cd frontend && npm ci`) and needs fontTools.

The pipeline is `draw_starswarm_art.py`'s: shapes rasterized at 8x, LANCZOS down, composited over
premultiplied float RGBA, and the same WebP settings. The same code gives identical pixels.
"""

from __future__ import annotations

import argparse
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

from draw_starswarm_art import (
    RGBA,
    SS,
    Canvas,
    Point,
    decode_webp,
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


def card(c: TileCanvas, x: int, y: int, w: int, h: int, face: str | None) -> None:
    """A card whose top-left corner is pixel (x, y). `face` is rank + suit ("7H"), or None for a
    face-down card. A face shows its index only (the rank, the suit beside it): a cascade shows
    each card's top strip, and the index is what a player reads there.

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
        ink = CARD_RED if is_red(face) else CARD_INK
        ix, iy = x + CARD_SNAP + CARD_INDEX, y + CARD_SNAP + CARD_INDEX
        text(c, face[:-1], ix / K, iy / K, CARD_RANK_CAP / K, ink)
        suit(c, face[-1], x + CARD_SNAP + w - CARD_INDEX, iy, CARD_SUIT_PX)
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
# Registry and output

SCENES: dict[str, Callable[[TileCanvas], None]] = {
    "sort": sort_scene,
    "yacht": yacht_scene,
    "twenty48": twenty48_scene,
    "sudoku": sudoku_scene,
    "solitaire": solitaire_scene,
    "freecell": freecell_scene,
    "daily_word": dailyword_scene,
}


def render(name: str) -> Image.Image:
    c = TileCanvas()
    SCENES[name](c)
    return c.image()


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
