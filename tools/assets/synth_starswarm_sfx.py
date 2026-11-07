"""Synthesize Star Swarm sound effects (no samples, no third-party audio). #3560

Every sound is built from oscillators, noise, envelopes and filters, so the set shares one
palette. Each recipe is the one the owner approved after a gameplay audition. Writes into
frontend/assets/sounds/:

- starswarm-beamcharge.ogg  0.60 s "reactor" charge-up: a low buzz that brightens and
  climbs ~0.6 octave while a pulse speeds up 3 -> 12 Hz. It must end exactly as the beam
  fires, so its length is tied to BEAM_CHARGE_MS (600) in engine/tuning.ts.
- starswarm-beamfire.ogg    0.90 s plasma blast: a detuned saw chord diving together,
  ring-modulated, with a sub thump and a short echo. The dive takes ~0.5 s (the bolt
  crosses the lane in ~0.4 s); the rest is ring-out, which does not affect gameplay.
- starswarm-attackrun.ogg   Carrier attack-run brace: a 0.80 s "throttle-up" (ATTACK_RUN_BRACE_MS
  = 800), a rounded engine climbing an octave (52 -> 104 Hz, sine harmonics for small speakers)
  while a gentle throb speeds up (10 -> 24 Hz) and a dark rumble opens up, then a roar-away
  tail that dips and fades as the Carrier swoops. Rumble/engine-led so it never reads as the
  buzzy beam charge.

Noise uses a fixed seed per sound, so every run is byte-for-byte reproducible.

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_starswarm_sfx.py [out_dir] [sound ...]
- starswarm-bosswave.ogg    1.50 s boss-wave sting (boss wave sighted and Carrier final stand):
  "ominous horn", a slow two-note synth-brass horn, "dun... DUN", stepping down a semitone
  (110 -> 103.8 Hz), with a sub thump under the second note and a little of the beam charge's
  reactor buzz underneath, so the sting introduces the Carrier's voice.
- starswarm-reinforce.ogg   1.35 s Carrier reinforcements: the airlock door (soft latch and a
  pressure "pfft"), then one smooth turbine spin-up (110 -> 230 Hz, dark roar opening up) that
  fades as the Grunts fly into formation. One continuous engine, not one whoosh per ship.

With no sound names, every sound is written. Names: beamcharge, beamfire, attackrun, bosswave,
reinforce.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def phase(freq: np.ndarray) -> np.ndarray:
    """Integrate an instantaneous-frequency array (Hz) into phase (radians)."""
    return 2 * np.pi * np.cumsum(freq) / SR


def saw(ph: np.ndarray) -> np.ndarray:
    return 2 * ((ph / (2 * np.pi)) % 1.0) - 1


def square(ph: np.ndarray, duty: float = 0.5) -> np.ndarray:
    return np.where((ph / (2 * np.pi)) % 1.0 < duty, 1.0, -1.0)


def lowpass(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    """One-pole lowpass; cutoff may be a scalar or a per-sample array (Hz)."""
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def env_ad(n: int, attack: float, decay_shape: float) -> np.ndarray:
    """Linear attack (seconds), then a power-curve decay to 0 at the end."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] = np.linspace(0, 1, a)
    e[a:] = np.linspace(1, 0, n - a) ** decay_shape
    return e


def fade(x: np.ndarray, fin: float = 0.004, fout: float = 0.01) -> np.ndarray:
    x = x.copy()
    a, b = int(fin * SR), int(fout * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def echo(x: np.ndarray, taps=((0.045, 0.35), (0.09, 0.2), (0.15, 0.1))) -> np.ndarray:
    """A few short delay taps: cheap 'space' without a reverb engine."""
    y = x.copy()
    for delay, gain in taps:
        k = int(delay * SR)
        y[k:] += gain * x[:-k]
    return y


def norm(x: np.ndarray, peak_db: float) -> np.ndarray:
    return x / (np.max(np.abs(x)) + 1e-12) * 10 ** (peak_db / 20)


def beam_charge(
    dur: float = 0.60, pulse_from: float = 3.0, pulse_to: float = 12.0, octaves: float = 0.6
) -> np.ndarray:
    """Reactor charge-up: low buzz that brightens and climbs, pulse train speeding up."""
    t = t_axis(dur)
    p = t / t[-1]
    f = 55 * 2 ** (octaves * p**1.2)
    buzz = square(phase(f), 0.3) + 0.6 * saw(phase(f * 1.005))
    buzz = lowpass(buzz, 200 + 3800 * p**2.2)
    sub = np.sin(phase(f / 2))
    rate = pulse_from + (pulse_to - pulse_from) * p**1.5
    pulse = lowpass(0.5 + 0.5 * np.sign(np.sin(phase(rate))), 120)  # softened gate
    x = (0.7 * buzz + 0.5 * sub) * (0.45 + 0.55 * pulse)
    x *= 0.3 + 0.7 * p
    return fade(x)


def beam_fire(dur: float = 0.90) -> np.ndarray:
    """Plasma blast. The dive keeps its 0.5 s speed; a longer dur only lets it ring out."""
    t = t_axis(dur)
    p = t / 0.50
    base = 110 + 700 * np.exp(-p * 4.5)
    chord = sum(saw(phase(base * r)) for r in (1.0, 1.007, 1.498, 2.003))
    ring = np.sin(phase(np.full_like(t, 63)))
    x = chord * (0.6 + 0.4 * ring)
    x = lowpass(x, 6000 * np.exp(-p * 2.5) + 400)
    sub = np.sin(phase(55 + 60 * np.exp(-t / 0.04))) * np.exp(-t / 0.2)
    x = (0.5 * x + 0.8 * sub) * env_ad(len(t), 0.003, 1.8)
    return fade(echo(x), 0.0, 0.03)


def lp2(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    """Two passes of the one-pole lowpass: a gentler, darker 12 dB/oct slope."""
    return lowpass(lowpass(x, cutoff), cutoff)


def highpass(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    return x - lowpass(x, cutoff)


def warm_engine(f: np.ndarray, bright: float | np.ndarray) -> np.ndarray:
    """Rounded engine tone: sine + octave-down sine + a little darkened saw for body."""
    tone = np.sin(phase(f)) + 0.6 * np.sin(phase(f / 2)) + 0.25 * np.sin(phase(f * 2.003))
    return tone + 0.35 * lp2(saw(phase(f * 1.004)), bright)


def throb(rate: np.ndarray, depth: float) -> np.ndarray:
    """Engine amplitude throb; rate (Hz) may vary per sample."""
    return 1 - depth * (0.5 + 0.5 * np.sin(phase(rate)))


def attack_run(tail: float = 0.50, presence: float = 1.0) -> np.ndarray:
    """Throttle-up brace (0.80 s) plus a roar-away tail as the Carrier dives.

    The brace part is sized to ATTACK_RUN_BRACE_MS; the tail overlaps the swoop (~3 s), so its
    length has no gameplay effect. The engine sits at 52 -> 104 Hz with sine harmonics up to
    ~400 Hz so it still reads on phone speakers, which barely reproduce anything under 100 Hz.
    """
    rng = np.random.default_rng(3560)
    brace = 0.80
    t = t_axis(brace + tail)
    pb = np.clip(t / brace, 0, 1)  # brace progress
    pt = np.clip((t - brace) / tail, 0, 1) if tail > 0 else np.zeros_like(t)  # tail progress
    f = 52 * 2 ** (pb**1.4) * (1 - 0.3 * pt)  # climb an octave, then dip as it dives away
    harm = presence * (0.45 * np.sin(phase(f * 2)) + 0.25 * np.sin(phase(f * 3.01)))
    harm += presence * 0.12 * np.sin(phase(f * 4.02))
    bright = 260 + 900 * pb**2 - 500 * pt
    rumble = lp2(highpass(rng.standard_normal(len(t)), 35), 180 + 800 * pb**2 - 550 * pt)
    x = warm_engine(f, bright) + harm + (0.6 + 0.8 * pb) * rumble
    x *= throb(10 + 14 * pb**1.3, 0.3 * (1 - pt))  # throb fades as it becomes a roar
    x *= (0.65 + 0.35 * pb**0.7) * (1 - pt) ** 1.6  # starts at ~2/3 level, tail fades out
    return fade(np.tanh(0.9 * x) / np.tanh(0.9), 0.01, 0.03)


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def place(dst: np.ndarray, src: np.ndarray, at: float) -> None:
    """Mix src into dst starting at `at` seconds (clipped to dst's length)."""
    k = int(at * SR)
    end = min(len(dst), k + len(src))
    dst[k:end] += src[: end - k]


def clunk(dur: float, f0: float, f1: float, seed: int) -> np.ndarray:
    """A short mechanical knock: a falling sine thud plus a filtered click."""
    t = t_axis(dur)
    body = np.sin(phase(f1 + (f0 - f1) * np.exp(-t / 0.02))) * np.exp(-t / 0.035)
    click = lp2(highpass(noise(len(t), seed), 300), 2500) * np.exp(-t / 0.01) * 0.6
    return body + click


def hiss(dur: float, lo: float, hi: float, seed: int, decay: float) -> np.ndarray:
    """A burst of band-limited air (lo..hi Hz) with a fast attack and exponential decay."""
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    return x * (1 - np.exp(-t / 0.01)) * np.exp(-t / decay)


def brass(f: float, dur: float, attack: float, decay: float) -> np.ndarray:
    """Synth brass: detuned saws through a filter that opens on the attack, then closes."""
    t = t_axis(dur)
    tone = sum(saw(phase(np.full_like(t, f * r))) for r in (1.0, 1.006, 0.995, 2.003))
    cut = 350 + 1850 * np.exp(-t / decay) * np.clip(t / attack, 0, 1)
    x = lp2(tone, cut) + 0.8 * np.sin(phase(np.full_like(t, f / 2)))
    return x * np.clip(t / attack, 0, 1) * (0.55 + 0.45 * np.exp(-t / (decay * 2)))


def boom(dur: float, seed: int) -> np.ndarray:
    """A sub thump with a short dark rumble."""
    t = t_axis(dur)
    sub = np.sin(phase(45 + 70 * np.exp(-t / 0.05))) * np.exp(-t / 0.22)
    return sub + lp2(noise(len(t), seed), 300) * np.exp(-t / 0.15) * 0.6


def boss_wave() -> np.ndarray:
    """Ominous horn: 'dun... DUN' down a semitone, thump under the second note."""
    x = np.zeros(int(1.5 * SR))
    place(x, brass(110, 0.55, attack=0.05, decay=0.3) * 0.75, 0.0)
    place(x, brass(103.8, 0.9, attack=0.04, decay=0.45), 0.55)
    place(x, boom(0.7, seed=50), 0.55)
    place(x, beam_charge(1.4, pulse_from=4, pulse_to=4, octaves=0.0) * 0.18, 0.05)  # reactor bed
    x = echo(x, ((0.11, 0.25), (0.23, 0.12)))
    return fade(np.tanh(0.9 * x) / np.tanh(0.9), 0.005, 0.12)


def thruster(
    dur: float, f0: float, f1: float, cut0: float, cut1: float, seed: int, swell: float
) -> np.ndarray:
    """One smooth engine/thruster: dark filtered roar + rounded engine tone, swell then fade."""
    t = t_axis(dur)
    p = t / t[-1]
    f = f0 + (f1 - f0) * p
    cut = cut0 + (cut1 - cut0) * p
    burn = lp2(highpass(noise(len(t), seed), 120), cut)
    eng = warm_engine(f, 500 + 0.5 * cut) + 0.3 * np.sin(phase(f * 3.01))
    amp = np.clip(t / (dur * swell), 0, 1) ** 0.8 * (1 - np.clip((p - 0.55) / 0.45, 0, 1)) ** 1.4
    return (0.6 * burn + 0.9 * eng) * amp


def reinforce() -> np.ndarray:
    """Airlock door (latch + 'pfft'), then one turbine spin-up as the Grunts launch."""
    x = np.zeros(int(1.35 * SR))
    place(x, clunk(0.08, 160, 90, seed=7) * 0.7, 0.0)
    place(x, hiss(0.22, lo=1200, hi=6000, seed=8, decay=0.06) * 1.1, 0.04)
    place(x, thruster(1.05, 110, 230, 600, 1500, seed=62, swell=0.4), 0.18)
    return fade(x, 0.003, 0.06)


def write_ogg(x: np.ndarray, path: Path) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", str(SR)]
    cmd += ["-i", "-", "-c:a", "libvorbis", "-q:a", "5", "-map_metadata", "-1", str(path)]
    subprocess.run(cmd, input=pcm, check=True)


# name -> (recipe, peak dBFS)
SOUNDS = {
    "beamcharge": (beam_charge, -1.5),
    "beamfire": (beam_fire, -1.0),
    "attackrun": (attack_run, -1.5),
    "bosswave": (boss_wave, -1.0),
    "reinforce": (reinforce, -1.0),
}


def main(out_dir: Path, names: list[str]) -> None:
    for name in names or list(SOUNDS):
        recipe, peak = SOUNDS[name]
        write_ogg(norm(recipe(), peak), out_dir / f"starswarm-{name}.ogg")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(Path(args[0]) if args else OUT_DEFAULT, args[1:])
