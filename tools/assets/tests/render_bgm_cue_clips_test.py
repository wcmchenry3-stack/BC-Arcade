"""pytest suite for render_bgm_cue_clips.py (#3637)."""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import render_bgm_cue_clips as r

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")

TS = r.REPO / "frontend/src/game/starswarm/bgmCues.ts"


def _ts_cues(src: str) -> list[int]:
    m = re.search(r"cuesMs:\s*\[([^\]]*)\]", src)
    assert m
    return [int(x.replace("_", "")) for x in m.group(1).split(",") if x.strip()]


def _ts_duration(src: str) -> int:
    m = re.search(r"durationMs:\s*([\d_]+)", src)
    assert m
    return int(m.group(1).replace("_", ""))


def test_cues_mirror_the_typescript_file():
    src = TS.read_text()
    assert _ts_cues(src) == r.CUES_MS
    assert _ts_duration(src) == r.DURATION_MS


def test_clip_names():
    assert [r.clip_name(i, c) for i, c in enumerate(r.CUES_MS, 1)] == [
        "cue-1-0m00s.mp3",
        "cue-2-1m12s.mp3",
        "cue-3-2m35s.mp3",
        "cue-4-4m29s.mp3",
        "cue-5-5m26s.mp3",
    ]


@needs_ffmpeg
def test_render_makes_clips_from_a_synthetic_track(tmp_path):
    track = tmp_path / "t.mp3"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=430",
         "-ac", "2", "-ar", "24000", str(track)],
        check=True,
    )  # fmt: skip
    out = tmp_path / "clips"
    files = r.render(out, track)
    assert [f.name for f in files][-1] == "loop-seam.mp3"
    assert len(files) == len(r.CUES_MS) + 1
    assert all(f.stat().st_size > 0 for f in files)
