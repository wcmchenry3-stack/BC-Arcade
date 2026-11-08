"""Synthesize Star Swarm's background music (no samples, no third-party audio). #3635, #3636

One original ~11:45 piece that replaces the four licensed Star Swarm background tracks. Every
sound is built here from oscillators, noise, envelopes and filters. The generator never opens,
reads or analyses any recording. This story (#3636) renders a rough draft of the whole track
plus short audition clips, so the owner can steer the sound before the final render (#3637).
The reasoning behind each choice is in docs/games/starswarm-music-design.md.

Run from the repo root (needs numpy, and ffmpeg with libmp3lame):
    python tools/assets/synth_starswarm_bgm.py [out_dir] [item ...]

out_dir defaults to tools/assets/out/bgm-audition/ (git-ignored; audio is never committed).
With no item names every clip in CLIPS is written, plus index.md describing them. Items are
clip names such as 00-draft-full or 03b-organ-flute. Everything is MP3 (libmp3lame VBR -q:a 4,
44.1 kHz stereo) so it plays on a phone. The seed is SEED (3635): a re-run decodes to the same
samples.

Form (seconds; one circular timeline of T_TOTAL = 705 s, so the end flows into 0:00)
- I. Cold Open, 0-200. Starts triumphant: an open C pad (C G D, no third) with a faint high E
  ("lifted colour"), bright. About 0:45 the E falls to E-flat (MOTIF_DARK_TURN) and the
  brightness tilt ramps down over ~40 s. Chords move every 20-40 s: C minor (0:42) -> E-flat/B-flat
  (1:18) -> D half-diminished, the dark turn (1:40, first Shepard fall underneath) -> F minor
  (2:12) -> F minor 7 to the end. A C2 sub pedal and a slow breathing swell (an 11 s amplitude
  breath on the pad and the air) run throughout. A shooting-star volley at 0:50 (7 streaks), two
  singles about 2:10, a stepped Shepard fall at 2:30, and a faint flute organ stop (8' 4' 2') in
  the pad from about 2:40.
- II. Cathedral, 200-400. The organ grows out of Part I's F minor into C minor (iv -> i, the
  plagal "amen"), then moves slowly C minor -> B-flat -> F -> C minor, a chord every 10-16 s, in
  wide voicings, with an airy breath band on top. 4:30 lifts into C major for 15 s (after an F
  major, so the lift is itself an amen), then back to minor. A gliding Shepard fall at 5:52. Near
  the end the first chorus voices gather (A-flat C E-flat) and the organ settles on A-flat
  major, the pivot (VI of C minor, V of D-flat).
- III. Swarm, 400-580. Open suspended D-flat chords (D-flat, A-flat, G-flat, E-flat, C-flat/B)
  around 140 Hz-1 kHz. Three choruses, each different: 7:45-8:06 the full swell (C#5 D#5 C#6
  entering one after another, MOTIF_CHORUS, "ah" vowel, upper bands lifted); 8:23-8:36 shorter,
  lower and darker ("oo" vowel, G#3 C#4 D#4) with a D-flat sub bump and little air; 8:52-9:10
  the brightest and airiest ("ee" vowel an octave up, an extra 5-14 kHz sparkle band), an echo of
  the first. Falling streaks between them, a stepped Shepard fall before the first and a gliding
  one into the last. A flute organ stop lingers at the start; Part IV's breathing creeps in at
  the end.
- IV. Shadows, 580-705. The Swarm's high C# and G# ("glass" voices) keep sounding while a
  G1/G2/G3 sub drone rises beneath them (the G against G#/C# clash). A breath of hiss every 6 s.
  10:21-10:23 the top end drops to near silence (above ~4 kHz cut by 42 dB) until 10:37, then
  opens again by 10:56. 10:24-10:38 something stirs: irregular, darker bursts (~1.8 kHz) with a
  grainy 40 Hz amplitude rattle over a low growl, and a long 20 s Shepard fall underneath. Then
  it passes: the regular breathing returns, G# falls to G and C# to C (MOTIF_SHADOW_RESOLVE), the
  drone settles, and the Cold Open's C minor pad creeps in, so the end flows into 0:00.

Parts hand over through equal-power crossfades of 24-26 s (XFADES), through shared notes: Part
I's F minor -> Part II's C minor organ; A-flat (held organ) -> D-flat; C# and G# held into
Shadows; G -> C resolving the loop. STARTING_POINTS are the six phrase starts the app may seek to
on a returning visit; none sits inside a crossfade window.

Recipes (every note has a raised-cosine attack and release of at least a few seconds, or tens of
ms for streaks and bursts, so nothing clicks)
- pad: a "PADsynth"-style ensemble. For each note, harmonics h*f0 with amplitude h^-rolloff and
  a gentle lowpass, each spread into a Gaussian band (bw cents wide) of random-phase partials:
  the sound of many slightly detuned voices. Built in one inverse FFT per event. Stereo is two
  phase sets mixed to a correlation of `width`. With `formant` set, harmonics are weighted by a
  vowel's formant peaks ("ah", "oo", "ee"): the chorus voices.
- organ: additive drawbars (16' 8' 5 1/3' 4' 2 2/3' 2' 1 3/5' 1'), one sine per rank, each rank
  detuned by a fixed tiny amount, through a rotating-speaker model: a ~1 Hz rotation that
  modulates amplitude (deeper for higher ranks, like a horn) and pitch (a few cents of Doppler),
  in quadrature between left and right. Phases depend on absolute time only, so common tones of
  consecutive chords crossfade seamlessly (true legato). ORGAN_VOICINGS holds the three audition
  voicings.
- drone: sine tones (sub pedals, the G drone), each a pair detuned by `beat` Hz.
- glass: the high held notes of Shadows: three detuned sine voices with weak 2nd/3rd harmonics,
  panned apart, gliding from one note to another where asked.
- shepard: a Shepard-Risset fall. Nine octave-spaced sine partials under a FIXED Gaussian
  spectral envelope (centre 600 Hz, sigma 1.1 octaves, on a log-frequency axis) slide down
  together, continuously ("glide", ~0.11 octave/s) or in smooth semitone steps ("stepped", one
  every 0.6 s). A partial leaving the bottom re-enters at the top at near-zero amplitude, so the
  fall never ends and never jumps.
- streak (shooting star): 0.5-1.7 s of white noise through a time-varying band-pass (STFT) whose
  centre falls from ~2.6 kHz to ~1.4 kHz, plus a faint whistle on the centre frequency, a 20 ms
  attack and an exponential decay, panned across the field while it falls.
- air: band-limited noise (a few kHz up) for the "airy breath"; slow swells come from `swell`.
- breath: noise around 2.2 kHz under a regular inhale/exhale envelope (one breath per period).
- stir: irregular bursts of noise around 1.8 kHz, amplitude-modulated by a jittered 40 Hz rattle
  with random per-cycle grain levels, over a low growl.

Mix: every event can carry a level curve (breakpoints in dB) and a slow `swell`. Each event goes
to the dry bus and, scaled by `send`, to a reverb send. The reverb convolves with a synthetic
impulse response (seeded noise split into bands, each decaying at its own rate: ~4.2 s low to
~1.6 s high, 25 ms pre-delay), circularly on the looping render. The master runs an STFT EQ: the
brightness tilt (TILT, dB per octave around 1 kHz), the 10:22 top cut (TOPCUT) and a 30 Hz
high-pass. A gentle leveller pulls 3 s loudness halfway toward the integrated level, the whole is
normalised to about -12 LUFS, and a look-ahead limiter keeps sample peaks under -2 dBFS. Output
is dithered 16-bit PCM piped to ffmpeg.
"""

from __future__ import annotations

import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import SR, noise  # shared building blocks (#3563)

OUT_DEFAULT = Path(__file__).resolve().parent / "out" / "bgm-audition"
SEED = 3635

T_TOTAL = 705.0  # seconds; the four tracks it replaces total 705.1 s
NT = round(T_TOTAL * SR)

# Parts (start, end) in seconds.
PARTS = {"I": (0.0, 200.0), "II": (200.0, 400.0), "III": (400.0, 580.0), "IV": (580.0, 705.0)}

# Equal-power crossfade windows between parts (start, end), 24-26 s each. "loop" is Shadows
# handing back to the Cold Open across the end of the file (705 s == 0 s).
XFADES = {
    "loop": (680.0, 705.0),
    "I-II": (178.0, 202.0),
    "II-III": (378.0, 402.0),
    "III-IV": (556.0, 582.0),
}
# Each part fades in over its first window and out over its second.
PART_WINDOWS = {"I": ("loop", "I-II"), "II": ("I-II", "II-III"), "III": ("II-III", "III-IV")}
PART_WINDOWS["IV"] = ("III-IV", "loop")

# Six composed starting points (seconds): phrase starts outside every crossfade window.
STARTING_POINTS = (0.0, 100.0, 205.0, 270.0, 405.0, 585.0)

# Motifs: the only melodic shapes in the piece, all 2-3 notes (rule: at most 3-4).
# The triumphant lifted third falling a semitone as the Cold Open darkens (~0:45).
MOTIF_DARK_TURN = ("E5", "Eb5")
# The chorus voices entering one after another in the first chorus swell (~7:45): a rising
# open stack (root, ninth, octave) rather than a tune.
MOTIF_CHORUS = ("C#5", "D#5", "C#6")
# Shadows letting go (~11:18-11:31): G# falls to G, then C# to C, turning the clash into C minor.
MOTIF_SHADOW_RESOLVE = ("G#5", "G5", "C#6", "C6")
MOTIFS = {
    "MOTIF_DARK_TURN": MOTIF_DARK_TURN,
    "MOTIF_CHORUS": MOTIF_CHORUS,
    "MOTIF_SHADOW_RESOLVE": MOTIF_SHADOW_RESOLVE,
}

# Brightness tilt (time s, dB per octave around TILT_PIVOT Hz). Ramps, never jumps.
TILT_PIVOT = 1000.0
TILT = (
    (0, 0.4), (40, 0.4), (80, -0.5), (178, -0.5), (204, 2.0), (264, 2.0), (271, 3.0),
    (284, 3.0), (292, 2.0), (370, 1.5), (402, 0.0), (464, 0.0), (472, 1.5), (484, 1.5),
    (490, 0.0), (502, -1.5), (514, -1.5), (520, 0.0), (530, 0.5), (536, 2.5), (548, 2.5),
    (556, 0.5), (582, -1.5), (680, -1.5), (705, 0.4),
)  # fmt: skip
# Top cut (time s, dB above ~4 kHz): Shadows' near-silence at 10:22.
TOPCUT = ((0, 0.0), (620.5, 0.0), (623.0, -42.0), (637.0, -42.0), (656.0, 0.0), (705, 0.0))
TARGET_LUFS = -12.0
CEILING_DB = -2.0

NOTE_RE = re.compile(r"^([A-G])([#b]?)(-?\d)$")
_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name: str) -> int:
    m = NOTE_RE.match(name)
    if not m:
        raise ValueError(f"bad note name {name!r}")
    acc = {"#": 1, "b": -1, "": 0}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + _PC[m.group(1)] + acc


def hz(name: str | float) -> float:
    if isinstance(name, (int, float)):
        return float(name)
    return 440.0 * 2 ** ((midi(name) - 69) / 12)


def notes(spec: str) -> list[str]:
    return spec.split()


# --- envelopes, crossfades, curves -----------------------------------------------------------


def ramp(x: np.ndarray) -> np.ndarray:
    """Raised-cosine 0 -> 1 over x in [0, 1]; ramp(p) + ramp(1 - p) == 1 (amplitude-complementary)."""
    return 0.5 - 0.5 * np.cos(np.pi * np.clip(x, 0.0, 1.0))


def env_ar(t: np.ndarray, length: float, attack: float, release: float) -> np.ndarray:
    """Raised-cosine attack and release over an event `length` s long (t is event-local)."""
    return ramp(t / max(attack, 1e-3)) * ramp((length - t) / max(release, 1e-3))


def equal_power(p: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
    """Equal-power crossfade gains (out, in) at progress p in [0, 1]: out**2 + in**2 == 1."""
    p = np.clip(np.asarray(p, dtype=float), 0.0, 1.0)
    return np.cos(p * np.pi / 2), np.sin(p * np.pi / 2)


def part_gain(part: str, t: np.ndarray) -> np.ndarray:
    """A part's gain at absolute times t (wrapping mod T_TOTAL): fades in over its first window
    and out over its second with the equal-power curves, 1 between, 0 elsewhere."""
    w_in, w_out = (XFADES[w] for w in PART_WINDOWS[part])
    rel = np.mod(np.asarray(t, dtype=float) - w_in[0], T_TOTAL)
    in_len = w_in[1] - w_in[0]
    core_end = np.mod(w_out[0] - w_in[0], T_TOTAL)
    out_end = core_end + (w_out[1] - w_out[0])
    g = np.zeros_like(rel)
    m = rel < in_len
    g[m] = equal_power(rel[m] / in_len)[1]
    g[(rel >= in_len) & (rel < core_end)] = 1.0
    m = (rel >= core_end) & (rel < out_end)
    g[m] = equal_power((rel[m] - core_end) / (out_end - core_end))[0]
    return g


def in_window(t: float) -> bool:
    return any(a <= t < b for a, b in XFADES.values())


def curve_db(points, t: np.ndarray, period: float | None = None) -> np.ndarray:
    """Linear interpolation of (time, value) breakpoints, optionally periodic."""
    xs = np.array([p[0] for p in points], dtype=float)
    ys = np.array([p[1] for p in points], dtype=float)
    if period:
        return np.interp(np.mod(t, period), xs, ys)
    return np.interp(t, xs, ys)


def pan_gains(pan: np.ndarray | float) -> tuple[np.ndarray, np.ndarray]:
    """Equal-power pan, -1 (left) .. +1 (right)."""
    th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.cos(th), np.sin(th)


def widen(a: np.ndarray, b: np.ndarray, corr: float) -> np.ndarray:
    """Stereo from two independent signals: left a, right correlated `corr` with a."""
    return np.stack([a, corr * a + np.sqrt(1 - corr**2) * b])


# --- noise and spectral tools ----------------------------------------------------------------


def band_mask(f: np.ndarray, lo: float, hi: float, edge: float = 0.5) -> np.ndarray:
    """Band-pass magnitude, raised-cosine skirts `edge` octaves wide below lo and above hi."""
    lf = np.log2(np.maximum(f, 1.0))
    up = ramp((lf - np.log2(lo) + edge) / edge)
    down = ramp((np.log2(hi) + edge - lf) / edge)
    return up * down


def band_noise(n: int, seed: int, lo: float, hi: float, edge: float = 0.5) -> np.ndarray:
    """Unit-RMS noise band-limited to lo..hi Hz (one FFT; seeded)."""
    X = np.fft.rfft(noise(n, seed))
    X *= band_mask(np.fft.rfftfreq(n, 1 / SR), lo, hi, edge)
    y = np.fft.irfft(X, n)
    return y / (np.sqrt(np.mean(y**2)) + 1e-12)


def log_band_noise(n: int, seed: int, centre: float, sigma_oct: float) -> np.ndarray:
    """Unit-RMS noise with a Gaussian band (on log frequency) around `centre`."""
    X = np.fft.rfft(noise(n, seed))
    f = np.maximum(np.fft.rfftfreq(n, 1 / SR), 1.0)
    X *= np.exp(-0.5 * (np.log2(f / centre) / sigma_oct) ** 2)
    y = np.fft.irfft(X, n)
    return y / (np.sqrt(np.mean(y**2)) + 1e-12)


def stft_process(x, gain_fn, n_fft=4096, t0=0.0, circular=False, stats=None):
    """Time-varying EQ by STFT: Hann analysis and synthesis, hop n_fft/4, overlap-add.

    gain_fn(frame_times, freqs) -> (frames, bins) magnitude gains. With circular=True the signal
    is treated as a loop, so the seam is processed like any other point. With `stats` (a dict),
    per-frame K-weighted mean square and spectral-centroid sums are accumulated into it.
    """
    hop = n_fft // 4
    n = len(x)
    pad = n_fft
    tail = (-(n + 2 * pad)) % hop
    if circular:
        xp = np.concatenate([x[-pad:], x, x[: pad + tail]])
    else:
        xp = np.concatenate([np.zeros(pad, x.dtype), x, np.zeros(pad + tail, x.dtype)])
    nb = len(xp) // hop
    nf = nb - 3
    win = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)).astype(np.float64)
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    view = np.lib.stride_tricks.sliding_window_view(xp, n_fft)[::hop]
    out = np.zeros((nb, hop), np.float64)
    kw = k_weight_power(freqs) if stats is not None else None
    one_sided = np.full(len(freqs), 2.0)
    one_sided[[0, -1]] = 1.0
    cmask = (freqs >= 20) & (freqs <= 16000)
    chunk = 512
    for c0 in range(0, nf, chunk):
        c1 = min(nf, c0 + chunk)
        frames = view[c0:c1].astype(np.float64) * win
        X = np.fft.rfft(frames, axis=1)
        tc = t0 + (np.arange(c0, c1) * hop + n_fft / 2 - pad) / SR
        X *= gain_fn(tc, freqs)
        if stats is not None:
            p = np.abs(X) ** 2
            stats["ms"][c0:c1] += (p * (kw * one_sided)).sum(1) / (n_fft**2 * 0.375)
            mag = np.sqrt(p[:, cmask])
            stats["cnum"][c0:c1] += (mag * freqs[cmask]).sum(1)
            stats["cden"][c0:c1] += mag.sum(1)
        y = np.fft.irfft(X, n_fft, axis=1) * win
        y = y.reshape(c1 - c0, 4, hop)
        for q in range(4):
            out[c0 + q : c1 + q] += y[:, q, :]
    out = out.reshape(-1) / 1.5  # sum of Hann^2 at hop n/4
    return out[pad : pad + n]


def stft_frames(n: int, n_fft: int = 4096) -> int:
    hop = n_fft // 4
    return (n + 2 * n_fft + (-(n + 2 * n_fft)) % hop) // hop - 3


def k_weight_power(f: np.ndarray) -> np.ndarray:
    """|H(f)|^2 of the BS.1770 K-weighting (pre-filter shelf and RLB high-pass) at SR."""
    z = np.exp(-1j * 2 * np.pi * f / SR)
    K = np.tan(np.pi * 1681.974450955533 / SR)
    Vh, Q = 10 ** (3.999843853973347 / 20), 0.7071752369554196
    Vb = Vh**0.4996667741545416
    a0 = 1 + K / Q + K * K
    b = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    h1 = (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    K = np.tan(np.pi * 38.13547087602444 / SR)
    Q = 0.5003270373238773
    a0 = 1 + K / Q + K * K
    a = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    h2 = (1 - 2 * z + z * z) / (a[0] + a[1] * z + a[2] * z * z)
    return np.abs(h1 * h2) ** 2


def fft_convolve(x: np.ndarray, h: np.ndarray, circular: bool) -> np.ndarray:
    """Overlap-add FFT convolution; with circular=True the tail wraps into the head (loop)."""
    n, m = len(x), len(h)
    nfft = 1 << int(np.ceil(np.log2(4 * m)))
    blk = nfft - m + 1
    H = np.fft.rfft(h, nfft)
    y = np.zeros(n + m - 1, np.float64)
    for s in range(0, n, blk):
        seg = x[s : s + blk]
        k = len(seg) + m - 1
        y[s : s + k] += np.fft.irfft(np.fft.rfft(seg, nfft) * H, nfft)[:k]
    if circular:
        y[: m - 1] += y[n:]
    return y[:n]


def reverb_ir(seed: int, length=5.0, rt_low=4.2, rt_high=1.6, predelay=0.025) -> np.ndarray:
    """Synthetic stereo impulse response: seeded noise in 8 log-spaced bands, each decaying at
    its own RT60 (long lows, short highs), a 25 ms pre-delay and a soft 12 ms onset."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = np.maximum(np.fft.rfftfreq(n, 1 / SR), 1.0)
    centres = np.linspace(np.log2(80), np.log2(12000), 8)
    step = centres[1] - centres[0]
    out = np.zeros((2, n))
    for ch in range(2):
        X = np.fft.rfft(noise(n, seed + ch))
        lf = np.clip(np.log2(f), centres[0], centres[-1])
        for c in centres:
            mask = np.clip(1 - np.abs(lf - c) / step, 0, 1)  # triangles: a partition of unity
            frac = (c - centres[0]) / (centres[-1] - centres[0])
            rt = rt_low * (rt_high / rt_low) ** frac
            out[ch] += np.fft.irfft(X * mask, n) * np.exp(-6.91 * t / rt)
    out *= ramp(t / 0.012)
    k = int(predelay * SR)
    out = np.concatenate([np.zeros((2, k)), out[:, : n - k]], axis=1)
    return out / np.sqrt(np.sum(out**2, axis=1, keepdims=True))


# --- events and recipes ----------------------------------------------------------------------


@dataclass(frozen=True)
class Ev:
    """One sounding object on the timeline. start may be negative or run past T_TOTAL: on the
    looping render it wraps. `p` holds the recipe's parameters; `curve` is a list of
    (absolute time, dB) breakpoints and `swell` a (period s, depth) amplitude breath."""

    kind: str
    start: float
    dur: float
    gain_db: float = 0.0
    send: float = 0.35
    part: str | None = None
    p: dict = field(default_factory=dict)


def harmonics_pad(f0, rolloff, cutoff, formant, fmax=14000.0):
    """(freqs, amps) for one pad note's harmonics."""
    h = np.arange(1, int(fmax / f0) + 1)
    fc = h * f0
    a = h ** (-rolloff) / (1 + (fc / cutoff) ** 2)
    if formant:
        peaks = VOWELS[formant]
        w = 0.06 + sum(g * np.exp(-0.5 * (np.log2(fc / pf) / 0.22) ** 2) for pf, g in peaks)
        a = a * w
    return fc, a


# Vowel formants (Hz, relative level): the chorus voices' colour.
VOWELS = {
    "ah": ((750, 1.0), (1200, 0.7), (2600, 0.4), (3400, 0.25)),
    "oo": ((330, 1.0), (850, 0.45), (2400, 0.08)),
    "ee": ((300, 0.5), (2300, 1.0), (3000, 0.8), (3900, 0.55), (5200, 0.3)),
}


def r_pad(ev: Ev, length: int) -> np.ndarray:
    p = ev.p
    n = length + (length % 2)
    df = SR / n
    power = np.zeros(n // 2 + 1)
    bw = p.get("bw", 18.0)
    levels = p.get("levels") or [0.0] * len(p["notes"])
    for name, lvl in zip(p["notes"], levels, strict=True):
        fcs, amps = harmonics_pad(
            hz(name), p.get("rolloff", 1.4), p.get("cutoff", 5000.0), p.get("formant")
        )
        amps = amps * 10 ** (lvl / 20)
        for fc, a in zip(fcs, amps, strict=True):
            sigma = max(fc * (2 ** (bw / 1200) - 1) / 2.355, 1.5 * df)
            i0 = max(1, int((fc - 4 * sigma) / df))
            i1 = min(len(power), int((fc + 4 * sigma) / df) + 2)
            g = np.exp(-0.5 * ((np.arange(i0, i1) * df - fc) / sigma) ** 2)
            power[i0:i1] += a * a * g / g.sum()
    mag = np.sqrt(power) * (n / 2) * np.sqrt(2)  # each harmonic ~ a sine of amplitude a
    rng = np.random.default_rng(p["seed"])
    chans = []
    for _ in range(2):
        ph = rng.uniform(0, 2 * np.pi, len(mag))
        chans.append(np.fft.irfft(mag * np.exp(1j * ph), n)[:length])
    y = widen(chans[0], chans[1], p.get("width", 0.55))
    t = np.arange(length) / SR
    return y * env_ar(t, ev.dur, p.get("attack", 5.0), p.get("release", 6.0))


# Organ voicings: drawbar footage -> level, rotating-speaker rate (Hz), amplitude depth, and
# Doppler pitch depth (cents). Footage f sounds at 8/f times the 8' pitch.
ORGAN_VOICINGS = {
    # A: the draft's voice. Full but round principal chorus, slow ~0.9 Hz shimmer.
    "cathedral": {
        "bars": {16: 0.55, 8: 1.0, 4: 0.6, 8 / 3: 0.32, 2: 0.4},
        "rate": 0.9,
        "depth": 0.22,
        "cents": 4.0,
    },
    # B: soft flutes (8' 4' and a whisper of 2'), slower 0.55 Hz chorale shimmer.
    "flute": {"bars": {8: 1.0, 4: 0.45, 2: 0.12}, "rate": 0.55, "depth": 0.15, "cents": 3.0},
    # C: full drawbars up to 1', brighter and reedier, faster 1.35 Hz shimmer.
    "full": {
        "bars": {16: 0.6, 8: 0.9, 16 / 3: 0.3, 4: 0.8, 8 / 3: 0.55, 2: 0.65, 1.6: 0.25, 1: 0.3},
        "rate": 1.35,
        "depth": 0.28,
        "cents": 6.0,
    },
}


def r_organ(ev: Ev, i0: int, i1: int) -> np.ndarray:
    p = ev.p
    v = ORGAN_VOICINGS[p.get("voicing", "cathedral")]
    rate = p.get("rate", v["rate"])
    beta = v["cents"] / 1200 * np.log(2)
    t_loc = np.arange(i0, i1) / SR
    t = ev.start + t_loc
    rot = 2 * np.pi * rate * t
    out = np.zeros((2, len(t)))
    for ch, off in ((0, 0.0), (1, np.pi / 2)):  # two "mics" a quarter turn apart
        s_rot, c_rot = np.sin(rot + off), np.cos(rot + off)
        for name in p["notes"]:
            f0 = hz(name)
            for foot, lvl in v["bars"].items():
                f = f0 * 8 / foot
                if f > 9000:
                    continue
                det = 1 + ((midi(name) * 7 + int(foot * 3)) % 5 - 2) * 0.35 / 1731  # +-0.7 cent
                depth = v["depth"] * (0.35 + 0.65 * min(f / 1500, 1.0))
                ph = 2 * np.pi * f * det * t + (beta * f / rate) * s_rot
                out[ch] += lvl / (1 + (f / 5000) ** 2) * (1 + depth * c_rot) * np.sin(ph)
    return out * env_ar(t_loc, ev.dur, p.get("attack", 3.0), p.get("release", 3.0))


def r_drone(ev: Ev, i0: int, i1: int) -> np.ndarray:
    p = ev.p
    t_loc = np.arange(i0, i1) / SR
    t = ev.start + t_loc
    beat = p.get("beat", 0.1)
    out = np.zeros((2, len(t)))
    for f, a in p["tones"]:
        f = hz(f)
        out[0] += a * np.sin(2 * np.pi * (f - beat / 2) * t)
        out[1] += a * np.sin(2 * np.pi * (f + beat / 2) * t + 0.7)
    return out * env_ar(t_loc, ev.dur, p.get("attack", 8.0), p.get("release", 8.0))


def r_glass(ev: Ev, length: int) -> np.ndarray:
    """Held high voices; p['voices'] = [(from, to, glide_at_abs, glide_s, level_db), ...]."""
    p = ev.p
    t_loc = np.arange(length) / SR
    t = ev.start + t_loc
    out = np.zeros((2, length))
    for k, (n0, n1, at, gd, lvl) in enumerate(p["voices"]):
        semis = midi(n1) - midi(n0)
        f = hz(n0) * 2 ** (semis / 12 * ramp((t - at) / gd))
        base = 2 * np.pi * np.cumsum(f) / SR
        for j, (cents, pan) in enumerate(((-4, -0.45), (0, 0.0), (4, 0.45))):
            ph = base * 2 ** (cents / 1200) + 1.3 * j + 0.7 * k
            x = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph)
            x *= 1 + 0.12 * np.sin(2 * np.pi * (0.13 + 0.03 * j) * t + j)  # slow shimmer
            gl, gr = pan_gains(pan)
            out[0] += gl * x * 10 ** (lvl / 20)
            out[1] += gr * x * 10 ** (lvl / 20)
    return out * env_ar(t_loc, ev.dur, p.get("attack", 10.0), p.get("release", 10.0))


# Shepard-Risset shape: glide rate (octaves/s), step period (s) and the fraction of a step spent
# sliding, the FIXED bell's centre (Hz) and width (octaves), the lowest frequency and the span.
SHEPARD = {"rate": 0.11, "step": 0.6, "glide": 0.2, "centre": 600.0, "sigma": 1.1, "lo": 25.0}
SHEPARD_OCTAVES = 9


def shepard_partials(t, mode: str = "glide", **shape):
    """Frequencies and amplitudes (partials x time) of a falling Shepard-Risset tone.

    Partial k sits `k - fall(t)` octaves (mod SHEPARD_OCTAVES) above `lo`; its amplitude comes
    only from a FIXED Gaussian bell over log-frequency (centre, sigma), so the spectral envelope
    never moves while every partial slides down under it. `shape` overrides SHEPARD.
    """
    sh = {**SHEPARD, **shape}
    rate, step, glide = sh["rate"], sh["step"], sh["glide"]
    centre, sigma, lo, octaves = sh["centre"], sh["sigma"], sh["lo"], SHEPARD_OCTAVES
    t = np.asarray(t, dtype=float)
    if mode == "glide":
        fall = rate * t
    elif mode == "stepped":
        u = t / step
        fall = (np.floor(u) + ramp((u % 1 - (1 - glide)) / glide)) / 12
    else:
        raise ValueError(mode)
    pos = np.mod(np.arange(octaves)[:, None] - fall[None, :], octaves)
    logf = np.log2(lo) + pos
    amp = np.exp(-0.5 * ((logf - np.log2(centre)) / sigma) ** 2)
    return 2**logf, amp


def r_shepard(ev: Ev, length: int) -> np.ndarray:
    p = ev.p
    t = np.arange(length) / SR
    kw = {k: p[k] for k in ("mode", "rate", "step", "centre", "sigma") if k in p}
    f, a = shepard_partials(t, **kw)
    ph = 2 * np.pi * np.cumsum(f, axis=1) / SR
    x = (a * np.sin(ph)).sum(0)
    d = int(0.007 * SR)  # a 7 ms inter-channel delay for width
    y = np.stack([x, np.concatenate([np.zeros(d), x[:-d]])])
    return y * env_ar(t, ev.dur, p.get("attack", 2.5), p.get("release", 3.0))


def r_streak(ev: Ev, length: int) -> np.ndarray:
    """Shooting star: a falling band of bright noise with a faint whistle, panned across."""
    p = ev.p
    t = np.arange(length) / SR
    f0, f1 = p.get("f_from", 2600.0), p.get("f_to", 1400.0)

    def fc_at(tt):
        return f0 * (f1 / f0) ** np.clip(tt / ev.dur, 0, 1)

    def gain(tc, freqs):
        lf = np.log2(np.maximum(freqs, 1.0))[None, :]
        return np.exp(-0.5 * ((lf - np.log2(fc_at(tc))[:, None]) / 0.32) ** 2)

    x = stft_process(noise(length, p["seed"]), gain, n_fft=1024)
    x = x / (np.sqrt(np.mean(x**2)) + 1e-12)
    x += 0.35 * np.sin(2 * np.pi * np.cumsum(fc_at(t)) / SR)
    e = ramp(t / 0.02) * np.exp(-t / (0.38 * ev.dur)) * ramp((ev.dur - t) / 0.06)
    gl, gr = pan_gains(
        p.get("pan_from", -0.7) + (p.get("pan_to", 0.7) - p.get("pan_from", -0.7)) * t / ev.dur
    )
    return np.stack([gl * x * e, gr * x * e])


def r_air(ev: Ev, length: int) -> np.ndarray:
    p = ev.p
    a = band_noise(length, p["seed"], p.get("lo", 3000.0), p.get("hi", 11000.0))
    b = band_noise(length, p["seed"] + 1, p.get("lo", 3000.0), p.get("hi", 11000.0))
    t = np.arange(length) / SR
    return widen(a, b, 0.3) * env_ar(t, ev.dur, p.get("attack", 8.0), p.get("release", 8.0))


def breath_env(t: np.ndarray, period: float) -> np.ndarray:
    """One breath per period: a 40% inhale swell, a 45% exhale, then rest."""
    u = np.mod(t, period) / period
    return np.where(u < 0.4, ramp(u / 0.4), ramp((0.85 - u) / 0.45))


def r_breath(ev: Ev, length: int) -> np.ndarray:
    p = ev.p
    t = np.arange(length) / SR
    a = log_band_noise(length, p["seed"], p.get("centre", 2200.0), 0.7)
    b = log_band_noise(length, p["seed"] + 1, p.get("centre", 2200.0), 0.7)
    e = breath_env(t, p.get("period", 6.0)) ** 1.5
    return widen(a, b, 0.5) * e * env_ar(t, ev.dur, 1.0, 2.0)


def r_stir(ev: Ev, length: int) -> np.ndarray:
    """Something stirring: irregular darker bursts with a grainy 40 Hz rattle, over a growl."""
    p = ev.p
    rng = np.random.default_rng(p["seed"])
    t = np.arange(length) / SR
    bursts = np.zeros(length)
    at = 0.2
    while at < ev.dur - 0.6:
        d = rng.uniform(0.3, 1.2)
        tt = t - at
        bursts += rng.uniform(0.5, 1.0) * ramp(tt / 0.06) * ramp((d - tt) / 0.25) * (tt < d)
        at += d + rng.uniform(0.15, 1.1)
    rattle_rate = p.get("rattle", 40.0)
    cyc = np.floor(t * rattle_rate).astype(int)
    grain = rng.uniform(0.3, 1.0, cyc.max() + 2)[cyc]
    jitter = np.cumsum(rng.normal(0, 0.02, length)) * 0.002
    rattle = (0.5 + 0.5 * np.cos(2 * np.pi * rattle_rate * t + jitter)) ** 2 * grain
    out = []
    for ch in range(2):
        hiss = log_band_noise(length, p["seed"] + 10 + ch, p.get("centre", 1800.0), 0.5)
        growl = log_band_noise(length, p["seed"] + 20 + ch, 260.0, 0.6)
        out.append(hiss * (0.25 + 0.75 * rattle) * bursts + 0.35 * growl * (0.4 + 0.6 * bursts))
    return np.stack(out) * env_ar(t, ev.dur, 0.8, 1.5)


# Recipes that render a whole event at once (then slice) vs. any sample range directly.
WHOLE = {
    "pad": r_pad,
    "glass": r_glass,
    "shepard": r_shepard,
    "streak": r_streak,
    "air": r_air,
    "breath": r_breath,
    "stir": r_stir,
}
RANGED = {"organ": r_organ, "drone": r_drone}


# --- the composition -------------------------------------------------------------------------


class Score:
    """Builds the event list with deterministic seeds (one per event, in order)."""

    def __init__(self, seed: int):
        self.events: list[Ev] = []
        self._seed = seed * 1000

    def add(self, kind, start, end, gain=0.0, send=0.35, part=None, **p) -> None:
        self._seed += 7
        p.setdefault("seed", self._seed)
        if isinstance(p.get("notes"), str):
            p["notes"] = notes(p["notes"])
        self.events.append(Ev(kind, start, end - start, gain, send, part, p))

    def pad(self, start, end, spec, gain=0.0, part=None, **p):
        self.add("pad", start, end, gain, p.pop("send", 0.4), part, notes=spec, **p)

    def organ(self, chords, end, voicing="cathedral", gain=0.0, part=None, xf=3.0, **p):
        """Legato organ: chord k sounds from onset_k - xf/2 to onset_k+1 + xf/2 with xf-second
        raised-cosine fades, so common tones hold and the rest crossfade."""
        for k, (on, spec) in enumerate(chords):
            nxt = chords[k + 1][0] if k + 1 < len(chords) else end
            a = p.get("first_attack", xf) if k == 0 else xf
            s = on - (a if k == 0 else xf / 2)
            self.add("organ", s, nxt + xf / 2, gain, 0.55, part, notes=spec, voicing=voicing,
                     attack=a, release=xf, **{k2: v for k2, v in p.items() if k2 != "first_attack"})  # fmt: skip


LV = {  # layer levels (dB), tuned by measurement
    "pad": -3.0,
    "sub": -6.0,
    "air1": -41.0,
    "air2": -34.0,
    "air3": -35.0,
    "organ": -5.0,
    "choir": -1.0,
    "glass": -9.0,
    "drone": -4.0,
    "shepard": -17.0,
    "streak": -1.0,
    "breath": -20.0,
    "stir": -17.0,
}


def track_events(seed: int = SEED) -> list[Ev]:
    """The whole piece as a list of events (deterministic for a seed)."""
    s = Score(seed)
    for part in (_cold_open, _cathedral, _swarm, _shadows):
        part(s)
    _threads(s, seed)
    return s.events


def _cold_open(s: Score) -> None:
    """I. Cold Open (0-200)."""
    P, I = LV["pad"], "I"
    # Open C, no third: triumphant and open. Starts at -28 (= 11:17) so it creeps in under Shadows.
    s.pad(-28, 48, "C3 G3 C4 G4 D5", P - 1, I, attack=14, release=8, rolloff=1.35, cutoff=4500,
          swell=(11.0, 0.12))  # fmt: skip
    # The loop's C minor colour: an E-flat that sounds 11:21-11:44 and is gone by 0:00.
    s.pad(-24, -1, "Eb4", P - 5, I, attack=10, release=9)
    # Lifted colour: a faint high E (and G) over the open C; it falls to E-flat (MOTIF_DARK_TURN).
    s.pad(1, 49, "E5 G5", P - 10, I, attack=6, release=7, rolloff=1.0, cutoff=8000)
    s.pad(41, 90, "Eb5", P - 12, I, attack=6, release=8)
    s.pad(40, 84, "C3 G3 C4 Eb4 G4", P - 4, I, attack=8, release=8, rolloff=1.5, swell=(11.0, 0.12))
    s.pad(77, 106, "Bb2 Eb3 G3 Bb3 Eb4 G4", P - 4, I, attack=6, release=7, rolloff=1.6,
          swell=(11.0, 0.12))  # fmt: skip
    # The dark turn (1:40): D half-diminished over the C pedal.
    s.pad(
        96, 138, "D3 F3 Ab3 C4 F4", P - 4, I, attack=4, release=8, rolloff=1.7, swell=(11.0, 0.15)
    )
    s.pad(
        127, 168, "F2 C3 F3 Ab3 C4", P - 4, I, attack=5, release=8, rolloff=1.7, swell=(11.0, 0.15)
    )
    s.pad(
        160, 206, "F2 C3 Ab3 Eb4 F4", P - 4, I, attack=6, release=6, rolloff=1.7, swell=(11.0, 0.15)
    )
    s.add("drone", -28, 206, LV["sub"], 0.0, I, tones=[("C2", 1.0), ("C3", 0.3)], attack=14,
          release=6)  # fmt: skip
    s.add("air", -25, 206, LV["air1"], 0.25, I, lo=2500, hi=10000, swell=(11.0, 0.35),
          curve=[(-25, -8), (0, -7), (40, -7), (85, 0), (206, 0)])  # fmt: skip
    # Foreshadowing: a faint flute organ stop in the pad (2:45 onwards).
    s.organ([(170, "F3 Ab3 C4")], 206, "flute", LV["organ"] - 12, I, first_attack=12)


def _cathedral(s: Score) -> None:
    """II. Cathedral (200-400)."""
    P, II = LV["pad"], "II"
    cathedral = [
        (205, "C3 G3 C4 Eb4 G4 C5"),
        (220, "Bb2 F3 Bb3 D4 F4 Bb4"),
        (234, "F2 C3 F3 A3 C4 F4 A4"),
        (248, "C3 G3 Eb4 G4 C5"),
        (258, "F2 F3 A3 C4 F4 A4 C5"),
        (270, "C3 G3 C4 E4 G4 C5 E5"),  # the C major lift
        (285, "C3 G3 C4 Eb4 G4 C5"),
        (300, "Bb2 F3 Bb3 D4 F4 Bb4"),
        (316, "F2 C3 F3 Ab3 C4 F4"),
        (332, "C3 G3 C4 Eb4 G4 C5"),
        (348, "Ab2 Eb3 Ab3 C4 Eb4 Ab4 C5"),  # the pivot: VI of C minor, V of D-flat
    ]
    s.organ(cathedral, 404, "cathedral", LV["organ"], II, first_attack=29)
    for k, (on, spec) in enumerate(cathedral):  # a soft ensemble doubling under the organ
        nxt = cathedral[k + 1][0] if k + 1 < len(cathedral) else 404
        s.pad(on - 4 if k else 176, nxt + 4, spec, P - 9, II, attack=5 if k else 25, release=6, rolloff=1.9,
              bw=28)  # fmt: skip
    s.add("air", 178, 404, LV["air2"], 0.3, II, lo=3000, hi=12000, swell=(9.0, 0.45),
          curve=[(178, -6), (205, 0), (264, 0), (272, 4), (284, 4), (292, 0), (404, -2)])  # fmt: skip
    # The first chorus voices gather over the A-flat (global, so they bridge into the Swarm).
    s.pad(352, 418, "Ab4 C5 Eb5", LV["choir"] - 8, None, attack=20, release=14, formant="ah",
          bw=30, rolloff=0.9, cutoff=6000, curve=[(352, -14), (395, 0), (418, 0)])  # fmt: skip


def _swarm(s: Score) -> None:
    """III. Swarm (400-580)."""
    P, III = LV["pad"], "III"
    swarm = [
        (405, "Db3 Ab3 Db4 Eb4 Ab4"),
        (428, "Db3 Gb3 Ab3 Db4 Gb4 Ab4"),
        (448, "Db3 B3 Eb4 Gb4 B4"),
        (465, "Db3 Ab3 Db4 Eb4 Ab4"),
        (487, "Db3 B3 Eb4 Gb4 B4"),
        (503, "Db3 Ab3 Eb4"),
        (517, "Db3 Gb3 Ab3 Db4 Gb4"),
        (530, "Db4 Eb4 Ab4 Db5"),
        (550, "Db4 Ab4 Db5"),
    ]
    for k, (on, spec) in enumerate(swarm):
        nxt = swarm[k + 1][0] if k + 1 < len(swarm) else 584
        s.pad(on - 4 if k else 381, nxt + 4, spec, P - 1, III, attack=6 if k else 24, release=7,
              rolloff=1.35, bw=22, cutoff=4500, swell=(13.0, 0.08))  # fmt: skip
    s.organ([(405, "Db3 Ab3 Db4 Eb4")], 432, "flute", LV["organ"] - 8, III, first_attack=10, xf=12)
    s.add("drone", 383, 584, LV["sub"] - 4, 0.0, III, tones=[("Db2", 1.0), ("Ab2", 0.3)],
          attack=18, release=8)  # fmt: skip
    s.add("air", 380, 584, LV["air3"], 0.25, III, lo=3500, hi=12000, swell=(13.0, 0.3),
          curve=[(380, -4), (405, 0), (500, 0), (505, -6), (515, -6), (530, 0), (584, -4)])  # fmt: skip
    C = LV["choir"]
    # Chorus 1 (7:45-8:06): the full swell. 5 s build, then a ~10 s swell; voices enter in turn.
    for k, nm in enumerate(MOTIF_CHORUS):
        m = midi(nm)
        st = 465 + 1.5 * k
        s.pad(st, 487, f"{nm} {_name(m - 12)} {_name(m + 12)}", C, III, attack=1.5, release=6,
              formant="ah", bw=32, rolloff=0.9, cutoff=9000, levels=[0, -8, -11], send=0.5,
              curve=[(st, -22), (470, -8), (477, 0), (481, 0)])  # fmt: skip
    # Chorus 2 (8:23-8:36): shorter, lower and darker, with a sub bump and little air.
    for k, nm in enumerate(("C#4", "G#3", "D#4")):
        st = 503 + 0.8 * k
        s.pad(st, 516, nm, C - 1, III, attack=2.5, release=5, formant="oo", bw=30, rolloff=1.8,
              cutoff=2200, send=0.45, curve=[(st, -14), (507, 0), (512, 0)])  # fmt: skip
    s.add("drone", 503, 517, LV["sub"] + 2, 0.0, III, tones=[("Db2", 1.0), ("Db3", 0.25)],
          attack=4, release=5)  # fmt: skip
    # Chorus 3 (8:52-9:10): brightest and airiest, an octave-up echo of the first.
    for k, nm in enumerate(("C#6", "D#6", "G#5")):
        m = midi(nm)
        st = 532 + 0.9 * k
        s.pad(st, 552, f"{nm} {_name(m - 12)}", C - 7, III, attack=1.5, release=7,
              formant="ee", bw=36, rolloff=0.7, cutoff=14000, levels=[0, -6], send=0.55,
              curve=[(st, -20), (537, -5), (543, 0), (547, 0)])  # fmt: skip
    s.add("air", 530, 554, LV["air3"] + 2, 0.4, III, lo=5000, hi=14000, attack=5, release=7,
          curve=[(530, -12), (538, 0), (548, 0)])  # fmt: skip


def _shadows(s: Score) -> None:
    """IV. Shadows (580-705)."""
    P, IV = LV["pad"], "IV"
    # The Swarm's high C# and G# keep sounding (global: they bridge III -> IV); then let go.
    s.add("glass", 544, 712, LV["glass"], 0.5, None, attack=12, release=9,
          voices=[("G#5", "G5", 677.0, 5.0, 0.0), ("C#6", "C6", 686.0, 5.0, -3.0)])  # fmt: skip
    s.add("glass", 544, 690, LV["glass"] - 5, 0.5, None, attack=12, release=10,
          voices=[("C#5", "C#5", 0.0, 1.0, 0.0)])  # fmt: skip
    # The G drone rising from below: G1 creeps in, G2 and G3 join at the 9:45 phrase.
    s.add("drone", 558, 707, LV["drone"], 0.0, IV, tones=[("G1", 1.0)], beat=0.12, attack=22,
          release=6, curve=[(558, -5), (592, 0), (676, 0), (700, -5)])  # fmt: skip
    s.add("drone", 580, 707, LV["drone"] - 3, 0.05, IV, tones=[("G2", 0.6), ("G3", 0.25)],
          beat=0.18, attack=5, release=6, curve=[(580, -6), (612, 0), (676, 0), (700, -6)])  # fmt: skip
    s.pad(558, 707, "G2 D3 G3", P - 3, IV, attack=14, release=8, rolloff=2.2, cutoff=1400, bw=26)
    s.add("air", 556, 707, LV["air3"] - 6, 0.2, IV, lo=3500, hi=10000, swell=(6.0, 0.3))
    # Regular breathing (from 9:15, in Part III, creeping), one breath per 6 s (aligned to 9:45).
    s.add("breath", 555, 622, LV["breath"], 0.3, None, period=6.0,
          curve=[(555, -16), (585, -2), (600, 0)])  # fmt: skip
    # Something comes out of the shadows (10:24-10:38).
    s.add("stir", 624.5, 638.5, LV["stir"], 0.25, IV, curve=[(624.5, -6), (628, 0), (636, 0)])
    s.add("breath", 641, 700, LV["breath"], 0.3, None, period=6.0,
          curve=[(641, -10), (650, -1), (676, -1), (700, -12)])  # fmt: skip


def _threads(s: Score, seed: int) -> None:
    """Threads that run across the parts: Shepard falls and shooting stars."""
    # Shepard falls: six, where tension builds.
    SH = LV["shepard"]
    for at, dur, mode in ((100, 18, "glide"), (150, 10, "stepped"), (352, 12, "glide"),
                          (448, 12, "stepped"), (516, 16, "glide"), (618, 20, "glide")):  # fmt: skip
        s.add("shepard", at, at + dur, SH, 0.45, None, mode=mode)

    # Shooting stars.
    rng = np.random.default_rng(seed + 1)
    volley = [50.0, 51.3, 52.4, 54.0, 55.1, 57.3, 58.6]  # 0:50, as the Cold Open darkens
    singles = [130.6, 133.9, 291.0, 489.2, 491.1, 494.4, 520.6, 524.1]
    for k, at in enumerate(volley + singles):
        d = float(rng.uniform(0.5, 1.7))
        pf = float(rng.uniform(-0.9, -0.2)) * (1 if k % 2 else -1)
        lv = LV["streak"] + float(rng.uniform(-3, 0))
        lv += 4.0 if at > 400 else 0.0  # the Swarm's bed is fuller in the streaks' band
        s.add("streak", at, at + d, lv, 0.5, None, pan_from=pf, pan_to=-pf,
              f_from=float(rng.uniform(2300, 2800)), f_to=float(rng.uniform(1300, 1600)))  # fmt: skip


def _name(m: int) -> str:
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[m % 12]}{m // 12 - 1}"


# --- rendering -------------------------------------------------------------------------------


def render_events(events, w0: int, n: int, loop: bool) -> tuple[np.ndarray, np.ndarray]:
    """Mix events into (dry, send) stereo float32 buses covering samples [w0, w0 + n)."""
    dry = np.zeros((2, n), np.float32)
    send = np.zeros((2, n), np.float32)
    shifts = (-NT, 0, NT) if loop else (0,)
    for ev in events:
        s0 = round(ev.start * SR)
        L = round(ev.dur * SR)
        whole = None
        for sh in shifts:
            a = s0 + sh - w0
            lo, hi = max(a, 0), min(a + L, n)
            if lo >= hi:
                continue
            i0, i1 = lo - a, hi - a
            if ev.kind in WHOLE:
                if whole is None:
                    whole = WHOLE[ev.kind](ev, L)
                y = whole[:, i0:i1]
            else:
                y = RANGED[ev.kind](ev, i0, i1)
            t_abs = ev.start + np.arange(i0, i1) / SR
            g = np.full(len(t_abs), 10 ** (ev.gain_db / 20))
            if ev.part and loop:
                g *= part_gain(ev.part, t_abs)
            if "curve" in ev.p:
                g *= 10 ** (curve_db(ev.p["curve"], t_abs) / 20)
            if "swell" in ev.p:
                per, depth = ev.p["swell"]
                g *= 1 + depth * np.sin(2 * np.pi * t_abs / per)
            yg = y * g
            dry[:, lo:hi] += yg
            send[:, lo:hi] += ev.send * yg
    return dry, send


def master_gain_fn(tilt, topcut, period):
    lfp = None

    def fn(tc, freqs):
        nonlocal lfp
        if lfp is None:
            f = np.maximum(freqs, 1.0)
            lfp = (
                np.clip(np.log2(f / TILT_PIVOT), -3.0, 3.5),
                ramp(np.log2(f / 3000.0)),  # the top cut's band: 3 kHz -> 6 kHz and up
                1 / np.sqrt(1 + (30.0 / f) ** 8),  # 4th-order 30 Hz high-pass (magnitude)
            )
        oc, top, hpf = lfp
        g_db = curve_db(tilt, tc, period)[:, None] * oc[None, :]
        g_db += curve_db(topcut, tc, period)[:, None] * top[None, :]
        return 10 ** (g_db / 20) * hpf[None, :]

    return fn


def loudness_from_ms(ms: np.ndarray, frames_per_block: int, step: int) -> np.ndarray:
    """Block loudness (LUFS) from per-frame K-weighted mean square (summed over channels)."""
    c = np.concatenate([[0.0], np.cumsum(ms)])
    starts = np.arange(0, len(ms) - frames_per_block + 1, step)
    p = (c[starts + frames_per_block] - c[starts]) / frames_per_block
    return -0.691 + 10 * np.log10(p + 1e-20), p


def integrated_lufs(ms: np.ndarray, hop_s: float) -> float:
    fpb = round(0.4 / hop_s)
    lk, p = loudness_from_ms(ms, fpb, max(1, fpb // 4))
    p = p[lk > -70]
    rel = -0.691 + 10 * np.log10(p.mean()) - 10
    p = p[(-0.691 + 10 * np.log10(p)) > rel]
    return float(-0.691 + 10 * np.log10(p.mean()))


def limit(x: np.ndarray, ceiling_db: float = CEILING_DB, block: float = 0.004) -> np.ndarray:
    """Look-ahead block limiter: gain falls smoothly before any block that would pass the
    ceiling and recovers over a few blocks; it never raises the level."""
    c = 10 ** (ceiling_db / 20)
    B = int(block * SR)
    n = x.shape[1]
    nb = -(-n // B)
    pk = np.zeros(nb * B)
    pk[:n] = np.abs(x).max(0)
    pk = pk.reshape(nb, B).max(1)
    g = np.minimum(1.0, c / np.maximum(pk, 1e-9))
    r = 3
    gp = np.pad(g, r, mode="edge")
    gmin = np.min(np.stack([gp[k : k + nb] for k in range(2 * r + 1)]), axis=0)
    gs = np.convolve(np.pad(gmin, 2, mode="edge"), np.ones(5) / 5, "valid")
    centres = (np.arange(nb) + 0.5) * B
    return x * np.interp(np.arange(n), centres, gs).astype(np.float32)


def master(dry, send, ir, t0, loop, curves=(TILT, TOPCUT), stats=None):
    """Reverb, master EQ, leveller (looping render only), loudness normalisation and limiter.
    Returns float32 (2, n)."""
    n = dry.shape[1]
    mix = np.empty((2, n), np.float32)
    nf = stft_frames(n)
    st = {"ms": np.zeros(nf), "cnum": np.zeros(nf), "cden": np.zeros(nf)}
    fn = master_gain_fn(*curves, T_TOTAL if loop else None)
    for ch in range(2):
        wet = fft_convolve(send[ch].astype(np.float64), ir[ch], circular=loop)
        mix[ch] = stft_process(dry[ch].astype(np.float64) + wet, fn, t0=t0, circular=loop, stats=st)
    hop_s = 1024 / SR
    if loop:
        # Leveller: pull the 3 s loudness halfway toward the integrated level, smoothed over ~20 s.
        integ = integrated_lufs(st["ms"], hop_s)
        fpb = round(3.0 / hop_s)
        ms = np.concatenate([st["ms"][-fpb:], st["ms"], st["ms"][:fpb]]) if loop else st["ms"]
        lk, _ = loudness_from_ms(ms, fpb, 1)
        corr = np.clip((integ - lk) * 0.5, -4.0, 4.0)
        k = round(20.0 / hop_s)
        kern = ramp(np.linspace(0, 1, k // 2))
        kern = np.concatenate([kern, kern[::-1]])
        kern /= kern.sum()
        corr = np.convolve(np.pad(corr, k, mode="wrap" if loop else "edge"), kern, "same")[k:-k]
        ctimes = ((np.arange(len(corr)) + fpb / 2 - (fpb if loop else 0)) * 1024 - 2048) / SR
        gcurve = 10 ** (np.interp(np.arange(n) / SR, ctimes, corr) / 20)
        mix *= gcurve.astype(np.float32)
        st["ms"] *= np.interp((np.arange(nf) * 1024 - 2048) / SR, ctimes, 10 ** (corr / 10))
    integ = integrated_lufs(st["ms"], hop_s)
    mix *= np.float32(10 ** ((TARGET_LUFS - integ) / 20))
    st["ms"] *= 10 ** ((TARGET_LUFS - integ) / 10)
    if stats is not None:
        stats.update(st)
    return limit(mix)


_IR_CACHE: dict[int, np.ndarray] = {}


def ir_for(seed: int) -> np.ndarray:
    if seed not in _IR_CACHE:
        _IR_CACHE[seed] = reverb_ir(seed + 77)
    return _IR_CACHE[seed]


def render_track(t0: float = 0.0, t1: float = T_TOTAL, seed: int = SEED, stats=None):
    """Render the piece. The full span renders as a seamless loop (circular reverb and EQ,
    leveller, normalisation). A shorter window renders [t0, t1) with a 6 s pre-roll for the
    reverb and a fixed gain (for tests and quick looks)."""
    events = track_events(seed)
    if (t0, t1) == (0.0, T_TOTAL):
        dry, send = render_events(events, 0, NT, loop=True)
        return master(dry, send, ir_for(seed), 0.0, loop=True, stats=stats)
    pre = 6.0
    w0 = round((t0 - pre) * SR)
    n = round((t1 - t0 + pre) * SR)
    dry, send = render_events(events, w0, n, loop=True)
    out = master(dry, send, ir_for(seed), t0 - pre, loop=False)
    return out[:, int(pre * SR) :]


# --- standalone audition renders (variants) --------------------------------------------------


def organ_variant(voicing: str, seed: int = SEED) -> list[Ev]:
    """The same four chords (C minor, B-flat, F, C minor; 8 s each) in one organ voicing."""
    s = Score(seed + 500)
    chords = [(1.5, "C3 G3 C4 Eb4 G4 C5"), (9.5, "Bb2 F3 Bb3 D4 F4 Bb4"),
              (17.5, "F2 C3 F3 A3 C4 F4 A4"), (25.5, "C3 G3 C4 Eb4 G4 C5")]  # fmt: skip
    s.organ(chords, 32.0, voicing, LV["organ"], None, first_attack=1.5)
    s.add("air", 0, 34, LV["air2"], 0.3, None, lo=3000, hi=12000, swell=(9.0, 0.45), attack=2,
          release=3)  # fmt: skip
    return s.events


def shepard_variant(mode: str, fall: float, total: float, seed: int = SEED) -> list[Ev]:
    """A Shepard fall over a quiet F minor bed (+4 dB over its draft level, so it can be heard)."""
    s = Score(seed + 600)
    s.pad(0, total, "F2 C3 Ab3 C4", LV["pad"] - 4, None, attack=3, release=3, rolloff=1.7)
    s.add("shepard", 2.5, 2.5 + fall, LV["shepard"] + 4, 0.45, None, mode=mode)
    return s.events


def render_standalone(events, dur: float, seed: int = SEED, tilt=((0, 1.0), (1, 1.0))):
    n = round(dur * SR)
    dry, send = render_events(events, 0, n, loop=False)
    flat = ((0, 0.0), (1, 0.0))
    return master(dry, send, ir_for(seed), 0.0, loop=False, curves=(tilt, flat))


VARIANTS = {
    "organ-cathedral": (lambda: organ_variant("cathedral"), 34.0, ((0, 2.0), (1, 2.0))),
    "organ-flute": (lambda: organ_variant("flute"), 34.0, ((0, 2.0), (1, 2.0))),
    "organ-full": (lambda: organ_variant("full"), 34.0, ((0, 2.0), (1, 2.0))),
    "shepard-glide": (lambda: shepard_variant("glide", 16.0, 24.0), 24.0, ((0, -1.0), (1, -1.0))),
    "shepard-stepped": (
        lambda: shepard_variant("stepped", 12.0, 20.0),
        20.0,
        ((0, -1.0), (1, -1.0)),
    ),
}


# --- clips -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Clip:
    """kind: 'excerpt' (a..b s of the draft, wrapping past the end), 'variant' (a standalone
    render), or 'join' (other clips back to back with `gap` s of silence between)."""

    name: str
    kind: str
    listen: str
    a: float = 0.0
    b: float = 0.0
    fade_in: float = 0.5
    fade_out: float = 1.0
    variant: str = ""
    parts: tuple[str, ...] = ()
    gap: float = 1.5


def _ex(name, a, b, listen, fade_in=0.5):
    return Clip(name, "excerpt", listen, a=a, b=b, fade_in=fade_in)


def _var(name, variant, listen):
    return Clip(name, "variant", listen, variant=variant)


START_CLIP_SECONDS = 20.0
START_FADE_IN = 1.5

CLIPS_LIST = [
    _ex("00-draft-full", 0.0, T_TOTAL, "The whole rough draft, all four parts and threads.", 0.0),
    _ex(
        "01-cold-open-triumphant-to-dark",
        0.0,
        60.0,
        "Open C, bright and triumphant; about 0:45 the high E falls to E-flat and it darkens; "
        "the shooting-star volley at 0:50.",
    ),
    _ex(
        "02-dark-turn",
        95.0,
        135.0,
        "The dark turn at 1:40 (D half-diminished over the C pedal) with the first Shepard fall "
        "under it; two single streaks near the end.",
    ),
    _var(
        "03a-organ-cathedral",
        "organ-cathedral",
        "Organ A (the draft's voice): 16' 8' 4' 2 2/3' 2', ~0.9 Hz shimmer. "
        "C minor, B-flat, F, C minor.",
    ),
    _var(
        "03b-organ-flute",
        "organ-flute",
        "Organ B: soft flutes 8' 4' (2'), slower ~0.55 Hz shimmer. Same chords.",
    ),
    _var(
        "03c-organ-full",
        "organ-full",
        "Organ C: full drawbars to 1', brighter and reedier, faster ~1.35 Hz shimmer. Same chords.",
    ),
    _ex(
        "04-c-major-lift",
        256.0,
        292.0,
        "F major then the 4:30 lift into C major for ~15 s (brighter, airier), back to C minor.",
    ),
    _ex(
        "05a-chorus-1-full-swell",
        462.0,
        488.0,
        "Chorus 1: 5 s build, ~10 s swell, voices C#5, D#5, C#6 entering in turn, upper bands up.",
    ),
    _ex(
        "05b-chorus-2-low-dark",
        500.0,
        520.0,
        "Chorus 2: shorter, lower ('oo'), darker, a D-flat sub bump, little air.",
    ),
    _ex(
        "05c-chorus-3-bright-airy",
        528.0,
        552.0,
        "Chorus 3: brightest and airiest ('ee', an octave up, sparkle above 4 kHz).",
    ),
    Clip(
        "05-three-choruses",
        "join",
        "The three choruses back to back: hear the contrast.",
        parts=("05a-chorus-1-full-swell", "05b-chorus-2-low-dark", "05c-chorus-3-bright-airy"),
    ),
    _var(
        "06a-shepard-glide",
        "shepard-glide",
        "Shepard fall A: a continuous 16 s glide down (the draft uses this for most falls).",
    ),
    _var(
        "06b-shepard-stepped",
        "shepard-stepped",
        "Shepard fall B: 12 s of smooth semitone steps down, one every 0.6 s.",
    ),
    _ex("07-shooting-stars", 44.0, 68.0, "The 0:50 shooting-star volley over the darkening bed."),
    _ex(
        "08-shadows-stir",
        615.0,
        645.0,
        "Shadows: the top end drops away at 10:22, then something stirs (irregular darker "
        "bursts, a grainy rattle) over a long Shepard fall, then passes.",
    ),
    _ex(
        "09a-coldopen-to-cathedral",
        172.0,
        208.0,
        "Transition I -> II: F minor into the C minor organ (the plagal amen), 2:58-3:22.",
    ),
    _ex(
        "09b-cathedral-to-swarm",
        372.0,
        408.0,
        "Transition II -> III: the organ's A-flat pivot into open D-flat, chorus voices gathering.",
    ),
    _ex(
        "09c-swarm-to-shadows",
        551.0,
        587.0,
        "Transition III -> IV: C# and G# held while the G drone and the breathing rise.",
    ),
    _ex(
        "09d-loop-seam",
        T_TOTAL - 20.0,
        T_TOTAL + 20.0,
        "The loop seam: the last 20 s straight into the first 20 s (11:25 -> 0:20).",
    ),
]
CLIPS_LIST += [
    _ex(f"10-start-{k + 1}", sp, sp + START_CLIP_SECONDS,
        f"Starting point {k + 1} ({int(sp) // 60}:{int(sp) % 60:02d}) with the app's 1.5 s fade-in.",
        START_FADE_IN)
    for k, sp in enumerate(STARTING_POINTS)
]  # fmt: skip
CLIPS_LIST += [
    Clip("11a-contrast-organ", "join", "Organ A, B, C back to back.",
         parts=("03a-organ-cathedral", "03b-organ-flute", "03c-organ-full")),
    Clip("11b-contrast-shepard", "join", "Shepard glide then stepped, back to back.",
         parts=("06a-shepard-glide", "06b-shepard-stepped")),
]  # fmt: skip
CLIPS = {c.name: c for c in CLIPS_LIST}


def clip_seconds(name: str) -> float:
    c = CLIPS[name]
    if c.kind == "excerpt":
        return c.b - c.a
    if c.kind == "variant":
        return VARIANTS[c.variant][1]
    return sum(clip_seconds(p) for p in c.parts) + c.gap * (len(c.parts) - 1)


def fade_edges(x: np.ndarray, fin: float, fout: float) -> np.ndarray:
    x = x.copy()
    a, b = int(fin * SR), int(fout * SR)
    if a:
        x[:, :a] *= np.linspace(0, 1, a, dtype=np.float32)
    if b:
        x[:, -b:] *= np.linspace(1, 0, b, dtype=np.float32)
    return x


def excerpt(track: np.ndarray, a: float, b: float) -> np.ndarray:
    """Samples a..b s of a looping track; spans past the end wrap to the start."""
    i0 = round(a * SR)
    idx = np.arange(i0, i0 + round((b - a) * SR)) % track.shape[1]
    return track[:, idx]


def build_clip(name: str, draft: np.ndarray | None, cache: dict) -> np.ndarray:
    if name in cache:
        return cache[name]
    c = CLIPS[name]
    if c.kind == "excerpt":
        x = excerpt(draft, c.a, c.b)
        x = x if name == "00-draft-full" else fade_edges(x, c.fade_in, c.fade_out)
    elif c.kind == "variant":
        events_fn, dur, tilt = VARIANTS[c.variant]
        x = fade_edges(render_standalone(events_fn(), dur, tilt=tilt), 0.05, 1.0)
    else:
        gap = np.zeros((2, round(c.gap * SR)), np.float32)
        pieces = []
        for k, p in enumerate(c.parts):
            pieces += ([gap] if k else []) + [build_clip(p, draft, cache)]
        x = np.concatenate(pieces, axis=1)
    cache[name] = x
    return x


# --- output ----------------------------------------------------------------------------------


def to_pcm16(x: np.ndarray, seed: int = SEED) -> bytes:
    """Interleaved 16-bit PCM with seeded TPDF dither (deterministic)."""
    rng = np.random.default_rng(seed)
    d = (rng.random(x.shape) - rng.random(x.shape)).astype(np.float32)
    y = np.clip(np.round(x * 32767 + d), -32768, 32767).astype("<i2")
    return y.T.tobytes()


def write_mp3(x: np.ndarray, path: Path, quality: int = 4) -> None:
    """Stereo MP3 (libmp3lame VBR -q:a quality, 44.1 kHz), no metadata."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ac", "2", "-ar", str(SR), "-i", "-"]
    cmd += ["-c:a", "libmp3lame", "-q:a", str(quality), "-map_metadata", "-1", str(path)]
    subprocess.run(cmd, input=to_pcm16(x), check=True)


def _mmss(sec: float) -> str:
    return f"{int(sec) // 60}:{sec % 60:04.1f}"


def write_index(out_dir: Path) -> None:
    lines = [
        "# Star Swarm music: audition clips (#3636)",
        "",
        (
            "Synthesized from scratch by `tools/assets/synth_starswarm_bgm.py` (seed "
            f"{SEED}). Rough draft, not the final render. Design log: "
            "`docs/games/starswarm-music-design.md`."
        ),
        "",
        "| File | Length | Size | What to listen for |",
        "| --- | --- | --- | --- |",
    ]
    for c in CLIPS_LIST:
        f = out_dir / f"{c.name}.mp3"
        size = f"{f.stat().st_size / 1e6:.2f} MB" if f.exists() else "not rendered"
        lines.append(f"| {f.name} | {_mmss(clip_seconds(c.name))} | {size} | {c.listen} |")
    lines += ["", "Starting points (s): " + ", ".join(f"{s:g}" for s in STARTING_POINTS), ""]
    (out_dir / "index.md").write_text("\n".join(lines))


def main(out_dir: Path, names: list[str]) -> None:
    unknown = [n for n in names if n not in CLIPS]
    if unknown:
        sys.exit(f"unknown clip(s): {', '.join(unknown)}; known: {', '.join(CLIPS)}")
    names = names or list(CLIPS)
    out_dir.mkdir(parents=True, exist_ok=True)

    def needs_draft(n):
        c = CLIPS[n]
        return c.kind == "excerpt" or any(needs_draft(p) for p in c.parts)

    draft = None
    if any(needs_draft(n) for n in names):
        t = time.time()
        draft = render_track()
        print(f"rendered the draft in {time.time() - t:.0f} s", flush=True)
    cache: dict = {}
    for n in names:
        write_mp3(build_clip(n, draft, cache), out_dir / f"{n}.mp3")
        print(f"wrote {n}.mp3 ({clip_seconds(n):.1f} s)", flush=True)
    write_index(out_dir)


if __name__ == "__main__":
    args = sys.argv[1:]
    main(Path(args[0]) if args else OUT_DEFAULT, args[1:])
