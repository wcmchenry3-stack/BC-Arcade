"""Make the Round 46 Star Swarm track loop-ready (#3638, epic #3635).

This is the ONLY edit applied to the owner's Round 46 render; the composition is unchanged:

1. Trim the baked-in fade-in (first TRIM_HEAD_S) and fade-out (everything after TRIM_TAIL_S).
2. Equal-power crossfade (cos/sin) over XFADE_S: the tail fades out while the first XFADE_S of the
   trimmed audio fades in. The file starts where that seam ends, so the loop point is continuous.
3. Gain of +GAIN_DB (the game volume stays 0.57; the loudness lives in the file).
4. One MP3 encode (libmp3lame 128 kbps, 24 kHz stereo).

Owner-approved 2026-11-12 after a seam audition. Every original time t becomes t - TRIM_HEAD_S -
XFADE_S (5.5 s); see docs/games/starswarm-music-design.md.

SOURCE_MP3 is the archived Round 46 render (#3734, unpacked from its zip in #3762):

    docs/games/starswarm-music/Rounds/Round_46/starswarm-round46-seven-minute-signature-mix.mp3

(SHA-256 29b0a1604e458fa1b0cb92d0502c283b836d1b1f9b2a63a3f012fd3c815f442a.)

Usage: python tools/assets/make_starswarm_bgm_loop.py SOURCE_MP3 OUT_MP3 [--wav INTERMEDIATE.wav]
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

import numpy as np

SR = 24_000  # Hz; the source is 24 kHz stereo
TRIM_HEAD_S = 2.5  # the baked-in fade-in ends by ~2.2 s
TRIM_TAIL_S = 418.2  # the baked-in fade-out starts at ~418.4 s
XFADE_S = 3.0  # the end blends into the start over this long
GAIN_DB = 2.9  # owner-approved; game volume stays 0.57
BITRATE = "128k"


def decode(path: Path | str) -> np.ndarray:
    """Decode to float64 stereo frames at SR, shape (n, 2)."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def make_loop(
    x: np.ndarray,
    head_s: float = TRIM_HEAD_S,
    tail_s: float = TRIM_TAIL_S,
    xfade_s: float = XFADE_S,
    gain_db: float = GAIN_DB,
    sr: int = SR,
) -> np.ndarray:
    """Trim, equal-power seam, gain. Output length is (tail - head) - xfade."""
    s = x[int(head_s * sr) : int(tail_s * sr)]
    n = int(xfade_s * sr)
    t = (np.arange(n) + 0.5) / n
    fade_out = np.cos(t * np.pi / 2)[:, None]
    fade_in = np.sin(t * np.pi / 2)[:, None]
    seam = s[-n:] * fade_out + s[:n] * fade_in  # the tail flows into the opening
    y = np.concatenate([s[n:-n], seam])  # the file starts where the seam ends
    return y * 10 ** (gain_db / 20)


def write_wav(y: np.ndarray, wav: Path) -> None:
    pcm = (np.clip(y, -1, 1) * 32767).round().astype("<i2").tobytes()
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "s16le",
            "-ar",
            str(SR),
            "-ac",
            "2",
            "-i",
            "-",
            str(wav),
        ],
        input=pcm,
        check=True,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("source_mp3", type=Path)
    ap.add_argument("out_mp3", type=Path)
    ap.add_argument("--wav", type=Path, help="keep the intermediate 16-bit WAV here")
    args = ap.parse_args(argv)

    y = make_loop(decode(args.source_mp3))
    peak = float(np.abs(y).max())
    assert peak < 1.0, f"clipping: peak {peak}"
    with tempfile.TemporaryDirectory() as tmp:
        wav = args.wav or Path(tmp) / "loop.wav"
        write_wav(y, wav)
        args.out_mp3.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame",
             "-b:a", BITRATE, "-ar", str(SR), str(args.out_mp3)],
            check=True,
        )  # fmt: skip
    print(f"samples {len(y)} seconds {len(y) / SR:.3f} peak dBFS {20 * np.log10(peak):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
