"""A compact, encoder-free fingerprint of the Star Swarm music recipe (#4027).

The build encodes MP3 three times, and libmp3lame's choices are chaotic: a one-ulp float difference
upstream (another CPU's SIMD path in numpy/scipy) flips a quantiser decision and moves the decoded
track by about 2e-3 relative RMS, though the sound is the same. So the recipe is pinned before any
encoder sees it: the un-encoded bed, each layer's phrase, and the arrangement laid over the
un-encoded bed (`arrange.Stages.dry_mix`). Each is summarised as per-window RMS per channel plus a
peak, rounded to 9 significant digits, and `reference_fingerprint.json` holds those numbers.

A changed cue level, window, duck, fade or pitch, or a changed layer or bed, moves some window by
far more than TOLERANCE; float noise between machines moves it by about 1e-12.

The file also records `shipped_sha256`, the hash of the shipped MP3 the reference belongs to.
A refresh that changes the fingerprint while the shipped MP3 is unchanged would silently bless a
recipe change the shipped track does not have, so `refuse_reason` stops it unless forced.

Refresh after an intentional recipe change: `python tools/assets/build_starswarm_bgm.py
--write-fingerprint` (docs/games/starswarm-music-design.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .common import SR

REFERENCE = Path(__file__).resolve().parent / "reference_fingerprint.json"
WINDOW_S = 5  # s per RMS window
TOLERANCE = 1e-6  # relative, per value (ATOL below for near-silent windows)
ATOL = 1e-9  # absolute floor: RMS values this small are noise
DIGITS = 9


def _round(x: float) -> float:
    return float(f"{x:.{DIGITS}g}")


def summarise(x: np.ndarray) -> dict:
    """x is (2, n): per-channel RMS of each WINDOW_S window (last one may be short), and the peak."""
    w = WINDOW_S * SR
    x = np.asarray(x, dtype=np.float64)
    rms = [
        [_round(float(np.sqrt(np.mean(x[ch, i : i + w] ** 2)))) for i in range(0, x.shape[1], w)]
        for ch in range(x.shape[0])
    ]
    return {"samples": int(x.shape[1]), "peak": _round(float(np.max(np.abs(x)))), "rms": rms}


def compute(stages) -> dict:
    """The fingerprint of an `arrange.Stages` built with `dry=True`."""
    assert stages.dry_mix is not None, "build_stages(dry=True) is needed"
    out = {
        "window_s": WINDOW_S,
        "bed": summarise(stages.bed_pcm.T),
        "dry_mix": summarise(stages.dry_mix),
    }
    out["phrases"] = {name: summarise(x) for name, x in sorted(stages.phrases.items())}
    return out


def write(fp: dict, path: Path = REFERENCE) -> None:
    path.write_text(json.dumps(fp, separators=(",", ":"), sort_keys=True) + "\n")


def load(path: Path = REFERENCE) -> dict:
    return json.loads(path.read_text())


def refuse_reason(new: dict, committed: dict | None, shipped_sha256: str) -> str | None:
    """Why `--write-fingerprint` should not overwrite `committed`, or None when it may.

    It may when there is no reference yet, when the fingerprint does not change, or when the
    shipped MP3 has changed since the reference was written (the documented order: replace the
    MP3, then refresh). It may not when the fingerprint changes but the shipped MP3 did not.
    """
    if committed is None or committed.get("shipped_sha256") != shipped_sha256:
        return None
    if not differences(new, committed):
        return None
    return (
        "the rebuilt stages differ from the committed fingerprint, but the shipped MP3 "
        f"({shipped_sha256[:12]}) is the one that fingerprint was made for. Replace the shipped "
        "MP3 with the rebuilt track first, or pass --force only if you have deliberately decided "
        "the shipped MP3 stays as is."
    )


def differences(got: dict, want: dict) -> list[str]:
    """Human-readable mismatches between two fingerprints (empty when they agree)."""
    problems: list[str] = []
    want = {k: v for k, v in want.items() if k != "shipped_sha256"}
    if got.keys() != want.keys():
        return [f"stages differ: {sorted(got)} vs {sorted(want)}"]

    def walk(path: str, a, b) -> None:
        if isinstance(b, dict):
            if not isinstance(a, dict) or a.keys() != b.keys():
                problems.append(f"{path}: keys differ")
                return
            for k in b:
                walk(f"{path}.{k}", a[k], b[k])
        elif isinstance(b, list):
            if len(a) != len(b):
                problems.append(f"{path}: {len(a)} windows, reference has {len(b)}")
                return
            for i, (u, v) in enumerate(zip(a, b, strict=True)):
                walk(f"{path}[{i}]", u, v)
        elif isinstance(b, int):
            if a != b:
                problems.append(f"{path}: {a} != {b}")
        elif abs(a - b) > TOLERANCE * abs(b) + ATOL:
            problems.append(f"{path}: {a!r} vs reference {b!r}")

    walk("fingerprint", got, want)
    return problems
