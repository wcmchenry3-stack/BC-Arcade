"""Shared constants and audio I/O for the Star Swarm background-music recipe.

Every layer renders at 24 kHz stereo. Arrays are shaped (2, n) (channels first), as in the round
scripts the layers came from; only the Round 44 bed works in (n, 2) internally.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np

SR = 24_000  # Hz


def ease(v):
    """Smoothstep on [0, 1]. The rounds call it `ease`, `sm`, `soft` or `smooth`; it is one curve."""
    v = np.clip(v, 0, 1)
    return v * v * (3 - 2 * v)


def decode_mp3(data: bytes) -> np.ndarray:
    """Decode MP3 bytes to float32 (2, n) at SR, as the rounds' `decode()` did."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"],
        input=data,
        capture_output=True,
        check=True,
    )
    return np.frombuffer(p.stdout, dtype="<f4").reshape(-1, 2).T.copy()


def encode_mp3_f32(x: np.ndarray) -> bytes:
    """Encode float (2, n) to MP3, 128 kbps, the way Rounds 45 and 46 wrote their renders.

    The output goes to a real file, not a pipe: ffmpeg fills in the LAME/Xing header (which tells a
    decoder how much encoder padding to drop) only when it can seek back, so a piped MP3 differs.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "x.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2",
             "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "128k", str(out)],
            input=np.ascontiguousarray(x.T, dtype="<f4").tobytes(),
            check=True,
        )  # fmt: skip
        return out.read_bytes()


def encode_mp3_pcm16_wav(x: np.ndarray) -> bytes:
    """Encode (n, 2) float audio as Round 44 did: a 16-bit WAV first, then MP3 128 kbps.

    Round 44 wrote the WAV with soundfile (libsndfile), so the float-to-16-bit step uses it too.
    """
    import soundfile as sf  # only this step needs it

    with tempfile.TemporaryDirectory() as tmp:
        wav, out = Path(tmp) / "x.wav", Path(tmp) / "x.mp3"
        sf.write(wav, x, SR, subtype="PCM_16")
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav),
             "-codec:a", "libmp3lame", "-b:a", "128k", str(out)],
            check=True,
        )  # fmt: skip
        return out.read_bytes()


def mp3_round_trip(x: np.ndarray) -> np.ndarray:
    """Encode to MP3 and decode again.

    The approved track was built in stages, and each stage was handed to the next as an MP3. Those
    encodes are part of the sound that shipped, so the build repeats them to reproduce it exactly.
    """
    return decode_mp3(encode_mp3_f32(x))
