"""Synthesize the puzzle, tile and dice games' sound effects (no samples, no third-party audio). #3578

Covers Sort, 2048, Yacht, Daily Word, Sudoku and Mahjong (not the card games, which are
synth_arcade_sfx.py / #3563, Star Swarm or Cascade). Mahjong's background music is out of scope.
These games share one family of sounds: one file can back several games' registry keys. Each
recipe is the one the owner approved after a gameplay audition. The reasoning behind each sound
is in docs/games/puzzle-sound-design.md. The building blocks are in synth_common.py.

Writes into frontend/assets/sounds/. Noise uses a fixed seed per sound, so every run
reproduces the same decoded audio (compare with synth_common.decoded_pcm_sha256: Ogg bytes
differ only by their random stream serial).

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_puzzle_sfx.py [out_dir] [sound ...]

With no sound names, every sound is written.

Sounds:
- dice-roll-1/2/3.ogg  Yacht "short cup and spill", 0.75 s each: a brief muffled rattle in a cup
  (~90 ms), then five dice spill onto a wooden tray and bounce to rest by ~0.42 s, inside the
  500 ms tumble animation. Every impact is noise (a click plus noise-driven resonances, no sine
  body), a few with a die-on-die knock. Three variations (seeds) via useSoundVariants.
- die-hold-1/2/3.ogg  Yacht "pick up", 0.12 s each: a fingertip click on the die, then a small
  rising puff of air as it is lifted (~50 ms in all). Three variations.
- die-release-1/2/3.ogg  Yacht "set down", 0.12 s each: a soft tap on wood (the die put back),
  then a tiny settle bounce ~25 ms later. Three variations, 1 dB under the hold.
- Yacht scoring ladder, "wood and mallet" (one sound per score; a milestone replaces the commit):
  score-commit.ogg (a pencil tap on a wooden scorepad), score-zero.ogg (a dull pencil scratch
  and tap, for a 0), small-straight.ogg / large-straight.ogg (4 / 5 rising marimba notes),
  full-house.ogg (a 3-note chord, then a 2-note pair), upper-bonus.ogg (a rising run into a
  held marimba roll with a glass sparkle, ~1 s). cpu-*.ogg: the computer's "rival" versions of
  the same six, falling, minor, darker, 2.5 dB quieter and at most 0.5 s.
- Yacht jackpot, the top of the ladder ("mallet fanfare"): jackpot-yacht.ogg (a two-octave mallet
  run into a big rolled C major chord, glass sparkles falling, ~1.5 s), jackpot-joker.ogg (the
  same a whole step higher, with a double "again!" bell). cpu-jackpot-yacht.ogg /
  cpu-jackpot-joker.ogg: the computer's, 0.7 s: a fast falling minor run into a low minor chord.
- 2048 "wooden tiles": tile-merge-1/2/3.ogg (0.22 s: a faint slide of air, then two wooden tiles
  clacking together at 100 ms, as the sliding tiles meet and pop) and tile-spawn-1/2/3.ogg (0.16 s: a small tile set
  down at 60 ms, as the new tile scales in). Three variations each; the spawn, on every swipe, is
  the quietest sound in the game.
- 2048 win-2048.ogg (~2.5 s: from the 2048 tile's pop, the Yacht jackpot's rising mallet run and
  rolled chord, then a final "ta-da" mallet chord with a high glass bell as the win card shows at
  1.0 s) and game-over-2048.ogg (~2.0 s: a last wooden tile clack as the move lands, a gentle
  falling mallet line G E D C over the dim and shake, settling on a soft low A minor chord as the
  card shows at 0.6 s). Timed to the motion (#3690).
- Mahjong "real tiles", "crisp clack": mahjong-select-1/2/3.ogg (0.12 s: a bright fingertip tick
  on a dense tile, with a breath of cloth, on the tap) and mahjong-match-1/2/3.ogg (0.5 s: a tap
  on the second tile, the pair flying, a crisp clack and its double as they meet face to face at
  264 ms, then two tiny high sparks on the burst). Three variations each; select is 3 dB under
  match.
- Mahjong mahjong-shuffle-wash.ogg ("washing the tiles", 1.05 s): a dense clatter of ~140 tile
  clicks pushed around on the felt, swelling with the 880 ms swirl over a soft felt rumble, then
  12 tiles landing left to right over 572-880 ms, as the wave lands.
- Mahjong "gong and bells": mahjong-win.ogg (3.4 s: a small gong swells under the spark cascade
  while bells ring a C pentatonic carillon, then a bright gong stroke and a bell chord at 1.45 s,
  as the result card shows) and mahjong-deadlock.ogg (1.9 s: a muted gong (F4) with the board
  shake, then one soft falling bell, E5 then C5, as the card shows).
- Daily Word "wooden letter tiles", "tick + marimba": daily-word-miss/present/correct-1/2/3.ogg
  (0.24 s: a small wooden tile turning over, played as each tile's colour shows, 100 ms apart;
  a grey tile a dull tick, a yellow one adds a soft marimba E5, a green one a warm G5 + C6;
  2 dB louder per step) and daily-word-refused.ogg (0.38 s: two dull taps 120 ms apart over a low
  falling A4-Ab4 on the marimba, with the 360 ms "no" shake).
- Daily Word "mallet run": daily-word-win.ogg (2.4 s: a marimba note on each tile's hop, rising
  C E G C E, a glass shimmer over the sparks, then a rolled C major "ta-da" with a bell as the
  result card shows at 1.1 s) and daily-word-loss.ogg (1.9 s: a soft falling marimba line, one note
  as each answer tile shows, G E D C A, then a low A minor chord as the card shows at 0.78 s).
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import (
    SR,
    fade,
    highpass,
    level_rms,
    lowpass,
    lp2,
    mallet,
    noise,
    norm,
    phase,
    place,
    t_axis,
    write_ogg,
)

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


# --- dice ------------------------------------------------------------------------------------


def resonate(x: np.ndarray, f: float, q: float) -> np.ndarray:
    """Two-pole bandpass resonator (RBJ constant-peak-gain biquad), for ringing noise."""
    w = 2 * np.pi * f / SR
    alpha = np.sin(w) / (2 * q)
    a0 = 1 + alpha
    b0, b2 = alpha / a0, -alpha / a0
    a1, a2 = -2 * np.cos(w) / a0, (1 - alpha) / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x[i], y1, v
        y[i] = v
    return y


# surface -> (highpass, lowpass, attack s, decay s, thud level); resonances drawn per impact
CLACK_SURFACES = {
    "wood": (400, 9000, 0.0003, 0.0025, 0.35),  # a die landing on a wooden tray
    "cup": (500, 4500, 0.0004, 0.003, 0.0),  # dice knocking inside a cup: muffled
    "die": (2500, 10000, 0.0002, 0.0012, 0.0),  # die on die: tiny and bright
}


def clack(seed: int, surface: str, g: float = 1.0) -> np.ndarray:
    """One die impact, 50 ms: a broadband click plus noise-driven resonances (no sine body)."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.05)
    n = len(t)
    lo, hi, att, dec, thud = CLACK_SURFACES[surface]
    if surface == "wood":
        bands = [(rng.uniform(1500, 2100), 10, 0.012), (rng.uniform(3200, 4200), 12, 0.008)]
    elif surface == "cup":
        bands = [(rng.uniform(700, 900), 8, 0.012), (rng.uniform(2600, 3200), 10, 0.006)]
    else:
        bands = [(rng.uniform(4500, 6000), 14, 0.005)]
    onset = np.clip(t / att, 0, 1)
    click = lp2(highpass(noise(n, seed), lo), hi)
    x = click / (np.std(click) + 1e-12) * onset * np.exp(-t / dec)
    for f, q, d in bands:
        r = resonate(noise(n, seed + int(f)), f, q)
        x += 0.5 * r / (np.std(r) + 1e-12) * onset * np.exp(-t / d)
    if thud:
        th = lp2(highpass(noise(n, seed + 7), 150), 600)
        x += thud * th / (np.std(th) + 1e-12) * np.clip(t / 0.002, 0, 1) * np.exp(-t / 0.012)
    return x * g


def bounces(
    seed: int, t0: float, first_gap: float, ratio: float, n_hits: int, g0: float, end: float = 0.56
) -> list[tuple[float, float, int]]:
    """One die bouncing to rest: (time, level, seed) per impact, gaps and levels shrinking."""
    rng = np.random.default_rng(seed)
    hits = []
    at, gap, g = t0, first_gap, g0
    for k in range(n_hits):
        if at > end:
            break
        hits.append((at, g * rng.uniform(0.85, 1.0), seed * 10 + k))
        at += gap * rng.uniform(0.85, 1.15)
        gap *= ratio
        g *= rng.uniform(0.6, 0.72)
    return hits


DICE_CUP_LEN = 0.09  # s of rattle in the cup before the spill ("short cup", owner pick)


def dice_roll(i: int) -> np.ndarray:
    """Short cup and spill, 0.75 s: a brief cup rattle, then 5 dice bounce on wood (variation i)."""
    base = 1000 * (1 + i) + 600
    rng = np.random.default_rng(base)
    x = np.zeros(int(0.75 * SR))
    for j in range(int(rng.integers(7, 9))):  # the rattle swells a little as the cup tips
        at = rng.uniform(0, DICE_CUP_LEN)
        place(x, clack(base + 500 + j, "cup", 0.18 + 0.22 * at / DICE_CUP_LEN), at)
    start = DICE_CUP_LEN + 0.01
    for d in range(5):
        t0 = start + rng.uniform(0, 0.05)
        gap = rng.uniform(0.08, 0.11)
        for at, g, s in bounces(base + d, t0, gap, 0.66, 6, rng.uniform(0.7, 1.0)):
            place(x, clack(s, "wood", g), at)
            if rng.random() < 0.35 and at < 0.4:  # sometimes a knock against another die
                place(x, clack(s + 3, "die", g * 0.45), at + rng.uniform(0.008, 0.02))
    return fade(x, 0.0, 0.05)


def puff(seed: int, dur: float, lo: float, hi: float, rise: float) -> np.ndarray:
    """A smooth puff of air (band-limited noise, no grain), rising then falling."""
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    x /= np.std(x) + 1e-12
    p = t / t[-1]
    return x * np.clip(p / rise, 0, 1) ** 1.2 * (1 - np.clip((p - rise) / (1 - rise), 0, 1)) ** 2


def die_hold(i: int) -> np.ndarray:
    """Pick up, 0.12 s: a fingertip click on the die, then a rising puff as it lifts (variation i)."""
    s = 3000 + 20 * i
    x = np.zeros(int(0.12 * SR))
    place(x, clack(s, "die", 0.7), 0.0)
    place(x, puff(s + 1, (0.045, 0.05, 0.04)[i], 1200, 5000, rise=0.7) * 0.25, 0.004)
    return fade(x, 0.0, 0.02)


def die_release(i: int) -> np.ndarray:
    """Set down, 0.12 s: a soft tap on wood, then a tiny settle bounce (variation i)."""
    s = 3100 + 20 * i
    x = np.zeros(int(0.12 * SR))
    place(x, lowpass(clack(s, "wood", 1.0), 5000), 0.0)
    place(x, lowpass(clack(s + 1, "wood", 0.25), 4000), (0.026, 0.03, 0.022)[i])
    return fade(x, 0.0, 0.02)


# --- scoring ladder ---------------------------------------------------------------------------


def hz(semi_from_c5: float) -> float:
    return 523.25 * 2 ** (semi_from_c5 / 12)


# notes as semitones from C5
C4, Eb4, F4, G4, Ab4, A4, Bb4 = -12, -9, -7, -5, -4, -3, -2
C5, D5, E5, G5, C6, E6, G6, C7 = 0, 2, 4, 7, 12, 16, 19, 24


def marimba(n: float, dur: float = 0.5, decay: float = 0.18) -> np.ndarray:
    return mallet(hz(n), dur, decay)


def low_marimba(n: float) -> np.ndarray:
    """The computer's darker, shorter marimba."""
    return marimba(n, 0.35, 0.12)


def glass(n: float, dur: float = 0.8, decay: float = 0.35) -> np.ndarray:
    """A small glass bell: a sine plus quieter inharmonic partials (x2.76, x5.4)."""
    t = t_axis(dur)
    f = hz(n)
    x = np.sin(phase(np.full_like(t, f))) * np.exp(-t / decay)
    x += 0.3 * np.sin(phase(np.full_like(t, f * 2.76))) * np.exp(-t / (decay * 0.35))
    x += 0.12 * np.sin(phase(np.full_like(t, f * 5.4))) * np.exp(-t / (decay * 0.15))
    return x * np.clip(t / 0.002, 0, 1)


def tremolo_chord(
    notes: list[float], voice: Callable[[float], np.ndarray], dur: float, rate: float, seed: int
) -> np.ndarray:
    """A held chord as a soft mallet roll: the chord re-struck `rate` times a second, fading."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int((dur + 0.35) * SR))  # room for the last strikes to ring out
    k = 0
    at = 0.0
    while at < dur - 0.05:
        for n in notes:
            g = 0.35 * (1 - 0.6 * at / dur) * rng.uniform(0.8, 1.0)
            place(x, voice(n) * g, at + rng.uniform(0, 0.01))
        k += 1
        at = k / rate
    return x


def scratch(seed: int, dur: float, lo: float, hi: float, grain_rate: float = 1200) -> np.ndarray:
    """A pencil stroke on paper: grainy band-limited noise, swelling then easing."""
    t = t_axis(dur)
    n = len(t)
    rng = np.random.default_rng(seed + 500)
    base = lp2(highpass(noise(n, seed), lo), hi)
    base /= np.std(base) + 1e-12
    imp = (rng.random(n) < grain_rate / SR) * rng.uniform(0.5, 1.0, n)
    grain = lp2(imp, 2500)
    grain /= grain.max() + 1e-12
    p = t / t[-1]
    shape = np.clip(p / 0.25, 0, 1) * (1 - np.clip((p - 0.25) / 0.75, 0, 1)) ** 1.5
    return base * (0.35 + 0.65 * grain * 3) * shape


def seq(
    notes: list[float],
    voice: Callable[[float], np.ndarray],
    gap: float,
    total: float,
    gains: list[float] | None = None,
) -> np.ndarray:
    """Notes struck `gap` s apart (0 = a chord) into a `total`-second buffer."""
    x = np.zeros(int(total * SR))
    for i, n in enumerate(notes):
        place(x, voice(n) * (1.0 if gains is None else gains[i]), i * gap)
    return x


def mix(total: float, *parts: tuple[np.ndarray, float]) -> np.ndarray:
    x = np.zeros(int(total * SR))
    for p, at in parts:
        place(x, p, at)
    return fade(x, 0.0, 0.03)


def score_commit() -> np.ndarray:
    """A pencil tapped on a wooden scorepad, 0.12 s."""
    return mix(0.12, (lowpass(clack(4000, "wood", 1.0), 6000), 0.0))


def score_zero() -> np.ndarray:
    """A 0 scored: a dull pencil scratch, then a dull tap, 0.14 s."""
    return mix(
        0.14,
        (lowpass(scratch(4010, 0.07, 400, 2200), 2500) * 0.6, 0.0),
        (lowpass(clack(4011, "wood", 0.6), 2500), 0.06),
    )


def small_straight() -> np.ndarray:
    """Four rising marimba notes (C D E G), 55 ms apart."""
    return mix(0.6, (seq([C5, D5, E5, G5], marimba, 0.055, 0.6), 0.0))


def large_straight() -> np.ndarray:
    """Five rising marimba notes (C D E G C), 50 ms apart, the top one accented."""
    return mix(0.7, (seq([C5, D5, E5, G5, C6], marimba, 0.05, 0.7, [1, 1, 1, 1, 1.25]), 0.0))


def full_house() -> np.ndarray:
    """Three and two: a rolled C major triad, then a C-G pair 160 ms later."""
    return mix(
        0.65,
        (seq([C5, E5, G5], marimba, 0.012, 0.6), 0.0),
        (seq([C6, G5], marimba, 0.012, 0.5), 0.16),
    )


def upper_bonus() -> np.ndarray:
    """Achievement, 1.2 s: a rising run into a held marimba roll on C major, a glass sparkle on top."""
    return mix(
        1.2,
        (seq([G4, C5, E5, G5], marimba, 0.06, 0.6), 0.0),
        (
            tremolo_chord([C5, E5, G5, C6], lambda n: marimba(n, 0.3, 0.12), 0.6, 18, 4020),
            0.26,
        ),
        (glass(G6, 0.7, 0.3) * 0.25, 0.26),
    )


def cpu_score_commit() -> np.ndarray:
    """The computer's commit: a darker wooden tap."""
    return mix(0.12, (lowpass(clack(4100, "wood", 1.0), 3000), 0.0))


def cpu_score_zero() -> np.ndarray:
    """The computer's 0: a darker scratch and tap."""
    return mix(
        0.14,
        (lowpass(scratch(4110, 0.07, 300, 1500), 1600) * 0.6, 0.0),
        (lowpass(clack(4111, "wood", 0.6), 1800), 0.06),
    )


def cpu_small_straight() -> np.ndarray:
    """Four falling minor notes (G F Eb C) an octave down, 45 ms apart."""
    return mix(0.45, (seq([G4, F4, Eb4, C4], low_marimba, 0.045, 0.45), 0.0))


def cpu_large_straight() -> np.ndarray:
    """Five falling notes (C Bb G F C), 42 ms apart."""
    return mix(0.5, (seq([C5, Bb4, G4, F4, C4], low_marimba, 0.042, 0.5), 0.0))


def cpu_full_house() -> np.ndarray:
    """A rolled C minor triad, then a falling G-C pair."""
    return mix(
        0.45,
        (seq([C4, Eb4, G4], low_marimba, 0.012, 0.4), 0.0),
        (seq([G4, C4], lambda n: marimba(n, 0.3, 0.1), 0.012, 0.3), 0.13),
    )


def cpu_upper_bonus() -> np.ndarray:
    """A quick minor sigh, 0.5 s: F minor then C minor."""
    return mix(
        0.5,
        (seq([Ab4, F4, C4], lambda n: marimba(n, 0.4, 0.14), 0.0, 0.45), 0.0),
        (seq([G4, Eb4, C4], lambda n: marimba(n, 0.35, 0.14), 0.0, 0.35), 0.16),
    )


def sparkle(notes: list[float], at0: float, gap: float, g: float = 0.22) -> np.ndarray:
    """Glass sparkles, `gap` s apart from `at0`."""
    x = np.zeros(int((at0 + gap * len(notes) + 0.6) * SR))
    for i, n in enumerate(notes):
        place(x, glass(n, 0.6, 0.25) * g, at0 + i * gap)
    return x


def roll_chord(notes: list[float], dur: float, seed: int) -> np.ndarray:
    """A big held chord as a mallet roll; each strike rings out (0.6 s) so the roll ends softly."""
    return tremolo_chord(notes, lambda n: marimba(n, 0.6, 0.12), dur, 18, seed)


def jackpot_yacht() -> np.ndarray:
    """Your yacht, 1.9 s: a two-octave mallet run into a rolled C major chord, sparkles falling."""
    run = seq([C5, E5, G5, C6, E6, G6], marimba, 0.045, 0.7, [0.8, 0.85, 0.9, 0.95, 1, 1.1])
    return mix(
        1.9,
        (run, 0.0),
        (roll_chord([C5, E5, G5, C6, E6], 1.0, 7001), 0.27),
        (sparkle([G6 + 5, E6 + 12, C6 + 12, G6], 0.35, 0.09), 0.0),
    )


def jackpot_joker() -> np.ndarray:
    """Your joker (another yacht), 1.9 s: the yacht a whole step higher, with a double bell."""
    up = 2
    run = seq([n + up for n in (C5, E5, G5, C6, E6, G6)], marimba, 0.04, 0.7)
    again = seq([C6 + up + 12, C6 + up + 12], lambda n: glass(n, 0.5, 0.2), 0.11, 0.7)
    return mix(
        1.9,
        (run, 0.0),
        (again * 0.35, 0.24),
        (roll_chord([n + up for n in (C5, E5, G5, C6, E6)], 1.0, 7002), 0.26),
        (sparkle([G6 + 5 + up, E6 + 12 + up, C6 + 12 + up, G6 + up], 0.4, 0.08), 0.0),
    )


def cpu_jackpot_yacht() -> np.ndarray:
    """The computer's yacht, 0.7 s: a fast falling minor run into a low C minor chord."""
    return mix(
        0.7,
        (seq([C5, Bb4, G4, Eb4, C4], low_marimba, 0.035, 0.5), 0.0),
        (seq([C4, Eb4, G4], lambda n: marimba(n, 0.45, 0.16), 0.008, 0.5), 0.2),
    )


def cpu_jackpot_joker() -> np.ndarray:
    """The computer's joker, 0.7 s: a falling run into a low F minor chord."""
    return mix(
        0.7,
        (seq([Eb4 + 12, C5, Ab4, F4, C4], low_marimba, 0.035, 0.5), 0.0),
        (seq([C4, F4, Ab4], lambda n: marimba(n, 0.45, 0.16), 0.008, 0.5), 0.2),
    )


# --- 2048 -------------------------------------------------------------------------------------

# game/twenty48/motion.ts (#3689). Every sound fires as the move lands, so each puts its accent on
# its moment: the merge's two tiles meet at SLIDE_MS (100 ms) and the merged tile pops; a new tile
# shows from SPAWN_AT_MS (60 ms); the 2048 tile pops at 100 ms and the win card shows at
# WIN_BEAT_MS (1.0 s); a stuck board dims and shakes from GAME_OVER_DIM_AT_MS (220 ms) and the
# game-over card shows at GAME_OVER_BEAT_MS (0.6 s) (#3690).
TILE_MERGE_AT = 0.10
TILE_SPAWN_AT = 0.06
WIN_POP_AT = 0.10
WIN_CARD_AT = 1.0
GAME_OVER_LAND_AT = 0.10
GAME_OVER_DIM_AT = 0.22
GAME_OVER_CARD_AT = 0.6


def swish(seed: int, dur: float, lo: float, hi: float, g: float) -> np.ndarray:
    """A tile sliding: a short smooth puff of air, rising and falling."""
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    x /= np.std(x) + 1e-12
    p = t / t[-1]
    return x * np.sin(np.pi * p) ** 1.5 * g


def block_clack(seed: int, g: float = 1.0) -> np.ndarray:
    """Two wooden tiles meeting: a click rung at wood resonances, with a softer double."""
    x = np.zeros(int(0.06 * SR))
    place(x, lowpass(clack(seed, "wood", g), 7000), 0.0)
    place(x, lowpass(clack(seed + 1, "wood", g * 0.45), 5000), 0.006)
    return x


def tile_merge(i: int) -> np.ndarray:
    """Merge, 0.22 s: a faint slide, then two wooden tiles clacking on the pop (variation i)."""
    x = np.zeros(int(0.22 * SR))
    place(x, swish(8000 + i, 0.085, 900, 3500, 0.10), 0.0)
    place(x, block_clack(8010 + 10 * i, 1.0), TILE_MERGE_AT)
    return fade(x, 0.0, 0.02)


def tile_spawn(i: int) -> np.ndarray:
    """Spawn, 0.16 s: a small tile set down as the new tile scales in (variation i)."""
    x = np.zeros(int(0.16 * SR))
    place(x, lowpass(clack(8100 + 10 * i, "die", 0.6), 6000), TILE_SPAWN_AT)
    return fade(x, 0.0, 0.02)


def win_2048() -> np.ndarray:
    """2048 reached, 2.6 s: the jackpot's run and roll from the 2048 tile's pop, then a final
    "ta-da" chord and a bell as the win card shows."""
    run = seq([C5, E5, G5, C6, E6, G6], marimba, 0.05, 0.8, [0.8, 0.85, 0.9, 0.95, 1, 1.1])
    final = seq([C5, G5, C6, E6], lambda n: marimba(n, 1.5, 0.32), 0.008, 1.5)
    return mix(
        2.6,
        (run, WIN_POP_AT),
        (roll_chord([C5, E5, G5, C6, E6], 1.1, 9001), WIN_POP_AT + 0.3),
        (sparkle([G6 + 5, E6 + 12, C6 + 12, G6], 0.38, 0.1), WIN_POP_AT),
        (final * 1.2, WIN_CARD_AT),
        (glass(C7, 1.5, 0.4) * 0.25, WIN_CARD_AT),
    )


def game_over_2048() -> np.ndarray:
    """No moves left, 2.1 s: a last tile clack as the move lands, a gentle falling line over the
    dim and shake, a soft low A minor chord as the game-over card shows."""
    line = seq([G5, E5, D5, C5], lambda n: marimba(n, 0.6, 0.2), 0.1, 0.9, [0.9, 0.8, 0.75, 0.7])
    settle = seq([A4, C5, E5], lambda n: marimba(n, 1.5, 0.35), 0.01, 1.5)
    return mix(
        2.1,
        (block_clack(9010, 0.6), GAME_OVER_LAND_AT),
        (line, GAME_OVER_DIM_AT - 0.02),
        (settle * 0.8, GAME_OVER_CARD_AT),
    )


# --- Mahjong ----------------------------------------------------------------------------------

# motion.ts (#3613): a matched pair lifts, flies together and meets at MATCH_MEET_AT (0.6) of
# MATCH_MS (440 ms), then bursts. The match sound fires at the tap, so its clack sits on the meet.
MAHJONG_MEET_AT = 0.264
# A dense mahjong tile's resonances: (Hz, Q, decay s, level); drawn +-4% per hit.
MAHJONG_TILE_BANDS = [(2400, 12, 0.010, 0.6), (3700, 14, 0.008, 0.5), (5600, 16, 0.005, 0.35)]


def tile_hit(
    seed: int, g: float = 1.0, dec: float = 0.0018, thud: float = 0.0, dur: float = 0.06
) -> np.ndarray:
    """A dense mahjong tile struck: a broadband click rung at the tile's resonances (noise-driven)."""
    rng = np.random.default_rng(seed)
    t = t_axis(dur)
    n = len(t)
    onset = np.clip(t / 0.00025, 0, 1)
    c = lp2(highpass(noise(n, seed), 600), 11000)
    x = c / (np.std(c) + 1e-12) * onset * np.exp(-t / dec)
    for f, q, d, a in MAHJONG_TILE_BANDS:
        f *= rng.uniform(0.96, 1.04)
        r = resonate(noise(n, seed + int(f)), f, q)
        x += a * r / (np.std(r) + 1e-12) * onset * np.exp(-t / d)
    if thud:
        th = lp2(highpass(noise(n, seed + 7), 180), 700)
        x += thud * th / (np.std(th) + 1e-12) * np.clip(t / 0.002, 0, 1) * np.exp(-t / 0.01)
    return x * g


def mahjong_select(i: int) -> np.ndarray:
    """Select, 0.12 s: a bright fingertip tick on the tile, with a breath of cloth (variation i)."""
    x = np.zeros(int(0.12 * SR))
    place(x, tile_hit(100 + i, 0.55, dec=0.0012), 0.0)
    place(x, swish(110 + i, 0.05, 2000, 6000, 0.04), 0.004)
    return fade(x, 0.0, 0.02)


def mahjong_match(i: int) -> np.ndarray:
    """Match, 0.5 s: a tap on the second tile, the pair flying, a crisp clack as they meet face to
    face, then two tiny high sparks on the burst (variation i)."""
    x = np.zeros(int(0.5 * SR))
    place(x, tile_hit(120 + i, 0.35, dec=0.001), 0.0)
    place(x, swish(130 + i, 0.2, 1500, 5000, 0.05), 0.05)
    place(x, tile_hit(140 + i, 1.0, thud=0.15), MAHJONG_MEET_AT)
    place(x, tile_hit(150 + i, 0.35), MAHJONG_MEET_AT + 0.007)
    sparks = np.zeros(int(0.4 * SR))
    for k, n in enumerate([G6 + 12 - 2 * i, E6 + 12]):
        place(sparks, glass(n, 0.25, 0.06) * 0.12 * 0.85**k, 0.045 * k)
    place(x, sparks, MAHJONG_MEET_AT + 0.02)
    return fade(x, 0.0, 0.03)


# motion.ts (#3613): a shuffle swirls every tile to its new place over SHUFFLE_MS (880 ms), in a
# wave: each starts at up to 0.35 of it (0-308 ms) and lands 0.65 of it later (572-880 ms).
MAHJONG_SHUFFLE_LAND = (0.572, 0.88)


def tile_clatter(
    seed: int, t0: float, t1: float, n: int, g0: float, g1: float, shape: float = 1.0
) -> np.ndarray:
    """n tile clicks scattered between t0 and t1, swelling in the middle (shape), levels g0..g1."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int((t1 + 0.1) * SR))
    for k in range(n):
        u = rng.random()
        at = t0 + (t1 - t0) * u
        g = (g0 + (g1 - g0) * u) * np.sin(np.pi * u) ** shape * rng.uniform(0.4, 1.0)
        place(x, tile_hit(seed * 100 + k, g, dec=rng.uniform(0.0008, 0.0016)), at)
    return x


def tile_landings(seed: int, n: int, g: float) -> np.ndarray:
    """The shuffle's wave of tiles landing, left to right over MAHJONG_SHUFFLE_LAND, settling."""
    rng = np.random.default_rng(seed)
    land0, land1 = MAHJONG_SHUFFLE_LAND
    x = np.zeros(int((land1 + 0.15) * SR))
    for k in range(n):
        u = k / (n - 1)
        at = land0 + (land1 - land0) * u + rng.uniform(-0.01, 0.01)
        place(x, tile_hit(seed * 100 + k, g * rng.uniform(0.6, 1.0) * (1 - 0.4 * u), thud=0.1), at)
    return x


def mahjong_shuffle() -> np.ndarray:
    """Shuffle, 1.05 s, "washing the tiles": a dense clatter of tiles pushed around on the felt,
    swelling with the swirl, over a soft felt rumble, then the wave of tiles settling into place."""
    x = np.zeros(int(1.05 * SR))
    place(x, swish(500, 0.75, 400, 2500, 0.18), 0.02)
    place(x, tile_clatter(501, 0.02, 0.70, 140, 0.25, 0.35, 0.8), 0.0)
    place(x, tile_landings(502, 12, 0.55), 0.0)
    return fade(x, 0.005, 0.08)


# The win plays at the winning tap; its spark cascade (motion.ts WIN_CASCADE_MS) holds the result
# card back until 1.45 s, where the win's final stroke lands. The deadlock plays with the 420 ms
# board shake; its card shows at 500 ms (engine.ts DEADLOCK_OVERLAY_DELAY_MS).
MAHJONG_WIN_CARD_AT = 1.45
MAHJONG_PENTATONIC = [0, 2, 4, 7, 9]  # C D E G A


def pentatonic(k: int) -> float:
    """The k-th note of C major pentatonic from C5 (k = 5 is C6), as semitones from C5."""
    return 12 * (k // 5) + MAHJONG_PENTATONIC[k % 5]


def gong(f: float, dur: float, decay: float, swell: float = 0.05, g: float = 1.0) -> np.ndarray:
    """A small gong: inharmonic partials, some slowly beating, a short swell and a long decay."""
    t = t_axis(dur)
    x = np.zeros_like(t)
    partials = [(1.0, 1.0, 1.0, 0.0), (1.47, 0.5, 0.7, 1.3), (2.09, 0.35, 0.5, 2.1)]
    partials += [(2.76, 0.22, 0.35, 0.0), (3.9, 0.12, 0.25, 3.0)]
    for ratio, a, dk, beat in partials:
        fr = np.full_like(t, f * ratio) * (1 + 0.002 * np.sin(2 * np.pi * beat * t))
        x += a * np.sin(phase(fr)) * np.exp(-t / (decay * dk))
    return x * (1 - np.exp(-t / swell)) * g


def mahjong_win() -> np.ndarray:
    """Win, 3.4 s, "gong and bells": a small gong swells under the sparks while bells ring a
    pentatonic carillon, then a bright gong stroke and a bell chord as the result card shows."""
    x = np.zeros(int(3.4 * SR))
    place(x, gong(hz(-7), 1.4, 0.6, 0.25, 0.25), 0.25)
    for k, n in enumerate(pentatonic(j) for j in [5, 7, 9, 8, 10, 12, 11, 13, 14]):
        place(x, glass(n, 0.8, 0.28) * 0.17, 0.35 + 0.11 * k)
    place(x, gong(hz(-5), 2.0, 0.9, 0.01, 0.6), MAHJONG_WIN_CARD_AT)
    for k, n in enumerate([12, 16, 19, 21]):  # C6 E6 G6 A6
        place(x, glass(n, 1.8, 0.6) * 0.25, MAHJONG_WIN_CARD_AT + 0.02 * k)
    return fade(x, 0.0, 0.3)


def mahjong_deadlock() -> np.ndarray:
    """Deadlock, 1.9 s: a muted low gong with the board shake, then one soft falling bell (E5, C5)
    as the result card shows."""
    x = np.zeros(int(1.9 * SR))
    place(x, gong(hz(-7), 1.6, 0.45, 0.01, 0.9), 0.0)
    place(x, glass(E5, 1.3, 0.45) * 0.3, 0.42)
    place(x, glass(C5, 1.3, 0.5) * 0.25, 0.62)
    return fade(x, 0.0, 0.25)


# --- Daily Word -------------------------------------------------------------------------------

# motion.ts (#3664): a tile's colour changes at its flip midpoint, i * TILE_STAGGER_MS +
# FLIP_HALF_MS after Enter. The reveal sound is played there, so its tick is at 0, and it stays
# short: the next tile's tick follows 100 ms later. The refusal plays with the 360 ms shake.
DAILY_WORD_RESULTS = ("miss", "present", "correct")


def word_tick(seed: int, g: float, lp: float, thud: float = 0.0) -> np.ndarray:
    """A small wooden letter tile turning over: a short wood clack, low-passed, with an
    optional dull body (a grey tile, a refusal)."""
    x = lowpass(clack(seed, "wood", g), lp)
    if thud:
        t = t_axis(0.05)
        th = lp2(highpass(noise(len(t), seed + 3), 200), 700)
        x += thud * g * th / (np.std(th) + 1e-12) * np.clip(t / 0.002, 0, 1) * np.exp(-t / 0.01)
    return x


def daily_word_reveal(result: str, i: int) -> np.ndarray:
    """One tile's reveal, 0.24 s ("tick + marimba", variation i): a grey tile is a dull wooden
    tick; a present (yellow) one adds a soft marimba E5; a correct (green) one a warm G5 + C6."""
    seed = 12000 + 10 * i + 100 * DAILY_WORD_RESULTS.index(result)
    x = np.zeros(int(0.24 * SR))
    if result == "miss":
        place(x, word_tick(seed, 0.8, 4000, thud=0.3), 0.0)
    elif result == "present":
        place(x, word_tick(seed, 0.7, 6000), 0.0)
        place(x, marimba(E5, 0.23, 0.07) * 0.5, 0.004)
    else:
        place(x, word_tick(seed, 0.7, 6500), 0.0)
        place(x, marimba(G5, 0.23, 0.09) * 0.45, 0.004)
        place(x, marimba(C6, 0.23, 0.09) * 0.35, 0.004)
    return fade(x, 0.0, 0.03)


def daily_word_refused() -> np.ndarray:
    """A refused guess, 0.38 s: two dull wooden taps on the shake's first swings, 120 ms apart,
    over a low falling minor second (A4, Ab4) on the marimba: a soft "no"."""
    x = np.zeros(int(0.38 * SR))
    place(x, word_tick(12500, 0.9, 2500, thud=0.6), 0.0)
    place(x, word_tick(12510, 0.6, 2200, thud=0.6), 0.12)
    place(x, marimba(A4, 0.25, 0.06) * 0.25, 0.0)
    place(x, marimba(Ab4, 0.25, 0.06) * 0.22, 0.12)
    return fade(x, 0.0, 0.03)


# motion.ts (#3664): the win plays when the solved row has finished flipping. Its tiles then hop
# WIN_HOP_STAGGER_MS (70 ms) apart, each at its highest 0.45 of WIN_HOP_MS (240 ms) in, and the
# result card shows after winCelebrationMs (1.1 s, the sparks). The loss plays at the same moment:
# the answer's tiles flip in LOSS_REVEAL_STAGGER_MS (120 ms) apart, each showing its colour
# FLIP_HALF_MS (150 ms) in, and the card shows after lossRevealMs (0.78 s for five letters).
DAILY_WORD_HOP_STAGGER = 0.07
DAILY_WORD_HOP_PEAK = 0.45 * 0.24
DAILY_WORD_WIN_CARD_AT = 1.1
DAILY_WORD_ANSWER_STAGGER = 0.12
DAILY_WORD_ANSWER_MID = 0.15
DAILY_WORD_LOSS_CARD_AT = 0.78


def daily_word_win() -> np.ndarray:
    """Win, 2.4 s ("mallet run"): a marimba note on each tile's hop, rising C5 E5 G5 C6 E6, a glass
    shimmer over the sparks, then a rolled C major "ta-da" with a high bell as the card shows."""
    x = np.zeros(int(2.4 * SR))
    for k, n in enumerate([C5, E5, G5, C6, E6]):
        hop = k * DAILY_WORD_HOP_STAGGER + DAILY_WORD_HOP_PEAK
        place(x, marimba(n, 0.6, 0.18) * (0.8 + 0.05 * k), hop - 0.004)
    for k, n in enumerate([G6, C7, E6 + 12, G6]):
        place(x, glass(n, 0.7, 0.25) * 0.12, 0.45 + 0.12 * k)
    for k, n in enumerate([C5, G5, C6, E6]):
        place(x, marimba(n, 1.3, 0.4) * 0.9, DAILY_WORD_WIN_CARD_AT + 0.012 * k)
    place(x, glass(C7, 1.2, 0.4) * 0.2, DAILY_WORD_WIN_CARD_AT + 0.03)
    return fade(x, 0.0, 0.25)


def daily_word_loss() -> np.ndarray:
    """Loss, 1.9 s: a soft falling marimba line, one note as each answer tile shows (G5 E5 D5 C5
    A4), then a low A minor chord as the card shows; gentle, not a punishment."""
    x = np.zeros(int(1.9 * SR))
    for k, n in enumerate([G5, E5, D5, C5, A4]):
        at = k * DAILY_WORD_ANSWER_STAGGER + DAILY_WORD_ANSWER_MID - 0.004
        place(x, marimba(n, 0.5, 0.16) * (0.75 - 0.05 * k), at)
    for k, n in enumerate([A4, C5, E5]):
        place(x, marimba(n, 1.1, 0.35) * 0.6, DAILY_WORD_LOSS_CARD_AT + 0.015 * k)
    return fade(x, 0.0, 0.25)


# --- registry ---------------------------------------------------------------------------------

Level = Callable[[np.ndarray], np.ndarray]


def peak(db: float) -> Level:
    return lambda x: norm(x, db)


def rms50(db: float, peak_max: float) -> Level:
    return lambda x: level_rms(x, db, peak_max)


DICE_ROLL_LEVEL = rms50(-20.0, -1.0)  # ~1.5 dB over card place: a roll is a bigger event
DIE_HOLD_LEVEL = rms50(-21.5, -1.0)  # ~1.5 dB under the roll, level with card place
DIE_RELEASE_LEVEL = rms50(-22.5, -1.0)  # 1 dB under the hold: release is the quieter "undo"

# The scoring ladder, as dB over the loudest 50 ms; the computer's set sits CPU_DROP under it.
SCORE_LADDER = {
    "score-commit": -22.0,
    "score-zero": -23.5,
    "small-straight": -20.5,
    "large-straight": -20.0,
    "full-house": -20.0,
    "upper-bonus": -18.0,
}
CPU_DROP = 2.5
TILE_MERGE_LEVEL = rms50(-22.0, -3.0)  # a soft reward, most swipes
TILE_SPAWN_LEVEL = rms50(-26.0, -3.0)  # every swipe: the quietest sound in the game
MAHJONG_SELECT_LEVEL = rms50(-23.0, -3.0)  # the most frequent Mahjong sound: 3 dB under match
MAHJONG_MATCH_LEVEL = rms50(-20.0, -1.0)  # the reward, ~72 times a game
# A reveal plays on every tile (5 per guess): grey quietest, green 4 dB over it.
DAILY_WORD_REVEAL_LEVEL = {"miss": -28.0, "present": -26.0, "correct": -24.0}
JACKPOT_LEVEL = rms50(-16.0, -1.0)  # the top of the ladder, 2 dB over the upper bonus
CPU_JACKPOT_LEVEL = rms50(-19.0, -1.0)  # the computer's, 3 dB under yours

# file stem -> (recipe, leveling). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], Level]] = {
    "dice-roll-1": (lambda: dice_roll(0), DICE_ROLL_LEVEL),
    "dice-roll-2": (lambda: dice_roll(1), DICE_ROLL_LEVEL),
    "dice-roll-3": (lambda: dice_roll(2), DICE_ROLL_LEVEL),
    "die-hold-1": (lambda: die_hold(0), DIE_HOLD_LEVEL),
    "die-hold-2": (lambda: die_hold(1), DIE_HOLD_LEVEL),
    "die-hold-3": (lambda: die_hold(2), DIE_HOLD_LEVEL),
    "die-release-1": (lambda: die_release(0), DIE_RELEASE_LEVEL),
    "die-release-2": (lambda: die_release(1), DIE_RELEASE_LEVEL),
    "die-release-3": (lambda: die_release(2), DIE_RELEASE_LEVEL),
    "score-commit": (score_commit, rms50(SCORE_LADDER["score-commit"], -1.0)),
    "score-zero": (score_zero, rms50(SCORE_LADDER["score-zero"], -1.0)),
    "small-straight": (small_straight, rms50(SCORE_LADDER["small-straight"], -1.0)),
    "large-straight": (large_straight, rms50(SCORE_LADDER["large-straight"], -1.0)),
    "full-house": (full_house, rms50(SCORE_LADDER["full-house"], -1.0)),
    "upper-bonus": (upper_bonus, rms50(SCORE_LADDER["upper-bonus"], -1.0)),
    "cpu-score-commit": (cpu_score_commit, rms50(SCORE_LADDER["score-commit"] - CPU_DROP, -1.0)),
    "cpu-score-zero": (cpu_score_zero, rms50(SCORE_LADDER["score-zero"] - CPU_DROP, -1.0)),
    "cpu-small-straight": (
        cpu_small_straight,
        rms50(SCORE_LADDER["small-straight"] - CPU_DROP, -1.0),
    ),
    "cpu-large-straight": (
        cpu_large_straight,
        rms50(SCORE_LADDER["large-straight"] - CPU_DROP, -1.0),
    ),
    "cpu-full-house": (cpu_full_house, rms50(SCORE_LADDER["full-house"] - CPU_DROP, -1.0)),
    "cpu-upper-bonus": (cpu_upper_bonus, rms50(SCORE_LADDER["upper-bonus"] - CPU_DROP, -1.0)),
    "jackpot-yacht": (jackpot_yacht, JACKPOT_LEVEL),
    "jackpot-joker": (jackpot_joker, JACKPOT_LEVEL),
    "cpu-jackpot-yacht": (cpu_jackpot_yacht, CPU_JACKPOT_LEVEL),
    "cpu-jackpot-joker": (cpu_jackpot_joker, CPU_JACKPOT_LEVEL),
    "tile-merge-1": (lambda: tile_merge(0), TILE_MERGE_LEVEL),
    "tile-merge-2": (lambda: tile_merge(1), TILE_MERGE_LEVEL),
    "tile-merge-3": (lambda: tile_merge(2), TILE_MERGE_LEVEL),
    "tile-spawn-1": (lambda: tile_spawn(0), TILE_SPAWN_LEVEL),
    "tile-spawn-2": (lambda: tile_spawn(1), TILE_SPAWN_LEVEL),
    "tile-spawn-3": (lambda: tile_spawn(2), TILE_SPAWN_LEVEL),
    "win-2048": (win_2048, JACKPOT_LEVEL),  # the top of the ladder, like Yacht's jackpot
    "game-over-2048": (game_over_2048, rms50(-21.0, -1.0)),  # gentle: a long game ending
    "mahjong-select-1": (lambda: mahjong_select(0), MAHJONG_SELECT_LEVEL),
    "mahjong-select-2": (lambda: mahjong_select(1), MAHJONG_SELECT_LEVEL),
    "mahjong-select-3": (lambda: mahjong_select(2), MAHJONG_SELECT_LEVEL),
    "mahjong-match-1": (lambda: mahjong_match(0), MAHJONG_MATCH_LEVEL),
    "mahjong-match-2": (lambda: mahjong_match(1), MAHJONG_MATCH_LEVEL),
    "mahjong-match-3": (lambda: mahjong_match(2), MAHJONG_MATCH_LEVEL),
    "mahjong-shuffle-wash": (mahjong_shuffle, rms50(-20.0, -1.0)),  # rare: level with the match
    "mahjong-win": (mahjong_win, JACKPOT_LEVEL),  # the top of the ladder, like 2048's win
    "mahjong-deadlock": (mahjong_deadlock, rms50(-21.0, -1.0)),  # gentle, like 2048's game over
    **{
        f"daily-word-{r}-{i + 1}": (
            lambda r=r, i=i: daily_word_reveal(r, i),
            rms50(DAILY_WORD_REVEAL_LEVEL[r], -3.0),
        )
        for r in DAILY_WORD_RESULTS
        for i in range(3)
    },
    "daily-word-refused": (daily_word_refused, rms50(-24.0, -3.0)),  # level with a green tile
    "daily-word-win": (daily_word_win, rms50(-17.0, -1.0)),  # once a day: 1 dB under Mahjong's
    "daily-word-loss": (daily_word_loss, rms50(-21.0, -1.0)),  # gentle, like 2048's game over
}


def main(out_dir: Path, names: list[str]) -> None:
    unknown = [n for n in names if n not in SOUNDS]
    if unknown:
        raise SystemExit(f"unknown sound(s): {', '.join(unknown)}; known: {', '.join(SOUNDS)}")
    for name in names or list(SOUNDS):
        recipe, level = SOUNDS[name]
        write_ogg(level(recipe()), out_dir / f"{name}.ogg")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(Path(args[0]) if args else OUT_DEFAULT, args[1:])
