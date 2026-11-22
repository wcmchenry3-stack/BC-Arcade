"""Synthesize Cascade's sound effects, one full set per piece set (no samples, no third-party audio). #3702

Two sets of 22 files, switched with the Fruits / Cosmos toggle. Each recipe is the one the owner
approved from the spectrogram proposals on #3702 (2026-11-16): Fruits plays "Juicy pops" and
Cosmos plays "Starlight glass". The reasoning, the options and the picks are in
docs/games/cascade-sound-design.md. The building blocks are in synth_common.py, plus the glass
bell and the die tick from synth_puzzle_sfx.py.

Writes into frontend/assets/sounds/ as cascade-<set>-<sound>.ogg. Noise uses a fixed seed per
sound, so every run reproduces the same decoded audio (compare with
synth_common.decoded_pcm_sha256: Ogg bytes differ only by their random stream serial).

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_cascade_sfx.py [out_dir] [sound ...]

With no sound names, every sound is written. A name is the file stem, e.g. cascade-fruits-drop.

Every set has the same 22 sounds, timed to game/cascade/motion.ts and celebration.ts:
- drop: the piece leaves the spawner (every turn: the quietest sound).
- land-light / land-heavy: a piece's first contact; light for tiers 0-5, heavy for 6-11 (the
  player also scales the volume by tier; MOTION.sound.heavyLandTier).
- merge-t0 .. merge-t11: one pre-pitched file per tier made (C-major pentatonic, rising with
  the tier; no playback-rate pitch shift). t0-t10 are the #3702 recipes, unchanged. t11 is the
  capstone's own file (#3966, owner option C): the t10 note plus a higher chord, played together
  with the win at the winning merge (soundPacer.win).
- chain-1 .. chain-4: a chain's paced steps (MOTION.chain.stepMs, 80 ms), rising; steps past
  the fourth replay chain-4. Each is shorter than two steps.
- danger: one tick per on-beat of the lid's danger blink (at most 3 Hz). Shorter than the
  fastest blink period (MOTION.danger.fastMs, 340 ms), so ticks never overlap.
- win: plays at the winning merge. A run over the capstone's rise (0.40-0.85 s), a fizz or
  glints over the twinkles (0.70-1.90 s), and a chord as the card shows at 2.1 s
  (CELEBRATION_CARD_MS).
- game-over: plays at the game over. A falling line over the dim and the lid's flashes, landing
  on a soft low A minor as the loss card shows at 1.0 s (MOTION.gameOver.cardAtMs).

Fruits, "Juicy pops": bubbly, plucky and squishy. Bubbles are Minnaert bubbles (a damped sine
whose pitch rises as it closes, after van den Doel, as in Sort's pour); strings are
Karplus-Strong plucks.
Cosmos, "Starlight glass": glass bells over a deep sub tone that grows with the tier (a
planet's weight), crystal pings with an echo, and a deep pad under the win and the game over.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import (
    SR,
    echo,
    fade,
    level_rms,
    lowpass,
    lp2,
    noise,
    phase,
    place,
    t_axis,
    write_ogg,
)
from synth_puzzle_sfx import clack, glass

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"

SETS = ("fruits", "cosmos")

# --- timing (frontend/src/game/cascade/motion.ts and celebration.ts) ---------------------------

WIN_RISE = (0.40, 0.85)  # celebration.ts: the capstone rises to the board centre
WIN_TWINKLE = (0.70, 1.90)  # celebration.ts: twinkles over the dimmed pile
WIN_CARD_AT = 2.10  # CELEBRATION_CARD_MS
GAME_OVER_CARD_AT = 1.00  # MOTION.gameOver.cardAtMs
CHAIN_STEP = 0.08  # MOTION.chain.stepMs
DANGER_FASTEST = 0.34  # MOTION.danger.fastMs: the shortest gap between two danger ticks

# --- pitch ------------------------------------------------------------------------------------

PENTA = [0, 2, 4, 7, 9]  # C D E G A


def penta(n: int) -> int:
    """Semitones of the n-th note of C major pentatonic (0 -> C, 5 -> the next octave's C)."""
    return 12 * (n // 5) + PENTA[n % 5]


def f_of(semi_from_c5: float) -> float:
    return 523.25 * 2 ** (semi_from_c5 / 12)


# --- shared voices ----------------------------------------------------------------------------


def blank(dur: float) -> np.ndarray:
    return np.zeros(int(dur * SR))


def sine_env(f: float, dur: float, decay: float, attack: float = 0.003) -> np.ndarray:
    t = t_axis(dur)
    return np.sin(phase(np.full_like(t, f))) * np.exp(-t / decay) * np.clip(t / attack, 0, 1)


def thud(seed: int, dur: float, lp: float, decay: float) -> np.ndarray:
    """A dark noise thud: low-passed noise with a 2 ms attack and an exponential decay."""
    t = t_axis(dur)
    x = lp2(noise(len(t), seed), lp)
    return x / (np.std(x) + 1e-12) * np.clip(t / 0.002, 0, 1) * np.exp(-t / decay)


def ks_pluck(f: float, dur: float, seed: int, bright: float = 0.5, decay: float = 0.996):
    """Karplus-Strong plucked string: a filtered noise burst in a damped, averaging delay loop."""
    n = int(dur * SR)
    p = max(2, round(SR / f))
    buf = lowpass(noise(p, seed), 1500 + 9000 * bright)
    buf /= np.abs(buf).max() + 1e-12
    y = np.zeros(n)
    y[:p] = buf
    for i in range(p, n):
        y[i] = decay * 0.5 * (y[i - p] + y[max(i - p - 1, 0)])
    return y


def bubble(f0: float, dur: float, decay: float, rise: float = 0.6) -> np.ndarray:
    """Minnaert bubble: a damped sine whose pitch rises as it closes (van den Doel)."""
    t = t_axis(dur)
    f = f0 * (1 + rise * t / decay * 0.25)
    return np.sin(phase(f)) * np.exp(-t / decay) * np.clip(t / 0.0015, 0, 1)


def shimmer(f: float, dur: float, decay: float, beat: float = 3.0) -> np.ndarray:
    """Two sines `beat` Hz apart that beat slowly: a glassy shimmer."""
    t = t_axis(dur)
    x = np.sin(phase(np.full_like(t, f))) + np.sin(phase(np.full_like(t, f + beat)))
    return 0.5 * x * np.exp(-t / decay) * np.clip(t / 0.004, 0, 1)


def pad(freqs: list[float], dur: float, swell: float, seed: int) -> np.ndarray:
    """A soft pad: each note as two sines detuned ±4.8 cents, swelling in, fading 0.5 s out."""
    t = t_axis(dur)
    rng = np.random.default_rng(seed)
    x = np.zeros_like(t)
    for f in freqs:
        for d in (-0.6, 0.6):
            x += np.sin(phase(np.full_like(t, f * (1 + d / 1200 * 8))) + rng.uniform(0, 6))
    e = np.clip(t / swell, 0, 1) ** 2 * np.clip((dur - t) / 0.5, 0, 1)
    return x / (2 * len(freqs)) * e


def sub_thump(f0: float, dur: float, decay: float) -> np.ndarray:
    """A low sine that drops an octave in ~30 ms: a soft, deep 'whumf'."""
    t = t_axis(dur)
    f = f0 * (0.5 + 0.5 * np.exp(-t / 0.03))
    return np.sin(phase(f)) * np.exp(-t / decay) * np.clip(t / 0.002, 0, 1)


# Land sizes and seeds: light (tiers 0-5) and heavy (tiers 6-11). The seeds are the proposals'.
LAND = {"land-light": (0.0, 1166), "land-heavy": (1.0, 1366)}


# =================================================================================================
# Fruits: "Juicy pops"
# =================================================================================================


def fruits_drop() -> np.ndarray:
    """0.1 s: one bubble 'plip' (520 Hz, 22 ms)."""
    x = blank(0.1)
    place(x, bubble(520, 0.1, 0.022, rise=2.5) * 0.9, 0.0)
    return fade(x, 0.0, 0.02)


def fruits_land(size: float, seed: int) -> np.ndarray:
    """A squish: a sine bending down 40 %, a short noise splat, tiny bubbles on a heavy one."""
    dur = 0.18 + 0.1 * size
    t = t_axis(dur)
    f0 = 170 - 80 * size
    body = np.sin(phase(f0 * (0.6 + 0.4 * np.exp(-t / 0.03)))) * np.exp(-t / (0.035 + 0.04 * size))
    x = blank(dur)
    place(x, body * 0.9, 0.0)
    place(x, thud(seed, dur, 1800 - 900 * size, 0.012) * 0.35, 0.0)
    if size > 0.3:
        rng = np.random.default_rng(seed)
        for _ in range(int(2 + 3 * size)):
            place(x, bubble(rng.uniform(900, 1600), 0.05, 0.01) * 0.12, rng.uniform(0.02, 0.1))
    return fade(x, 0.0, 0.03)


def fruits_merge(n: int) -> np.ndarray:
    """A juicy pop: a bubble an octave up, then a plucked string per tier (G4 pentatonic -> G6)."""
    semi = penta(n) - 5
    f = f_of(semi)
    dur = 0.32 + 0.025 * n
    x = blank(dur + 0.03)
    place(x, bubble(f * 2, 0.06, 0.012, rise=3.0) * 0.6, 0.0)
    place(x, ks_pluck(f, dur, 8200 + n, bright=0.35 + 0.03 * n, decay=0.993), 0.008)
    if n >= 5:  # a fizz of tiny bubbles: more juice in a bigger fruit
        rng = np.random.default_rng(8300 + n)
        for _ in range(4 + n):
            place(x, bubble(rng.uniform(1500, 3200), 0.03, 0.006) * 0.12, rng.uniform(0.03, 0.22))
    if n >= 8:
        place(x, ks_pluck(f * 2, dur, 8400 + n, bright=0.6, decay=0.99) * 0.4, 0.03)
    return fade(x, 0.0, 0.05)


def fruits_merge_capstone() -> np.ndarray:
    """merge-t11, 0.75 s (#3966, option C): the t10 note, then D7 and G7 strummed over it (tiny
    stagger) with extra bubble fizz, so the capstone sounds like the top of the climb."""
    n = 10
    x = blank(0.75)
    place(x, fruits_merge(n), 0.0)
    for j, semi in enumerate([penta(n) - 5 + 7, penta(n) - 5 + 12]):  # D7, G7
        place(
            x,
            ks_pluck(f_of(semi), 0.6, 8910 + j, bright=0.8, decay=0.992) * (0.45 - 0.1 * j),
            0.035 + 0.03 * j,
        )
    rng = np.random.default_rng(8920)
    for _ in range(14):
        place(x, bubble(rng.uniform(2200, 4200), 0.03, 0.006) * 0.12, rng.uniform(0.05, 0.4))
    return fade(x, 0.0, 0.08)


def fruits_chain(k: int) -> np.ndarray:
    """A rising double blip: two bubbles a fourth apart (35 ms), a pentatonic step up per link."""
    f = 700 * 2 ** (penta(k) / 12)
    x = blank(0.14)
    place(x, bubble(f, 0.06, 0.014, rise=2.0) * 0.8, 0.0)
    place(x, bubble(f * 1.335, 0.07, 0.016, rise=2.0) * 0.8, 0.035)
    return fade(x, 0.0, 0.02)


def fruits_danger() -> np.ndarray:
    """A low 'bloop-bloop' heartbeat: two 125 Hz sines bending down, 110 ms apart."""
    x = blank(0.26)
    for at, g in ((0.0, 1.0), (0.11, 0.7)):
        t = t_axis(0.12)
        s = np.sin(phase(125 * (0.85 + 0.15 * np.exp(-t / 0.02)))) * np.exp(-t / 0.035)
        place(x, s * np.clip(t / 0.003, 0, 1) * g, at)
    return fade(x, 0.0, 0.03)


def fruits_win() -> np.ndarray:
    """2.7 s: plucks over the rise, a swelling fizz over the twinkles, a pop chord at the card."""
    x = blank(2.7)
    place(x, bubble(500, 0.12, 0.03, rise=2) * 0.6, 0.0)
    run = [penta(n) - 5 for n in range(9)]  # G4 -> B5
    gap = (WIN_RISE[1] - WIN_RISE[0]) / len(run)
    for k, s in enumerate(run):
        place(x, ks_pluck(f_of(s), 0.5, 8500 + k, 0.5, 0.993) * 0.6, WIN_RISE[0] + k * gap)
    rng = np.random.default_rng(8501)
    a, b = WIN_TWINKLE
    for _ in range(70):
        at = rng.uniform(a, b)
        p = (at - a) / (b - a)
        f = rng.uniform(900, 2000) * (1 + 0.8 * p)
        place(x, bubble(f, 0.04, 0.008, rise=2.5) * (0.07 + 0.13 * p), at)
    place(x, bubble(380, 0.15, 0.04, rise=2.0) * 0.7, WIN_CARD_AT)
    for j, s in enumerate([-5, -1, 2, 7, 12]):  # a strummed G4 B4 D5 G5 C6
        place(x, ks_pluck(f_of(s), 0.75, 8600 + j, 0.5, 0.996) * 0.5, WIN_CARD_AT + 0.012 * j)
    return fade(x, 0.0, 0.3)


def fruits_game_over() -> np.ndarray:
    """1.9 s: a deflating balloon and falling plucks, then a low A minor pluck chord at the card."""
    x = blank(1.9)
    t = t_axis(0.8)
    f = 520 * (0.25 ** (t / 0.8)) * (1 + 0.03 * np.sin(2 * np.pi * 7 * t))
    s = np.sin(phase(f)) * np.clip(t / 0.02, 0, 1) * (1 - t / 0.8) ** 0.7
    place(x, lowpass(s, 2500) * 0.5, 0.12)
    for k, sm in enumerate([2, -1, -5]):  # D5 B4 G4
        place(x, ks_pluck(f_of(sm), 0.4, 8700 + k, 0.3, 0.99) * 0.5, 0.15 + 0.22 * k)
    for j, sm in enumerate([-15, -12, -8]):  # A3 C4 E4
        at = GAME_OVER_CARD_AT + 0.015 * j
        place(x, ks_pluck(f_of(sm), 0.85, 8800 + j, 0.25, 0.997) * 0.55, at)
    return fade(x, 0.0, 0.3)


# =================================================================================================
# Cosmos: "Starlight glass"
# =================================================================================================


def cosmos_drop() -> np.ndarray:
    """0.12 s: a two-note glass twinkle (G7, then C8 25 ms later)."""
    x = blank(0.12)
    place(x, glass(31, 0.12, 0.03) * 0.6, 0.0)
    place(x, glass(36, 0.12, 0.02) * 0.35, 0.025)
    return fade(x, 0.0, 0.02)


def cosmos_land(size: float, seed: int) -> np.ndarray:
    """A sub whumf with a short noise thud and a faint, muffled glass ring."""
    dur = 0.22 + 0.1 * size
    x = blank(dur)
    place(x, sub_thump(100 - 35 * size, dur, 0.05 + 0.04 * size), 0.0)
    place(x, thud(seed, dur, 900 - 500 * size, 0.012) * 0.25, 0.0)
    place(x, glass(19 - 12 * size, dur, 0.05) * 0.15, 0.0)
    return fade(x, 0.0, 0.03)


def cosmos_merge(n: int) -> np.ndarray:
    """A glass bell per tier (C5 pentatonic -> C7) over a sub sine that grows with the tier; from
    t8 a slow-beating shimmer an octave up."""
    semi = penta(n)
    dur = 0.34 + 0.03 * n
    x = blank(dur + 0.03)
    place(x, clack(11200 + n, "die", 0.3), 0.0)
    place(x, glass(semi, dur, 0.16 + 0.025 * n), 0.002)
    place(x, sub_thump(f_of(semi - 24) * 2, dur, 0.08 + 0.015 * n) * (0.3 + 0.04 * n), 0.0)
    if n >= 8:
        place(x, shimmer(f_of(semi + 12), dur, 0.25, beat=4.0) * 0.25, 0.04)
    return fade(x, 0.0, 0.06)


def cosmos_merge_capstone() -> np.ndarray:
    """merge-t11, 0.82 s (#3966, option C): the t10 bell with C7 + G7 + C8 bells over it, an
    octave shimmer on C8 and the t10's deeper sub, a bright capstone chord."""
    n = 10
    x = blank(0.82)
    place(x, cosmos_merge(n), 0.0)
    for j, semi in enumerate([31, 36]):  # G7, C8 (the t10 bell is C7)
        place(x, glass(semi, 0.7, 0.3) * (0.4 - 0.1 * j), 0.03 + 0.03 * j)
    place(x, shimmer(f_of(36), 0.7, 0.35, beat=5.0) * 0.18, 0.06)
    return fade(x, 0.0, 0.08)


def cosmos_chain(k: int) -> np.ndarray:
    """A crystal ping with a 50 ms echo: C7 D7 E7 G7."""
    x = blank(0.2)
    place(x, echo(glass(24 + penta(k - 1), 0.12, 0.04), ((0.05, 0.3),)), 0.0)
    return fade(x, 0.0, 0.03)


def cosmos_danger() -> np.ndarray:
    """A low A4 bell beating against Bb4, over a 110 Hz sub pulse: quiet and uneasy."""
    x = blank(0.3)
    place(x, glass(-3, 0.3, 0.09), 0.0)
    place(x, glass(-2, 0.3, 0.09) * 0.6, 0.0)
    place(x, sub_thump(110, 0.3, 0.06) * 0.6, 0.0)
    return fade(x, 0.0, 0.04)


def cosmos_win() -> np.ndarray:
    """2.8 s: a deep pad, a glass run over the rise, glints over the twinkles, a bright chord with
    a low bell and a sub at the card."""
    x = blank(2.8)
    place(x, pad([f_of(-24), f_of(-17), f_of(-8)], 2.6, 0.9, 11501) * 0.45, 0.2)
    run = [penta(n) for n in range(5, 14)]  # C6 -> G7
    gap = (WIN_RISE[1] - WIN_RISE[0]) / len(run)
    for k, s in enumerate(run):
        place(x, glass(s, 0.6, 0.2) * 0.45, WIN_RISE[0] + k * gap)
    rng = np.random.default_rng(11502)
    for _ in range(16):
        place(
            x, glass(penta(int(rng.integers(8, 16))), 0.5, 0.12) * 0.15, rng.uniform(*WIN_TWINKLE)
        )
    place(x, shimmer(f_of(12), 1.4, 0.7, 3.0) * 0.25, 0.85)
    for s in (12, 16, 19, 24):
        place(x, glass(s, 0.9, 0.4) * 0.45, WIN_CARD_AT)
    place(x, glass(-12, 1.0, 0.5) * 0.35, WIN_CARD_AT)
    place(x, sub_thump(130, 0.5, 0.2) * 0.4, WIN_CARD_AT)
    return fade(x, 0.0, 0.3)


def cosmos_game_over() -> np.ndarray:
    """2.0 s: a dark low drone, falling glass G6 E6 D6 C6, a dim A minor glass chord and a sub
    at the card."""
    x = blank(2.0)
    place(x, pad([f_of(-27), f_of(-20)], 1.9, 0.3, 11601) * 0.35, 0.0)
    for k, s in enumerate([19, 16, 14, 12]):
        place(x, glass(s, 0.6, 0.2) * 0.45, 0.18 + 0.17 * k)
    for s in (-3, 0, 4):
        place(x, lowpass(glass(s, 1.0, 0.45), 3000) * 0.5, GAME_OVER_CARD_AT)
    place(x, sub_thump(90, 0.5, 0.2) * 0.4, GAME_OVER_CARD_AT)
    return fade(x, 0.0, 0.3)


# =================================================================================================

Level = Callable[[np.ndarray], np.ndarray]


def rms50(db: float, peak_max: float) -> Level:
    return lambda x: level_rms(x, db, peak_max)


# dB over the loudest 50 ms, the same for both sets so a skin switch never jumps. Matched to the
# shipped in-house sounds: tile-spawn -27 (every swipe), tile-merge -22, mahjong-match -20.5,
# win-2048 -16, game-over-2048 -21.
LEVELS: dict[str, Level] = {
    "drop": rms50(-27.0, -3.0),  # every turn: the quietest, like 2048's spawn
    "land-light": rms50(-26.0, -3.0),
    "land-heavy": rms50(-23.0, -3.0),
    **{f"merge-t{n}": rms50(-23.0 + 0.5 * n, -1.0) for n in range(12)},  # -23 .. -17.5
    **{f"chain-{k}": rms50(-23.0 + 1.0 * k, -3.0) for k in range(1, 5)},  # -22 .. -19
    "danger": rms50(-26.0, -3.0),  # repeats: a nudge, not an alarm
    "win": rms50(-15.0, -1.0),  # the top of the ladder, like yacht-win
    "game-over": rms50(-21.0, -1.0),  # gentle, like 2048's game over
}

VOICES = {
    "fruits": {
        "drop": fruits_drop,
        "land": fruits_land,
        "merge": fruits_merge,
        "merge_capstone": fruits_merge_capstone,
        "chain": fruits_chain,
        "danger": fruits_danger,
        "win": fruits_win,
        "game_over": fruits_game_over,
    },
    "cosmos": {
        "drop": cosmos_drop,
        "land": cosmos_land,
        "merge": cosmos_merge,
        "merge_capstone": cosmos_merge_capstone,
        "chain": cosmos_chain,
        "danger": cosmos_danger,
        "win": cosmos_win,
        "game_over": cosmos_game_over,
    },
}


def _recipes(v: dict) -> dict[str, Callable[[], np.ndarray]]:
    out: dict[str, Callable[[], np.ndarray]] = {"drop": v["drop"]}
    for name, (size, seed) in LAND.items():
        out[name] = lambda size=size, seed=seed: v["land"](size, seed)
    for n in range(11):
        out[f"merge-t{n}"] = lambda n=n: v["merge"](n)
    out["merge-t11"] = v["merge_capstone"]
    for k in range(1, 5):
        out[f"chain-{k}"] = lambda k=k: v["chain"](k)
    out["danger"] = v["danger"]
    out["win"] = v["win"]
    out["game-over"] = v["game_over"]
    return out


# file stem -> (recipe, leveling). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], Level]] = {
    f"cascade-{s}-{name}": (recipe, LEVELS[name])
    for s in SETS
    for name, recipe in _recipes(VOICES[s]).items()
}

# The Fruits capstone's spread-out strum reads about 3 dB quieter than the same level on the other
# merges, so it gets +2.5 dB after the leveling (the peak stays under -1 dBFS). Owner-approved
# render, #3966.
FRUITS_T11_TRIM_DB = 2.5
_fruits_t11_recipe, _fruits_t11_level = SOUNDS["cascade-fruits-merge-t11"]
SOUNDS["cascade-fruits-merge-t11"] = (
    _fruits_t11_recipe,
    lambda x: _fruits_t11_level(x) * 10 ** (FRUITS_T11_TRIM_DB / 20),
)


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
