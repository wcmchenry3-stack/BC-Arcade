"""Render audition clips for the Star Swarm music starting points (#3637).

One 20 s clip per starting point (decoded from the track at the cue, 1.5 s fade-in, as the app will
play it), plus `loop-seam.mp3`: the last 15 s straight into the first 15 s, to hear the restart.
Output is MP3 (libmp3lame -q:a 4, 24 kHz stereo) in a git-ignored folder; audio is not committed.

CUES_MS mirrors `frontend/src/game/starswarm/bgmCues.ts`; a test keeps them equal.

Usage: python tools/assets/render_bgm_cue_clips.py [--out DIR]
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TRACK = REPO / "frontend/assets/sounds/starswarm-bgm.mp3"
DEFAULT_OUT = Path(__file__).resolve().parent / "out" / "bgm-cues"

# Mirrors bgmCues.ts (STARSWARM_BGM).
DURATION_MS = 412_700
CUES_MS = [0, 66_500, 156_500, 223_500, 290_500]

CLIP_S = 20
FADE_IN_S = 1.5
SEAM_S = 15


def clip_name(index: int, cue_ms: int) -> str:
    """`cue-<n>-<m>m<ss>s.mp3`, e.g. cue-2-1m06s.mp3."""
    secs = cue_ms // 1000
    return f"cue-{index}-{secs // 60}m{secs % 60:02d}s.mp3"


def _encode_args(out: Path) -> list[str]:
    return ["-ac", "2", "-ar", "24000", "-c:a", "libmp3lame", "-q:a", "4", str(out)]


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def render(out_dir: Path, track: Path = TRACK) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for i, cue in enumerate(CUES_MS, start=1):
        out = out_dir / clip_name(i, cue)
        _ffmpeg(
            "-ss", f"{cue / 1000:.3f}", "-t", str(CLIP_S), "-i", str(track),
            "-af", f"afade=t=in:d={FADE_IN_S}",
            *_encode_args(out),
        )  # fmt: skip
        written.append(out)
    seam = out_dir / "loop-seam.mp3"
    tail_start = DURATION_MS / 1000 - SEAM_S
    _ffmpeg(
        "-ss", f"{tail_start:.3f}", "-t", str(SEAM_S), "-i", str(track),
        "-ss", "0", "-t", str(SEAM_S), "-i", str(track),
        "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
        *_encode_args(seam),
    )  # fmt: skip
    written.append(seam)
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default {DEFAULT_OUT})"
    )
    args = ap.parse_args(argv)
    for path in render(args.out):
        print(f"{path} ({path.stat().st_size} B)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
