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

- starswarm-rout-loop.ogg   2.00 s seamless loop for the grunt rout (plays while any Grunt flees):
  "panic warble", one engine at ~165 Hz with a fast nervous 6 Hz vibrato and a 3 Hz tremolo
  over a dark roar. Every modulation completes whole cycles in the loop, and the tail is
  equal-power crossfaded into the head, so it repeats without a click.

- starswarm-pickup.ogg      0.42 s pickup (every ordinary power-up, salvage crate and hull plating):
  "warm mallet", two soft mallet notes rising a fifth (C5 -> G5) with a faint shimmer an octave
  up. Short and soft-edged, because it plays all game long.

- Shield ("force field", #3560): starswarm-shield-on.ogg (0.40 s rising shimmer, the loudest
  part), starswarm-shield-loop.ogg (2.0 s seamless soft two-tone hum, 220/330/440 Hz),
  starswarm-shield-warn.ogg (0.70 s stutter about 1 s before the shield ends) and
  starswarm-shield-off.ogg (0.45 s falling sweep).
- Buddy ("hover drone", #3560): starswarm-buddy-in.ogg (0.55 s soft thruster whoosh in),
  starswarm-buddy-loop.ogg (2.0 s quiet hover warble, quieter than the shield),
  starswarm-buddy-out.ogg (0.75 s fly-by fade out) and starswarm-buddy-down.ogg (0.90 s three
  sad descending blips E5-C5-G4 then a soft pop).
- starswarm-bombblast.ogg   1.50 s Smart Bomb "shockwave": a sub boom plus an expanding
  'whumm' as a noise band opens and closes.
- starswarm-lightning-loop.ogg 2.0 s seamless "Tesla-coil buzz" while Lightning is active: a
  buzzing 120 Hz saw arc with a 30 Hz flutter and fixed-position crackles.

With no sound names, every sound is written. Names: beamcharge, beamfire, attackrun, bosswave,
reinforce, rout-loop, pickup, shield-on, shield-loop, shield-warn, shield-off, buddy-in,
buddy-loop, buddy-out, buddy-down, bombblast, lightning-loop.
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


def loopify(x: np.ndarray, xfade: float = 0.15) -> np.ndarray:
    """Equal-power crossfade of the last `xfade` s into the head, so the result loops cleanly."""
    n = int(xfade * SR)
    ramp = np.linspace(0, np.pi / 2, n)
    out = x[:-n].copy()
    out[:n] = x[:n] * np.sin(ramp) + x[-n:] * np.cos(ramp)
    return out


def lfo(t: np.ndarray, rate: float) -> np.ndarray:
    return np.sin(2 * np.pi * rate * t)


def rout_loop(length: float = 2.0) -> np.ndarray:
    """Panic warble: one engine with a fast nervous vibrato and tremolo over a dark roar.

    LFO rates (6 Hz, 3 Hz) are whole multiples of 1/length, so the loop point is phase-continuous.
    """
    t = t_axis(length + 0.15)  # + the crossfade that loopify folds back into the head
    f = 165 * (1 + 0.06 * lfo(t, 6.0))
    eng = warm_engine(f, 900) + 0.35 * np.sin(phase(f * 2.99))
    roar = lp2(highpass(noise(len(t), 72), 120), 1000)
    x = (0.8 * eng + 0.7 * roar) * (0.78 + 0.22 * lfo(t, 3.0))
    return loopify(x)


def bell(f: float, dur: float, decay: float) -> np.ndarray:
    """A soft pure bell tone: one sine with a 4 ms attack and an exponential decay."""
    t = t_axis(dur)
    return np.sin(phase(np.full_like(t, f))) * np.exp(-t / decay) * np.clip(t / 0.004, 0, 1)


def mallet(f: float, dur: float, decay: float) -> np.ndarray:
    """Warm mallet (marimba-like): fundamental, a quiet 2nd and a quick 4th harmonic."""
    t = t_axis(dur)
    x = np.sin(phase(np.full_like(t, f))) * np.exp(-t / decay)
    x += 0.35 * np.sin(phase(np.full_like(t, f * 4))) * np.exp(-t / (decay * 0.3))
    x += 0.15 * np.sin(phase(np.full_like(t, f * 2.01))) * np.exp(-t / (decay * 0.6))
    return x * np.clip(t / 0.006, 0, 1)


def pickup() -> np.ndarray:
    """Two soft mallet notes rising a fifth (C5 -> G5) with a faint shimmer."""
    x = np.zeros(int(0.42 * SR))
    place(x, mallet(523.25, 0.4, 0.14) * 0.8, 0.0)
    place(x, mallet(783.99, 0.35, 0.16), 0.075)
    place(x, bell(1567.98, 0.3, 0.12 / 1.6) * 0.12, 0.075)  # shimmer an octave above, ~75 ms decay
    return fade(x, 0.0, 0.04)


# ---------------------------------------------------------------------------
# Power-ups (#3560): shield, Buddy, Smart Bomb, Lightning
# ---------------------------------------------------------------------------

LOOP = 2.0  # power-up loop length (s); every LFO rate is a multiple of 1 / LOOP


def sine(f: float | np.ndarray, t: np.ndarray) -> np.ndarray:
    return np.sin(phase(np.broadcast_to(np.asarray(f, float), t.shape).copy()))


def env(t: np.ndarray, attack: float, decay: float) -> np.ndarray:
    """Linear attack, then exponential decay."""
    return np.clip(t / attack, 0, 1) * np.exp(-np.clip(t - attack, 0, None) / decay)


def loop_of(fn) -> np.ndarray:
    """Render fn(t) over LOOP + the crossfade, then fold the seam with loopify."""
    return loopify(fn(t_axis(LOOP + 0.15)))


def shield_on() -> np.ndarray:
    """Rising shimmer: 300 -> 900 Hz with a fifth above and a soft air burst."""
    t = t_axis(0.4)
    f = 300 * 3 ** np.clip(t / 0.25, 0, 1)
    air = 0.6 * lp2(highpass(noise(len(t), 1), 800), 3000)
    return (sine(f, t) + 0.5 * sine(f * 1.5, t) + air) * env(t, 0.02, 0.12)


def shield_loop() -> np.ndarray:
    """Soft, dull two-tone hum with a gentle 2 Hz shimmer."""

    def f(t):
        tone = sine(220, t) + 0.6 * sine(330.0, t) + 0.25 * sine(440.0, t)
        return lp2(tone, 900) * (0.8 + 0.2 * lfo(t, 2.0))

    return loop_of(f)


def shield_warn() -> np.ndarray:
    """A stutter, like a failing field: the tone gated on and off every 120 ms."""
    t = t_axis(0.7)
    gate = np.where((t % 0.12) < 0.06, 1.0, 0.25)
    return lp2(sine(330, t) + 0.5 * sine(495, t), 1500) * lp2(gate, 60) * env(t, 0.01, 0.4)


def shield_off() -> np.ndarray:
    """Falling sweep 900 -> 200 Hz with a soft puff."""
    t = t_axis(0.45)
    f = 900 * (200 / 900) ** np.clip(t / 0.35, 0, 1)
    return (sine(f, t) + 0.4 * lp2(highpass(noise(len(t), 2), 300), 1500)) * env(t, 0.005, 0.15)


def thrust(dur, f0, f1, cut0, cut1, seed, rise=0.35) -> np.ndarray:
    """A short thruster: dark roar + rounded engine, swelling in and fading out."""
    t = t_axis(dur)
    p = t / t[-1]
    f = f0 + (f1 - f0) * p
    roar = lp2(highpass(noise(len(t), seed), 150), cut0 + (cut1 - cut0) * p)
    eng = warm_engine(f, 900) * 0.6
    a = np.clip(p / rise, 0, 1) * (1 - np.clip((p - 0.6) / 0.4, 0, 1)) ** 1.3
    return (roar + eng) * a


def buddy_in() -> np.ndarray:
    """Soft thruster whoosh in (300 -> 360 Hz)."""
    return thrust(0.55, 300, 360, 600, 1800, 13, rise=0.5) * 0.9


def buddy_loop() -> np.ndarray:
    """Quiet hover warble: 300 Hz with a 3 Hz wobble and a 1.5 Hz swell."""

    def f(t):
        tone = sine(300 * (1 + 0.015 * lfo(t, 3.0)), t) + 0.4 * sine(600, t)
        return lp2(tone, 1200) * (0.8 + 0.2 * lfo(t, 1.5))

    return loop_of(f)


def buddy_out() -> np.ndarray:
    """Fly-by fade out: pitch falls 380 -> 200 Hz as the roar darkens."""
    t = t_axis(0.75)
    f = 380 * (200 / 380) ** (t / t[-1])
    roar = lp2(highpass(noise(len(t), 14), 200), 1600 * np.exp(-t / 0.4) + 300)
    return (roar + 0.6 * sine(f, t)) * env(t, 0.08, 0.25)


def blast(dur, f_hi, f_lo, seed, rumble_cut=900, rumble=0.8, decay=0.18) -> np.ndarray:
    """An explosion core: a falling sub thump plus a darkening noise rumble."""
    t = t_axis(dur)
    sub = sine(f_lo + (f_hi - f_lo) * np.exp(-t / 0.04), t) * np.exp(-t / decay)
    cut = rumble_cut * np.exp(-t / 0.25) + 150
    rum = lp2(noise(len(t), seed), cut) * np.exp(-t / (decay * 1.2)) * rumble
    return sub + rum


def buddy_down() -> np.ndarray:
    """Three sad descending blips (E5 C5 G4), then a soft pop."""
    x = np.zeros(int(0.9 * SR))
    for i, f in enumerate((659.25, 523.25, 392.0)):
        t = t_axis(0.2)
        place(x, (sine(f, t) + 0.3 * sine(f * 2, t)) * env(t, 0.005, 0.07), i * 0.12)
    place(x, blast(0.45, 200, 80, 22, 1500, 0.6, 0.1) * 0.8, 0.38)
    return fade(x, 0.0, 0.05)


def bomb_blast() -> np.ndarray:
    """Shockwave: a boom plus an expanding 'whumm' (noise band opening, then closing)."""
    x = blast(1.5, 150, 40, 31, 2000, 1.0, 0.3)
    t = t_axis(1.2)
    cut = 300 + 3500 * np.sin(np.pi * np.clip(t / 0.9, 0, 1)) ** 2
    place(x, lp2(highpass(noise(len(t), 32), 120), cut) * env(t, 0.05, 0.35) * 0.9, 0.03)
    return fade(np.tanh(x) / np.tanh(1.0), 0.0, 0.1)


def crackles(t: np.ndarray, seed: int, rate: float, level: float, cut_lo: float = 1500):
    """Electric crackle bursts at fixed (seeded) positions, so a loop repeats exactly."""
    out = np.zeros_like(t)
    rng = np.random.default_rng(seed)
    for _ in range(int(rate * LOOP)):
        at = rng.random() * LOOP
        n = int(0.012 * SR)
        k = int(at * SR)
        burst = highpass(noise(n, int(rng.integers(1e6))), cut_lo) * np.exp(
            -np.arange(n) / (0.003 * SR)
        )
        out[k : k + n] += burst[: len(out[k : k + n])] * level * (0.5 + rng.random())
    return out


def lightning_loop() -> np.ndarray:
    """Tesla-coil buzz: a buzzing 120 Hz saw arc with a 30 Hz flutter and snapping crackles."""

    def f(t):
        buzz = sum(
            saw(phase(np.full_like(t, 120.0 * r))) * g
            for r, g in ((1, 1.0), (1.003, 0.7), (2.0, 0.4))
        )
        buzz = lp2(buzz, 2600) * (0.75 + 0.25 * lfo(t, 30.0))
        return buzz + crackles(t, 40, 9, 1.4)

    return loop_of(f)


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
    "rout-loop": (rout_loop, -1.0),
    "pickup": (pickup, -3.0),
    "shield-on": (shield_on, -2.0),
    "shield-loop": (shield_loop, -11.0),
    "shield-warn": (shield_warn, -6.0),
    "shield-off": (shield_off, -4.0),
    "buddy-in": (buddy_in, -6.0),
    "buddy-loop": (buddy_loop, -18.0),
    "buddy-out": (buddy_out, -6.0),
    "buddy-down": (buddy_down, -2.0),
    "bombblast": (bomb_blast, -1.0),
    "lightning-loop": (lightning_loop, -4.0),
}


def main(out_dir: Path, names: list[str]) -> None:
    for name in names or list(SOUNDS):
        recipe, peak = SOUNDS[name]
        write_ogg(norm(recipe(), peak), out_dir / f"starswarm-{name}.ogg")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(Path(args[0]) if args else OUT_DEFAULT, args[1:])
