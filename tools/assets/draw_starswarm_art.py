"""Deterministic Star Swarm sprite generator (#3591, epic #3590).

Draws the Star Swarm sprites from vector recipes and writes WebP at 3x display size, authored at
each box's aspect ratio. Only Pillow and numpy are used (no cairo: it has no Linux wheel).
The design reasoning lives in `docs/games/starswarm-art-design.md`.

Usage:
    python tools/assets/draw_starswarm_art.py [--out DIR] [--sheet] [name ...]

    --out DIR  where to write `starswarm-<name>.webp` (default: a new temporary directory,
               printed at the end; copy the files you ship into frontend/assets/starswarm/,
               e.g. `starswarm-p1-arrow-base.webp` becomes `player/p1-base.webp` and
               `starswarm-guardian-scarab-plate.webp` becomes `enemy/guardian-plate.webp`, and
               `starswarm-rock-large-1-veins.webp` becomes `rock/large-1-veins.webp`, and
               `starswarm-shot-player.webp` becomes `shot/player.webp`, and
               `starswarm-pickup-shield.webp` becomes `pickup/shield.webp`)
    name       recipe names to draw (default: all). Any unknown name exits non-zero and lists
               the valid ones, before any file is written, whatever the argument order.
    --sheet    also write `contact-sheet.png` (anywhere on the command line): every recipe at
               3x and at game size (shown 2x), plus every gun level x hull level composite of
               each ship with the code-drawn armour outline simulated, and every enemy look
               (damage layers stacked), and every rock in each of its three runtime palettes
               (veins over the tinted body), built from the decoded shipped WebPs so reviews show
               the shipped look. Used for owner reviews.

Each WebP's byte size is printed, so stories can track their budget.

Pipeline: shapes are rasterized at 8x with `ImageDraw`, downscaled with LANCZOS for
anti-aliasing, filled with a solid colour or a numpy gradient through the mask, and composited
over premultiplied float RGBA. Everything is deterministic: the same code gives identical
decoded pixels.
"""

from __future__ import annotations

import argparse
import io
import math
import random
import sys
import tempfile
from collections.abc import Callable, Sequence
from functools import cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# --------------------------------------------------------------------------------------------
# Constants

SCALE = 3  # sprites are authored at 3x their display size (game px)
SS = 8  # shape supersample factor
LANCZOS_MARGIN = 4  # canvas px: LANCZOS reads 3 px either side of a pixel when downscaling
PAD = 4 * SCALE  # transparent margin around the box (glows, strokes, the armour outline)
PLAYER_BOX = 34  # game px, square (frontend PLAYER_W)
GRUNT_BOX = 24  # game px, square (TIER_SIZE.Grunt)
# #3593: the enemy boxes (frontend TIER_SIZE), width x height in game px
ENEMY_BOXES: dict[str, tuple[int, int]] = {
    "grunt": (24, 24),
    "elite": (28, 28),
    "guardian": (36, 32),
    "carrier": (54, 48),
}
BUDDY_BOX = 34  # game px, square (frontend BUDDY_SIZE)
RIVET_R = 1.5  # px at 3x: a 3 px dot, the guide's minimum for rivets
WEBP_QUALITY = 82  # lossy colour quality; #3592 lowered it from 90 to fit about 7 KB per ship
WEBP_ALPHA_QUALITY = 70  # the alpha plane is compressed too (it is mostly flat 0 or 255)
WEBP_METHOD = 6
SHEET_BG = (0, 0, 16, 255)  # STARSWARM_SPACE, #000010

Point = tuple[float, float]
RGBA = tuple[float, float, float, float]
Stops = Sequence[tuple[float, RGBA]]

# --------------------------------------------------------------------------------------------
# Palette (colour roles, see the style guide). The runtime palette (`render/palette.ts`) must
# mirror these when code-drawn parts are restyled in later stories.


def hexrgb(h: str, a: float = 1.0) -> RGBA:
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, a)


SILVER: Stops = [
    (0, hexrgb("#7f90a6")),
    (0.45, hexrgb("#f2f6fb")),
    (0.55, hexrgb("#e3ebf4")),
    (1, hexrgb("#68788c")),
]
EDGE = hexrgb("#16222f")  # dark line on friendly hulls
CYAN = hexrgb("#00e8d0")  # friendly accent
GUNMETAL: Stops = [(0, hexrgb("#3a4655")), (0.5, hexrgb("#8a98a8")), (1, hexrgb("#2f3a47"))]
CANOPY: Stops = [(0, hexrgb("#d6fbff")), (0.5, hexrgb("#29b8d6")), (1, hexrgb("#073a52"))]
ARMOR: Stops = [(0, hexrgb("#e4f3ff")), (0.5, hexrgb("#8fb4d0")), (1, hexrgb("#4d6f8c"))]
ARMOR_EDGE = hexrgb("#1fb6ff")  # hull plating blue, also the armour outline tint
# #3593: the "lifted" enemy shell (owner decision), light enough to read on #000010 at game size
CARAPACE: Stops = [(0, hexrgb("#b07ae0")), (0.5, hexrgb("#7d48b4")), (1, hexrgb("#4a2378"))]
CARAPACE_EDGE = hexrgb("#c07bff")  # enemy hull rim light
STINGER = hexrgb("#ff5a3c")  # enemy weapons / danger
MEMBRANE = (0.75, 0.55, 1.0, 0.35)
HIVE_SHIELD = hexrgb("#e08cff")  # hive energy: the Guardian's emitter
HOT = hexrgb("#ff7a2e")  # damage: crack glow and the rim of a blown plate
SCORCH = hexrgb("#1a0610")  # the dark line inside a crack
GASH = hexrgb("#12040a")  # a blown-out shell plate
STUMP = hexrgb("#7a2a1a")  # the Elite's snapped scythe
EMBER = (0.45, 0.1, 0.1, 1.0)  # the Elite's dull core between flickers
BAY: Stops = [(0, hexrgb("#120820")), (1, hexrgb("#3a1a55"))]  # the Carrier's hangar bay
HONEYCOMB = (1.0, 0.45, 0.25, 0.55)  # the Queen's glowing abdomen cells
OUTLINE_RGB = (31, 182, 255)

# --------------------------------------------------------------------------------------------
# Vector helper: a premultiplied float RGBA canvas


class Gradient:
    """A fill evaluated per pixel; `rgba(h, w, x0, y0)` returns the premultiplied (h, w, 4) float
    array for the window of that size whose top-left pixel is (x0, y0) on the canvas."""

    def rgba(self, h: int, w: int, x0: int = 0, y0: int = 0) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError


def _ramp(t: np.ndarray, stops: Stops) -> np.ndarray:
    """Interpolate stops in premultiplied space (so alpha-0 stops don't tint the fade)."""
    offs = [o for o, _ in stops]
    chans = []
    for i in range(4):
        vals = []
        for _, c in stops:
            vals.append(c[i] * c[3] if i < 3 else c[3])
        chans.append(np.interp(t, offs, vals))
    return np.stack(chans, -1).astype(np.float32)


class Linear(Gradient):
    def __init__(self, p0: Point, p1: Point, stops: Stops):
        self.p0, self.p1, self.stops = p0, p1, stops

    def rgba(self, h: int, w: int, x0: int = 0, y0: int = 0) -> np.ndarray:
        yy, xx = np.mgrid[y0 : y0 + h, x0 : x0 + w].astype(np.float32)
        xx += 0.5
        yy += 0.5
        dx, dy = self.p1[0] - self.p0[0], self.p1[1] - self.p0[1]
        den = dx * dx + dy * dy or 1.0
        t = ((xx - self.p0[0]) * dx + (yy - self.p0[1]) * dy) / den
        return _ramp(np.clip(t, 0, 1), self.stops)


class Radial(Gradient):
    def __init__(self, c: Point, r: float, stops: Stops):
        self.c, self.r, self.stops = c, r, stops

    def rgba(self, h: int, w: int, x0: int = 0, y0: int = 0) -> np.ndarray:
        yy, xx = np.mgrid[y0 : y0 + h, x0 : x0 + w].astype(np.float32)
        d = np.hypot(xx + 0.5 - self.c[0], yy + 0.5 - self.c[1]) / self.r
        return _ramp(np.clip(d, 0, 1), self.stops)


Fill = RGBA | Gradient


def xf(pts: Sequence[Point], ox: float = 0.0, oy: float = 0.0, ang: float = 0.0) -> list[Point]:
    """Rotate points by `ang` radians about the origin, then translate by (ox, oy)."""
    ca, sa = math.cos(ang), math.sin(ang)
    return [(ox + x * ca - y * sa, oy + x * sa + y * ca) for x, y in pts]


def ellipse_pts(cx: float, cy: float, rx: float, ry: float, n: int = 72) -> list[Point]:
    return [
        (cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n))
        for i in range(n)
    ]


def rect_pts(x: float, y: float, w: float, h: float) -> list[Point]:
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


Window = tuple[int, int, int, int]  # x0, y0, x1, y1 in canvas pixels


class Canvas:
    """A premultiplied RGBA float canvas. Coordinates are in box pixels: (0, 0) is the box's
    top-left corner, `pad` pixels inside the canvas.

    `glows=False` skips `glow()`, so the canvas holds the hull geometry only (used to build the
    armour outline's mask)."""

    def __init__(self, box_w: int, box_h: int, pad: int = PAD, glows: bool = True):
        self.w, self.h, self.pad, self.glows = box_w + 2 * pad, box_h + 2 * pad, pad, glows
        self.px = np.zeros((self.h, self.w, 4), np.float32)

    def _pt(self, p: Point) -> Point:
        return (p[0] + self.pad, p[1] + self.pad)

    def _window(self, pts: Sequence[Point], reach: float) -> Window:
        """The canvas window that can hold a shape: its bounding box (canvas px), grown by
        `reach` and by the LANCZOS support, clamped to the canvas. Pixels outside stay zero."""
        m = math.ceil(reach) + LANCZOS_MARGIN
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return (
            max(0, math.floor(min(xs)) - m),
            max(0, math.floor(min(ys)) - m),
            min(self.w, math.ceil(max(xs)) + m),
            min(self.h, math.ceil(max(ys)) + m),
        )

    def _mask(self, win: Window, draw: Callable[[ImageDraw.ImageDraw], None]) -> np.ndarray:
        """Rasterize at SS x into the window only (`draw` gets 8x coords relative to it)."""
        x0, y0, x1, y1 = win
        big = Image.new("L", ((x1 - x0) * SS, (y1 - y0) * SS), 0)
        draw(ImageDraw.Draw(big))
        small = big.resize((x1 - x0, y1 - y0), Image.LANCZOS)
        return np.clip(np.asarray(small, np.float32) / 255, 0, 1)

    def _paint(self, win: Window, mask: np.ndarray, fill: Fill) -> None:
        x0, y0, x1, y1 = win
        if isinstance(fill, Gradient):
            src = fill.rgba(y1 - y0, x1 - x0, x0, y0) * mask[..., None]
        else:
            r, g, b, a = fill
            src = np.stack([r * a * mask, g * a * mask, b * a * mask, a * mask], -1)
        dst = self.px[y0:y1, x0:x1]
        self.px[y0:y1, x0:x1] = src + dst * (1 - src[..., 3:4])

    def _shift(self, fill: Fill) -> Fill:
        """Gradients are specified in box coordinates; move them onto the padded canvas."""
        if isinstance(fill, Linear):
            return Linear(self._pt(fill.p0), self._pt(fill.p1), fill.stops)
        if isinstance(fill, Radial):
            return Radial(self._pt(fill.c), fill.r, fill.stops)
        return fill

    def polygon(self, pts: Sequence[Point], fill: Fill) -> None:
        cp = [self._pt(p) for p in pts]
        win = self._window(cp, 0)
        sp = [((x - win[0]) * SS, (y - win[1]) * SS) for x, y in cp]
        self._paint(win, self._mask(win, lambda d: d.polygon(sp, fill=255)), self._shift(fill))

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, fill: Fill) -> None:
        self.polygon(ellipse_pts(cx, cy, rx, ry), fill)

    def stroke(self, pts: Sequence[Point], width: float, color: RGBA, closed: bool = True) -> None:
        """A stroke centred on the path, round joins."""
        cp = [self._pt(p) for p in pts]
        wpx = max(1, round(width * SS))
        win = self._window(cp, wpx / SS / 2 + 1)
        sp = [((x - win[0]) * SS, (y - win[1]) * SS) for x, y in cp]
        if closed:
            sp = [*sp, sp[0], sp[1]]

        def draw(d: ImageDraw.ImageDraw) -> None:
            d.line(sp, fill=255, width=wpx, joint="curve")
            r = wpx / 2  # round the path's ends and corners
            for x, y in sp:
                d.ellipse((x - r, y - r, x + r, y + r), fill=255)

        self._paint(win, self._mask(win, draw), color)

    def fill_stroke(
        self, pts: Sequence[Point], fill: Fill, edge: RGBA = EDGE, lw: float = 0.55
    ) -> None:
        self.polygon(pts, fill)
        self.stroke(pts, lw * SCALE, edge)

    def glow(self, x: float, y: float, r: float, stops: Stops) -> None:
        """A radial glow: a gradient disc."""
        if not self.glows:
            return
        self.ellipse(x, y, r, r, Radial((x, y), r, stops))

    def image(self) -> Image.Image:
        a = self.px[..., 3]
        rgb = np.where(a[..., None] > 1e-6, self.px[..., :3] / np.maximum(a[..., None], 1e-6), 0)
        out = np.concatenate([rgb, a[..., None]], -1)
        return Image.fromarray(np.rint(np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")


def armour_outline(im: Image.Image, level: int, hull: np.ndarray) -> Image.Image:
    """The code-drawn armour outline, simulated: dilate the hull silhouette, subtract it, blur
    and tint. Thin at hull level 1, bold at level 2. Level 0 returns the image unchanged.

    `hull` is the silhouette alpha (uint8, same size as `im`) of the hull geometry WITHOUT the
    engine and muzzle glows, as the runtime outline follows the hull, not the halos."""
    if level <= 0:
        return im
    m = Image.fromarray(((hull > 40) * 255).astype(np.uint8), "L")
    grow = m.filter(ImageFilter.MaxFilter(5 if level == 1 else 9))
    rim = np.clip(np.asarray(grow, np.int16) - np.asarray(m, np.int16), 0, 255).astype(np.uint8)
    rim_img = Image.fromarray(rim, "L").filter(ImageFilter.GaussianBlur(1.0 if level == 1 else 1.6))
    alpha = np.asarray(rim_img, np.float32) * (0.75 if level == 1 else 1.0)
    out = np.zeros((im.height, im.width, 4), np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = OUTLINE_RGB
    out[..., 3] = alpha.clip(0, 255).astype(np.uint8)
    res = Image.fromarray(out, "RGBA")
    res.alpha_composite(im)
    return res


# --------------------------------------------------------------------------------------------
# Shared parts

ENGINE_STOPS: Stops = [(0, (0.85, 1, 1, 1)), (0.35, (0.2, 0.95, 1, 0.9)), (1, (0, 0.6, 1, 0))]
CORE_STOPS: Stops = [(0, (1, 0.95, 0.85, 1)), (0.35, (1, 0.35, 0.2, 1)), (1, (0.7, 0, 0.1, 0))]


def mirror_x(pts: Sequence[Point], w: float) -> list[Point]:
    """Reflect points across the vertical centre line of a box `w` wide."""
    return [(w - x, y) for x, y in pts]


def units(pts: Sequence[Point], w: float, h: float) -> list[Point]:
    return [(x * w, y * h) for x, y in pts]


def hlin(w: float, stops: Stops) -> Linear:
    return Linear((0, 0), (w, 0), stops)


def canopy(c: Canvas, x: float, y: float, rx: float, ry: float) -> None:
    c.polygon(ellipse_pts(x, y, rx, ry), Linear((0, y - ry), (0, y + ry), CANOPY))
    c.stroke(ellipse_pts(x, y, rx, ry), 0.4 * SCALE, EDGE)


# --------------------------------------------------------------------------------------------
# Player ships: P1 Arrow, P2 Forward-swept, P3 Twin-boom (34x34 game px box, 5 layers each)
# Unit coordinates: x across, y down, ship points up.


def p1_hull(c: Canvas, w: float, h: float) -> None:
    for ex in (0.42, 0.58):
        c.glow(ex * w, 0.95 * h, 0.09 * w, ENGINE_STOPS)
    wing = units([(0.5, 0.36), (0.94, 0.74), (0.94, 0.8), (0.6, 0.76), (0.5, 0.7)], w, h)
    c.fill_stroke(wing, hlin(w, SILVER))
    c.fill_stroke(mirror_x(wing, w), hlin(w, SILVER))
    body = units([(0.5, 0.03), (0.58, 0.3), (0.6, 0.9), (0.4, 0.9), (0.42, 0.3)], w, h)
    c.fill_stroke(body, hlin(w, SILVER))
    for s in (1, -1):  # cyan wing stripes
        x0 = 0.5 + s * 0.12
        stripe = [(x0, 0.56), (0.5 + s * 0.4, 0.74), (0.5 + s * 0.4, 0.77), (x0, 0.62)]
        c.polygon(units(stripe, w, h), CYAN)
    canopy(c, 0.5 * w, 0.34 * h, 0.06 * w, 0.12 * h)


def p2_hull(c: Canvas, w: float, h: float) -> None:
    c.glow(0.5 * w, 0.95 * h, 0.13 * w, ENGINE_STOPS)
    wing = units([(0.55, 0.62), (0.95, 0.46), (0.97, 0.52), (0.62, 0.82)], w, h)
    c.fill_stroke(wing, hlin(w, SILVER))
    c.fill_stroke(mirror_x(wing, w), hlin(w, SILVER))
    can = units([(0.55, 0.26), (0.75, 0.3), (0.56, 0.36)], w, h)
    c.fill_stroke(can, hlin(w, SILVER))
    c.fill_stroke(mirror_x(can, w), hlin(w, SILVER))
    body = units(
        [
            (0.5, 0.04),
            (0.6, 0.28),
            (0.62, 0.88),
            (0.56, 0.94),
            (0.44, 0.94),
            (0.38, 0.88),
            (0.4, 0.28),
        ],
        w,
        h,
    )
    c.fill_stroke(body, hlin(w, SILVER))
    for s in (1, -1):
        stripe = [
            (0.5 + s * 0.2, 0.62),
            (0.5 + s * 0.43, 0.52),
            (0.5 + s * 0.44, 0.55),
            (0.5 + s * 0.2, 0.67),
        ]
        c.polygon(units(stripe, w, h), CYAN)
    canopy(c, 0.5 * w, 0.3 * h, 0.065 * w, 0.11 * h)


def p3_hull(c: Canvas, w: float, h: float) -> None:
    for ex in (0.24, 0.76):
        c.glow(ex * w, 0.95 * h, 0.1 * w, ENGINE_STOPS)
    wing = units([(0.1, 0.56), (0.9, 0.56), (0.9, 0.66), (0.1, 0.66)], w, h)
    wing_fill = Linear((0, 0), (0, h), [(0.5, hexrgb("#e9eff6")), (0.7, hexrgb("#7d8ea3"))])
    c.fill_stroke(wing, wing_fill)
    boom = units([(0.24, 0.3), (0.31, 0.4), (0.31, 0.9), (0.17, 0.9), (0.17, 0.4)], w, h)
    c.fill_stroke(boom, hlin(w, SILVER))
    c.fill_stroke(mirror_x(boom, w), hlin(w, SILVER))
    pod = units([(0.5, 0.06), (0.6, 0.3), (0.6, 0.72), (0.4, 0.72), (0.4, 0.3)], w, h)
    c.fill_stroke(pod, hlin(w, SILVER))
    for x in (0.17, 0.77):
        c.polygon(units(rect_pts(x, 0.5, 0.06, 0.04), w, h), CYAN)
    canopy(c, 0.5 * w, 0.32 * h, 0.065 * w, 0.12 * h)


# Guns per level: (x, y_top, length, angle) in unit coords; L1 is the nose cannon (in `base`).
Gun = tuple[float, float, float, float]
P1_GUNS: dict[int, list[Gun]] = {
    1: [(0.5, 0.08, 0.13, 0)],
    2: [(0.27, 0.62, 0.17, 0), (0.73, 0.62, 0.17, 0)],
    3: [(0.12, 0.74, 0.14, -0.35), (0.88, 0.74, 0.14, 0.35)],
}
P2_GUNS: dict[int, list[Gun]] = {
    1: [(0.5, 0.06, 0.12, 0)],
    2: [(0.3, 0.62, 0.16, 0), (0.7, 0.62, 0.16, 0)],
    3: [(0.92, 0.5, 0.13, 0.4), (0.08, 0.5, 0.13, -0.4)],
}
P3_GUNS: dict[int, list[Gun]] = {
    1: [(0.5, 0.09, 0.12, 0)],
    2: [(0.24, 0.33, 0.13, 0), (0.76, 0.33, 0.13, 0)],
    3: [(0.06, 0.62, 0.13, -0.38), (0.94, 0.62, 0.13, 0.38)],
}

# Plating per hull level (1 = shoulder plates on the wing roots; 2 = nose cowl + wing armour).
Plates = list[list[Point]]
P1_PLATES: tuple[Plates, Plates] = (
    [
        [(0.4, 0.48), (0.24, 0.62), (0.27, 0.68), (0.42, 0.6)],
        [(0.6, 0.48), (0.76, 0.62), (0.73, 0.68), (0.58, 0.6)],
    ],
    [
        [(0.43, 0.14), (0.57, 0.14), (0.59, 0.26), (0.41, 0.26)],
        [(0.6, 0.68), (0.93, 0.75), (0.93, 0.8), (0.62, 0.75)],
        [(0.4, 0.68), (0.07, 0.75), (0.07, 0.8), (0.38, 0.75)],
    ],
)
P2_PLATES: tuple[Plates, Plates] = (
    [
        [(0.39, 0.56), (0.2, 0.62), (0.21, 0.68), (0.39, 0.65)],
        [(0.61, 0.56), (0.8, 0.62), (0.79, 0.68), (0.61, 0.65)],
    ],
    [
        [(0.43, 0.12), (0.57, 0.12), (0.59, 0.22), (0.41, 0.22)],
        [(0.63, 0.75), (0.95, 0.5), (0.97, 0.54), (0.65, 0.8)],
        [(0.37, 0.75), (0.05, 0.5), (0.03, 0.54), (0.35, 0.8)],
    ],
)
P3_PLATES: tuple[Plates, Plates] = (
    [
        [(0.31, 0.55), (0.4, 0.55), (0.4, 0.67), (0.31, 0.67)],
        [(0.6, 0.55), (0.69, 0.55), (0.69, 0.67), (0.6, 0.67)],
    ],
    [
        [(0.43, 0.12), (0.57, 0.12), (0.59, 0.24), (0.41, 0.24)],
        [(0.15, 0.4), (0.19, 0.4), (0.19, 0.86), (0.15, 0.86)],
        [(0.81, 0.4), (0.85, 0.4), (0.85, 0.86), (0.81, 0.86)],
    ],
)

SHIPS = {
    "p1-arrow": (p1_hull, P1_GUNS, P1_PLATES),
    "p2-forward-swept": (p2_hull, P2_GUNS, P2_PLATES),
    "p3-twin-boom": (p3_hull, P3_GUNS, P3_PLATES),
}


def draw_gun(c: Canvas, w: float, h: float, gun: Gun) -> None:
    """A mount block and a barrel with a cyan muzzle tip and a glow, muzzle pointing up/out."""
    x, y, ln, ang = gun
    bx, by = x * w, (y + ln) * h
    mount = xf(rect_pts(-0.055 * w, -0.02 * h, 0.11 * w, 0.09 * h), bx, by, ang)
    lx0 = xf([(-0.055 * w, 0)], bx, by, ang)[0]
    lx1 = xf([(0.055 * w, 0)], bx, by, ang)[0]
    c.fill_stroke(mount, Linear(lx0, lx1, GUNMETAL), EDGE, 0.4)
    bw, bl = 0.06 * w, ln * h
    barrel = xf(rect_pts(-bw / 2, -bl, bw, bl), bx, by, ang)
    b0 = xf([(-bw / 2, 0)], bx, by, ang)[0]
    b1 = xf([(bw / 2, 0)], bx, by, ang)[0]
    c.fill_stroke(barrel, Linear(b0, b1, GUNMETAL), EDGE, 0.35)
    c.polygon(xf(rect_pts(-bw / 2, -bl, bw, bw * 0.6), bx, by, ang), CYAN)
    c.glow(bx + math.sin(ang) * bl, by - math.cos(ang) * bl, 0.05 * w, ENGINE_STOPS)


def draw_plate(c: Canvas, w: float, h: float, pts: Sequence[Point]) -> None:
    """Bolted-on armour plate: pale-blue gradient, blue edge, a rivet (3 px across at 3x, the
    guide's minimum; thinner dots vanish at game size)."""
    p = units(pts, w, h)
    c.polygon(p, Linear((0, 0), (w, h), ARMOR))
    c.stroke(p, 0.75 * SCALE, ARMOR_EDGE)
    cx = sum(x for x, _ in p) / len(p)
    cy = sum(y for _, y in p) / len(p)
    c.ellipse(cx, cy, RIVET_R, RIVET_R, ARMOR_EDGE)


def _ship_canvas(ship: str, layer: str, glows: bool = True) -> Canvas:
    hull, guns, plates = SHIPS[ship]
    box = PLAYER_BOX * SCALE
    c = Canvas(box, box, glows=glows)
    if layer == "base":
        hull(c, box, box)
        for g in guns[1]:
            draw_gun(c, box, box, g)
    elif layer in ("guns2", "guns3"):
        for g in guns[int(layer[-1])]:
            draw_gun(c, box, box, g)
    else:  # plating1 / plating2
        for p in plates[int(layer[-1]) - 1]:
            draw_plate(c, box, box, p)
    return c


def _ship_layer(ship: str, layer: str) -> Image.Image:
    return _ship_canvas(ship, layer).image()


@cache
def hull_alpha(ship: str, layer: str) -> np.ndarray:
    """The layer's silhouette without glows (uint8 alpha), the armour outline's mask source."""
    return np.rint(_ship_canvas(ship, layer, glows=False).px[..., 3] * 255).astype(np.uint8)


# --------------------------------------------------------------------------------------------
# Grunt: G2 Wasp (24x24 game px box). Points DOWN: it dives at the player.


def grunt_wasp() -> Image.Image:
    box = GRUNT_BOX * SCALE
    w = h = float(box)
    c = Canvas(box, box)
    for s in (1, -1):  # membrane wings
        wing = units(
            [
                (0.5 + s * 0.08, 0.3),
                (0.5 + s * 0.46, 0.14),
                (0.5 + s * 0.42, 0.34),
                (0.5 + s * 0.1, 0.44),
            ],
            w,
            h,
        )
        c.polygon(wing, MEMBRANE)
        c.stroke(wing, 0.4 * SCALE, CARAPACE_EDGE)
    for y, r in ((0.26, 0.13), (0.48, 0.15), (0.68, 0.11)):  # segmented body
        seg = ellipse_pts(0.5 * w, y * h, r * w, r * 0.85 * h)
        c.polygon(seg, Linear((0.35 * w, 0), (0.65 * w, 0), CARAPACE))
        c.stroke(seg, 0.45 * SCALE, CARAPACE_EDGE)
    c.polygon(units([(0.45, 0.76), (0.55, 0.76), (0.5, 0.98)], w, h), STINGER)
    c.glow(0.5 * w, 0.48 * h, 0.09 * w, CORE_STOPS)
    return c.image()


# --------------------------------------------------------------------------------------------
# The rest of the hive (#3593): E2 Mantis (Elite), GD1 Scarab (Guardian), C1 Queen (Carrier).
# Every enemy points DOWN. Damage looks are either a whole sprite (the Elite at 1 HP) or a layer
# drawn over the base on the same canvas (the Guardian's plates and cracks, the Carrier's cracks).

SPARK_STOPS: Stops = [(0, (1, 1, 0.8, 1)), (1, (1, 0.5, 0.1, 0))]
SPARK_LINE = (1.0, 0.85, 0.4, 1.0)
EMBER_STOPS: Stops = [(0, (1, 0.67, 0.27, 1)), (1, (1, 0.67, 0.27, 0))]  # glowing crack sparks
EMITTER_STOPS: Stops = [(0, (1, 0.95, 1, 1)), (0.4, HIVE_SHIELD), (1, (*HIVE_SHIELD[:3], 0))]
EMITTER_DIM = hexrgb("#c58ad8", 0.8)
EMITTER_DEAD = hexrgb("#4a2050")
EMITTER_DEAD_EDGE = hexrgb("#7a3a8a")


def _enemy_canvas(kind: str) -> tuple[Canvas, float, float]:
    bw, bh = ENEMY_BOXES[kind]
    return Canvas(bw * SCALE, bh * SCALE), float(bw * SCALE), float(bh * SCALE)


def bezier_pts(p0: Point, p1: Point, p2: Point, p3: Point, n: int = 16) -> list[Point]:
    """A cubic Bezier sampled into `n + 1` points (for strokes along a curve)."""
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return out


def hive_wings(c: Canvas, w: float, h: float, y0: float, span: float, rise: float) -> None:
    """A pair of membrane wings with a rim-light edge."""
    for s in (1, -1):
        wing = units(
            [
                (0.5 + s * 0.08, y0),
                (0.5 + s * span, y0 - rise),
                (0.5 + s * (span - 0.04), y0 + 0.1),
                (0.5 + s * 0.1, y0 + 0.12),
            ],
            w,
            h,
        )
        c.polygon(wing, (*MEMBRANE[:3], 0.3))
        c.stroke(wing, 0.4 * SCALE, CARAPACE_EDGE)


def shell_ellipse(c: Canvas, cx: float, cy: float, rx: float, ry: float, fill: Fill) -> None:
    pts = ellipse_pts(cx, cy, rx, ry)
    c.polygon(pts, fill)
    c.stroke(pts, 0.45 * SCALE, CARAPACE_EDGE)


def spark_burst(c: Canvas, x: float, y: float, r: float, n: int, seed: int) -> None:
    """Short hot sparks flying from a break, and a white-hot flash at its centre."""
    rng = random.Random(seed)
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi)
        ln = rng.uniform(0.5, 1.0) * r
        c.stroke(
            [(x, y), (x + math.cos(a) * ln, y + math.sin(a) * ln)], 0.5 * SCALE, SPARK_LINE, False
        )
    c.glow(x, y, r * 0.6, SPARK_STOPS)


MANTIS_BODY = [(0.5, 0.08), (0.6, 0.3), (0.58, 0.8), (0.5, 0.95), (0.42, 0.8), (0.4, 0.3)]
SCYTHE_W = 1.3 * SCALE


def _mantis_body(c: Canvas, w: float, h: float) -> None:
    c.fill_stroke(units(MANTIS_BODY, w, h), hlin(w, CARAPACE), CARAPACE_EDGE, 0.5)


def elite_mantis() -> Image.Image:
    """E2 Mantis: a slim body, narrow wings and two raised scythe arms (its weapons)."""
    c, w, h = _enemy_canvas("elite")
    hive_wings(c, w, h, 0.32, 0.4, 0.14)
    for s in (1, -1):
        arm = units([(0.5 + s * 0.12, 0.48), (0.5 + s * 0.34, 0.62), (0.5 + s * 0.2, 0.9)], w, h)
        c.stroke(arm, SCYTHE_W, STINGER, False)
    _mantis_body(c, w, h)
    c.glow(0.5 * w, 0.42 * h, 0.09 * w, CORE_STOPS)
    return c.image()


def elite_mantis_attack() -> Image.Image:
    """The Mantis on a dive: scythes flung wide toward the player, wings swept back."""
    c, w, h = _enemy_canvas("elite")
    hive_wings(c, w, h, 0.26, 0.34, 0.22)
    for s in (1, -1):
        arm = units([(0.5 + s * 0.1, 0.5), (0.5 + s * 0.46, 0.6), (0.5 + s * 0.36, 0.98)], w, h)
        c.stroke(arm, SCYTHE_W, STINGER, False)
    _mantis_body(c, w, h)
    c.glow(0.5 * w, 0.42 * h, 0.11 * w, CORE_STOPS)
    return c.image()


# The Elite's core, box units: the runtime draws the 1 HP flicker here (render/enemies.ts)
MANTIS_CORE = (0.5, 0.42)


def elite_mantis_hurt() -> Image.Image:
    """The Mantis at 1 HP: the right scythe snapped to a stump with sparks at the break, a
    cracked body and a dull ember for a core (the runtime flickers the bright core over it)."""
    c, w, h = _enemy_canvas("elite")
    hive_wings(c, w, h, 0.32, 0.4, 0.14)
    left = units([(0.38, 0.48), (0.16, 0.62), (0.3, 0.9)], w, h)
    c.stroke(left, SCYTHE_W, STINGER, False)
    c.stroke(units([(0.62, 0.48), (0.76, 0.57)], w, h), SCYTHE_W, STUMP, False)
    _mantis_body(c, w, h)
    for a, b in (((0.46, 0.3), (0.55, 0.5)), ((0.55, 0.5), (0.48, 0.68))):
        c.stroke(units([a, b], w, h), 0.9 * SCALE, HOT, False)
    spark_burst(c, 0.77 * w, 0.58 * h, 0.14 * w, 6, seed=4)
    c.ellipse(MANTIS_CORE[0] * w, MANTIS_CORE[1] * h, 0.04 * w, 0.04 * w, EMBER)
    return c.image()


# GD1 Scarab: a domed shell in plates with a hive-energy emitter on its back.
SCARAB_EMITTER = (0.5, 0.42)
SCARAB_GASH_1 = [
    (0.12, 0.42),
    (0.2, 0.3),
    (0.28, 0.36),
    (0.33, 0.28),
    (0.36, 0.42),
    (0.31, 0.56),
    (0.35, 0.68),
    (0.24, 0.66),
    (0.16, 0.58),
]
SCARAB_GASH_2 = [(0.66, 0.3), (0.78, 0.36), (0.86, 0.5), (0.78, 0.62), (0.7, 0.54)]
SCARAB_CRACKS = [
    [(0.62, 0.22), (0.7, 0.4), (0.64, 0.52), (0.76, 0.66)],
    [(0.5, 0.62), (0.58, 0.74), (0.52, 0.86)],
]


def _scarab_shell_fill(h: float) -> Linear:
    return Linear((0, 0), (0, h), CARAPACE)


def _scarab_centre_line(c: Canvas, w: float, y0: float, y1: float) -> None:
    """The middle plate seam (a straight line: its curve has no bend), between y0 and y1."""
    c.stroke([(0.5 * w, y0), (0.5 * w, y1)], 0.45 * SCALE, (*CARAPACE_EDGE[:3], 0.55), False)


def _scarab_patch(c: Canvas, w: float, h: float, r: float) -> None:
    """Paint the shell back over the emitter (a disc of radius `r`), seam included, so a damage
    layer can show a dimmer emitter on top of the base's bright one."""
    ex, ey = SCARAB_EMITTER[0] * w, SCARAB_EMITTER[1] * h
    c.ellipse(ex, ey, r, r, _scarab_shell_fill(h))
    _scarab_centre_line(c, w, ey - r, ey + r)


def _gash(c: Canvas, w: float, h: float, pts: Sequence[Point]) -> None:
    p = units(pts, w, h)
    c.polygon(p, GASH)
    c.stroke(p, 0.9 * SCALE, HOT)


def guardian_scarab() -> Image.Image:
    """GD1 Scarab at full health (4 HP): intact plates and a bright emitter."""
    c, w, h = _enemy_canvas("guardian")
    for s in (1, -1):
        sting = [(0.5 + s * 0.1, 0.82), (0.5 + s * 0.22, 0.9), (0.5 + s * 0.12, 1.0)]
        c.polygon(units(sting, w, h), STINGER)
    shell_ellipse(c, 0.5 * w, 0.5 * h, 0.44 * w, 0.4 * h, _scarab_shell_fill(h))
    for k in (-0.22, 0, 0.22):  # plate seams
        seam = bezier_pts(
            ((0.5 + k) * w, 0.14 * h),
            ((0.5 + k * 1.3) * w, 0.4 * h),
            ((0.5 + k * 1.3) * w, 0.6 * h),
            ((0.5 + k) * w, 0.86 * h),
        )
        c.stroke(seam, 0.45 * SCALE, (*CARAPACE_EDGE[:3], 0.55), False)
    ex, ey = SCARAB_EMITTER[0] * w, SCARAB_EMITTER[1] * h
    c.glow(ex, ey, 0.17 * w, EMITTER_STOPS)
    dot = ellipse_pts(ex, ey, 0.07 * w, 0.07 * h)
    c.polygon(dot, hexrgb("#ffffff", 0.9))
    c.stroke(dot, 0.5 * SCALE, HIVE_SHIELD)
    return c.image()


def guardian_scarab_plate() -> Image.Image:
    """Layer, 3 HP and below: a shell plate blown out (a dark gash with a glowing rim and
    sparks) and the emitter dimmed. The first hit has to be obvious."""
    c, w, h = _enemy_canvas("guardian")
    _gash(c, w, h, SCARAB_GASH_1)
    spark_burst(c, 0.25 * w, 0.48 * h, 0.1 * w, 4, seed=2)
    _scarab_patch(c, w, h, 0.17 * w)
    ex, ey = SCARAB_EMITTER[0] * w, SCARAB_EMITTER[1] * h
    c.glow(ex, ey, 0.11 * w, EMITTER_STOPS)
    dot = ellipse_pts(ex, ey, 0.06 * w, 0.06 * h)
    c.polygon(dot, EMITTER_DIM)
    c.stroke(dot, 0.5 * SCALE, HIVE_SHIELD)
    return c.image()


def guardian_scarab_cracks() -> Image.Image:
    """Layer, 2 HP and below: glowing cracks across the shell."""
    c, w, h = _enemy_canvas("guardian")
    for crack in SCARAB_CRACKS:
        c.stroke(units(crack, w, h), 0.9 * SCALE, HOT, False)
    return c.image()


def guardian_scarab_plate2() -> Image.Image:
    """Layer, 1 HP: a second plate gone and the emitter dark (the runtime adds smoke)."""
    c, w, h = _enemy_canvas("guardian")
    _gash(c, w, h, SCARAB_GASH_2)
    _scarab_patch(c, w, h, 0.12 * w)
    ex, ey = SCARAB_EMITTER[0] * w, SCARAB_EMITTER[1] * h
    dot = ellipse_pts(ex, ey, 0.06 * w, 0.06 * h)
    c.polygon(dot, EMITTER_DEAD)
    c.stroke(dot, 0.5 * SCALE, EMITTER_DEAD_EDGE)
    return c.image()


def _hexagon(cx: float, cy: float, r: float) -> list[Point]:
    return [
        (cx + r * math.cos(k * math.pi / 3), cy + r * math.sin(k * math.pi / 3)) for k in range(6)
    ]


def _queen_canvas(glows: bool = True) -> Canvas:
    """C1 Queen: a hive-queen ship with a swollen honeycombed abdomen, a crown of spines and the
    hangar bay under the abdomen (where #3561's bay glow and hatch open)."""
    bw, bh = ENEMY_BOXES["carrier"]
    w, h = float(bw * SCALE), float(bh * SCALE)
    c = Canvas(bw * SCALE, bh * SCALE, glows=glows)
    hive_wings(c, w, h, 0.3, 0.52, 0.18)
    shell_ellipse(c, 0.5 * w, 0.24 * h, 0.16 * w, 0.14 * h, hlin(w, CARAPACE))
    shell_ellipse(c, 0.5 * w, 0.58 * h, 0.3 * w, 0.32 * h, Linear((0, 0), (w, h), CARAPACE))
    for i in range(-2, 3):  # honeycomb cells
        for j in range(2):
            x = (0.5 + i * 0.09 + (0.045 if j else 0)) * w
            c.polygon(_hexagon(x, (0.5 + j * 0.1) * h, 0.035 * w), HONEYCOMB)
    for s in (-0.12, 0, 0.12):  # crown spines
        spine = [(0.5 + s - 0.03, 0.14), (0.5 + s, 0.0), (0.5 + s + 0.03, 0.14)]
        c.polygon(units(spine, w, h), STINGER)
    bx, by, bwd, bht = 0.5 * w, 0.86 * h, 0.24 * w, 0.08 * h
    bay = rect_pts(bx - bwd / 2, by - bht / 2, bwd, bht)
    c.polygon(bay, Linear((0, by - bht / 2), (0, by + bht / 2), BAY))
    c.stroke(bay, 0.5 * SCALE, STINGER)
    for k in range(3):  # bay door ribs
        xx = bx - bwd / 2 + bwd * (k + 1) / 4
        c.stroke(
            [(xx, by - bht / 2), (xx, by + bht / 2)], 0.35 * SCALE, (*CARAPACE_EDGE[:3], 0.6), False
        )
    c.glow(0.5 * w, 0.24 * h, 0.07 * w, CORE_STOPS)
    return c


def carrier_queen() -> Image.Image:
    return _queen_canvas().image()


def carrier_queen_cracks() -> Image.Image:
    """Layer, the exposed Carrier: random-walk cracks (hot rim, dark core) and sparks, kept to
    the hull so nothing lands on empty space."""
    c, w, h = _enemy_canvas("carrier")
    rng = random.Random(8)
    for _ in range(2):
        x, y = rng.uniform(0.3, 0.7) * w, rng.uniform(0.3, 0.7) * h
        pts = [(x, y)]
        ang = rng.uniform(0, 2 * math.pi)
        for _ in range(4):
            ang += rng.uniform(-0.9, 0.9)
            ln = rng.uniform(0.05, 0.1) * w
            x, y = x + math.cos(ang) * ln, y + math.sin(ang) * ln
            pts.append((x, y))
        c.stroke(pts, 1.1 * SCALE, (*HOT[:3], 0.9), False)
        c.stroke(pts, 0.55 * SCALE, SCORCH, False)
    for _ in range(2):
        c.glow(rng.uniform(0.25, 0.75) * w, rng.uniform(0.25, 0.75) * h, 0.06 * w, EMBER_STOPS)
    hull = _queen_canvas(glows=False).px[..., 3:4] > 60 / 255
    c.px *= hull
    return c.image()


# --------------------------------------------------------------------------------------------
# Buddy: B1 Escort (34x34 game px box). A small delta drone that reads as a mini P1.
# It faces up like the player ship; the game mirrors it horizontally by its travel direction.


def buddy_escort() -> Image.Image:
    box = BUDDY_BOX * SCALE
    w = h = float(box)
    c = Canvas(box, box)
    c.glow(0.5 * w, 0.9 * h, 0.1 * w, ENGINE_STOPS)
    body = units(
        [(0.5, 0.2), (0.82, 0.72), (0.62, 0.8), (0.5, 0.74), (0.38, 0.8), (0.18, 0.72)], w, h
    )
    c.fill_stroke(body, hlin(w, SILVER))
    canopy(c, 0.5 * w, 0.5 * h, 0.07 * w, 0.09 * h)
    for s in (1, -1):  # cyan wing stripes
        stripe = [
            (0.5 + s * 0.12, 0.62),
            (0.5 + s * 0.28, 0.7),
            (0.5 + s * 0.26, 0.73),
            (0.5 + s * 0.12, 0.67),
        ]
        c.polygon(units(stripe, w, h), CYAN)
    return c.image()


# --------------------------------------------------------------------------------------------
# Asteroids (#3596): R1 basalt look, drawn NEUTRAL (greyscale) so the game can tint each rock
# at runtime into one of three palettes (one set of files instead of three). The tint is a
# per-channel affine map of the grey value L (0..1):  colour = edge + L * (light - edge), the
# same matrix on native (a Skia colour filter) and web (`render/rockTint.ts`). Large rocks also
# get a separate ore-vein layer, drawn over the tinted body untinted, so the salvage glow stays
# gold on every palette (#3568). Small rocks have no ore.

ROCK_BOXES = {"large": 44, "small": 24}  # game px: 2 x the hitbox radius (ASTEROID_STATS)
ROCK_PAD = 2 * SCALE  # a thin transparent margin (the edge stroke, the vein glow)
# Grey stops of the neutral body. L_DARK puts the gradient's dark end where each palette's dark
# stop sits between its edge (L = 0) and its light stop (L = 1); measured 0.19-0.27 per channel.
ROCK_L_DARK = 0.22
ROCK_BODY: Stops = [(0, (1.0, 1.0, 1.0, 1)), (1, (ROCK_L_DARK, ROCK_L_DARK, ROCK_L_DARK, 1))]
ROCK_EDGE = (0.0, 0.0, 0.0, 1.0)
# The three owner-approved palettes (light stop, edge), mirrored by `ROCK_PALETTES` in
# frontend render/palette.ts. L_DARK lands within 7 levels of each approved dark stop (R2's red
# channel is the farthest; R1 within 1, R3 within 3), close enough not to show on a gradient.
ROCK_PALETTES: dict[str, tuple[str, str]] = {
    "R1 basalt": ("#9a8c80", "#1e1915"),
    "R2 rust iron": ("#b0805a", "#24140c"),
    "R3 slate blue-grey": ("#8a96a8", "#151a22"),
}
ROCK_DARK_STOPS = {
    "R1 basalt": "#3a322c",
    "R2 rust iron": "#4a2c1c",
    "R3 slate blue-grey": "#2c323e",
}
ORE = hexrgb("#ffc04a")  # the glowing salvage veins
# (size, seed) of every variant: the owner-approved shapes (seeds 3 and 11 large, 5 small) plus a
# second small one. Two of each, times three palettes, is six looks per size inside the byte
# budget (the four Kenney meteors were 13,206 B; a third variant of each would cost about 5 KB).
ROCK_VARIANTS: dict[str, tuple[str, int]] = {
    "rock-large-1": ("large", 3),
    "rock-large-2": ("large", 11),
    "rock-small-1": ("small", 5),
    "rock-small-2": ("small", 13),
}


class TwoPointRadial(Gradient):
    """Cairo's two-circle radial gradient: t runs from circle (c0, r0) to circle (c1, r1)."""

    def __init__(self, c0: Point, r0: float, c1: Point, r1: float, stops: Stops):
        self.c0, self.r0, self.c1, self.r1, self.stops = c0, r0, c1, r1, stops

    def rgba(self, h: int, w: int, x0: int = 0, y0: int = 0) -> np.ndarray:
        yy, xx = np.mgrid[y0 : y0 + h, x0 : x0 + w].astype(np.float64)
        px, py = xx + 0.5 - self.c0[0], yy + 0.5 - self.c0[1]
        dx, dy, dr = self.c1[0] - self.c0[0], self.c1[1] - self.c0[1], self.r1 - self.r0
        a = dx * dx + dy * dy - dr * dr
        b = px * dx + py * dy + self.r0 * dr
        c = px * px + py * py - self.r0 * self.r0
        if abs(a) < 1e-9:
            t = c / (2 * b + 1e-9)
        else:  # the larger root of a t^2 - 2 b t + c = 0 (the circle drawn last wins)
            root = np.sqrt(np.maximum(b * b - a * c, 0))
            t = np.maximum((b + root) / a, (b - root) / a)
        return _ramp(np.clip(t, 0, 1).astype(np.float32), self.stops)


def rock_outline(seed: int, n: int = 12, jag: float = 0.07) -> list[Point]:
    """The rock's silhouette in unit-box coordinates (the approved shapes)."""
    rng = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.12, 0.12)
        r = 0.44 + rng.uniform(-jag, jag * 0.6)
        pts.append((0.5 + r * math.cos(a), 0.5 + r * math.sin(a)))
    return pts


def _rock_canvas(size: str) -> tuple[Canvas, float]:
    d = ROCK_BOXES[size] * SCALE
    return Canvas(d, d, ROCK_PAD), float(d)


def _rock_body(size: str, seed: int) -> tuple[Canvas, random.Random]:
    c, d = _rock_canvas(size)
    pts = units(rock_outline(seed), d, d)
    c.polygon(
        pts, TwoPointRadial((0.35 * d, 0.3 * d), 0.05 * d, (0.5 * d, 0.5 * d), 0.6 * d, ROCK_BODY)
    )
    c.stroke(pts, 0.7 * SCALE, ROCK_EDGE)
    rng = random.Random(seed + 9)
    for _ in range(3 if size == "large" else 2):  # craters
        cx, cy, r = rng.uniform(0.3, 0.7), rng.uniform(0.3, 0.7), rng.uniform(0.05, 0.09)
        stops: Stops = [(0, (*ROCK_EDGE[:3], 0.9)), (1, (1.0, 1.0, 1.0, 0.25))]
        c.ellipse(
            cx * d, cy * d, r * d, r * d, Radial(((cx - 0.02) * d, (cy - 0.02) * d), r * d, stops)
        )
    return c, rng


def rock_body(name: str) -> Image.Image:
    """A rock variant's neutral body (greyscale RGBA; the game tints it)."""
    size, seed = ROCK_VARIANTS[name]
    return _rock_body(size, seed)[0].image()


def rock_veins(name: str) -> Image.Image:
    """A large rock's ore veins: gold random walks with a soft glow, kept on the body."""
    size, seed = ROCK_VARIANTS[name]
    body, rng = _rock_body(size, seed)  # the same random stream the reference drew them from
    c, d = _rock_canvas(size)
    for _ in range(3):
        x, y = rng.uniform(0.3, 0.7) * d, rng.uniform(0.3, 0.7) * d
        pts = [(x, y)]
        ang = rng.uniform(0, 2 * math.pi)
        for _ in range(4):
            ang += rng.uniform(-0.8, 0.8)
            x, y = x + math.cos(ang) * 0.08 * d, y + math.sin(ang) * 0.08 * d
            pts.append((x, y))
        c.stroke(pts, 1.0 * SCALE, ORE, False)
    v = c.image()
    a = np.array(v)
    a[..., 3] = (a[..., 3] * (body.px[..., 3] > 60 / 255)).astype(np.uint8)
    lines = Image.fromarray(a, "RGBA")
    out = lines.filter(ImageFilter.GaussianBlur(1.6))
    out.alpha_composite(lines)
    return out


def tint_rock(neutral: Image.Image, palette: str) -> Image.Image:
    """The runtime tint, simulated: colour = edge + L * (light - edge), alpha kept."""
    light, edge = (np.array(hexrgb(h)[:3]) * 255 for h in ROCK_PALETTES[palette])
    a = np.asarray(neutral).astype(np.float64)
    lum = a[..., :1] / 255
    out = a.copy()
    out[..., :3] = edge + lum * (light - edge)
    return Image.fromarray(np.rint(np.clip(out, 0, 255)).astype(np.uint8), "RGBA")


def compose_rock(name: str, palette: str, cache: dict[str, Image.Image]) -> Image.Image:
    """A rock as the game draws it: the tinted body, then (large only) the untinted veins."""
    out = tint_rock(cache[name], palette)
    if f"{name}-veins" in cache:
        out.alpha_composite(cache[f"{name}-veins"])
    return out


def _rock_recipes() -> dict[str, Callable[[], Image.Image]]:
    recipes: dict[str, Callable[[], Image.Image]] = {}
    for name, (size, _) in ROCK_VARIANTS.items():
        recipes[name] = lambda n=name: rock_body(n)
        if size == "large":
            recipes[f"{name}-veins"] = lambda n=name: rock_veins(n)
    return recipes


# --------------------------------------------------------------------------------------------
# Projectiles (#3594). One shape language: friendly fire is an elongated bolt (cyan for the
# player, a shorter mint one for Buddy), danger is round (a red-orange plasma orb, the Carrier's
# twin lasers in hive pink) or a sharp amber shard (flak aimed at rocks). Each is one tiny sprite
# with its glow baked in, so the game draws one image per shot. The boxes are the art's size in
# game px; the game draws the box plus SHOT_PAD on every side, centred on the shot, whatever its
# hitbox (hitboxes are unchanged). Bolts point up; the game turns them along their travel.

SHOT_PAD = 2 * SCALE  # canvas px either side of the box: room for the baked glow
SHOT_WHITE = hexrgb("#f4ffff")  # the player bolt's hot core
BUDDY_MINT = hexrgb("#5dffa8")  # Buddy's bolt body (the Buddy pickup's mint)
BUDDY_CORE = hexrgb("#eafff4")
ORB_HOT = hexrgb("#fffaeb")  # every orb's white-hot centre
ORB_INNER = hexrgb("#ffb03c")  # enemy plasma: orange body...
ORB_OUTER = hexrgb("#ff3a1a")  # ...red-orange rim (the Carrier beam's plasma, #3625)
CARRIER_INNER = hexrgb("#ff9a6a")  # the Carrier's twin lasers: salmon body...
CARRIER_OUTER = hexrgb("#e0204a")  # ...hive-pink rim
FLAK = hexrgb("#ffc04a")  # amber shard (the ore gold: flak is aimed at rocks)
FLAK_CORE = hexrgb("#fff7d9")

# name -> (box w, box h) in game px
SHOT_BOXES: dict[str, tuple[int, int]] = {
    "shot-player": (5, 14),
    "shot-buddy": (4, 10),
    "shot-enemy": (7, 7),
    "shot-flak": (5, 8),
    "shot-carrier": (8, 8),
}


def _gauss_kernel(sigma: float) -> np.ndarray:
    r = max(1, math.ceil(3 * sigma))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    return (k / k.sum()).astype(np.float32)


def blur_premul(px: np.ndarray, sigma: float) -> np.ndarray:
    """A separable Gaussian blur of a premultiplied RGBA float array (edges read as clear), so
    a halo keeps its colour instead of fading through black."""
    k = _gauss_kernel(sigma)
    r = len(k) // 2
    p = np.pad(px, ((r, r), (r, r), (0, 0)))
    h, w = px.shape[:2]
    rows = sum(k[i] * p[:, i : i + w] for i in range(len(k)))
    return sum(k[i] * rows[i : i + h] for i in range(len(k))).astype(np.float32)


def _with_glow(c: Canvas, sigma: float, strength: float) -> Image.Image:
    """The shot over its own blurred halo (alpha x `strength`), as one image."""
    halo = blur_premul(c.px, sigma) * strength
    c.px = c.px + halo * (1 - c.px[..., 3:4])
    return c.image()


def _shot_canvas(name: str) -> tuple[Canvas, float, float]:
    bw, bh = SHOT_BOXES[name]
    w, h = bw * SCALE, bh * SCALE
    return Canvas(w, h, SHOT_PAD), float(w), float(h)


def capsule_pts(w: float, h: float, n: int = 12) -> list[Point]:
    """A vertical capsule filling a w x h box: round caps of radius w / 2."""
    r = w / 2
    top = [
        (r + r * math.cos(math.pi + math.pi * i / n), r + r * math.sin(math.pi + math.pi * i / n))
        for i in range(n + 1)
    ]
    bot = [
        (r + r * math.cos(math.pi * i / n), h - r + r * math.sin(math.pi * i / n))
        for i in range(n + 1)
    ]
    return top + bot


def shot_bolt(name: str, core: RGBA, edge: RGBA, glow: float) -> Image.Image:
    """A friendly bolt: a capsule whose colour fades out to the sides, a hot core line along it,
    and a soft glow in the body colour."""
    c, w, h = _shot_canvas(name)
    fade: Stops = [(0, (*edge[:3], 0.0)), (0.5, edge), (1, (*edge[:3], 0.0))]
    c.polygon(capsule_pts(w, h), hlin(w, fade))
    c.stroke([(w / 2, h * 0.08), (w / 2, h * 0.85)], w * 0.32, core, closed=False)
    return _with_glow(c, glow * SCALE / 3, 0.9)


def shot_orb(name: str, inner: RGBA, outer: RGBA, glow: float = 2.2) -> Image.Image:
    """A danger orb: a white-hot centre, the inner colour, a rim fading out, and a glow."""
    c, w, _ = _shot_canvas(name)
    r = w / 2
    stops: Stops = [(0, ORB_HOT), (0.3, inner), (0.75, outer), (1, (*outer[:3], 0.0))]
    c.ellipse(r, r, r, r, Radial((r, r), r, stops))
    return _with_glow(c, glow * SCALE / 3, 0.8)


def shot_flak() -> Image.Image:
    """Flak: an amber diamond shard with a pale core, pointing along its travel."""
    c, w, h = _shot_canvas("shot-flak")
    c.polygon(units([(0.5, 0), (1, 0.55), (0.5, 1), (0, 0.55)], w, h), FLAK)
    c.polygon(units([(0.5, 0.2), (0.7, 0.55), (0.5, 0.8), (0.3, 0.55)], w, h), FLAK_CORE)
    return _with_glow(c, 1.5 * SCALE / 3, 0.7)


SHOT_RECIPES: dict[str, Callable[[], Image.Image]] = {
    "shot-player": lambda: shot_bolt("shot-player", SHOT_WHITE, CYAN, 2.0),
    "shot-buddy": lambda: shot_bolt("shot-buddy", BUDDY_CORE, BUDDY_MINT, 1.6),
    "shot-enemy": lambda: shot_orb("shot-enemy", ORB_INNER, ORB_OUTER),
    "shot-flak": shot_flak,
    "shot-carrier": lambda: shot_orb("shot-carrier", CARRIER_INNER, CARRIER_OUTER),
}


# --------------------------------------------------------------------------------------------
# Pickups (#3595, owner pick "C-hex"). The four timed power-ups are one family: a hexagonal
# data-chip token, a silver bevel round a coloured face, and a white glyph (Shield crest,
# Lightning bolt, Buddy's up-arrow ship, Bomb with a fuse spark). The two persistent upgrades are
# their own shapes in the same finish: a gold crate with a white up-chevron (salvage: guns up)
# and a bevelled steel-blue armour plate with a white plus (hull plating). The hexagon and its
# silver rim are what set the Bomb apart from the round red-orange enemy orbs. Every sprite is
# the 24 px pickup box (frontend POWERUP_W/H; all six kinds share it) plus PICKUP_PAD on every
# side for the baked glow; the halo and pulse of the two upgrades stay code-drawn.

PICKUP_BOX = 24  # game px, square (frontend POWERUP_W / POWERUP_H)
PICKUP_PAD = 2 * SCALE  # canvas px either side of the box: room for the baked glow
PICKUP_FACE: dict[str, RGBA] = {
    "shield": hexrgb("#29c6ff"),
    "lightning": hexrgb("#ffe23a"),
    "buddy": hexrgb("#5dffa8"),
    "bomb": hexrgb("#ff6a2a"),
}
GLYPH = hexrgb("#ffffff")
FUSE_SPARK = (1.0, 0.9, 0.3, 1.0)
CRATE: Stops = [(0, hexrgb("#ffd56a")), (1, hexrgb("#b07510"))]
CRATE_EDGE = hexrgb("#5a3a06")
CRATE_BAND = hexrgb("#7a4d08")
PICKUP_GLOW = 2.0  # canvas px, the baked glow's sigma


def hexagon_pts(cx: float, cy: float, r: float) -> list[Point]:
    """A regular hexagon with points to the left and right (a flat top and bottom)."""
    return [
        (cx + r * math.cos(k * math.pi / 3), cy + r * math.sin(k * math.pi / 3)) for k in range(6)
    ]


def _shield_crest() -> list[Point]:
    """The Shield glyph's crest in unit coords (about -1 to 1), point down."""
    segs = [
        ((0, -0.9), (0.6, -0.7), (0.75, -0.6), (0.75, -0.6)),
        ((0.75, -0.6), (0.75, 0.2), (0.4, 0.7), (0, 0.95)),
        ((0, 0.95), (-0.4, 0.7), (-0.75, 0.2), (-0.75, -0.6)),
        ((-0.75, -0.6), (-0.75, -0.6), (-0.6, -0.7), (0, -0.9)),
    ]
    out: list[Point] = []
    for seg in segs:
        out += bezier_pts(*seg, n=10)[:-1]
    return out


# Each glyph is a list of (polygon in unit coords, colour); `glyph` scales them about a centre.
GLYPHS: dict[str, list[tuple[list[Point], RGBA]]] = {
    "shield": [(_shield_crest(), GLYPH)],
    "lightning": [
        ([(0.2, -1), (-0.55, 0.15), (-0.05, 0.15), (-0.25, 1), (0.55, -0.2), (0.05, -0.2)], GLYPH)
    ],
    "buddy": [
        ([(0, -0.9), (0.75, 0.6), (0.25, 0.4), (0, 0.75), (-0.25, 0.4), (-0.75, 0.6)], GLYPH)
    ],
    "bomb": [
        (ellipse_pts(0, 0.15, 0.62, 0.62, 48), GLYPH),
        (rect_pts(-0.18, -0.75, 0.36, 0.35), GLYPH),
        (ellipse_pts(0.3, -0.85, 0.17, 0.17, 24), FUSE_SPARK),
    ],
    "salvage": [
        (
            [
                (0, -0.8),
                (0.7, 0.05),
                (0.32, 0.05),
                (0.32, 0.8),
                (-0.32, 0.8),
                (-0.32, 0.05),
                (-0.7, 0.05),
            ],
            GLYPH,
        )
    ],
    "hull": [
        (rect_pts(-0.18, -0.75, 0.36, 1.5), GLYPH),
        (rect_pts(-0.75, -0.18, 1.5, 0.36), GLYPH),
    ],
}


def glyph(c: Canvas, kind: str, cx: float, cy: float, s: float) -> None:
    for pts, color in GLYPHS[kind]:
        c.polygon([(cx + x * s, cy + y * s) for x, y in pts], color)


def _pickup_canvas() -> tuple[Canvas, float]:
    w = PICKUP_BOX * SCALE
    return Canvas(w, w, PICKUP_PAD), float(w)


def pickup_powerup(kind: str) -> Image.Image:
    """A timed power-up: the hex token (silver bevel, face shaded top to bottom) and its glyph."""
    c, w = _pickup_canvas()
    face = PICKUP_FACE[kind]
    dark = (face[0] * 0.45, face[1] * 0.45, face[2] * 0.45, 1.0)
    c.polygon(hexagon_pts(w / 2, w / 2, 0.47 * w), Linear((0, 0), (w, w), SILVER))
    c.polygon(hexagon_pts(w / 2, w / 2, 0.38 * w), Linear((0, 0), (0, w), [(0, face), (1, dark)]))
    glyph(c, kind, w / 2, w / 2, 0.19 * w)
    return _with_glow(c, PICKUP_GLOW, 0.55)


def pickup_salvage() -> Image.Image:
    """The salvage crate (guns up): a gold crate, a dark band and edge, a white up-chevron."""
    c, w = _pickup_canvas()
    body = rect_pts(0.12 * w, 0.18 * w, 0.76 * w, 0.64 * w)
    c.polygon(body, Linear((0, 0.18 * w), (0, 0.82 * w), CRATE))
    c.stroke(body, 0.6 * SCALE, CRATE_EDGE)
    c.polygon(rect_pts(0.12 * w, 0.44 * w, 0.76 * w, 0.12 * w), CRATE_BAND)
    glyph(c, "salvage", w / 2, w / 2, 0.16 * w)
    return _with_glow(c, PICKUP_GLOW, 0.6)


def pickup_hull() -> Image.Image:
    """The hull plate: a bevelled armour plate in plating blue, its rim, a white plus."""
    c, w = _pickup_canvas()
    plate = units(
        [(0.5, 0.06), (0.9, 0.22), (0.86, 0.66), (0.5, 0.94), (0.14, 0.66), (0.1, 0.22)], w, w
    )
    c.polygon(plate, Linear((0, 0), (w, w), ARMOR))
    c.stroke(plate, 1.0 * SCALE, ARMOR_EDGE)
    glyph(c, "hull", w / 2, 0.48 * w, 0.15 * w)
    return _with_glow(c, PICKUP_GLOW, 0.6)


PICKUP_RECIPES: dict[str, Callable[[], Image.Image]] = {
    "pickup-shield": lambda: pickup_powerup("shield"),
    "pickup-lightning": lambda: pickup_powerup("lightning"),
    "pickup-buddy": lambda: pickup_powerup("buddy"),
    "pickup-bomb": lambda: pickup_powerup("bomb"),
    "pickup-salvage": pickup_salvage,
    "pickup-hull": pickup_hull,
}


ENEMY_RECIPES: dict[str, Callable[[], Image.Image]] = {
    "elite-mantis": elite_mantis,
    "elite-mantis-attack": elite_mantis_attack,
    "elite-mantis-hurt": elite_mantis_hurt,
    "guardian-scarab": guardian_scarab,
    "guardian-scarab-plate": guardian_scarab_plate,
    "guardian-scarab-cracks": guardian_scarab_cracks,
    "guardian-scarab-plate2": guardian_scarab_plate2,
    "carrier-queen": carrier_queen,
    "carrier-queen-cracks": carrier_queen_cracks,
}

# Every look an enemy can take in the game, as the recipes stacked bottom to top (the runtime
# picks them in `render/enemies.ts`). The contrast test and the contact sheet compose these.
ENEMY_LOOKS: dict[str, tuple[str, list[str]]] = {
    "grunt": ("grunt", ["grunt-wasp"]),
    "elite": ("elite", ["elite-mantis"]),
    "elite-attack": ("elite", ["elite-mantis-attack"]),
    "elite-1hp": ("elite", ["elite-mantis-hurt"]),
    "guardian-4hp": ("guardian", ["guardian-scarab"]),
    "guardian-3hp": ("guardian", ["guardian-scarab", "guardian-scarab-plate"]),
    "guardian-2hp": (
        "guardian",
        ["guardian-scarab", "guardian-scarab-plate", "guardian-scarab-cracks"],
    ),
    "guardian-1hp": (
        "guardian",
        [
            "guardian-scarab",
            "guardian-scarab-plate",
            "guardian-scarab-cracks",
            "guardian-scarab-plate2",
        ],
    ),
    "carrier": ("carrier", ["carrier-queen"]),
    "carrier-exposed": ("carrier", ["carrier-queen", "carrier-queen-cracks"]),
}


def compose_enemy(look: str, cache: dict[str, Image.Image]) -> Image.Image:
    """One enemy look: its layers stacked as the game draws them."""
    _, layers = ENEMY_LOOKS[look]
    out = cache[layers[0]].copy()
    for layer in layers[1:]:
        out.alpha_composite(cache[layer])
    return out


# --------------------------------------------------------------------------------------------
# Registry: name -> recipe (a no-argument callable returning an RGBA image)

LAYERS = ("base", "guns2", "guns3", "plating1", "plating2")  # bottom to top


def _build_recipes() -> dict[str, Callable[[], Image.Image]]:
    recipes: dict[str, Callable[[], Image.Image]] = {}
    for ship in SHIPS:
        for layer in LAYERS:
            recipes[f"{ship}-{layer}"] = lambda s=ship, layer_=layer: _ship_layer(s, layer_)
    recipes["grunt-wasp"] = grunt_wasp
    recipes.update(ENEMY_RECIPES)
    recipes["buddy-escort"] = buddy_escort
    recipes.update(_rock_recipes())
    recipes.update(SHOT_RECIPES)
    recipes.update(PICKUP_RECIPES)
    return recipes


RECIPES = _build_recipes()


def render(name: str) -> Image.Image:
    return RECIPES[name]()


def to_webp(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=WEBP_QUALITY, alpha_quality=WEBP_ALPHA_QUALITY, method=WEBP_METHOD)
    return buf.getvalue()


def decode_webp(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGBA")


def compose_ship(ship: str, guns: int, hull: int, cache: dict[str, Image.Image]) -> Image.Image:
    """A ship as the game stacks it: base, then guns2/3, then plating1/2, plus the outline."""
    layers = ["base"] + [f"guns{n}" for n in (2, 3) if guns >= n]
    layers += [f"plating{n}" for n in (1, 2) if hull >= n]
    out = cache[f"{ship}-base"].copy()
    for layer in layers[1:]:
        out.alpha_composite(cache[f"{ship}-{layer}"])
    mask = np.maximum.reduce([hull_alpha(ship, layer) for layer in layers])
    return armour_outline(out, hull, mask)


# --------------------------------------------------------------------------------------------
# Contact sheet

CELL = 130


def _game_size(im: Image.Image) -> Image.Image:
    return im.resize((max(1, im.width // SCALE), max(1, im.height // SCALE)), Image.LANCZOS)


def _tile(sheet: Image.Image, im: Image.Image, col: int, row_y: int, text: str) -> None:
    sheet.alpha_composite(
        im, (col * CELL + (CELL - im.width) // 2, row_y + 16 + (CELL - im.height) // 2)
    )
    ImageDraw.Draw(sheet).text((col * CELL + 2, row_y + 2), text, fill=(200, 210, 230, 255))


def _short(name: str) -> str:
    for ship in SHIPS:
        name = name.replace(ship, ship[:2])
    return name


def contact_sheet(cache: dict[str, Image.Image]) -> Image.Image:
    """`cache` holds the decoded WebPs, so the sheet shows the shipped look."""
    cols = 9
    names = list(RECIPES)
    rows: list[list[tuple[Image.Image, str]]] = []
    for i in range(0, len(names), cols):
        chunk = names[i : i + cols]
        rows.append([(cache[n], _short(n)) for n in chunk])
        rows.append([(_game_2x(cache[n]), "game 2x") for n in chunk])
    for ship in SHIPS:
        full = [
            (compose_ship(ship, g, h, cache), f"{ship[:2]} L{g} H{h}")
            for h in (0, 1, 2)
            for g in (1, 2, 3)
        ]
        rows.append(full)
        rows.append([(_game_2x(im), "game 2x") for im, _ in full])
    looks = list(ENEMY_LOOKS)
    for i in range(0, len(looks), cols):  # #3593: every enemy look, damage layers stacked
        chunk = [(compose_enemy(n, cache), n) for n in looks[i : i + cols]]
        rows.append(chunk)
        rows.append([(_game_2x(im), "game 2x") for im, _ in chunk])
    for palette in ROCK_PALETTES:  # #3596: every rock, tinted as the game tints it
        chunk = [(compose_rock(n, palette, cache), f"{n[5:]} {palette[:2]}") for n in ROCK_VARIANTS]
        rows.append(chunk)
        rows.append([(_game_2x(im), "game 2x") for im, _ in chunk])
    sheet = Image.new("RGBA", (cols * CELL, len(rows) * (CELL + 16)), SHEET_BG)
    for r, tiles in enumerate(rows):
        for col, (im, text) in enumerate(tiles):
            _tile(sheet, im, col, r * (CELL + 16), text)
    return sheet


def _game_2x(im: Image.Image) -> Image.Image:
    """The sprite at game size, enlarged 2x with no smoothing (to judge the pixels)."""
    return _game_size(im).resize((im.width * 2 // SCALE, im.height * 2 // SCALE), Image.NEAREST)


# --------------------------------------------------------------------------------------------
# CLI


def main(out_dir: Path | None, names: Sequence[str], sheet: bool = False) -> Path:
    """Draw `names` (default all) into `out_dir` (default: a new temporary directory). Unknown
    names exit with an error before anything is written. Returns the directory used."""
    unknown = [n for n in names if n not in RECIPES]
    if unknown:
        sys.exit(f"unknown name(s): {', '.join(unknown)}\nvalid names: {', '.join(RECIPES)}")
    out = out_dir if out_dir is not None else Path(tempfile.mkdtemp(prefix="starswarm-art-"))
    out.mkdir(parents=True, exist_ok=True)
    cache: dict[str, Image.Image] = {}
    for name in names or list(RECIPES):
        data = to_webp(render(name))
        (out / f"starswarm-{name}.webp").write_bytes(data)
        cache[name] = decode_webp(data)
        print(f"{name}: {cache[name].width}x{cache[name].height}  {len(data):,} B")
    if sheet:
        for n in RECIPES:
            if n not in cache:
                cache[n] = decode_webp(to_webp(render(n)))
        contact_sheet(cache).save(out / "contact-sheet.png")
        print(f"contact sheet: {out / 'contact-sheet.png'}")
    return out


def parse(argv: Sequence[str]) -> tuple[Path | None, list[str], bool]:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("names", nargs="*", help="recipe names to draw (default: all)")
    ap.add_argument("--out", type=Path, default=None, help="output directory (default: a temp dir)")
    ap.add_argument("--sheet", action="store_true", help="also write contact-sheet.png")
    ns = ap.parse_intermixed_args(argv)
    return ns.out, ns.names, ns.sheet


if __name__ == "__main__":
    out_dir = main(*parse(sys.argv[1:]))
    print(f"output: {out_dir}")
