"""Draw the 42 Mahjong tile faces in code, in the classic Hong Kong style (#3611).

Our own art: coin dots, caned bamboo with a sparrow on 1-bamboo, calligraphic characters, winds
and dragons, and painted seasons and flowers. Each face is a 300x420 SVG art box under the file
names the app already loads (`frontend/assets/mahjong/01-white-dragon.svg` ... `42-bamboo.svg`);
the canvas draws the ivory tile around it.

The lettering is Yuji Syuku (SIL Open Font License 1.1) glyph outlines, reshaped per character to
recover the classic tile calligraphy (a long tapering tail on 中, a flared, leaning base on 東 and
萬, ...) and given a little extra weight for small sizes. The outlines are extracted once into
`mahjong_glyphs.json` (committed, with the font's licence in `mahjong_glyphs.OFL.txt`), so a build
needs neither the network nor the font, and every build writes the same files.

Run from the repo root:
    python tools/assets/gen_mahjong_tiles.py [out_dir]          # draw the 42 faces
    python tools/assets/gen_mahjong_tiles.py extract FONT_DIR   # refresh mahjong_glyphs.json

FONT_DIR is the `files/` folder of the `@fontsource/yuji-syuku@5.3.1` npm package (extract needs
fontTools and brotli).
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DEFAULT = HERE.parents[1] / "frontend" / "assets" / "mahjong"
GLYPHS_FILE = HERE / "mahjong_glyphs.json"
FONT_PACKAGE = "@fontsource/yuji-syuku@5.3.1 (weight 400)"

# Every character a face uses.
CHARS = "一二三四伍六七八九萬東南西北中發春夏秋冬1234"

BLUE, GREEN, RED, IVORY = "#1f47a6", "#16773b", "#c3262e", "#fbf6e9"
DARK_GREEN, LIGHT_GREEN, PINK, GOLD, BARK = "#0b4a24", "#5aa35e", "#e0607a", "#e3a52a", "#7a5a2e"

Point = tuple[float, float]
Glyph = dict  # {"ops": [[op, x, y, ...], ...], "bounds": [x0, y0, x1, y1]} in font units (y up)


# --- glyphs: extract once, draw from the cache ---------------------------------------------------


def extract(font_dir: Path) -> None:
    """Write mahjong_glyphs.json: each character's outline as M/L/Q/C/Z ops, in font units."""
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

    fonts = [TTFont(f) for f in sorted(font_dir.glob("*-400-normal.woff2"))]
    out: dict[str, Glyph] = {}
    for ch in CHARS:
        for f in fonts:
            cmap = f.getBestCmap()
            if ord(ch) in cmap:
                gs = f.getGlyphSet()
                pen = OpsPen(gs)
                gs[cmap[ord(ch)]].draw(pen)
                ops = [[o[0], *[round(v) for v in o[1:]]] for o in pen.ops]
                pts = [(o[i], o[i + 1]) for o in ops for i in range(1, len(o), 2)]
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                out[ch] = {"ops": ops, "bounds": [min(xs), min(ys), max(xs), max(ys)]}
                break
        else:
            raise SystemExit(f"{ch} is not in the font")
    doc = {"font": FONT_PACKAGE, "license": "SIL Open Font License 1.1", "glyphs": out}
    GLYPHS_FILE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")


_GLYPHS: dict[str, Glyph] | None = None


def glyphs() -> dict[str, Glyph]:
    global _GLYPHS
    if _GLYPHS is None:
        _GLYPHS = json.loads(GLYPHS_FILE.read_text())["glyphs"]
    return _GLYPHS


def warp_for(ch: str, b: list[float]) -> Callable[[float, float], Point]:
    """The per-character reshaping that recovers the classic tile calligraphy (font units, y up)."""
    x0, y0, x1, y1 = b
    cx, cy, h = (x0 + x1) / 2, (y0 + y1) / 2, y1 - y0
    if ch == "中":  # a long tapering tail below the box
        t = y0 + 0.30 * h

        def f(x, y):
            if y < t:
                frac = (t - y) / (t - y0)
                return cx + (x - cx) * (1 - 0.55 * frac), t - (t - y) * 2.0
            return x, y

        return f
    if ch in "東萬":  # a flared base and a slight lean
        flare, lean = (0.30, 0.08) if ch == "東" else (0.22, 0.05)
        return lambda x, y: (
            cx + (x - cx) * (1 + flare * max(0.0, (cy - y) / (cy - y0))) + lean * (y - cy),
            y,
        )
    if ch in "發南西北":  # a lean
        return lambda x, y: (cx + (x - cx) * 1.04 + 0.06 * (y - cy), y)
    if ch == "三":  # a rising slope
        return lambda x, y: (x, y + 0.07 * (x - cx))
    return lambda x, y: (x, y)


WEIGHT = 22  # extra stroke (font units) so the lettering holds up at 26 px


def glyph(ch: str, cx: float, cy: float, size: float, fill: str) -> str:
    """The character as an SVG path, reshaped, its ink box `size` px on its long side, centred."""
    g = glyphs()[ch]
    f = warp_for(ch, g["bounds"])
    parts, xs, ys = [], [], []
    for op in g["ops"]:
        pts = [f(op[i], op[i + 1]) for i in range(1, len(op), 2)]
        for x, y in pts:
            xs.append(x)
            ys.append(y)
        parts.append(op[0] + " ".join(f"{x:.0f} {y:.0f}" for x, y in pts))
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    s = size / max(x1 - x0, y1 - y0)
    tx, ty = cx - (x0 + x1) / 2 * s, cy + (y0 + y1) / 2 * s
    return (
        f'<path fill="{fill}" stroke="{fill}" stroke-width="{WEIGHT}" stroke-linejoin="round" '
        f'transform="matrix({s:.4f} 0 0 {-s:.4f} {tx:.1f} {ty:.1f})" d="{"".join(parts)}"/>'
    )


# --- shapes --------------------------------------------------------------------------------------


def n(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def dot(cx: float, cy: float, r: float, ring: str) -> str:
    """A coin dot: an outer ring, a light band, a thin inner ring and a solid centre with an eye."""
    return (
        f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{ring}"/>'
        f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.82)}" fill="{IVORY}"/>'
        f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.66)}" fill="none" stroke="{ring}" stroke-width="{n(r * 0.12)}"/>'
        f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.36)}" fill="{ring}"/>'
        f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.14)}" fill="{IVORY}"/>'
    )


def big_dot() -> str:
    """1 dot: one large ornate coin, ringed in blue, green and red, with a scalloped band."""
    cx, cy = 150, 210
    out = f'<circle cx="{cx}" cy="{cy}" r="112" fill="{BLUE}"/><circle cx="{cx}" cy="{cy}" r="98" fill="{IVORY}"/>'
    # scalloped green band: a ring of small circles
    for k in range(24):
        a = 2 * math.pi * k / 24
        out += f'<circle cx="{n(cx + 80 * math.cos(a))}" cy="{n(cy + 80 * math.sin(a))}" r="11" fill="{GREEN}"/>'
    out += f'<circle cx="{cx}" cy="{cy}" r="70" fill="{IVORY}"/>'
    out += f'<circle cx="{cx}" cy="{cy}" r="58" fill="none" stroke="{RED}" stroke-width="10"/>'
    for k in range(8):  # an eight-petal rosette
        a = 2 * math.pi * k / 8
        out += (
            f'<ellipse cx="{n(cx + 28 * math.cos(a))}" cy="{n(cy + 28 * math.sin(a))}" rx="16" ry="9" '
            f'fill="{GREEN}" transform="rotate({n(math.degrees(a))} {n(cx + 28 * math.cos(a))} {n(cy + 28 * math.sin(a))})"/>'
        )
    out += f'<circle cx="{cx}" cy="{cy}" r="16" fill="{RED}"/><circle cx="{cx}" cy="{cy}" r="6" fill="{IVORY}"/>'
    return out


def stick(
    cx: float, top: float, h: float, w: float = 44, color: str = GREEN, angle: float = 0
) -> str:
    """A bamboo stick: two waisted cane segments between three nodes, with a light centre line."""
    out, seg = "", h / 2
    hw, wm = w / 2, w * 0.24
    for k in range(2):
        y0, y1 = top + k * seg, top + (k + 1) * seg
        ym = (y0 + y1) / 2
        out += (
            f'<path d="M{n(cx - hw)} {n(y0)}Q{n(cx - wm)} {n(ym)} {n(cx - hw)} {n(y1)}L{n(cx + hw)} {n(y1)}'
            f'Q{n(cx + wm)} {n(ym)} {n(cx + hw)} {n(y0)}Z" fill="{color}"/>'
        )
        out += (
            f'<path d="M{n(cx)} {n(y0 + 7)}L{n(cx)} {n(y1 - 7)}" stroke="{IVORY}" stroke-width="{n(w * 0.12)}" '
            f'stroke-linecap="round" opacity="0.6"/>'
        )
    for f in (0.0, 0.5, 1.0):
        y = top + f * h
        out += f'<rect x="{n(cx - w * 0.62)}" y="{n(y - 6)}" width="{n(w * 1.24)}" height="12" rx="6" fill="{color}"/>'
        out += f'<rect x="{n(cx - w * 0.45)}" y="{n(y - 2)}" width="{n(w * 0.9)}" height="4" rx="2" fill="{DARK_GREEN}"/>'
    if angle:
        out = f'<g transform="rotate({n(angle)} {n(cx)} {n(top + h / 2)})">{out}</g>'
    return out


# --- painted plants (seasons and flowers) --------------------------------------------------------


def stem(d: str, w: float = 7, color: str = GREEN) -> str:
    return (
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{n(w)}" stroke-linecap="round"/>'
    )


def leaf(cx: float, cy: float, length: float, angle: float, color: str = GREEN) -> str:
    """A pointed leaf: two arcs meeting at the tips, rotated to `angle` degrees."""
    L, W = length / 2, length * 0.2
    return (
        f'<path d="M{n(-L)} 0Q0 {n(-W * 2)} {n(L)} 0Q0 {n(W * 2)} {n(-L)} 0Z" fill="{color}" '
        f'transform="translate({n(cx)} {n(cy)}) rotate({n(angle)})"/>'
    )


def blossom(cx: float, cy: float, r: float, color: str, petals: int = 5, centre: str = GOLD) -> str:
    out = ""
    for k in range(petals):
        a = 2 * math.pi * k / petals - math.pi / 2
        out += f'<circle cx="{n(cx + r * 0.55 * math.cos(a))}" cy="{n(cy + r * 0.55 * math.sin(a))}" r="{n(r * 0.5)}" fill="{color}"/>'
    return out + f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.3)}" fill="{centre}"/>'


def mum(cx: float, cy: float, r: float, color: str = RED) -> str:
    """A chrysanthemum head: two rings of narrow petals around a gold centre."""
    out = ""
    for ring, (rr, k_n) in enumerate(((r, 16), (r * 0.65, 12))):
        for k in range(k_n):
            a = 360 * k / k_n + ring * 11
            out += (
                f'<ellipse cx="{n(cx)}" cy="{n(cy - rr * 0.55)}" rx="{n(rr * 0.13)}" ry="{n(rr * 0.45)}" fill="{color}" '
                f'opacity="{0.85 if ring else 1}" transform="rotate({n(a)} {n(cx)} {n(cy)})"/>'
            )
    return out + f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.25)}" fill="{GOLD}"/>'


def plant_plum() -> str:
    out = stem("M90 380Q120 300 115 235Q110 180 160 130", 10, BARK) + stem(
        "M114 250Q160 230 205 185", 7, BARK
    )
    out += stem("M108 300Q78 275 72 235", 6, BARK)
    for x, y, a in ((140, 300, -40), (100, 260, 40), (180, 200, -30)):
        out += leaf(x, y, 46, a)
    for x, y, r in (
        (160, 130, 34),
        (205, 185, 30),
        (72, 235, 28),
        (160, 225, 24),
        (130, 180, 22),
    ):
        out += blossom(x, y, r, PINK)
    return out


def plant_mum() -> str:
    out = stem("M150 385Q150 300 150 230", 8)
    for x, y, a in ((115, 320, -35), (185, 300, 35), (118, 270, -20), (182, 345, 20)):
        out += leaf(x, y, 70, a)
    return out + mum(158, 210, 72)


def plant_bamboo() -> str:
    out = ""
    for x, top in ((128, 135), (192, 105)):
        out += stick(x, top, 280, w=26, color=GREEN)
    for x, y, a in (
        (98, 185, -40),
        (82, 225, -20),
        (226, 135, 40),
        (247, 175, 20),
        (222, 235, 50),
        (102, 268, -50),
    ):
        out += leaf(x, y, 64, a)
    return out


def plant_summer() -> str:  # a lotus over its leaves
    out = stem("M150 390L150 250", 7)
    out += f'<ellipse cx="95" cy="350" rx="62" ry="22" fill="{GREEN}"/><ellipse cx="205" cy="330" rx="55" ry="20" fill="{LIGHT_GREEN}"/>'
    for a in (-50, -25, 0, 25, 50):
        out += (
            f'<ellipse cx="150" cy="200" rx="18" ry="52" fill="{PINK}" opacity="0.95" '
            f'transform="rotate({a} 150 250)"/>'
        )
    return out + f'<circle cx="150" cy="215" r="14" fill="{GOLD}"/>'


# --- the bird, and the season and flower plants ----------------------------------------------

PURPLE, SNOW, SNOW_EDGE, ORANGE, BLUE_LIGHT = "#8a3f92", "#ffffff", "#6f8fb0", "#e07a1f", "#4f7fd0"


def feather_rows(
    cx: float, cy: float, grid: tuple[int, int, float, float, float], colors: list[str]
) -> str:
    """Scalloped feathers: rows of overlapping half-discs, each row in its own colour.

    grid is (rows, cols, dx, dy, r): the rows and columns, their spacing and the feather radius.
    """
    rows, cols, dx, dy, r = grid
    out = ""
    for i in range(rows):
        for j in range(cols):
            x, y = cx + j * dx + (i % 2) * dx / 2, cy + i * dy
            out += f'<path d="M{n(x - r)} {n(y)}A{n(r)} {n(r)} 0 0 0 {n(x + r)} {n(y)}Z" fill="{colors[i % len(colors)]}" stroke="{IVORY}" stroke-width="1.5"/>'
    return out


def tail_feather(
    x0: float, y0: float, length: float, angle: float, color: str, eye: bool = False
) -> str:
    """A long tapering feather from (x0, y0), with a striped vane, or an eye-spot (peacock)."""
    a = math.radians(angle)
    x1, y1 = x0 + length * math.cos(a), y0 + length * math.sin(a)
    px, py = -math.sin(a), math.cos(a)
    w = length * 0.11
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    out = (
        f'<path d="M{n(x0)} {n(y0)}Q{n(mx + px * w * 2)} {n(my + py * w * 2)} {n(x1)} {n(y1)}'
        f'Q{n(mx - px * w * 2)} {n(my - py * w * 2)} {n(x0)} {n(y0)}Z" fill="{color}"/>'
    )
    out += f'<path d="M{n(x0)} {n(y0)}L{n(x1)} {n(y1)}" stroke="{IVORY}" stroke-width="1.6" opacity="0.7"/>'
    if eye:
        ex, ey = x0 + 0.78 * length * math.cos(a), y0 + 0.78 * length * math.sin(a)
        rot = n(angle)
        out += (
            f'<ellipse cx="{n(ex)}" cy="{n(ey)}" rx="{n(w * 1.5)}" ry="{n(w * 1.1)}" fill="{GOLD}" transform="rotate({rot} {n(ex)} {n(ey)})"/>'
            f'<ellipse cx="{n(ex)}" cy="{n(ey)}" rx="{n(w * 1.0)}" ry="{n(w * 0.75)}" fill="{GREEN}" transform="rotate({rot} {n(ex)} {n(ey)})"/>'
            f'<ellipse cx="{n(ex)}" cy="{n(ey)}" rx="{n(w * 0.55)}" ry="{n(w * 0.45)}" fill="{BLUE}" transform="rotate({rot} {n(ex)} {n(ey)})"/>'
        )
    else:
        for f in (0.35, 0.55, 0.75):
            sx, sy = x0 + f * length * math.cos(a), y0 + f * length * math.sin(a)
            out += f'<path d="M{n(sx - px * w)} {n(sy - py * w)}L{n(sx + px * w)} {n(sy + py * w)}" stroke="{IVORY}" stroke-width="2.4" opacity="0.8"/>'
    return out


def bird_sparrow() -> str:
    """A: a detailed sparrow on a leafy branch: layered tail, scalloped wing, shaded breast."""
    out = stem("M40 318Q150 296 270 312", 11, BARK)
    for x, y, a in ((60, 300, -20), (250, 296, 25), (215, 330, 40)):
        out += leaf(x, y, 50, a)
    for ang, col in ((118, GREEN), (126, BLUE), (134, RED), (142, GREEN), (150, BLUE)):
        out += tail_feather(128, 248, 150, ang, col)
    out += f'<ellipse cx="162" cy="214" rx="74" ry="56" fill="{GREEN}"/>'
    out += f'<ellipse cx="196" cy="238" rx="38" ry="40" fill="{RED}"/>'
    out += '<ellipse cx="204" cy="248" rx="22" ry="26" fill="#e86a52"/>'
    out += feather_rows(110, 196, (3, 4, 22, 13, 13), [BLUE, BLUE_LIGHT, GREEN])
    out += f'<circle cx="226" cy="142" r="38" fill="{GREEN}"/>'
    out += f'<path d="M200 128Q226 112 252 130Q228 136 200 128Z" fill="{BLUE}"/>'
    out += f'<circle cx="236" cy="138" r="10" fill="{IVORY}"/><circle cx="238" cy="138" r="5.5" fill="#1b2a4a"/>'
    out += f'<path d="M258 146L292 154L258 164Z" fill="{GOLD}"/>'
    out += f'<path d="M206 106Q212 76 240 92Q226 98 216 116Z" fill="{RED}"/><path d="M196 112Q192 88 214 92Q206 100 206 114Z" fill="{RED}"/>'
    out += f'<path d="M180 266L172 308M206 268L212 308" stroke="{GOLD}" stroke-width="6" stroke-linecap="round"/>'
    return out


def bird_peacock() -> str:
    """B: a peacock: a fanned tail of eye-spot feathers, a slender blue neck and a crest."""
    out = ""
    for k in range(9):
        ang = 100 + k * 10
        out += tail_feather(150, 270, 175, ang, GREEN if k % 2 else "#2e8f55", eye=True)
    out += f'<ellipse cx="170" cy="248" rx="46" ry="34" fill="{BLUE}"/>'
    out += feather_rows(140, 236, (2, 3, 22, 12, 12), [GREEN, BLUE_LIGHT])
    out += f'<path d="M188 236Q226 200 210 150Q204 128 218 112L234 118Q222 138 230 160Q240 206 206 248Z" fill="{BLUE}"/>'
    out += f'<circle cx="226" cy="114" r="16" fill="{BLUE}"/><circle cx="231" cy="110" r="4.5" fill="{IVORY}"/>'
    out += f'<path d="M240 116L262 122L240 128Z" fill="{GOLD}"/>'
    for dx in (-10, 0, 10):
        out += f'<path d="M226 100L{226 + dx * 1.6} 72" stroke="{BLUE}" stroke-width="2.5"/><circle cx="{226 + dx * 1.6}" cy="70" r="5" fill="{GREEN}"/>'
    out += f'<path d="M168 278L160 318M186 278L190 318" stroke="{GOLD}" stroke-width="6" stroke-linecap="round"/>'
    out += stem("M70 322L240 322", 10, BARK)
    return out


def bird_on_bamboo() -> str:
    """C: a sparrow perched on a bamboo stalk, with bamboo leaves: the bird tied to its suit."""
    out = stick(92, 40, 360, w=40)
    for x, y, a in ((140, 92, -25), (150, 120, 10), (52, 300, 200), (48, 330, 160)):
        out += leaf(x, y, 66, a)
    for ang, col in ((132, GREEN), (142, RED), (152, BLUE)):
        out += tail_feather(150, 256, 110, ang, col)
    out += f'<ellipse cx="182" cy="226" rx="58" ry="46" fill="{GREEN}"/>'
    out += f'<ellipse cx="208" cy="246" rx="30" ry="32" fill="{RED}"/>'
    out += feather_rows(140, 212, (3, 3, 20, 12, 12), [BLUE, BLUE_LIGHT, GREEN])
    out += f'<circle cx="230" cy="166" r="32" fill="{GREEN}"/>'
    out += f'<circle cx="240" cy="160" r="8" fill="{IVORY}"/><circle cx="242" cy="160" r="4.5" fill="#1b2a4a"/>'
    out += f'<path d="M258 166L286 172L258 180Z" fill="{GOLD}"/>'
    out += f'<path d="M214 136Q222 112 244 126Q230 130 222 142Z" fill="{RED}"/>'
    out += f'<path d="M176 268L112 286M196 270L112 296" stroke="{GOLD}" stroke-width="5" stroke-linecap="round"/>'
    return out


def peach_blossom(cx: float, cy: float, r: float) -> str:
    """A five-petal peach blossom with notched petals, darker heart and stamens."""
    out = ""
    for k in range(5):
        a = 2 * math.pi * k / 5 - math.pi / 2
        px, py = cx + r * 0.55 * math.cos(a), cy + r * 0.55 * math.sin(a)
        out += (
            f'<ellipse cx="{n(px)}" cy="{n(py)}" rx="{n(r * 0.42)}" ry="{n(r * 0.52)}" fill="{PINK}" '
            f'transform="rotate({n(math.degrees(a) + 90)} {n(px)} {n(py)})"/>'
        )
    out += f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r * 0.32)}" fill="{RED}"/>'
    for k in range(6):
        a = 2 * math.pi * k / 6
        out += f'<circle cx="{n(cx + r * 0.38 * math.cos(a))}" cy="{n(cy + r * 0.38 * math.sin(a))}" r="{n(r * 0.07)}" fill="{GOLD}"/>'
    return out


def plant_spring() -> str:
    """Spring: a peach branch in bloom, with buds and fresh leaves."""
    out = stem("M60 380Q110 320 140 250Q170 180 230 130", 9, BARK) + stem(
        "M128 280Q90 240 86 190", 6, BARK
    )
    for x, y, a in ((150, 230, -30), (110, 300, 30), (200, 168, 20), (95, 215, -60)):
        out += leaf(x, y, 46, a, LIGHT_GREEN)
    for x, y, r in ((230, 130, 34), (86, 186, 28), (170, 200, 26)):
        out += peach_blossom(x, y, r)
    for x, y in ((200, 128), (120, 250), (104, 168)):
        out += f'<ellipse cx="{x}" cy="{y}" rx="7" ry="11" fill="{PINK}"/><path d="M{x - 6} {y + 8}Q{x} {y + 16} {x + 6} {y + 8}" fill="{LIGHT_GREEN}"/>'
    return out


def maple_leaf(cx: float, cy: float, r: float, angle: float, color: str) -> str:
    """A five-lobed maple leaf with a short stem."""
    pts = []
    for k in range(10):
        a = math.radians(angle - 90 + k * 36)
        rr = r if k % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d = "M" + "L".join(f"{n(x)} {n(y)}" for x, y in pts) + "Z"
    a = math.radians(angle + 90)
    return (
        f'<path d="{d}" fill="{color}" stroke="{color}" stroke-width="6" stroke-linejoin="round"/>'
        f'<path d="M{n(cx)} {n(cy)}L{n(cx + r * 1.2 * math.cos(a))} {n(cy + r * 1.2 * math.sin(a))}" stroke="{BARK}" stroke-width="4"/>'
    )


def plant_autumn() -> str:
    """Autumn: maple leaves turning red, orange and gold on a twig."""
    out = stem("M70 380Q120 300 160 240Q190 190 230 150", 8, BARK) + stem(
        "M150 260Q100 220 90 160", 6, BARK
    )
    for x, y, r, a, c in (
        (230, 150, 40, 15, RED),
        (90, 160, 36, -20, ORANGE),
        (170, 225, 34, 30, GOLD),
        (110, 290, 30, -35, RED),
        (215, 260, 26, 50, ORANGE),
    ):
        out += maple_leaf(x, y, r, a, c)
    return out


def needles(cx: float, cy: float, r: float) -> str:
    """A fan of pine needles."""
    out = ""
    for k in range(13):
        a = math.radians(-170 + k * 13.3)
        out += f'<path d="M{n(cx)} {n(cy)}L{n(cx + r * math.cos(a))} {n(cy + r * math.sin(a))}" stroke="{GREEN}" stroke-width="4" stroke-linecap="round"/>'
    return out


def plant_winter() -> str:
    """Winter: a pine branch with snow resting on its needles."""
    out = stem("M60 380Q100 300 150 260Q200 220 240 150", 11, BARK) + stem(
        "M140 270Q100 230 70 200", 7, BARK
    )
    for x, y, r in ((240, 150, 46), (70, 200, 40), (180, 225, 42), (120, 300, 36)):
        out += needles(x, y, r)
        out += (  # a cap of snow resting on the needles
            f'<path d="M{n(x - r)} {n(y - r * 0.35)}Q{n(x)} {n(y - r * 1.05)} {n(x + r)} {n(y - r * 0.35)}'
            f'Q{n(x)} {n(y - r * 0.15)} {n(x - r)} {n(y - r * 0.35)}Z" fill="{SNOW}" stroke="{SNOW_EDGE}" stroke-width="4"/>'
        )
    out += f'<path d="M96 318Q130 272 168 250" fill="none" stroke="{SNOW_EDGE}" stroke-width="10" stroke-linecap="round"/>'
    out += f'<path d="M96 316Q130 270 168 248" fill="none" stroke="{SNOW}" stroke-width="7" stroke-linecap="round"/>'
    for x, y, r in (
        (60, 110, 6),
        (130, 80, 5),
        (175, 130, 4),
        (40, 280, 5),
        (250, 300, 6),
        (210, 80, 4),
    ):
        out += f'<circle cx="{x}" cy="{y}" r="{r}" fill="{SNOW}" stroke="{SNOW_EDGE}" stroke-width="2"/>'
    return out


def orchid_bloom(cx: float, cy: float, r: float) -> str:
    """An orchid flower: three sepals, two petals and a frilled lip."""
    out = ""
    for a, rx, ry in ((-90, 0.22, 0.55), (150, 0.22, 0.5), (30, 0.22, 0.5)):
        rad = math.radians(a)
        px, py = cx + r * 0.45 * math.cos(rad), cy + r * 0.45 * math.sin(rad)
        out += (
            f'<ellipse cx="{n(px)}" cy="{n(py)}" rx="{n(r * rx)}" ry="{n(r * ry)}" fill="{PURPLE}" '
            f'transform="rotate({a + 90} {n(px)} {n(py)})"/>'
        )
    for a in (-30, -150):
        rad = math.radians(a)
        px, py = cx + r * 0.35 * math.cos(rad), cy + r * 0.35 * math.sin(rad)
        out += (
            f'<ellipse cx="{n(px)}" cy="{n(py)}" rx="{n(r * 0.28)}" ry="{n(r * 0.4)}" fill="#c06cc4" '
            f'transform="rotate({a + 90} {n(px)} {n(py)})"/>'
        )
    out += f'<ellipse cx="{n(cx)}" cy="{n(cy + r * 0.32)}" rx="{n(r * 0.3)}" ry="{n(r * 0.22)}" fill="{IVORY}" stroke="{PURPLE}" stroke-width="3"/>'
    return out + f'<circle cx="{n(cx)}" cy="{n(cy + r * 0.05)}" r="{n(r * 0.1)}" fill="{GOLD}"/>'


def blade(d1: str, d2: str, color: str = GREEN) -> str:
    """A long arching orchid leaf: the area between two curves that meet at both ends."""
    return f'<path d="{d1}{d2}Z" fill="{color}"/>'


def plant_orchid() -> str:
    """Orchid: long arching leaves and three orchid blooms on a slender stem."""
    out = ""
    out += blade("M150 392Q90 300 40 250", "Q100 290 160 392", GREEN)
    out += blade("M152 392Q170 280 250 230", "Q190 300 164 392", GREEN)
    out += blade("M148 392Q120 300 120 180", "Q140 300 160 392", DARK_GREEN)
    out += blade("M150 392Q220 340 270 340", "Q220 360 160 392", LIGHT_GREEN)
    out += stem("M170 392Q190 280 200 160", 4)
    for x, y, r in ((200, 150, 40), (178, 222, 34), (222, 262, 28)):
        out += orchid_bloom(x, y, r)
    return out


# --- faces ---------------------------------------------------------------------------------------


def svg(body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">{body}</svg>\n'


def characters(numeral: str) -> str:
    return svg(glyph(numeral, 150, 112, 145, BLUE) + glyph("萬", 150, 292, 185, RED))


DOTS: dict[int, list[tuple[float, float, float, str]]] = {
    2: [(150, 115, 58, BLUE), (150, 305, 58, GREEN)],
    3: [(80, 95, 50, BLUE), (150, 210, 50, RED), (220, 325, 50, GREEN)],
    4: [(92, 120, 54, BLUE), (208, 120, 54, GREEN), (92, 300, 54, GREEN), (208, 300, 54, BLUE)],
    5: [
        (88, 106, 50, BLUE),
        (212, 106, 50, GREEN),
        (150, 210, 50, RED),
        (88, 314, 50, GREEN),
        (212, 314, 50, BLUE),
    ],
    6: [
        (100, 85, 46, GREEN),
        (200, 85, 46, GREEN),
        (100, 225, 46, RED),
        (200, 225, 46, RED),
        (100, 330, 46, RED),
        (200, 330, 46, RED),
    ],
    7: [
        (72, 62, 38, GREEN),
        (150, 102, 38, GREEN),
        (228, 142, 38, GREEN),
        (100, 245, 44, RED),
        (200, 245, 44, RED),
        (100, 340, 44, RED),
        (200, 340, 44, RED),
    ],
    8: [(x, y, 42, BLUE) for y in (68, 165, 260, 355) for x in (100, 200)],
    9: [(x, y, 40, c) for y, c in ((80, BLUE), (210, RED), (340, GREEN)) for x in (70, 150, 230)],
}


def bamboo(k: int) -> str:
    G, R, B = GREEN, RED, BLUE
    if k == 1:
        return bird_sparrow()
    sticks: list[tuple] = {
        2: [(150, 42, 160), (150, 218, 160)],
        3: [(150, 42, 160), (95, 218, 160), (205, 218, 160)],
        4: [(95, 42, 160), (205, 42, 160), (95, 218, 160), (205, 218, 160)],
        5: [(78, 42, 160), (222, 42, 160), (78, 218, 160), (222, 218, 160), (150, 130, 160, 36, R)],
        6: [(x, y, 160) for y in (42, 218) for x in (80, 150, 220)],
        7: [(150, 30, 110, 40, R)]
        + [(x, y, 115, 40, B if x == 150 else G) for y in (152, 285) for x in (80, 150, 220)],
        8: [
            (58, 42, 160, 38),
            (242, 42, 160, 38),
            (118, 42, 160, 38, G, 22),
            (182, 42, 160, 38, G, -22),
            (58, 218, 160, 38),
            (242, 218, 160, 38),
            (118, 218, 160, 38, G, -22),
            (182, 218, 160, 38, G, 22),
        ],
        9: [(x, y, 112, 40, R if x == 150 else G) for y in (35, 155, 275) for x in (76, 150, 224)],
    }[k]
    return "".join(stick(*s) for s in sticks)


def tuft() -> str:
    """The grass tuft the classic flower and season tiles grow from, in blue and green."""
    out = ""
    for d, c in (
        ("M150 392Q120 360 80 352", BLUE),
        ("M150 392Q178 358 222 350", BLUE),
        ("M150 392Q140 350 112 330", GREEN),
        ("M150 392Q162 352 192 332", GREEN),
        ("M150 392Q150 360 150 336", GREEN),
    ):
        out += stem(d, 9, c)
    return out


def lush(plant: Callable[[], str]) -> str:
    """The plant enlarged about its base so it fills the tile, over the tuft."""
    return (
        f'<g transform="translate(150 392) scale(1.04) translate(-150 -392)">{plant()}</g>' + tuft()
    )


def season(i: int, plant: Callable[[], str]) -> str:
    return svg(lush(plant) + glyph("一二三四"[i], 228, 70, 80, RED))


def flower(i: int, plant: Callable[[], str]) -> str:
    return svg(lush(plant) + glyph("1234"[i], 64, 76, 84, BLUE))


def white_dragon() -> str:
    return svg(
        f'<rect x="56" y="58" width="188" height="304" rx="12" fill="none" stroke="{BLUE}" stroke-width="18"/>'
        f'<rect x="84" y="86" width="132" height="248" rx="6" fill="none" stroke="{BLUE}" stroke-width="7"/>'
        + "".join(
            f'<path d="M{a} {b}l{c} {d}" stroke="{BLUE}" stroke-width="7" stroke-linecap="round"/>'
            for a, b, c, d in (
                (66, 68, 18, 18),
                (234, 68, -18, 18),
                (66, 352, 18, -18),
                (234, 352, -18, -18),
            )
        )
    )


FACES: dict[str, Callable[[], str]] = {
    "01-white-dragon": white_dragon,
    "02-green-dragon": lambda: svg(glyph("發", 150, 210, 250, GREEN)),
    "03-red-dragon": lambda: svg(glyph("中", 150, 210, 290, RED)),
    "04-east-wind": lambda: svg(glyph("東", 150, 210, 250, BLUE)),
    "05-south-wind": lambda: svg(glyph("南", 150, 210, 240, BLUE)),
    "06-west-wind": lambda: svg(glyph("西", 150, 210, 230, BLUE)),
    "07-north-wind": lambda: svg(glyph("北", 150, 210, 230, BLUE)),
    **{
        f"{8 + i:02d}-characters-{i + 1}": (lambda c=c: characters(c))
        for i, c in enumerate("一二三四伍六七八九")
    },
    "17-circles-1": lambda: svg(big_dot()),
    **{
        f"{16 + k:02d}-circles-{k}": (lambda k=k: svg("".join(dot(*d) for d in DOTS[k])))
        for k in range(2, 10)
    },
    **{f"{25 + k:02d}-bamboos-{k}": (lambda k=k: svg(bamboo(k))) for k in range(1, 10)},
    "35-spring": lambda: season(0, plant_spring),
    "36-summer": lambda: season(1, plant_summer),
    "37-autumn": lambda: season(2, plant_autumn),
    "38-winter": lambda: season(3, plant_winter),
    "39-plum": lambda: flower(0, plant_plum),
    "40-orchid": lambda: flower(1, plant_orchid),
    "41-chrysanthemum": lambda: flower(2, plant_mum),
    "42-bamboo": lambda: flower(3, plant_bamboo),
}


def build(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, face in FACES.items():
        (out_dir / f"{name}.svg").write_text(face())


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["extract"]:
        extract(Path(args[1]))
    else:
        build(Path(args[0]) if args else OUT_DEFAULT)
