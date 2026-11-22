"""The arrangement: where each signature sound plays over the bed (Rounds 45 and 46, owner-approved).

The track was built in three stages, and the build keeps them because the approved sound depends on
them (each stage reached the next as an MP3, and those encodes are part of what shipped):

1. Bed: the 420 s Round 44 foundation (`bed.py`), saved as MP3.
2. Intro (Round 45): the first 120 s of the bed with four signatures (`INTRO_CUES`), saved as MP3.
3. Full mix (Round 46): the bed again, with the intro's first 120 s laid over it (a 0.7 s blend back
   into the bed at 2:00) and nine more signatures after it (`MAIN_CUES`), saved as MP3.

`make_starswarm_bgm_loop.py` then turns the full mix into the game track (fades trimmed, seam, gain).

A cue places a window of a layer's phrase on the timeline: it fades in and out, and while it plays
the music under it is ducked by `duck` (a fraction) so the signature has room. Times are seconds in
the full mix (the game track is 5.5 s earlier: see docs/games/starswarm-music-design.md).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import resample_poly

from . import bed, choirs, organ, rise, robots, shepard
from .common import SR, decode_mp3, ease, encode_mp3_f32, encode_mp3_pcm16_wav

DUR = 420  # s, the full mix
INTRO_DUR = 120  # s, the Round 45 intro
INTRO_BLEND = 0.7  # s, the intro hands back to the plain bed over this long, ending at 2:00
INTRO_PEAK = 0.83  # the intro's safety ceiling (it peaked lower, so its gain is 1)
MIX_PEAK = 0.91  # the full mix's safety ceiling (likewise unused: gain 1)

# Layer name -> renderer. Each returns its phrase as float32 (2, n).
LAYERS = {
    "rise": rise.render,
    "robots": robots.render,
    "gathering": lambda: choirs.render("gathering"),
    "electromagnetic": lambda: choirs.render("electromagnetic"),
    "organ": organ.render,
}

# Pitch shifts are polyphase resamples: output/input length ratios (up, down) for resample_poly.
# A ratio below 1 shortens the phrase, so it plays higher and faster.
PITCH_RATIOS = {1.06: (50, 53), 0.94: (50, 47), 1.04: (25, 26), 0.96: (25, 24)}


@dataclass(frozen=True)
class Cue:
    label: str
    layer: str  # a LAYERS key
    source_at: float  # s into the layer's phrase where the window starts
    at: float  # s on the timeline
    secs: float  # window length
    level: float  # gain on the layer
    duck: float  # how far the music underneath dips (0-1) while the cue plays
    fade_in: float = 2.0
    fade_out: float = 2.8
    pitch: float = 1.0  # a PITCH_RATIOS key, or 1.0


@dataclass(frozen=True)
class ShepardCue:
    at: float
    secs: float
    amp: float
    rate: float  # octaves per second of descent
    base: float  # Hz
    duck: float
    label: str = "audible descending Shepard"


# Round 45: the first two minutes. Every signature has 14-16 s of plain bed before the next one.
INTRO_CUES = [
    Cue("astronomical rise", "rise", 9, 10, 17, 0.75, 0.24, 2.2, 3.2),
    Cue("varied robotic signals", "robots", 13, 42, 18, 0.76, 0.22, 1.5, 2.6),
    Cue("gathering swarm chorus", "gathering", 11, 76, 17, 0.64, 0.27, 2.3, 3.0),
    Cue("electromagnetic choir", "electromagnetic", 17, 109, 10, 0.73, 0.24, 1.2, 2.6),
]

# Round 46: after the intro. At least 15 s between featured windows; no rise beside a Shepard.
# The order matters (the mix is a running float sum), so keep cues in time order.
MAIN_CUES = [
    ShepardCue(136, 13, amp=0.029, rate=0.125, base=245, duck=0.35),
    Cue("distant organ color", "organ", 14, 166, 15, 0.65, 0.12, 3.5, 4.0),
    Cue(
        "robotic signals - altered call sequence",
        "robots",
        18,
        198,
        16,
        0.71,
        0.19,
        2.0,
        3.2,
        pitch=1.06,
    ),
    Cue(
        "astronomical rise - second higher arc",
        "rise",
        11,
        233,
        17,
        0.69,
        0.25,
        2.4,
        3.4,
        pitch=1.04,
    ),
    Cue(
        "gathering swarm - darker reprise",
        "gathering",
        16,
        266,
        16,
        0.66,
        0.27,
        2.5,
        3.0,
        pitch=0.94,
    ),
    Cue(
        "electromagnetic choir - changed register",
        "electromagnetic",
        13,
        300,
        15,
        0.73,
        0.24,
        2.4,
        3.3,
        pitch=1.06,
    ),
    ShepardCue(333, 14, amp=0.029, rate=0.11, base=215, duck=0.35),
    Cue(
        "robotic signals - final fragmented dialogue",
        "robots",
        20,
        364,
        15,
        0.70,
        0.20,
        1.8,
        2.8,
        pitch=0.96,
    ),
    Cue(
        "gathering swarm - shorter return",
        "gathering",
        19,
        394,
        13,
        0.62,
        0.24,
        2.7,
        3.2,
        pitch=1.06,
    ),
    # The last ~13 s are bed only: no final impact or cadence.
]


def place(out: np.ndarray, cue: Cue, phrase: np.ndarray) -> None:
    """Mix one cue into `out` (float64 (2, n)) in place."""
    n_out = out.shape[1]
    i = round(cue.at * SR)
    j = min(n_out, i + round(cue.secs * SR))
    n = j - i
    source = phrase[:, round(cue.source_at * SR) :]
    if cue.pitch != 1.0:
        up, down = PITCH_RATIOS[cue.pitch]
        source = resample_poly(source, up, down, axis=1)
    assert source.shape[1] >= n, (cue.label, source.shape, n)
    s = source[:, :n].astype(np.float64).copy()
    t = np.arange(n, dtype=np.float64) / SR
    w = ease(t / cue.fade_in) * ease((cue.secs - t) / cue.fade_out)
    out[:, i:j] *= (1 - cue.duck * w)[None, :]
    out[:, i:j] += cue.level * s * w[None, :]


def place_shepard(out: np.ndarray, cue: ShepardCue) -> None:
    i = round(cue.at * SR)
    j = round((cue.at + cue.secs) * SR)
    layer, env = shepard.render(cue.secs, cue.rate, cue.base, n=j - i)
    out[:, i:j] *= (1 - cue.duck * env)[None, :]
    out[:, i:j] += cue.amp * layer * env[None, :]


def safety_gain(ceiling: float, *signals: np.ndarray) -> float:
    """A single global scale applied only if a peak would pass `ceiling` (never per section)."""
    peak = max(float(np.max(np.abs(x))) for x in signals)
    return min(1.0, ceiling / peak)


def mix_intro(bed_audio: np.ndarray, phrases: dict[str, np.ndarray]) -> np.ndarray:
    """Stage 2 before its MP3 encode: the first INTRO_DUR s of the bed with the intro cues, float64."""
    n = INTRO_DUR * SR
    intro_bed = bed_audio[:, :n]
    intro = intro_bed.astype(np.float64).copy()
    for cue in INTRO_CUES:
        place(intro, cue, phrases[cue.layer])
    return intro * safety_gain(INTRO_PEAK, intro_bed, intro)


def mix_full(
    bed_audio: np.ndarray, intro_audio: np.ndarray, phrases: dict[str, np.ndarray]
) -> np.ndarray:
    """Stage 3 before its MP3 encode: the full mix, float64 (2, DUR * SR)."""
    n = DUR * SR
    full_bed = bed_audio[:, :n]
    assert full_bed.shape == (2, n)
    out = full_bed.astype(np.float64).copy()
    blend = int(INTRO_BLEND * SR)
    boundary = INTRO_DUR * SR
    out[:, : boundary - blend] = intro_audio[:, : boundary - blend]
    weight = ease(np.linspace(0, 1, blend, endpoint=False))
    out[:, boundary - blend : boundary] = (
        intro_audio[:, boundary - blend : boundary] * (1 - weight)[None, :]
        + full_bed[:, boundary - blend : boundary] * weight[None, :]
    )
    for cue in MAIN_CUES:
        if isinstance(cue, ShepardCue):
            place_shepard(out, cue)
        else:
            place(out, cue, phrases[cue.layer])
    out *= safety_gain(MIX_PEAK, out, full_bed)
    return out


@dataclass
class Stages:
    """Everything `build_stages` renders.

    `bed_pcm`, `phrases` and `dry_mix` are the encoder-free stages: pure numpy/scipy arithmetic
    that no MP3 encoder touches. `dry_mix` is the arrangement laid over the un-encoded bed (the
    real mix lays it over the bed after an MP3 round trip), so it pins every cue's level, window,
    duck, fade and pitch without depending on libmp3lame. Nothing here changes the shipped audio.
    """

    bed_pcm: np.ndarray  # float32 (n, 2), what the bed's WAV/MP3 encode receives
    phrases: dict[str, np.ndarray]  # float32 (2, n) per layer
    dry_mix: np.ndarray | None  # float64 (2, DUR * SR); None unless asked for
    mp3: dict[str, bytes]  # {"bed", "intro", "mix"}


def build_stages(log=print, dry: bool = True) -> Stages:
    bed_pcm = bed.render(log)
    bed_mp3 = encode_mp3_pcm16_wav(bed_pcm)
    bed_audio = decode_mp3(bed_mp3)
    phrases = {name: render() for name, render in LAYERS.items()}
    log("layers: " + ", ".join(f"{k} {v.shape[1] / SR:.0f} s" for k, v in phrases.items()))

    # Stage 2: the intro.
    intro_mp3 = encode_mp3_f32(mix_intro(bed_audio, phrases))
    intro_audio = decode_mp3(intro_mp3)[:, : INTRO_DUR * SR]
    assert intro_audio.shape == (2, INTRO_DUR * SR)

    # Stage 3: the full mix.
    mix_mp3 = encode_mp3_f32(mix_full(bed_audio, intro_audio, phrases))
    log("full mix rendered")

    # The encoder-free twin of stages 2 and 3, for the reproducibility fingerprint.
    dry_mix = None
    if dry:
        dry_bed = np.ascontiguousarray(bed_pcm.T)
        dry_mix = mix_full(dry_bed, mix_intro(dry_bed, phrases), phrases)
    return Stages(bed_pcm, phrases, dry_mix, {"bed": bed_mp3, "intro": intro_mp3, "mix": mix_mp3})


def build(log=print) -> dict[str, bytes]:
    """Render the three stages. Returns their MP3s: {"bed", "intro", "mix"}."""
    return build_stages(log, dry=False).mp3


def cue_sheet() -> list[dict]:
    """The timeline as plain data (what `round46_cues.json` recorded), for docs and auditions."""
    rows = [{"name": "Round 45 intro", "start": 0, "end": INTRO_DUR}]
    rows += [{"name": c.label, "start": c.at, "end": round(c.at + c.secs, 2)} for c in INTRO_CUES]
    rows += [{"name": c.label, "start": c.at, "end": round(c.at + c.secs, 2)} for c in MAIN_CUES]
    return rows
