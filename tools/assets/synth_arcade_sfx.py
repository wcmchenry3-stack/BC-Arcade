"""Synthesize the card and puzzle games' sound effects (no samples, no third-party audio). #3563

Covers Blackjack, Solitaire, FreeCell, Hearts, Mahjong, Sudoku, 2048, Yacht, Sort and Daily Word
(not Star Swarm or Cascade). These games share one family of sounds: one file can back several
games' registry keys, e.g. a single card-place sound for Solitaire, FreeCell and Hearts. Each
recipe is the one the owner approved after a gameplay audition. The reasoning behind each
sound is in docs/games/arcade-sound-design.md. The building blocks are in synth_common.py.

Writes into frontend/assets/sounds/. Noise uses a fixed seed per sound, so every run
reproduces the same decoded audio (compare with synth_common.decoded_pcm_sha256: Ogg bytes
differ only by their random stream serial).

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_arcade_sfx.py [out_dir] [sound ...]

With no sound names, every sound is written.

Sounds:
- card-place-1/2/3.ogg  "slide and settle", 0.10 s each: ~40-50 ms of grainy card-on-felt
  friction ending in a soft flat flap of air, with no tonal body. Three variations (slide length,
  seeds) played in random order, never the same twice in a row (useSoundVariants), so a run of
  Auto-Complete (one card every 120 ms) doesn't sound mechanical. Solitaire, FreeCell, Hearts.
- card-flip-1/2/3.ogg  "turn and lay", 0.10 s each (Solitaire: a Draw-1 stock draw, a revealed
  card): a smooth turning whoosh of air (~30 ms), then the card laid down (a soft flap).
- card-fan-1/2/3.ogg   Draw 3, 0.20 s each: three card flips ~40 ms apart, the last a touch firmer.
- card-deal-1/2/3.ogg  Blackjack "dealer's toss", 0.32 s each, played as the card leaves: a snap
  off the deck, a fading whoosh, the landing flap at 240 ms (CARD_DEAL_FLIGHT, the deal motion).
- chip-bet-1/2/3, chip-payout, chip-collect, chip-nudge.ogg  Blackjack chips, "felt thud": a chip
  set down on felt (a soft dark puff with a muffled tick); bet = a short slide into the circle,
  payout = chips landing one after another, collect = the stake swept away, nudge = a push.
- result-win/push/lose/bust/blackjack.ogg  Blackjack results, "soft chimes": mallet notes; win a
  rising fifth, push one neutral note, lose a soft falling minor third, bust shorter and duller,
  blackjack a quick sparkle arpeggio (1.08 s). Wins sit ~3-4 dB above everyday sounds.
- riffle-start/loop/settle.ogg  Auto-Complete "riffle shuffle" (Solitaire, FreeCell), played by
  useRunSound for as long as the run lasts: a 0.14 s pick-up (an accelerating flutter), a 2.0 s
  seamless loop (a dense flutter of bright card edges, ~42/s, over a papery whirr) and a 0.30 s
  settle (a few last edges, then the deck tapped flat: two soft flaps of air).
- card-game-won.ogg  "rising swell", 2.45 s (Solitaire, FreeCell, Hearts): a soft pad (detuned
  saws through a gentle lowpass) swells into C major, with a bell sparkle as it opens. It waits
  0.25 s (GAME_WON_LEAD) so the Auto-Complete riffle's settle, played at the same instant, lands
  first.
- card-game-lost.ogg  Hearts, 1.40 s: a short pad swell that sinks into A minor. Quieter than
  game won (~4 dB) and never a "fail" sting.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import (
    SR,
    bell,
    fade,
    highpass,
    level_rms,
    loopify,
    lp2,
    mallet,
    noise,
    norm,
    phase,
    place,
    saw,
    t_axis,
    write_ogg,
)

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


# --- cards ------------------------------------------------------------------------------------


def flap(
    seed: int,
    dur: float = 0.03,
    decay: float = 0.003,
    tail: float = 0.012,
    lo: float = 180,
    hi: float = 7000,
    tail_level: float = 0.18,
) -> np.ndarray:
    """A card landing flat: a very short broadband puff of air, with a softer, darker after-puff."""
    t = t_axis(dur)
    n = len(t)
    x = lp2(highpass(noise(n, seed), lo), hi)
    x /= np.std(x) + 1e-12
    e = np.clip(t / 0.0006, 0, 1) * (np.exp(-t / decay) + tail_level * np.exp(-t / tail))
    return x * e


def friction(
    seed: int,
    dur: float,
    lo: float = 1500,
    hi: float = 7000,
    grain_rate: float = 900,
    grain_depth: float = 0.8,
    rise: float = 0.3,
) -> np.ndarray:
    """Paper sliding on felt: band-limited noise with grainy micro-bursts (card stock texture)."""
    t = t_axis(dur)
    n = len(t)
    rng = np.random.default_rng(seed + 500)
    base = lp2(highpass(noise(n, seed), lo), hi)
    base /= np.std(base) + 1e-12
    # grain: sparse random impulses smeared over ~1 ms
    imp = (rng.random(n) < grain_rate / SR) * rng.uniform(0.5, 1.0, n)
    grain = lp2(imp, 1500)
    grain /= grain.max() + 1e-12
    p = t / t[-1]
    shape = np.clip(p / rise, 0, 1) ** 0.7 * (1 - np.clip((p - rise) / (1 - rise), 0, 1)) ** 1.5
    return base * (1 - grain_depth + grain_depth * grain * 3) * shape


def card_place(i: int) -> np.ndarray:
    """Slide and settle: a short papery slide ending in a soft flat flap (variation i = 0..2)."""
    dur = (0.045, 0.05, 0.04)[i]
    x = np.zeros(int(0.10 * SR))
    place(x, friction(71 + i, dur, lo=1200, hi=7500, grain_rate=1100, rise=0.15) * 0.35, 0.0)
    place(x, flap(81 + i, decay=0.003, tail=0.012, hi=5500) * 0.9, dur - 0.004)
    return fade(x, 0.0, 0.01)


def air(seed: int, dur: float, lo: float, hi: float, rise: float) -> np.ndarray:
    """A smooth puff of moving air (no grain): a card turning over."""
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    x /= np.std(x) + 1e-12
    p = t / t[-1]
    return x * np.clip(p / rise, 0, 1) ** 1.2 * (1 - np.clip((p - rise) / (1 - rise), 0, 1)) ** 2


def card_flip(i: int, seed: int = 0) -> np.ndarray:
    """Turn and lay, 0.10 s: a smooth turning whoosh, then the card laid down (variation i)."""
    s = 700 + 10 * i + seed
    w = (0.030, 0.034, 0.027)[i % 3]
    x = np.zeros(int(0.10 * SR))
    place(x, air(s, w, 600, 3500, rise=0.75) * 0.5, 0.0)
    place(
        x,
        flap(s + 1, dur=0.06, decay=0.0028, tail=0.012, lo=250, hi=5000, tail_level=0.2),
        w - 0.004,
    )
    return fade(x, 0.0, 0.012)


def card_fan(k: int) -> np.ndarray:
    """Draw 3, 0.20 s: three cards flipped off in a quick fan, ~40 ms apart (variation k)."""
    x = np.zeros(int(0.20 * SR))
    for j, (at, g) in enumerate(((0.0, 0.7), (0.038, 0.8), (0.074, 1.0))):
        place(x, card_flip(j, 100 * (k + 1)) * g, at)
    return fade(x, 0.0, 0.015)


CARD_DEAL_FLIGHT = 0.24  # s: the deal motion's flight (#3571); the landing sits exactly here


def card_deal(i: int) -> np.ndarray:
    """Dealer's toss, 0.32 s, played as the card leaves: a crisp snap off the deck, a whoosh of
    air that fades as the card travels, then the landing flap at CARD_DEAL_FLIGHT (variation i).
    """
    s = 1000 + 10 * i
    x = np.zeros(int((CARD_DEAL_FLIGHT + 0.08) * SR))
    place(x, tick(s, decay=(0.0010, 0.0011, 0.0009)[i], lo=2200, hi=9000) * 0.7, 0.0)
    place(x, air(s + 1, CARD_DEAL_FLIGHT - 0.02, 700, 4500, rise=0.18) * 0.22, 0.008)
    place(
        x,
        flap(s + 2, dur=0.05, decay=0.003, tail=0.012, lo=220, hi=5500, tail_level=0.18),
        CARD_DEAL_FLIGHT,
    )
    return fade(x, 0.0, 0.015)


# --- Blackjack chips (felt thud) and results (soft chimes) ------------------------------------


def chip_click(
    seed: int, f0: float = 3800.0, decay: float = 0.009, body: float = 0.0
) -> np.ndarray:
    """Two clay chips knocking: a few inharmonic modes high up, plus a tiny noise snap."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.06)
    f = f0 * (1 + rng.uniform(-0.06, 0.06))
    x = sum(
        g * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (decay * d))
        for r, g, d in ((1.0, 1.0, 1.0), (1.53, 0.55, 0.7), (2.31, 0.3, 0.5), (0.62, body, 1.4))
    )
    snap = highpass(noise(len(t), seed), 3000) * np.exp(-t / 0.0012)
    return (x + 0.6 * snap / (np.abs(snap).max() + 1e-9)) * np.clip(t / 0.0004, 0, 1)


def felt_thud(seed: int) -> np.ndarray:
    """A chip set down on felt: a soft, dark puff with a muffled tick on top."""
    t = t_axis(0.06)
    puff = lp2(highpass(noise(len(t), seed), 250), 1600)
    puff = puff / (np.std(puff) + 1e-9) * np.clip(t / 0.001, 0, 1) * np.exp(-t / 0.012)
    return puff + 0.35 * chip_click(seed + 7, f0=2600, decay=0.004)


def chip_bet(seed: int) -> np.ndarray:
    """A chip tapped from the tray slides into the betting circle and lands on the felt."""
    x = np.zeros(int(0.22 * SR))
    place(x, friction(seed, 0.09, lo=1500, hi=6000, grain_rate=500, rise=0.3) * 0.12, 0.0)
    place(x, felt_thud(seed + 3), 0.09)
    return fade(x, 0.0, 0.02)


def chip_payout(seed: int = 200, n: int = 5, spread: float = 0.26) -> np.ndarray:
    """The payout: chips slide over and land one after another on the stake."""
    x = np.zeros(int((spread + 0.25) * SR))
    rng = np.random.default_rng(seed)
    place(x, friction(seed, 0.18, lo=1200, hi=6000, grain_rate=700, rise=0.4) * 0.16, 0.0)
    for j in range(n):
        at = 0.12 + spread * (j / max(1, n - 1)) ** 0.8 + rng.uniform(-0.01, 0.01)
        place(x, felt_thud(seed + 31 * j) * (0.6 + 0.4 * rng.random()), at)
    return fade(x, 0.0, 0.04)


def chip_collect(seed: int = 210) -> np.ndarray:
    """The stake swept away across the felt: a long slide with a few chips tumbling."""
    x = np.zeros(int(0.5 * SR))
    place(x, friction(seed, 0.38, lo=900, hi=5000, grain_rate=900, rise=0.15) * 0.4, 0.0)
    for j, at in enumerate((0.05, 0.13, 0.22)):
        place(x, felt_thud(seed + 17 * j) * (0.45 - 0.1 * j), at)
    return fade(x, 0.0, 0.08)


def chip_nudge(seed: int = 220) -> np.ndarray:
    """Push: the stake nudged back to the player, one soft chip."""
    x = np.zeros(int(0.2 * SR))
    place(x, friction(seed, 0.07, lo=1500, hi=5500, grain_rate=500, rise=0.3) * 0.12, 0.0)
    place(x, felt_thud(seed + 5) * 0.6, 0.06)
    return fade(x, 0.0, 0.03)


def chime(notes, dur=0.6, decay=0.18, gap=0.075, shimmer=0.0) -> np.ndarray:
    """Soft mallet notes `gap` s apart, each a little firmer, with an optional bell shimmer."""
    x = np.zeros(int((dur + gap * len(notes)) * SR))
    for j, f in enumerate(notes):
        place(x, mallet(f, dur, decay) * (0.75 + 0.25 * j / max(1, len(notes) - 1)), gap * j)
        if shimmer:
            place(x, bell(f * 2, dur * 0.8, decay * 0.7) * shimmer, gap * j)
    return fade(x, 0.0, 0.05)


E5, B5, G4, EB4 = 659.25, 987.77, 392.0, 311.13
C5, G5, C6 = 523.25, 783.99, 1046.5


def result_win() -> np.ndarray:  # a bright rising fifth, E5 -> B5
    return chime([E5, B5], decay=0.16)


def result_push() -> np.ndarray:  # one neutral note (E5)
    return chime([440.0 * 1.5], dur=0.45, decay=0.12)


def result_lose() -> np.ndarray:  # a soft falling minor third, G4 -> Eb4
    return chime([G4, EB4], decay=0.14, gap=0.11)


def result_bust() -> np.ndarray:  # shorter and duller, F5 -> Db5
    return chime([349.23 * 2, 277.18 * 2], decay=0.10, gap=0.08)


def result_blackjack() -> np.ndarray:  # a quick sparkle arpeggio, C5 E5 G5 C6, with a shimmer
    return chime([C5, E5, G5, C6], dur=0.8, decay=0.22, gap=0.07, shimmer=0.25)


# --- Auto-Complete riffle ---------------------------------------------------------------------

RIFFLE_LOOP = 2.0  # s; every modulation rate is a multiple of 1 / RIFFLE_LOOP
RIFFLE_XF = 0.15  # s folded back into the head by loopify


def tick(seed: int, decay: float = 0.0012, lo: float = 1500, hi: float = 8000) -> np.ndarray:
    """One card edge flicking past: a tiny bright broadband click (12 ms)."""
    t = t_axis(0.012)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    x /= np.std(x) + 1e-12
    return x * np.clip(t / 0.0003, 0, 1) * np.exp(-t / decay)


def place_wrap(dst: np.ndarray, src: np.ndarray, at: float) -> None:
    """Mix src into dst at `at` s, wrapping the overflow to the start (for seamless loops)."""
    k = int(at * SR) % len(dst)
    n = min(len(src), len(dst) - k)
    dst[k : k + n] += src[:n]
    if n < len(src):
        dst[: len(src) - n] += src[n:]


def flutter(length: float, rate: float, seed: int, jitter: float) -> np.ndarray:
    """Card edges at `rate` per second with timing and level jitter, wrapped to loop."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(length * SR))
    for j in range(int(rate * length)):
        at = (j + rng.uniform(-jitter, jitter)) / rate
        g = tick(int(rng.integers(1_000_000)), decay=0.0010, lo=1800, hi=8500)
        place_wrap(x, g * rng.uniform(0.55, 1.0), at % length)
    return x


def whirr(length: float, seed: int, swell_rate: float, swell_depth: float) -> np.ndarray:
    """Papery whirr under the flutter, crossfaded to loop."""
    t = t_axis(length + RIFFLE_XF)
    x = lp2(highpass(noise(len(t), seed), 1500), 7000)
    x /= np.std(x) + 1e-12
    x *= 1 - swell_depth * (0.5 + 0.5 * np.sin(2 * np.pi * swell_rate * t))
    return loopify(x, RIFFLE_XF)


def riffle_loop_raw() -> np.ndarray:
    """Riffle shuffle: a dense flutter of bright card edges (~42/s) over a papery whirr."""
    edges = flutter(RIFFLE_LOOP, 42, 101, jitter=0.3)
    return edges + 0.06 * whirr(RIFFLE_LOOP, 102, swell_rate=3.0, swell_depth=0.3)


# The loop is set to RIFFLE_LOOP_LUFS integrated loudness (a bed under the run, a little under
# card place). Its unscaled loudness, measured once with ffmpeg's ebur128 (the loop played 3
# times), is fixed here so the generator doesn't depend on the ffmpeg version.
RIFFLE_LOOP_LUFS = -27.0
RIFFLE_LOOP_MEASURED_LUFS = -16.6


def riffle_loop() -> np.ndarray:
    return riffle_loop_raw() * 10 ** ((RIFFLE_LOOP_LUFS - RIFFLE_LOOP_MEASURED_LUFS) / 20)


def riffle_start() -> np.ndarray:
    """Pick-up, 0.14 s: an accelerating flutter into the loop, peaking with the loop."""
    x = np.zeros(int(0.14 * SR))
    rng = np.random.default_rng(7)
    ats = [0.0, 0.035, 0.062, 0.083, 0.100, 0.114, 0.126]
    for j, at in enumerate(ats):
        g = tick(int(rng.integers(1e6)), decay=0.0012, lo=1600, hi=8000)
        place(x, g * (0.5 + 0.5 * j / len(ats)), at)
    x = fade(x, 0.0, 0.01)
    return x * (np.abs(riffle_loop()).max() / (np.abs(x).max() + 1e-12))


def riffle_settle() -> np.ndarray:
    """Squared pile, 0.30 s: a few last edges, then the deck tapped flat (two soft flaps)."""
    seed = 500
    x = np.zeros(int(0.30 * SR))
    for j, at in enumerate((0.0, 0.022, 0.040)):
        place(x, tick(seed + j, decay=0.0012) * (0.6 - 0.15 * j), at)
    place(x, friction(seed + 10, 0.05, lo=1200, hi=6000, rise=0.3) * 0.25, 0.03)
    place(
        x,
        flap(seed + 20, dur=0.06, decay=0.004, tail=0.02, lo=150, hi=4500, tail_level=0.25),
        0.075,
    )
    place(
        x,
        flap(seed + 21, dur=0.06, decay=0.003, tail=0.015, lo=150, hi=4000, tail_level=0.2) * 0.55,
        0.115,
    )
    return fade(x, 0.0, 0.05)


# --- game won / game lost --------------------------------------------------------------------

GAME_WON_LEAD = 0.25  # s left for the riffle's settle, which plays at the same instant


def et(semitones_from_a4: int) -> float:
    """Equal-tempered pitch (A4 = 440 Hz), exact, as in the approved sample."""
    return 440.0 * 2 ** (semitones_from_a4 / 12)


ET_A4, ET_C5, ET_E5, ET_G5, ET_C6 = et(0), et(3), et(7), et(10), et(15)


def pad(notes, dur: float, attack: float, release_at: float, bright: float) -> np.ndarray:
    """A soft pad: three detuned saws per note through a gentle lowpass, swelling in, then released."""
    t = t_axis(dur)
    x = np.zeros_like(t)
    for f in notes:
        for d in (1.0, 1.004, 0.996):
            x += saw(phase(np.full_like(t, f * d)))
    x = lp2(x, bright)
    env = np.clip(t / attack, 0, 1) ** 1.6 * np.where(
        t < release_at, 1.0, np.exp(-(t - release_at) / 0.35)
    )
    return x * env / len(notes)


def card_game_won() -> np.ndarray:
    """Rising swell into C major, with a bell sparkle and a mallet C6 as it opens (0.62 s in)."""
    x = np.zeros(int((GAME_WON_LEAD + 2.2) * SR))
    place(x, pad([ET_C5, ET_E5, ET_G5], 2.1, 0.7, 1.35, 2800), GAME_WON_LEAD)
    for j, f in enumerate((ET_C6 * 2, ET_G5 * 2, ET_E5 * 4, ET_C6 * 4)):
        place(x, bell(f, 0.9, 0.3) * 0.2, GAME_WON_LEAD + 0.62 + 0.06 * j)
    place(x, mallet(ET_C6, 1.2, 0.4) * 0.35, GAME_WON_LEAD + 0.62)
    return fade(x, 0.0, 0.3)


def card_game_lost() -> np.ndarray:
    """A short swell that sinks into A minor."""
    x = np.zeros(int(1.4 * SR))
    place(x, pad([ET_A4, ET_C5, ET_E5], 1.35, 0.35, 0.7, 1800), 0.0)
    return fade(x, 0.0, 0.25)


# --- Hearts: moon shot, trick gathered, hearts broken, queen of spades ---------------------------


def formant_gain(f, formants):
    """Spectral envelope at frequency f: a sum of resonance peaks (centre, bandwidth, gain)."""
    g = np.zeros_like(f)
    for fc, bw, a in formants:
        g += a / (1 + ((f - fc) / (bw / 2)) ** 2)
    return g


OO = [(380, 160, 1.0), (820, 220, 0.45), (2400, 400, 0.06)]
AH = [(700, 200, 1.0), (1150, 260, 0.6), (2600, 400, 0.08)]


def howl(dur=2.3, f_lo=380, f_hi=640, seed=1, vibrato=0.012, breath=0.06, open_vowel=0.7):
    """A wolf's howl: additive harmonics under a moving vowel (oo -> ah -> oo), pitch rising, holding, falling."""
    t = t_axis(dur)
    u = t / dur
    rise = np.clip(u / 0.16, 0, 1) ** 0.6
    fall = np.clip((u - 0.72) / 0.28, 0, 1) ** 1.4
    rng = np.random.default_rng(seed)
    drift = lp2(rng.standard_normal(len(t)), 6) * 0.004 / 0.02
    f0 = (f_lo + (f_hi - f_lo) * rise + 25 * np.clip((u - 0.16) / 0.5, 0, 1)) * (1 - 0.42 * fall)
    f0 = f0 * (1 + vibrato * np.sin(2 * np.pi * 5.2 * t) * np.clip((u - 0.25) / 0.2, 0, 1) + drift)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    mix = (
        open_vowel * np.sin(np.pi * np.clip((u - 0.1) / 0.7, 0, 1)) ** 1.5
    )  # how open the vowel is
    x = np.zeros_like(t)
    for n in range(1, 14):
        fn = n * f0
        g = (1 - mix) * formant_gain(fn, OO) + mix * formant_gain(fn, AH)
        x += g * np.sin(n * ph) / n**0.6 * (fn < 8000)
    b = lp2(highpass(noise(len(t), seed + 5), 400), 2500)
    x += breath * b / (np.std(b) + 1e-9) * np.std(x)
    amp = np.clip(t / 0.18, 0, 1) ** 1.5 * (1 - fall) ** 0.35
    return fade(x * amp, 0.005, 0.15)


def reverb(x, tail=1.2, seed=9, wet=0.3):
    """A soft hall: noise impulse response with an exponential decay, darkened."""
    n = int(tail * SR)
    ir = noise(n, seed) * np.exp(-np.arange(n) / SR / (tail / 5))
    ir = lp2(ir, 3000)
    ir /= np.sqrt(np.sum(ir**2))
    m = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, 2 * m) * np.fft.rfft(ir, 2 * m))[:m]
    out = np.zeros(len(y))
    out[: len(x)] += x
    return out + wet * y / (np.abs(y).max() + 1e-9) * np.abs(x).max()


def hearts_moon_howl() -> (
    np.ndarray
):  # a wolf on a hill: one howl, then a second, farther wolf answers, all in a wide space
    x = np.zeros(int(3.6 * SR))
    place(x, howl(2.1, 430, 640, seed=1), 0.0)
    place(x, lp2(howl(1.6, 480, 700, seed=3, vibrato=0.016), 1800) * 0.35, 1.45)
    return fade(reverb(x, tail=1.8, wet=0.45)[: int(3.9 * SR)], 0.0, 0.4)


def trick_gathered(
    seed: int = 0,
) -> np.ndarray:  # a whoosh as the pile flies to the winner, landing softly
    x = np.zeros(int(0.32 * SR))
    t = t_axis(0.2)
    w = (
        lp2(highpass(noise(len(t), 940 + seed), 600), 3500)
        * np.sin(np.pi * np.clip(t / 0.2, 0, 1)) ** 2
    )
    place(x, w / (np.abs(w).max() + 1e-9) * 0.4, 0.0)
    place(
        x,
        flap(950 + seed, dur=0.06, decay=0.004, tail=0.02, lo=150, hi=4000, tail_level=0.2) * 0.7,
        0.19,
    )
    return fade(x, 0.0, 0.04)


def hearts_broken_heartbeat() -> (
    np.ndarray
):  # heartbeat: a "lub-dub" thump with a bright crack on top (the heart breaks open)
    x = np.zeros(int(0.9 * SR))
    for at, g, f in ((0.0, 1.0, 230), (0.16, 0.7, 200)):
        t = t_axis(0.18)
        thump = np.sin(2 * np.pi * f * t * (1 - 0.3 * t / 0.18)) * np.exp(-t / 0.05)
        thump += (
            0.8 * np.sin(2 * np.pi * 2.6 * f * t) * np.exp(-t / 0.02)
        )  # some energy up high for phones
        place(x, thump * g, at)
    t = t_axis(0.05)
    place(x, highpass(noise(len(t), 970), 3000) * np.exp(-t / 0.008) * 0.35, 0.16)
    place(x, mallet(783.99, 0.5, 0.18) * 0.45, 0.30)
    return fade(x, 0.0, 0.1)


def queen_of_spades_gong() -> np.ndarray:  # a dark whoosh as she lands, then a low gong-like bell
    x = np.zeros(int(1.5 * SR))
    t = t_axis(0.25)
    w = lp2(highpass(noise(len(t), 990), 300), 2000) * np.sin(np.pi * np.clip(t / 0.25, 0, 1)) ** 2
    place(x, w / (np.abs(w).max() + 1e-9) * 0.35, 0.0)
    place(x, card_place(2) * 0.8, 0.22)
    tt = t_axis(1.2)
    gong = sum(
        g * np.sin(2 * np.pi * 330 * r * tt) * np.exp(-tt / d)
        for r, g, d in ((1, 1, 0.5), (2.1, 0.5, 0.3), (2.9, 0.35, 0.2), (4.2, 0.2, 0.12))
    )
    place(x, gong * np.clip(tt / 0.003, 0, 1) * 0.6, 0.23)
    return fade(x, 0.0, 0.2)


# --- Solitaire / FreeCell: invalid move, multi-card move, no moves left ---------------------------


def card_invalid_move() -> (
    np.ndarray
):  # "nope": two soft, muted wood notes falling a minor second, short and low-key
    x = np.zeros(int(0.32 * SR))
    place(x, mallet(523.25, 0.14, 0.035) * 0.9, 0.0)
    place(x, mallet(493.88, 0.2, 0.045), 0.085)
    return fade(lp2(x, 3000), 0.0, 0.05)


def card_multi_move(
    n: int = 4, seed: int = 0
) -> np.ndarray:  # fan sweep: a whoosh as the run lifts, then the cards fan down in a quick ripple
    x = np.zeros(int(0.42 * SR))
    t = t_axis(0.16)
    w = (
        lp2(highpass(noise(len(t), 1320 + seed), 700), 4000)
        * np.sin(np.pi * np.clip(t / 0.16, 0, 1)) ** 2
    )
    place(x, w / (np.abs(w).max() + 1e-9) * 0.35, 0.0)
    for j in range(n):
        place(
            x,
            flap(1330 + j, dur=0.05, decay=0.003, tail=0.012, lo=150, hi=4500, tail_level=0.15)
            * (0.55 + 0.45 * (j == n - 1)),
            0.15 + 0.028 * j,
        )
    return fade(x, 0.0, 0.04)


def card_no_moves() -> (
    np.ndarray
):  # shrug: three soft mallet notes that drift down and don't resolve
    x = np.zeros(int(1.0 * SR))
    for j, f in enumerate((659.25, 587.33, 554.37)):
        place(x, mallet(f, 0.6, 0.16) * (0.9 - 0.12 * j), 0.13 * j)
    return fade(x, 0.0, 0.1)


# --- registry ---------------------------------------------------------------------------------

Level = Callable[[np.ndarray], np.ndarray]


def peak(db: float) -> Level:
    return lambda x: norm(x, db)


def rms50(db: float, peak_max: float) -> Level:
    return lambda x: level_rms(x, db, peak_max)


CARD_PLACE_LEVEL = rms50(-21.5, -1.5)  # the three variations match by short-term loudness
CARD_FLIP_LEVEL = rms50(-22.5, -0.5)  # ~1 dB under card place: a reveal reads "lands, then turns"
CARD_FAN_LEVEL = rms50(-21.5, -0.5)  # three cards: ~1 dB over a single flip
CARD_DEAL_LEVEL = rms50(-21.5, -1.0)  # like card place

# file stem -> (recipe, leveling). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], Level]] = {
    "card-place-1": (lambda: card_place(0), CARD_PLACE_LEVEL),
    "card-place-2": (lambda: card_place(1), CARD_PLACE_LEVEL),
    "card-place-3": (lambda: card_place(2), CARD_PLACE_LEVEL),
    "card-flip-1": (lambda: card_flip(0), CARD_FLIP_LEVEL),
    "card-flip-2": (lambda: card_flip(1), CARD_FLIP_LEVEL),
    "card-flip-3": (lambda: card_flip(2), CARD_FLIP_LEVEL),
    "card-fan-1": (lambda: card_fan(0), CARD_FAN_LEVEL),
    "card-fan-2": (lambda: card_fan(1), CARD_FAN_LEVEL),
    "card-fan-3": (lambda: card_fan(2), CARD_FAN_LEVEL),
    "card-deal-1": (lambda: card_deal(0), CARD_DEAL_LEVEL),
    "card-deal-2": (lambda: card_deal(1), CARD_DEAL_LEVEL),
    "card-deal-3": (lambda: card_deal(2), CARD_DEAL_LEVEL),
    "chip-bet-1": (lambda: chip_bet(100), rms50(-22.5, -1.0)),
    "chip-bet-2": (lambda: chip_bet(101), rms50(-22.5, -1.0)),
    "chip-bet-3": (lambda: chip_bet(102), rms50(-22.5, -1.0)),
    "chip-payout": (chip_payout, rms50(-21.0, -1.0)),  # under the win chime
    "chip-collect": (chip_collect, rms50(-22.0, -1.0)),
    "chip-nudge": (chip_nudge, rms50(-22.5, -1.0)),
    "result-win": (result_win, rms50(-19.0, -1.0)),
    "result-push": (result_push, rms50(-22.0, -1.0)),
    "result-lose": (result_lose, rms50(-22.0, -1.0)),
    "result-bust": (result_bust, rms50(-22.0, -1.0)),
    "result-blackjack": (result_blackjack, rms50(-17.5, -1.0)),
    "riffle-start": (riffle_start, lambda x: x),  # peaks with the loop (set in the recipe)
    "riffle-loop": (riffle_loop, lambda x: x),  # RIFFLE_LOOP_LUFS (set in the recipe)
    "riffle-settle": (riffle_settle, rms50(-21.5, -1.5)),  # lands like a card place
    "card-game-won": (card_game_won, rms50(-17.0, -1.0)),  # with result-blackjack, the loudest
    "card-game-lost": (card_game_lost, rms50(-21.0, -1.0)),  # ~4 dB under game won
    "hearts-moon-howl": (hearts_moon_howl, rms50(-17.0, -1.0)),  # the human shoots the moon
    "trick-gathered-1": (
        lambda: trick_gathered(0),
        rms50(-23.0, -1.0),
    ),  # every trick: under card place
    "trick-gathered-2": (lambda: trick_gathered(1), rms50(-23.0, -1.0)),
    "trick-gathered-3": (lambda: trick_gathered(2), rms50(-23.0, -1.0)),
    "hearts-broken-heartbeat": (hearts_broken_heartbeat, rms50(-19.5, -1.0)),
    "queen-of-spades-gong": (queen_of_spades_gong, rms50(-19.5, -1.0)),
    "card-invalid-move": (
        card_invalid_move,
        rms50(-24.0, -1.0),
    ),  # frequent mis-taps: under card place
    "card-multi-move": (card_multi_move, rms50(-21.0, -1.0)),  # a run of cards: like card place
    "card-no-moves": (card_no_moves, rms50(-21.5, -1.0)),  # FreeCell stuck: under game lost
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
