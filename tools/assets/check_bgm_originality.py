"""Originality check for the Star Swarm background track (#3637, epic #3635).

Compares a candidate track with source tracks by harmonic content (chroma), so a copied melody or
chord progression is caught even when it is transposed or placed at a different time.

Method:
  * decode to mono 11,025 Hz (ffmpeg);
  * chroma: 2 s frames; each frame averages the magnitude spectra of 8192-sample Hann-windowed
    STFT slices; bins between 55 and 2000 Hz fold into 12 pitch classes; each frame is L2-normalised;
  * score of a pair = best mean cosine similarity over 30 s windows (15 frames), at every time
    offset of both tracks (stride 3 frames) and all 12 transpositions (roll the chroma);
  * baseline = the pairwise scores among the source tracks; threshold = the baseline maximum;
  * the candidate passes if every score against the sources is <= the threshold.

Usage: check_bgm_originality.py CANDIDATE SOURCE [SOURCE ...]
Prints a markdown report; exits 1 on FAIL. Needs numpy and ffmpeg only.
"""

from __future__ import annotations

import argparse
import itertools
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 11_025
FRAME_S = 2
FRAME_SAMPLES = SR * FRAME_S
NFFT = 8192
HOP = NFFT // 2
FMIN, FMAX = 55.0, 2000.0
WINDOW_FRAMES = 15  # 30 s
STRIDE = 3


def decode_mono(path: str | Path) -> np.ndarray:
    """Decode any audio file to mono float32 at 11,025 Hz."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32)


def _pitch_class_map() -> tuple[slice, np.ndarray]:
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    lo = int(np.searchsorted(freqs, FMIN))
    hi = int(np.searchsorted(freqs, FMAX, side="right"))
    pcs = (np.round(12 * np.log2(freqs[lo:hi] / 440.0)).astype(int) + 9) % 12
    return slice(lo, hi), pcs


def chroma_from_pcm(pcm: np.ndarray) -> np.ndarray:
    """Return an (n_frames, 12) array of L2-normalised chroma, one row per 2 s frame."""
    sel, pcs = _pitch_class_map()
    win = np.hanning(NFFT).astype(np.float32)
    n_frames = len(pcm) // FRAME_SAMPLES
    out = np.zeros((n_frames, 12), dtype=np.float64)
    for i in range(n_frames):
        frame = pcm[i * FRAME_SAMPLES : (i + 1) * FRAME_SAMPLES]
        starts = range(0, len(frame) - NFFT + 1, HOP)
        spec = np.zeros(NFFT // 2 + 1)
        for s in starts:
            spec += np.abs(np.fft.rfft(frame[s : s + NFFT] * win))
        out[i] = np.bincount(pcs, weights=spec[sel], minlength=12)
    norms = np.linalg.norm(out, axis=1, keepdims=True)
    return out / np.maximum(norms, 1e-12)


def chroma_from_file(path: str | Path) -> np.ndarray:
    return chroma_from_pcm(decode_mono(path))


def best_similarity(
    a: np.ndarray, b: np.ndarray, window: int = WINDOW_FRAMES, stride: int = STRIDE
) -> float:
    """Best mean cosine similarity of `window`-frame stretches of a and b, over offsets and keys."""
    window = min(window, len(a), len(b))
    if window == 0:
        return 0.0
    n1, n2 = len(a) - window + 1, len(b) - window + 1
    best = -1.0
    for shift in range(12):
        sim = a @ np.roll(b, shift, axis=1).T  # (len(a), len(b)) frame cosine similarities
        acc = np.zeros((n1, n2))
        for k in range(window):  # sum along diagonals = windowed sum at every offset pair
            acc += sim[k : k + n1, k : k + n2]
        best = max(best, float(acc[::stride, ::stride].max()) / window)
    return best


def evaluate(candidate: np.ndarray, sources: dict[str, np.ndarray]) -> dict:
    """Score the candidate against each source and the sources against each other."""
    if len(sources) < 2:
        raise ValueError("need at least two source tracks to set a baseline")
    baseline = {
        (x, y): best_similarity(sources[x], sources[y])
        for x, y in itertools.combinations(sources, 2)
    }
    threshold = max(baseline.values())
    scores = {name: best_similarity(candidate, ch) for name, ch in sources.items()}
    return {
        "scores": scores,
        "baseline": baseline,
        "threshold": threshold,
        "passed": all(s <= threshold for s in scores.values()),
    }


def format_report(candidate_name: str, result: dict) -> str:
    lines = ["| Pair | Best similarity |", "| --- | --- |"]
    for name, score in result["scores"].items():
        lines.append(f"| {candidate_name} vs {name} | {score:.4f} |")
    for (x, y), score in result["baseline"].items():
        lines.append(f"| baseline: {x} vs {y} | {score:.4f} |")
    lines.append(f"| threshold (baseline maximum) | {result['threshold']:.4f} |")
    lines.append(f"| result | {'PASS' if result['passed'] else 'FAIL'} |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("candidate")
    ap.add_argument("sources", nargs="+")
    args = ap.parse_args(argv)
    sources = {Path(p).name: chroma_from_file(p) for p in args.sources}
    result = evaluate(chroma_from_file(args.candidate), sources)
    print(format_report(Path(args.candidate).name, result))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
