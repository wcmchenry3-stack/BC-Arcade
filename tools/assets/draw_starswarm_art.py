"""Deterministic Star Swarm sprite generator (#3591, epic #3590).

Draws the Star Swarm sprites from vector recipes and writes WebP at 3x display size, authored at
each box's aspect ratio. Only Pillow and numpy are used (no cairo: it has no Linux wheel).
The design reasoning lives in `docs/games/starswarm-art-design.md`.

Usage:
    python tools/assets/draw_starswarm_art.py [out_dir] [name ...] [--sheet]

    out_dir   where to write `starswarm-<name>.webp` (default: a temp directory; production
              assets are NOT written into frontend/assets by this story)
    name      recipe names to draw (default: all). Unknown names exit with an error, before any
              file is written.
    --sheet   also write `contact-sheet.png`: every recipe at 3x and at game size (shown 2x),
              plus every gun level x hull level composite of each ship with the code-drawn
              armour outline simulated. Used for owner reviews.

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
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# --------------------------------------------------------------------------------------------
# Constants

SCALE = 3  # sprites are authored at 3x their display size (game px)
SS = 8  # shape supersample factor
PAD = 3 * SCALE  # transparent margin around the box (glows, strokes, the armour outline)
PLAYER_BOX = 34  # game px, square (frontend PLAYER_W)
GRUNT_BOX = 24  # game px, square (TIER_SIZE.Grunt)
WEBP_QUALITY = 90
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
CARAPACE: Stops = [(0, hexrgb("#7a4aa0")), (0.5, hexrgb("#4b2470")), (1, hexrgb("#1f0d33"))]
CARAPACE_EDGE = hexrgb("#c07bff")  # enemy hull rim light
STINGER = hexrgb("#ff5a3c")  # enemy weapons / danger
MEMBRANE = (0.75, 0.55, 1.0, 0.35)
OUTLINE_RGB = (31, 182, 255)

# --------------------------------------------------------------------------------------------
# Vector helper: a premultiplied float RGBA canvas


class Gradient:
    """A fill evaluated per pixel; `rgba(h, w)` returns a premultiplied (h, w, 4) float array."""

    def rgba(self, h: int, w: int) -> np.ndarray:  # pragma: no cover - interface
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

    def rgba(self, h: int, w: int) -> np.ndarray:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        xx += 0.5
        yy += 0.5
        dx, dy = self.p1[0] - self.p0[0], self.p1[1] - self.p0[1]
        den = dx * dx + dy * dy or 1.0
        t = ((xx - self.p0[0]) * dx + (yy - self.p0[1]) * dy) / den
        return _ramp(np.clip(t, 0, 1), self.stops)


class Radial(Gradient):
    def __init__(self, c: Point, r: float, stops: Stops):
        self.c, self.r, self.stops = c, r, stops

    def rgba(self, h: int, w: int) -> np.ndarray:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
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


class Canvas:
    """A premultiplied RGBA float canvas. Coordinates are in box pixels: (0, 0) is the box's
    top-left corner, `pad` pixels inside the canvas."""

    def __init__(self, box_w: int, box_h: int, pad: int = PAD):
        self.w, self.h, self.pad = box_w + 2 * pad, box_h + 2 * pad, pad
        self.px = np.zeros((self.h, self.w, 4), np.float32)

    def _pt(self, p: Point) -> Point:
        return (p[0] + self.pad, p[1] + self.pad)

    def _mask(self, draw: Callable[[ImageDraw.ImageDraw], None]) -> np.ndarray:
        big = Image.new("L", (self.w * SS, self.h * SS), 0)
        draw(ImageDraw.Draw(big))
        small = big.resize((self.w, self.h), Image.LANCZOS)
        return np.clip(np.asarray(small, np.float32) / 255, 0, 1)

    def _paint(self, mask: np.ndarray, fill: Fill) -> None:
        if isinstance(fill, Gradient):
            src = fill.rgba(self.h, self.w) * mask[..., None]
        else:
            r, g, b, a = fill
            src = np.stack([r * a * mask, g * a * mask, b * a * mask, a * mask], -1)
        self.px = src + self.px * (1 - src[..., 3:4])

    def _shift(self, fill: Fill) -> Fill:
        """Gradients are specified in box coordinates; move them onto the padded canvas."""
        if isinstance(fill, Linear):
            return Linear(self._pt(fill.p0), self._pt(fill.p1), fill.stops)
        if isinstance(fill, Radial):
            return Radial(self._pt(fill.c), fill.r, fill.stops)
        return fill

    def polygon(self, pts: Sequence[Point], fill: Fill) -> None:
        sp = [(x * SS, y * SS) for x, y in map(self._pt, pts)]
        self._paint(self._mask(lambda d: d.polygon(sp, fill=255)), self._shift(fill))

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, fill: Fill) -> None:
        self.polygon(ellipse_pts(cx, cy, rx, ry), fill)

    def stroke(self, pts: Sequence[Point], width: float, color: RGBA, closed: bool = True) -> None:
        """A stroke centred on the path, round joins."""
        sp = [(x * SS, y * SS) for x, y in map(self._pt, pts)]
        if closed:
            sp = [*sp, sp[0], sp[1]]
        wpx = max(1, round(width * SS))

        def draw(d: ImageDraw.ImageDraw) -> None:
            d.line(sp, fill=255, width=wpx, joint="curve")
            r = wpx / 2  # round the path's ends and corners
            for x, y in sp:
                d.ellipse((x - r, y - r, x + r, y + r), fill=255)

        self._paint(self._mask(draw), color)

    def fill_stroke(
        self, pts: Sequence[Point], fill: Fill, edge: RGBA = EDGE, lw: float = 0.55
    ) -> None:
        self.polygon(pts, fill)
        self.stroke(pts, lw * SCALE, edge)

    def glow(self, x: float, y: float, r: float, stops: Stops) -> None:
        """A radial glow: a gradient disc."""
        self.ellipse(x, y, r, r, Radial((x, y), r, stops))

    def blur(self, radius: float) -> None:
        """Gaussian-blur the whole canvas (used for soft halos built on a scratch canvas)."""
        chans = [
            np.asarray(
                Image.fromarray(self.px[..., i], "F").filter(ImageFilter.GaussianBlur(radius))
            )
            for i in range(4)
        ]
        self.px = np.stack(chans, -1)

    def image(self) -> Image.Image:
        a = self.px[..., 3]
        rgb = np.where(a[..., None] > 1e-6, self.px[..., :3] / np.maximum(a[..., None], 1e-6), 0)
        out = np.concatenate([rgb, a[..., None]], -1)
        return Image.fromarray(np.rint(np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")


def armour_outline(im: Image.Image, level: int) -> Image.Image:
    """The code-drawn armour outline, simulated: dilate the silhouette, subtract it, blur and
    tint. Thin at hull level 1, bold at level 2. Level 0 returns the image unchanged."""
    if level <= 0:
        return im
    a = np.asarray(im)[..., 3]
    m = Image.fromarray(((a > 40) * 255).astype(np.uint8), "L")
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


def mirror(pts: Sequence[Point]) -> list[Point]:
    return [(1 - x, y) for x, y in pts]


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
    c.fill_stroke([(w - x, y) for x, y in wing], hlin(w, SILVER))
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
    c.fill_stroke([(w - x, y) for x, y in wing], hlin(w, SILVER))
    can = units([(0.55, 0.26), (0.75, 0.3), (0.56, 0.36)], w, h)
    c.fill_stroke(can, hlin(w, SILVER))
    c.fill_stroke([(w - x, y) for x, y in can], hlin(w, SILVER))
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
    c.fill_stroke([(w - x, y) for x, y in boom], hlin(w, SILVER))
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
    """Bolted-on armour plate: pale-blue gradient, blue edge, a rivet."""
    p = units(pts, w, h)
    c.polygon(p, Linear((0, 0), (w, h), ARMOR))
    c.stroke(p, 0.75 * SCALE, ARMOR_EDGE)
    cx = sum(x for x, _ in p) / len(p)
    cy = sum(y for _, y in p) / len(p)
    c.ellipse(cx, cy, 0.012 * w, 0.012 * w, ARMOR_EDGE)


def _ship_layer(ship: str, layer: str) -> Image.Image:
    hull, guns, plates = SHIPS[ship]
    box = PLAYER_BOX * SCALE
    c = Canvas(box, box)
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
    return c.image()


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
# Registry: name -> recipe (a no-argument callable returning an RGBA image)

RECIPES: dict[str, Callable[[], Image.Image]] = {}
for _ship in SHIPS:
    for _layer in ("base", "guns2", "guns3", "plating1", "plating2"):
        RECIPES[f"{_ship}-{_layer}"] = lambda s=_ship, l=_layer: _ship_layer(s, l)
RECIPES["grunt-wasp"] = grunt_wasp

LAYERS = ("base", "guns2", "guns3", "plating1", "plating2")
GAME_BOX = {"grunt-wasp": GRUNT_BOX}


def render(name: str) -> Image.Image:
    return RECIPES[name]()


def to_webp(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
    return buf.getvalue()


def compose_ship(ship: str, guns: int, hull: int, cache: dict[str, Image.Image]) -> Image.Image:
    """A ship as the game stacks it: base, then guns2/3, then plating1/2, plus the outline."""
    names = ["base"] + [f"guns{n}" for n in (2, 3) if guns >= n]
    names += [f"plating{n}" for n in (1, 2) if hull >= n]
    out = cache[f"{ship}-base"].copy()
    for n in names[1:]:
        out.alpha_composite(cache[f"{ship}-{n}"])
    return armour_outline(out, hull)


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


def contact_sheet(cache: dict[str, Image.Image]) -> Image.Image:
    cols = 9
    names = list(RECIPES)
    rows: list[tuple[str, list[tuple[Image.Image, str]]]] = []
    for i in range(0, len(names), cols):
        chunk = names[i : i + cols]
        rows.append(
            (
                "3x",
                [
                    (
                        cache[n],
                        n.replace("p1-arrow", "p1")
                        .replace("p2-forward-swept", "p2")
                        .replace("p3-twin-boom", "p3"),
                    )
                    for n in chunk
                ],
            )
        )
        small = [
            (
                _game_size(cache[n]).resize((cache[n].width * 2 // SCALE,) * 2, Image.NEAREST),
                "game 2x",
            )
            for n in chunk
        ]
        rows.append(("game", small))
    for ship in SHIPS:
        combos = [(g, h) for h in (0, 1, 2) for g in (1, 2, 3)]
        full = [(compose_ship(ship, g, h, cache), f"{ship[:2]} L{g} H{h}") for g, h in combos]
        rows.append(("3x", full))
        rows.append(
            (
                "game",
                [
                    (_game_size(im).resize((im.width * 2 // SCALE,) * 2, Image.NEAREST), "game 2x")
                    for im, _ in full
                ],
            )
        )
    sheet = Image.new("RGBA", (cols * CELL, len(rows) * (CELL + 16)), SHEET_BG)
    for r, (_, tiles) in enumerate(rows):
        for col, (im, text) in enumerate(tiles):
            _tile(sheet, im, col, r * (CELL + 16), text)
    return sheet


# --------------------------------------------------------------------------------------------
# CLI


def main(out_dir: Path, names: list[str], sheet: bool = False) -> None:
    unknown = [n for n in names if n not in RECIPES]
    if unknown:
        sys.exit(f"unknown name(s): {', '.join(unknown)}; known: {', '.join(RECIPES)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache: dict[str, Image.Image] = {}
    for name in names or list(RECIPES):
        cache[name] = render(name)
        data = to_webp(cache[name])
        (out_dir / f"starswarm-{name}.webp").write_bytes(data)
        print(f"{name}: {cache[name].width}x{cache[name].height}  {len(data):,} B")
    if sheet:
        for n in RECIPES:
            cache.setdefault(n, render(n))
        contact_sheet(cache).save(out_dir / "contact-sheet.png")
        print(f"contact sheet: {out_dir / 'contact-sheet.png'}")


def parse(argv: list[str]) -> tuple[Path, list[str], bool]:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("args", nargs="*", help="[out_dir] [name ...]")
    ap.add_argument("--sheet", action="store_true", help="also write contact-sheet.png")
    ns = ap.parse_args(argv)
    args = ns.args
    if args and args[0] in RECIPES:  # names only: use the default out_dir
        return Path(tempfile.gettempdir()) / "starswarm-art", args, ns.sheet
    if args:
        return Path(args[0]), args[1:], ns.sheet
    return Path(tempfile.gettempdir()) / "starswarm-art", [], ns.sheet


if __name__ == "__main__":
    main(*parse(sys.argv[1:]))
