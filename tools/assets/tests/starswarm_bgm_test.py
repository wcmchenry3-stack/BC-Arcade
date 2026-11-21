"""The Star Swarm music recipe (`starswarm_bgm/`, `build_starswarm_bgm.py`) makes the shipped track.

`test_recipe_rebuilds_the_shipped_track` renders the whole track (about a minute) and compares it
with `frontend/assets/sounds/starswarm-bgm.mp3` on decoded samples. Under a matched ffmpeg /
libmp3lame build (CI's Ubuntu 24.04 ffmpeg) the rebuild is byte-identical, so the tolerance is
tight: it catches a changed cue level or layer, not only a wholesale change. An ffmpeg upgrade can
move it, because the build encodes MP3 three times; then rebuild, listen, and refresh the shipped
file (docs/games/starswarm-music-design.md). Locally the rebuild skips without ffmpeg or
soundfile; under CI (`CI` set) it fails instead. The other tests need only numpy and scipy.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import itertools

import build_starswarm_bgm
from starswarm_bgm import arrange, shepard
from starswarm_bgm.common import SR

REPO = Path(__file__).resolve().parents[3]
LOOP_SCRIPT = REPO / "tools/assets/make_starswarm_bgm_loop.py"
LOOP_SCRIPT_DOCS = (
    REPO / "docs/games/starswarm-music-design.md",
    REPO / "frontend/assets/sounds/SOUND_CREDITS.md",
)

TOLERANCE = 1e-4  # relative RMS error of the decoded rebuild against the decoded shipped track


def test_cues_are_in_time_order_and_inside_the_track():
    for cues, end in ((arrange.INTRO_CUES, arrange.INTRO_DUR), (arrange.MAIN_CUES, arrange.DUR)):
        starts = [c.at for c in cues]
        assert starts == sorted(starts)
        assert all(c.at + c.secs <= end for c in cues)
    # The intro owns 0-2:00; the main cues start after it.
    assert arrange.MAIN_CUES[0].at >= arrange.INTRO_DUR


def test_cues_name_real_layers_and_pitches():
    for c in arrange.INTRO_CUES + arrange.MAIN_CUES:
        if isinstance(c, arrange.ShepardCue):
            continue
        assert c.layer in arrange.LAYERS, c
        assert c.pitch == 1.0 or c.pitch in arrange.PITCH_RATIOS, c
        assert 0 < c.duck < 1 and c.level > 0, c


def test_pitch_ratios_match_their_names():
    # A pitch of p plays the phrase p times faster: output/input length is about 1/p.
    for pitch, (up, down) in arrange.PITCH_RATIOS.items():
        assert abs(up / down - 1 / pitch) < 0.002, pitch


def test_featured_windows_leave_breathing_room():
    # The approved arrangement keeps the bed alone for a while between signatures (Round 45: 14-16 s,
    # Round 46: 15-19 s). Guard against a new cue landing on top of another.
    cues = arrange.INTRO_CUES + arrange.MAIN_CUES
    for a, b in itertools.pairwise(cues):
        assert b.at - (a.at + a.secs) >= 14, (a, b)


def test_cue_sheet_matches_the_approved_round_46_timeline():
    # round46_cues.json (owner's archive) start/end times, plus Round 45's four intro cues.
    approved = [(10, 27), (42, 60), (76, 93), (109, 119), (136, 149), (166, 181), (198, 214),
                (233, 250), (266, 282), (300, 315), (333, 347), (364, 379), (394, 407)]  # fmt: skip
    got = [(r["start"], r["end"]) for r in arrange.cue_sheet()[1:]]
    assert got == approved


def test_shepard_envelope_fades_at_both_ends():
    layer, env = shepard.render(10.0, rate=0.125, base=245.0)
    assert layer.shape == (2, 10 * SR) and env.shape == (10 * SR,)
    assert env[0] == 0 and env[5 * SR] == 1 and env[-1] < 1e-6
    assert np.isfinite(layer).all()


def test_shepard_falls_by_rate_octaves_per_second():
    # Follow one partial: 2 s at 0.125 octave/s moves it down a quarter octave. (The loudest
    # partial wraps back up an octave as the next one takes over: that is the illusion.)
    rate, gap = 0.125, 2.0
    layer, _ = shepard.render(6.0, rate=rate, base=245.0)

    def peak_hz(x, lo, hi):
        spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
        f = np.fft.rfftfreq(len(x), 1 / SR)
        band = (f > lo) & (f < hi)
        return f[band][np.argmax(spec[band])]

    w = SR // 4
    a = peak_hz(layer[0, 2 * SR : 2 * SR + w], 300, 560)
    start = int((2 + gap) * SR)
    b = peak_hz(layer[0, start : start + w], a * 0.7, a * 0.95)
    assert abs(np.log2(a / b) - rate * gap) < 0.03, (a, b)


def test_check_refuses_to_overwrite_the_shipped_file():
    before = build_starswarm_bgm.SHIPPED.read_bytes()
    # The guard runs before any rendering, so this returns at once instead of building the track.
    with pytest.raises(SystemExit):
        build_starswarm_bgm.main(["--check", str(build_starswarm_bgm.SHIPPED)])
    assert build_starswarm_bgm.SHIPPED.read_bytes() == before


def _rebuild_problem() -> str | None:
    if shutil.which("ffmpeg") is None:
        return "ffmpeg is not installed"
    done = subprocess.run(
        ["ffmpeg", "-v", "error", "-encoders"], check=False, capture_output=True, text=True
    )
    if "libmp3lame" not in done.stdout:
        return "ffmpeg has no libmp3lame encoder"
    try:
        import soundfile  # noqa: F401
    except (ImportError, OSError) as e:
        return f"soundfile is unusable: {e}"
    return None


def _decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def test_recipe_rebuilds_the_shipped_track(tmp_path):
    problem = _rebuild_problem()
    if problem:
        if os.environ.get("CI"):
            pytest.fail(f"{problem}; the CI test-tools job must provide it")
        pytest.skip(problem)
    out = tmp_path / "starswarm-bgm.mp3"
    build_starswarm_bgm.build(out, stages=tmp_path / "stages", log=lambda *_: None)
    fresh, shipped = _decode(out), _decode(build_starswarm_bgm.SHIPPED)
    assert len(fresh) == len(shipped)
    err = np.sqrt(np.mean((fresh - shipped) ** 2) / np.mean(shipped**2))
    assert err < TOLERANCE, f"rebuild differs from the shipped track: relative RMS {err:.2e}"
    cues = json.loads((tmp_path / "stages" / "cues.json").read_text())
    assert cues == arrange.cue_sheet()


def test_documented_loop_script_hash_is_current():
    digest = hashlib.sha256(LOOP_SCRIPT.read_bytes()).hexdigest()
    for doc in LOOP_SCRIPT_DOCS:
        assert digest in doc.read_text(encoding="utf-8"), (
            f"{doc.relative_to(REPO)} records a stale SHA-256 for tools/assets/"
            f"make_starswarm_bgm_loop.py; update it to {digest} (the hash must be refreshed "
            "whenever the loop script changes, even a docstring edit)"
        )
