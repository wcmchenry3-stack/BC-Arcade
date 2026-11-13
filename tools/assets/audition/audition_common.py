"""Shared helpers for the sound audition tools (#3673): decode, mix, measure, run ffmpeg.

`preview.py` and `mix.py` build on these. Dev tooling only: nothing here is shipped, and nothing
here writes to frontend/assets/sounds/. Needs numpy and ffmpeg (with libx264 and aac for the mp4s;
libvorbis only to decode the Oggs the generators write, which any ffmpeg can).
"""

from __future__ import annotations

import subprocess
import wave
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np

SR = 44100
AUDIO_SUFFIXES = (".ogg", ".mp3", ".wav", ".m4a")
PEAK_CEILING = 0.98  # a mix that would clip is scaled down to this


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a command, failing loudly with its stderr when it exits non-zero."""
    try:
        return subprocess.run(cmd, check=True, capture_output=True, **kwargs)
    except FileNotFoundError as err:
        raise SystemExit(f"{cmd[0]} not found: install ffmpeg and put it on PATH") from err
    except subprocess.CalledProcessError as err:
        stderr = (err.stderr or b"").decode(errors="replace").strip()
        raise SystemExit(f"{' '.join(cmd[:3])} ... failed:\n{stderr}") from err


def decode(path: Path) -> np.ndarray:
    """Any audio file (Ogg, mp3, wav, ...) as mono float samples at SR."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"]
    return np.frombuffer(run(cmd).stdout, dtype="<f4").astype(np.float64)


def level_rms_db(x: np.ndarray) -> float:
    """The loudest 50 ms, as RMS in dBFS (the `level_rms` the sound design logs quote)."""
    w = int(0.05 * SR)
    if len(x) < w:
        x = np.pad(x, (0, w - len(x)))
    rms = np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid").max())
    return float(20 * np.log10(max(rms, 1e-12)))


def low_energy_pct(x: np.ndarray, cutoff: float = 300.0) -> float:
    """Percent of the signal's energy below `cutoff` Hz (what a phone speaker cannot play)."""
    power = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    total = power.sum()
    return float(100 * power[freqs < cutoff].sum() / total) if total > 0 else 0.0


def mix_events(
    events: list[tuple[np.ndarray, float]], total: float | None = None, limit: float | None = None
) -> np.ndarray:
    """Lay each (samples, start second) into one track; scale down only if it would clip.

    `total` is a minimum length. `limit` is the end of the recording: the track is exactly that
    long and every sound is cut there (a long file cannot play on past the video)."""
    if limit is not None:
        out = np.zeros(round(limit * SR))
    else:
        end = max((at + len(x) / SR for x, at in events), default=0.0)
        out = np.zeros(round(max(total or 0.0, end) * SR))
    for x, at in events:
        k = round(at * SR)
        if k < 0:
            raise ValueError(f"a sound starts before the video: {at:.3f} s")
        piece = x[: max(0, len(out) - k)]
        out[k : k + len(piece)] += piece
    peak = float(np.abs(out).max()) if len(out) else 0.0
    return out * (PEAK_CEILING / peak) if peak > PEAK_CEILING else out


def write_wav(x: np.ndarray, path: Path) -> None:
    """Mono 16-bit WAV at SR."""
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def media_duration(path: Path) -> float | None:
    """A file's duration in seconds, or None when the container does not say (Playwright's webm)."""
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]
    out = run([*cmd, str(path)]).stdout.decode().strip()
    try:
        return float(out)
    except ValueError:
        return None


def parse_spec(spec: str) -> tuple[Path, float]:
    """`file.ogg` or `file.ogg@1.25`: a sound and the second it starts (0 when omitted)."""
    name, sep, at = spec.rpartition("@")
    if not sep:
        return Path(spec), 0.0
    try:
        return Path(name), float(at)
    except ValueError as err:
        raise SystemExit(f"bad spec {spec!r}: expected file.ogg or file.ogg@seconds") from err


def resolve_play_src(src: str, dist: Path) -> Path:
    """The file in `dist` a logged `HTMLMediaElement.play` URL was served from."""
    parsed = urlparse(src)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"not a served file: {src[:60]}")
    root = dist.resolve()
    path = (root / unquote(parsed.path).lstrip("/")).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"outside the build: {src[:60]}")
    if path.suffix.lower() not in AUDIO_SUFFIXES:
        raise ValueError(f"not an audio file: {src[:60]}")
    if not path.is_file():
        raise FileNotFoundError(f"{src} is not in {dist} (looked for {path}); is dist the build?")
    return path
