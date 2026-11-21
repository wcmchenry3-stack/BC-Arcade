"""The Star Swarm music recipe (`starswarm_bgm/`, `build_starswarm_bgm.py`) makes the shipped track.

The build encodes MP3 three times, and libmp3lame is chaotic: a one-ulp float difference upstream
(another CPU's SIMD path) changes its quantiser choices and moves the decoded track by 2e-3 to 5e-3
relative RMS without changing the sound (#4027: the same code and packages passed on one CI runner
and failed on another with 2.08e-3). So the recipe is checked in two layers:

1. `test_recipe_matches_the_reference_fingerprint` pins the encoder-free stages (the un-encoded bed,
   each layer's phrase, and the arrangement laid over the un-encoded bed) against
   `starswarm_bgm/reference_fingerprint.json` at 1e-6 relative. Float noise moves them by about
   1e-12, a changed cue level, window, duck, fade, pitch or layer by orders of magnitude more.
2. `test_recipe_rebuilds_the_shipped_track` compares the final MP3 with the shipped one at a
   tolerance that allows encoder differences between machines: same length, relative RMS and
   per-window loudness (justified at the constants below).

Refresh after an intentional recipe change: docs/games/starswarm-music-design.md. Locally the
rebuild skips without ffmpeg or soundfile; under CI (`CI` set) it fails instead. The other tests
need only numpy and scipy.
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
from starswarm_bgm import arrange, fingerprint, shepard
from starswarm_bgm.common import SR

REPO = Path(__file__).resolve().parents[3]
LOOP_SCRIPT = REPO / "tools/assets/make_starswarm_bgm_loop.py"
LOOP_SCRIPT_DOCS = (
    REPO / "docs/games/starswarm-music-design.md",
    REPO / "frontend/assets/sounds/SOUND_CREDITS.md",
)

# Final-file tolerances (the whole-track check is the loose one; the fingerprint is the tight one).
# Evidence, all against the shipped track with identical code and packages:
#   - CI, two runners a minute apart: byte-different MP3s at relative RMS 2.08e-3 (#4027).
#   - Locally, perturbing the bed by 1e-9 noise (far below int16 resolution) before the first
#     encode: 4.8e-3 and 5.0e-3, so encoder chaos saturates near 5e-3 and 2.08e-3 is typical.
#   - The same perturbation moves any 10 s window's loudness by at most 0.0009 dB.
# RMS_TOLERANCE is 3x the worst of those: it still fails a wholesale change (another layer, a
# different bed or gain, truncation), which moves relative RMS to 1e-1 or more. A single cue
# (0.5 dB louder on one 17 s window) moves relative RMS less than the noise does, which is why that
# is the fingerprint's job; the loudness windows below catch it from the final file too.
# WINDOW_DB_TOLERANCE is 20x the worst noise (0.0009 dB) and below a 0.5 dB cue change on one
# window (about 0.05 dB over the 10 s that contains it).
RMS_TOLERANCE = 1.5e-2
WINDOW_S = 10
WINDOW_DB_TOLERANCE = 0.02


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


def test_check_refuses_to_overwrite_the_shipped_file(monkeypatch):
    # Without the guard, --check would render over the shipped file and then compare it with
    # itself (always "identical"). Stub the build so a regression fails at once, untouched.
    def must_not_build(*_args, **_kwargs):
        pytest.fail("--check built over SHIPPED")

    monkeypatch.setattr(build_starswarm_bgm, "build", must_not_build)
    before = build_starswarm_bgm.SHIPPED.read_bytes()
    with pytest.raises(SystemExit) as exc:
        build_starswarm_bgm.main(["--check", str(build_starswarm_bgm.SHIPPED)])
    assert exc.value.code == 2  # argparse's ap.error
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


@pytest.fixture(scope="module")
def rebuild(tmp_path_factory):
    """Render the whole track once (about a minute): the MP3, its stage files and the fingerprint."""
    problem = _rebuild_problem()
    if problem:
        if os.environ.get("CI"):
            pytest.fail(f"{problem}; the CI test-tools job must provide it")
        pytest.skip(problem)
    root = tmp_path_factory.mktemp("bgm")
    out = root / "starswarm-bgm.mp3"
    fp = build_starswarm_bgm.build(
        out, stages=root / "stages", log=lambda *_: None, with_fingerprint=True
    )
    return out, root / "stages", fp


def test_recipe_matches_the_reference_fingerprint(rebuild):
    _, _, fp = rebuild
    problems = fingerprint.differences(fp, fingerprint.load())
    assert not problems, (
        "the encoder-free stages moved; if the music change is intended, run "
        "`python tools/assets/build_starswarm_bgm.py --write-fingerprint`:\n"
        + "\n".join(problems[:20])
    )


def test_recipe_rebuilds_the_shipped_track(rebuild):
    out, stages, _ = rebuild
    fresh, shipped = _decode(out), _decode(build_starswarm_bgm.SHIPPED)
    assert len(fresh) == len(shipped)
    err = np.sqrt(np.mean((fresh - shipped) ** 2) / np.mean(shipped**2))
    assert err < RMS_TOLERANCE, f"rebuild differs from the shipped track: relative RMS {err:.2e}"
    w = WINDOW_S * SR * 2  # interleaved stereo samples
    for k in range(0, len(shipped) - w + 1, w):
        a, r = fresh[k : k + w], shipped[k : k + w]
        db = 20 * np.log10(np.sqrt(np.mean(a**2)) / np.sqrt(np.mean(r**2)))
        assert abs(db) < WINDOW_DB_TOLERANCE, f"{k // w * WINDOW_S}s window is {db:+.3f} dB"
    cues = json.loads((stages / "cues.json").read_text())
    assert cues == arrange.cue_sheet()


def _toy_stage(level: float) -> np.ndarray:
    """A short stereo stage with one cue placed on it, to exercise the fingerprint's sensitivity."""
    n = 12 * SR
    t = np.arange(n) / SR
    bed = 0.2 * np.sin(2 * np.pi * 220 * t)[None, :].repeat(2, axis=0)
    phrase = 0.5 * np.sin(2 * np.pi * 330 * t)[None, :].repeat(2, axis=0)
    cue = arrange.Cue("toy", "rise", 0, 2, 8, level, 0.25)
    arrange.place(bed, cue, phrase)
    return bed


def test_fingerprint_catches_a_changed_cue_level_but_not_float_noise():
    want = fingerprint.summarise(_toy_stage(0.7))
    assert not fingerprint.differences(fingerprint.summarise(_toy_stage(0.7)), want)
    # Float noise (a ulp-level difference between machines) is inside the tolerance.
    noisy = _toy_stage(0.7) * (1 + 1e-12)
    assert not fingerprint.differences(fingerprint.summarise(noisy), want)
    # A 0.1 dB change to one cue is far outside it.
    louder = fingerprint.summarise(_toy_stage(0.7 * 10 ** (0.1 / 20)))
    assert fingerprint.differences(louder, want)


def test_fingerprint_catches_a_moved_window_or_length():
    want = fingerprint.summarise(_toy_stage(0.7))
    shifted = np.roll(_toy_stage(0.7), 3 * SR, axis=1)
    assert fingerprint.differences(fingerprint.summarise(shifted), want)
    assert fingerprint.differences(fingerprint.summarise(_toy_stage(0.7)[:, :-SR]), want)


def test_reference_fingerprint_is_compact_and_covers_every_stage():
    ref = fingerprint.load()
    assert set(ref) == {"window_s", "bed", "dry_mix", "phrases"}
    assert set(ref["phrases"]) == set(arrange.LAYERS)
    assert ref["bed"]["samples"] == arrange.DUR * SR
    assert ref["dry_mix"]["samples"] == arrange.DUR * SR
    assert fingerprint.REFERENCE.stat().st_size < 16_384  # a fingerprint, not audio


def test_documented_loop_script_hash_is_current():
    digest = hashlib.sha256(LOOP_SCRIPT.read_bytes()).hexdigest()
    for doc in LOOP_SCRIPT_DOCS:
        assert digest in doc.read_text(encoding="utf-8"), (
            f"{doc.relative_to(REPO)} records a stale SHA-256 for tools/assets/"
            f"make_starswarm_bgm_loop.py; update it to {digest} (the hash must be refreshed "
            "whenever the loop script changes, even a docstring edit)"
        )
