"""Scratch recipes for Sort sound OPTIONS (#3661), glass and water. Not repo files."""

from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
import _paths  # noqa: F401  (puts tools/assets on sys.path)
from synth_common import (
    SR,
    fade,
    highpass,
    level_rms,
    lowpass,
    lp2,
    noise,
    norm,
    phase,
    place,
    t_axis,
)

# --- voices -----------------------------------------------------------------------------------
GLASS = [
    (1.0, 1.0, 1.0),
    (2.32, 0.45, 0.55),
    (4.25, 0.22, 0.3),
    (6.63, 0.10, 0.18),
]  # ratio, gain, decay-scale


def ping(f, dur, decay, parts=GLASS, att=0.002, g=1.0):
    """Glass ping: inharmonic partials, short attack, exponential decays."""
    t = t_axis(dur)
    x = np.zeros_like(t)
    for r, a, ds in parts:
        if f * r < 9000:
            x += a * np.sin(phase(np.full_like(t, f * r))) * np.exp(-t / (decay * ds))
    return g * x * np.clip(t / att, 0, 1)


def tick(seed, dur=0.02, lo=2500, hi=9000, g=1.0):
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    return g * x / (np.std(x) + 1e-12) * np.exp(-t / (dur / 5)) * np.clip(t / 0.0004, 0, 1)


def chirp(f0, f1, dur, decay, seed=0, curve=3.0, att=0.004, h2=0.0):
    """Bubble: a sine gliding f0->f1 (fast exponential approach), with an optional 2nd harmonic."""
    t = t_axis(dur)
    f = f1 + (f0 - f1) * np.exp(-t * curve / dur)
    ph = phase(f)
    x = np.sin(ph) + h2 * np.sin(2 * ph)
    return x * np.exp(-t / decay) * np.clip(t / att, 0, 1)


def air(seed, dur, lo, hi, peak=0.5, power=1.5):
    """Smooth band of air, swelling to `peak` (0..1 of dur) then falling."""
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    x /= np.std(x) + 1e-12
    p = t / t[-1]
    up = np.clip(p / peak, 0, 1) ** power
    dn = (1 - np.clip((p - peak) / (1 - peak + 1e-9), 0, 1)) ** 2
    return x * up * dn


def sweep_air(seed, dur, f0, f1, bw=0.5):
    """Noise through a rising/falling band (a slosh): lowpass-highpass tracking f(t)."""
    t = t_axis(dur)
    f = np.linspace(f0, f1, len(t))
    x = noise(len(t), seed)
    y = lowpass(highpass(x, f * (1 - bw / 2)), f * (1 + bw))
    y /= np.std(y) + 1e-12
    p = t / t[-1]
    return y * np.sin(np.pi * p) ** 1.5


def jit(i, spread=0.05):  # variation: deterministic pitch scale per variation index
    return [1.0, 1 - spread, 1 + spread * 1.1][i % 3]


def fin(x, rms, peak=-3.0, fi=0.002, fo=0.015):
    return level_rms(fade(x, fi, fo), rms, peak)


# --- SELECT (0.12 s, on lift) ----------------------------------------------------------------
def select(opt, i=0):
    j = jit(i)
    x = np.zeros(int(0.12 * SR))
    if opt == "A":  # bright glass tick: a fingertip on a bottle, tiny ping
        place(x, tick(100 + i, 0.012, 2500, 9000, 0.9), 0)
        place(x, ping(3100 * j, 0.1, 0.018, [(1, 1, 1), (2.32, 0.3, 0.5)], g=0.9), 0)
    elif opt == "B":  # rounder glass "tok": body of the bottle, two low-mid partials
        place(x, tick(110 + i, 0.01, 1200, 5000, 0.6), 0)
        place(
            x, ping(1250 * j, 0.1, 0.022, [(1, 1, 1), (2.7, 0.45, 0.5), (5.1, 0.15, 0.3)], g=1.0), 0
        )
    else:  # water pip: a tiny droplet chirp rising
        place(x, chirp(1300 * j, 2300 * j, 0.1, 0.02, curve=4, att=0.002) * 0.9, 0)
        place(x, tick(120 + i, 0.006, 3000, 9000, 0.25), 0)
    return fin(x, -24, fo=0.02)


# --- POUR LIFT (soft, 0.17 s, at the tap) and GLUG (per unit, ~0.2 s) ------------------------
def pour_lift(opt, i=0):
    j = jit(i)
    x = np.zeros(int(0.2 * SR))
    if opt == "A":  # glass lifted off the shelf: a faint glass touch, then a soft rising puff
        place(x, ping(1900 * j, 0.1, 0.03, [(1, 1, 1), (2.32, 0.35, 0.5)], g=0.35), 0.0)
        place(x, tick(200 + i, 0.012, 1500, 6000, 0.3), 0.0)
        place(x, air(210 + i, 0.17, 500, 2400, 0.7) * 0.5, 0.01)
    elif opt == "B":  # water slosh in the bottle as it tips: rising band of liquid noise
        place(x, sweep_air(220 + i, 0.18, 600 * j, 1500 * j, 0.7) * 0.8, 0.0)
        place(x, chirp(500 * j, 800 * j, 0.08, 0.03, curve=2, att=0.02) * 0.2, 0.03)
    else:  # glass-on-glass scoot: a soft high glass rub, then a tiny clink as it settles over the neck
        r = lp2(highpass(noise(int(0.12 * SR), 230 + i), 2200), 5500)
        r = r / (np.std(r) + 1e-12) * np.sin(np.pi * t_axis(0.12) / 0.12) ** 1.5 * 0.4
        place(x, r, 0.0)
        place(x, ping(2700 * j, 0.1, 0.035, g=0.55), 0.13)
    return fin(x, -28, fi=0.01, fo=0.03)


def glug(opt, i=0, rise=0.0):
    j = jit(i) * (1 + rise)
    x = np.zeros(int(0.24 * SR))
    if opt == "A":  # higher/brighter: a quick bright bubble with a glassy ping on the surface
        place(x, chirp(850 * j, 1500 * j, 0.14, 0.04, curve=5, h2=0.15), 0)
        place(x, ping(2600 * j, 0.12, 0.025, [(1, 1, 1), (2.32, 0.3, 0.5)], g=0.22), 0.002)
        place(x, air(300 + i, 0.08, 1500, 6000, 0.2) * 0.12, 0.0)
    elif opt == "B":  # rounder/deeper: a fat low bubble that droops, hollow bottle body
        place(x, chirp(520 * j, 380 * j, 0.22, 0.07, curve=3, h2=0.3, att=0.006), 0)
        place(x, chirp(1040 * j, 760 * j, 0.15, 0.03, curve=3, att=0.006) * 0.18, 0)
        place(x, air(310 + i, 0.1, 500, 2500, 0.25) * 0.1, 0)
    else:  # bubblier: three small bubbles tumbling, a rising one each
        for k, (at, f0, f1, g) in enumerate(
            [(0.0, 700, 1100, 1.0), (0.045, 900, 1500, 0.75), (0.085, 1150, 1800, 0.5)]
        ):
            place(x, chirp(f0 * j, f1 * j, 0.07, 0.018, curve=4, att=0.003) * g, at)
        place(x, air(320 + i, 0.14, 1800, 7000, 0.3) * 0.1, 0.0)
    return fin(x, -21, fi=0.002, fo=0.04)


# --- REFUSED (0.24 s, the shake) -------------------------------------------------------------
def refused(opt, i=0):
    x = np.zeros(int(0.26 * SR))
    if opt == "A":  # two dull glass taps, falling (like a bottle knocking its neighbour)
        place(x, ping(900, 0.09, 0.02, [(1, 1, 1), (2.5, 0.3, 0.4)], g=1.0), 0.0)
        place(x, tick(400, 0.008, 800, 3500, 0.4) * 0.5, 0.0)
        place(x, ping(760, 0.12, 0.028, [(1, 1, 1), (2.5, 0.3, 0.4)], g=0.85), 0.12)
        place(x, tick(401, 0.008, 800, 3500, 0.4) * 0.4, 0.12)
    elif opt == "B":  # a falling water "bloop": the reverse of a glug, droops away
        place(x, chirp(900, 450, 0.24, 0.08, curve=2.2, h2=0.2, att=0.01), 0)
        place(x, tick(410, 0.008, 1000, 4000, 0.3), 0.0)
    else:  # soft glass rattle: a damped buzz of small ticks, left and right of the shake
        for k, at in enumerate([0.0, 0.05, 0.1, 0.15, 0.2]):
            place(
                x,
                ping(1500 - 120 * k, 0.05, 0.012, [(1, 1, 1), (2.7, 0.3, 0.4)], g=0.8 * 0.72**k),
                at,
            )
            place(x, tick(420 + k, 0.006, 1500, 5000, 0.4 * 0.72**k), at)
    return fin(x, -23, fo=0.04)


# --- COMPLETE (<=0.42 s: pulse; badge pops at ~0.12-0.3) -------------------------------------
def complete(opt, i=0):
    x = np.zeros(int(0.5 * SR))
    if opt == "A":  # two-note glass chime, rising a fifth (E6 -> B6)
        place(x, ping(1319, 0.4, 0.14, g=0.8), 0.0)
        place(x, ping(1976, 0.4, 0.16, g=0.9), 0.07)
    elif opt == "B":  # one bright wine-glass ring with a slow shimmer and a tiny clink
        t = t_axis(0.5)
        r = ping(1568, 0.5, 0.2, [(1, 1, 1), (2.32, 0.5, 0.6), (4.25, 0.3, 0.4)], g=1.0)
        r *= 1 + 0.18 * np.sin(2 * np.pi * 9 * t)
        place(x, r, 0.04)
        place(x, tick(430, 0.01, 3000, 9000, 0.6), 0.04)
    else:  # water-up-into-glass: a rising bubble run then a glass ting at the badge
        place(x, chirp(500, 1400, 0.12, 0.05, curve=2, att=0.01) * 0.6, 0.0)
        place(x, chirp(800, 1700, 0.08, 0.03, curve=3, att=0.005) * 0.5, 0.07)
        place(x, ping(2093, 0.38, 0.12, g=0.9), 0.12)
        place(x, ping(3136, 0.3, 0.08, g=0.4), 0.15)
    return fin(x, -20, fo=0.08)


# --- UNDO (0.28 s, soft reverse) -------------------------------------------------------------
def undo(opt, i=0):
    x = np.zeros(int(0.3 * SR))
    if opt == "A":  # a reversed clink: a swell that ends in a tiny tick
        p = ping(1800, 0.26, 0.07, g=1.0)[::-1] * 0.8
        place(x, p, 0.0)
        place(x, tick(440, 0.008, 2500, 8000, 0.3), 0.255)
    elif opt == "B":  # reverse bubble: a droplet sucked back, falling then a soft close
        place(x, chirp(1500, 700, 0.25, 0.09, curve=2.5, att=0.02) * 0.9, 0.0)
    else:  # two soft falling glass notes (C7-ish to G6), gentle
        place(x, ping(1760, 0.2, 0.07, [(1, 1, 1), (2.32, 0.25, 0.5)], g=0.8), 0.0)
        place(x, ping(1318, 0.24, 0.09, [(1, 1, 1), (2.32, 0.25, 0.5)], g=0.9), 0.11)
    return fin(x, -27, fi=0.004, fo=0.05)


# --- HINT (gentle sparkle, ~0.55 s) ----------------------------------------------------------
def hint(opt, i=0):
    x = np.zeros(int(0.65 * SR))
    if opt == "A":  # three rising glass pings, pentatonic (G6 B6 D7... soft)
        for k, (at, f) in enumerate([(0.0, 1568), (0.1, 1976), (0.2, 2349)]):
            place(x, ping(f, 0.4, 0.1, [(1, 1, 1), (2.32, 0.25, 0.5)], g=0.7 + 0.15 * k), at)
    elif opt == "B":  # glints of light on water: random high glass droplets, a soft cluster
        rng = np.random.default_rng(77)
        for k in range(7):
            f = rng.choice([1568, 1760, 2093, 2349, 2637, 3136])
            place(
                x,
                ping(f, 0.25, 0.05, [(1, 1, 1)], g=rng.uniform(0.3, 0.7)),
                0.04 * k + rng.uniform(0, 0.02),
            )
    else:  # glass harmonica: a wine-glass swell with a shimmer, a lit-up bottle
        t = t_axis(0.6)
        e = np.sin(np.pi * np.clip(t / 0.6, 0, 1) ** 0.7) ** 2
        s = sum(
            a * np.sin(phase(np.full_like(t, f)))
            for f, a in [(1568, 1), (2349, 0.5), (3136, 0.35), (3141, 0.3)]
        )
        place(x, s * e * (1 + 0.15 * np.sin(2 * np.pi * 11 * t)), 0.0)
        place(x, ping(3136, 0.3, 0.07, [(1, 1, 1)], g=0.5), 0.28)
    return fin(x, -26, fi=0.006, fo=0.08)


# --- WIN (card at 1.38 s; tail ~0.6 s under card) --------------------------------------------
WIN_LEN = 2.0
CARD = 1.38
STAG = 0.06


def win(opt, i=0):
    x = np.zeros(int(WIN_LEN * SR))
    if (
        opt == "A"
    ):  # glass chime cascade: rising C major pentatonic, one note per piece, then a bright chord at the card
        notes = [1047, 1319, 1568, 1976, 2349, 2637]
        for k, f in enumerate(notes):
            place(x, ping(f, 0.9, 0.22, g=0.55 + 0.06 * k), 0.02 + k * 0.17)
        for f, g in [(1047, 0.8), (1568, 0.7), (2093, 0.8), (3136, 0.5)]:
            place(x, ping(f, 0.6, 0.3, g=g), CARD)
        place(x, tick(500, 0.02, 3000, 9000, 0.6), CARD)
    elif (
        opt == "B"
    ):  # water cascade: rain of glugs falling in pitch filling a glass, then a clear ting
        rng = np.random.default_rng(88)
        for k in range(10):
            at = 0.02 + k * 0.13
            f0 = 1500 * (0.93**k) * rng.uniform(0.95, 1.05)
            place(x, chirp(f0 * 0.6, f0, 0.12, 0.035, curve=4, att=0.003) * (0.5 + 0.04 * k), at)
            place(x, ping(f0 * 1.9, 0.2, 0.04, [(1, 1, 1)], g=0.2), at)
        place(x, air(501, 1.2, 1500, 6000, 0.9) * 0.08, 0.0)
        for f, g in [(1568, 0.9), (2349, 0.7), (3136, 0.45)]:
            place(x, ping(f, 0.6, 0.28, g=g), CARD)
        place(x, tick(502, 0.02, 3000, 9000, 0.6), CARD)
    else:  # glass wind-chime shimmer: dense random glissando up, swelling, resolving on a high ring
        rng = np.random.default_rng(99)
        scale = np.array([1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637, 3136])
        n = 22
        for k in range(n):
            p = k / (n - 1)
            idx = int(np.clip(p * 8 + rng.integers(-1, 2), 0, 8))
            place(
                x,
                ping(scale[idx], 0.5, 0.1, [(1, 1, 1), (2.32, 0.3, 0.5)], g=0.25 + 0.5 * p),
                0.02 + p * 1.3 + rng.uniform(0, 0.02),
            )
        t = t_axis(1.6)
        sw = (
            sum(np.sin(phase(np.full_like(t, f))) for f in (2093, 3136))
            * 0.2
            * np.sin(np.pi * np.clip(t / 1.6, 0, 1) ** 0.8) ** 2
        )
        place(x, sw, 0.0)
        for f, g in [(2093, 0.9), (3136, 0.8), (4186, 0.35)]:
            place(x, ping(f, 0.6, 0.3, g=g), CARD)
    return fin(x, -17, fi=0.004, fo=0.15)


SOUNDS = {  # name: (function, variations, loudness)
    "select": (select, 3),
    "lift": (pour_lift, 3),
    "glug": (glug, 3),
    "refused": (refused, 1),
    "complete": (complete, 1),
    "undo": (undo, 1),
    "hint": (hint, 1),
    "win": (win, 1),
}
