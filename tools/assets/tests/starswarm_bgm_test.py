"""The Star Swarm music recipe (`starswarm_bgm/`, `build_starswarm_bgm.py`) makes the shipped track.

The build encodes MP3 three times, and libmp3lame is chaotic: a one-ulp float difference upstream
(another CPU's SIMD path) changes its quantiser choices and moves the decoded track by 2e-3 to 5e-3
relative RMS without changing the sound (#4027: the same code and packages passed on one CI runner
and failed on another with 2.08e-3). So the recipe is checked in two layers:

1. `test_recipe_matches_the_reference_fingerprint` pins the encoder-free stages (the un-encoded bed,
   each layer's phrase, and the arrangement laid over the un-encoded bed) against
   `starswarm_bgm/reference_fingerprint.json` (window RMS at 1e-5, peaks at 1e-4 relative).
   numpy's CPU-specific SIMD kernels move them a little between machines (peaks up to 2.6e-6,
   RMS up to 7.7e-7; measured in `starswarm_bgm/fingerprint.py`); a changed cue level, window,
   duck, fade, pitch or layer moves them by more than ten times the tolerance.
2. `test_recipe_rebuilds_the_shipped_track` compares the final MP3 with the shipped one at a
   tolerance that allows encoder differences between machines: same length, relative RMS and
   per-window loudness (justified at the constants below).

Refresh after an intentional recipe change: docs/games/starswarm-music-design.md. Locally the
rebuild skips without ffmpeg or soundfile; under CI (`CI` set) it fails instead. The other tests
need only numpy and scipy.
"""

import dataclasses
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
# WINDOW_DB_TOLERANCE is 20x the worst noise (0.0009 dB). A cue made 0.5 dB louder moves the
# window holding it by only 0.028-0.044 dB (measured), so this check has about 1.4x margin at
# 0.5 dB and does not see smaller cue changes: the fingerprint is the primary level guard, and
# this is a coarse backstop on the shipped file.
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
    built = []  # the rendered Stages, so a test can re-mix them without rendering again

    def keep(*args, **kwargs):
        built.append(real(*args, **kwargs))
        return built[-1]

    real = arrange.build_stages
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(arrange, "build_stages", keep)
        fp = build_starswarm_bgm.build(
            out, stages=root / "stages", log=lambda *_: None, with_fingerprint=True
        )
    return out, root / "stages", fp, built[0]


def test_recipe_matches_the_reference_fingerprint(rebuild):
    _, _, fp, _ = rebuild
    problems = fingerprint.differences(fp, fingerprint.load())
    assert not problems, (
        "the encoder-free stages moved; if the music change is intended, run "
        "`python tools/assets/build_starswarm_bgm.py --write-fingerprint`:\n"
        + "\n".join(problems[:20])
    )


def test_recipe_rebuilds_the_shipped_track(rebuild):
    out, stages, _, _ = rebuild
    fresh, shipped = _decode(out), _decode(build_starswarm_bgm.SHIPPED)
    assert len(fresh) == len(shipped)
    err = np.sqrt(np.mean((fresh - shipped) ** 2) / np.mean(shipped**2))
    assert err < RMS_TOLERANCE, f"rebuild differs from the shipped track: relative RMS {err:.2e}"
    w = WINDOW_S * SR * 2  # interleaved stereo samples
    for k in range(0, len(shipped), w):  # the last window may be shorter
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
    # Cross-machine noise, at 3x the worst measured (fingerprint.py): every sample scaled by
    # 2.3e-6 and the peak sample by a further 7.8e-6 (#4026 failed CI on a 2.6e-6 peak at the
    # old 1e-6 tolerance).
    noisy = _toy_stage(0.7) * (1 + 3 * 7.7e-7)
    k = np.unravel_index(np.argmax(np.abs(noisy)), noisy.shape)
    noisy[k] *= 1 + 3 * 2.6e-6
    assert not fingerprint.differences(fingerprint.summarise(noisy), want)
    # A 0.1 dB change to one cue is far outside it.
    louder = fingerprint.summarise(_toy_stage(0.7 * 10 ** (0.1 / 20)))
    assert fingerprint.differences(louder, want)


def test_peaks_get_the_looser_tolerance_and_windows_the_tighter():
    # Between the two tolerances (1e-5 < 5e-5 < 1e-4): passes as a peak, fails as an RMS window.
    want = fingerprint.summarise(_toy_stage(0.7))
    peak_moved = {**want, "peak": want["peak"] * (1 + 5e-5)}
    assert not fingerprint.differences(peak_moved, want)
    rms_moved = {**want, "rms": [[v * (1 + 5e-5) for v in ch] for ch in want["rms"]]}
    problems = fingerprint.differences(rms_moved, want)
    assert problems and all(".rms[" in p for p in problems)


def test_fingerprint_catches_the_smallest_real_cue_change(rebuild):
    # The real recipe, not a toy: the quiet distant-organ cue is the one whose level moves the
    # dry mix least (1.55e-4 at +0.1 dB, measured), so it is the margin that matters.
    _, _, fp, stages = rebuild
    dry_bed = np.ascontiguousarray(stages.bed_pcm.T)
    organs = [(k, c) for k, c in enumerate(arrange.MAIN_CUES) if getattr(c, "layer", "") == "organ"]
    assert len(organs) == 1, "expected one organ cue in MAIN_CUES; update this test"
    k, organ = organs[0]
    # Control: the unchanged re-mix matches, so a difference below can only be the 0.1 dB.
    same = arrange.mix_full(dry_bed, arrange.mix_intro(dry_bed, stages.phrases), stages.phrases)
    assert not fingerprint.differences(fingerprint.summarise(same), fp["dry_mix"])
    louder = dataclasses.replace(organ, level=organ.level * 10 ** (0.1 / 20))
    cues = [*arrange.MAIN_CUES[:k], louder, *arrange.MAIN_CUES[k + 1 :]]
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(arrange, "MAIN_CUES", cues)
        mix = arrange.mix_full(dry_bed, arrange.mix_intro(dry_bed, stages.phrases), stages.phrases)
    problems = fingerprint.differences(fingerprint.summarise(mix), fp["dry_mix"])
    assert problems, "a 0.1 dB change to the organ cue went unnoticed"


def test_fingerprint_catches_a_moved_window_or_length():
    want = fingerprint.summarise(_toy_stage(0.7))
    shifted = np.roll(_toy_stage(0.7), 3 * SR, axis=1)
    assert fingerprint.differences(fingerprint.summarise(shifted), want)
    assert fingerprint.differences(fingerprint.summarise(_toy_stage(0.7)[:, :-SR]), want)


def test_reference_fingerprint_is_compact_and_covers_every_stage():
    ref = fingerprint.load()
    assert set(ref) == {"window_s", "bed", "dry_mix", "phrases", "shipped_sha256"}
    assert set(ref["phrases"]) == set(arrange.LAYERS)
    assert ref["bed"]["samples"] == arrange.DUR * SR
    assert ref["dry_mix"]["samples"] == arrange.DUR * SR
    assert fingerprint.REFERENCE.stat().st_size < 16_384  # a fingerprint, not audio


def test_reference_fingerprint_belongs_to_the_shipped_track():
    # Refreshing the reference without replacing the MP3 would bless a recipe change the shipped
    # track lacks; --write-fingerprint records the hash so this catches a stale pairing.
    assert fingerprint.load()["shipped_sha256"] == build_starswarm_bgm.sha256(
        build_starswarm_bgm.SHIPPED
    ), "the shipped MP3 changed without --write-fingerprint (or the reference was edited alone)"


def test_write_fingerprint_refuses_a_silent_refresh():
    committed = {**_fp(1.0), "shipped_sha256": "a" * 64}
    moved = _fp(1.1)
    # The fingerprint moved and the shipped MP3 did not: refuse.
    assert fingerprint.refuse_reason(moved, committed, "a" * 64)
    # The documented order (MP3 replaced first, so its hash differs): allowed.
    assert fingerprint.refuse_reason(moved, committed, "b" * 64) is None
    # Nothing moved, or no reference yet: allowed.
    assert fingerprint.refuse_reason(_fp(1.0), committed, "a" * 64) is None
    assert fingerprint.refuse_reason(moved, None, "a" * 64) is None


def test_write_fingerprint_cli_refuses_unless_forced(tmp_path, monkeypatch):
    ref = tmp_path / "ref.json"
    sha = build_starswarm_bgm.sha256(build_starswarm_bgm.SHIPPED)
    fingerprint.write({**_fp(1.0), "shipped_sha256": sha}, ref)
    monkeypatch.setattr(fingerprint, "REFERENCE", ref)
    monkeypatch.setattr(build_starswarm_bgm, "build", lambda *_a, **_k: _fp(1.1))
    assert build_starswarm_bgm.main(["--write-fingerprint"]) == 1
    assert fingerprint.load(ref)["bed"] == _fp(1.0)["bed"]
    assert build_starswarm_bgm.main(["--write-fingerprint", "--force"]) == 0
    assert fingerprint.load(ref)["bed"] == _fp(1.1)["bed"]


def _fp(level: float) -> dict:
    stage = fingerprint.summarise(_toy_stage(0.7 * level))
    return {"window_s": 5, "bed": stage, "dry_mix": stage, "phrases": {"rise": stage}}


def test_documented_loop_script_hash_is_current():
    digest = hashlib.sha256(LOOP_SCRIPT.read_bytes()).hexdigest()
    for doc in LOOP_SCRIPT_DOCS:
        assert digest in doc.read_text(encoding="utf-8"), (
            f"{doc.relative_to(REPO)} records a stale SHA-256 for tools/assets/"
            f"make_starswarm_bgm_loop.py; update it to {digest} (the hash must be refreshed "
            "whenever the loop script changes, even a docstring edit)"
        )


# --layers (#4000): each layer and Shepard tone on its own, as an MP3.


def _need_mp3_encoder() -> None:
    """Skip locally, fail under CI, when ffmpeg/ffprobe cannot encode and measure MP3 (as the
    rebuild test does)."""
    problem = None
    if shutil.which("ffmpeg") is None:
        problem = "ffmpeg is not installed"
    elif shutil.which("ffprobe") is None:
        problem = "ffprobe is not installed"
    elif (
        "libmp3lame"
        not in subprocess.run(
            ["ffmpeg", "-v", "error", "-encoders"], check=False, capture_output=True, text=True
        ).stdout
    ):
        problem = "ffmpeg has no libmp3lame encoder"
    if problem:
        if os.environ.get("CI"):
            pytest.fail(f"{problem}; the CI test-tools job must provide it")
        pytest.skip(problem)


def _toy_phrase(secs: int) -> np.ndarray:
    """A stereo tone `secs` long: stands in for a layer's phrase where the real one is too slow."""
    t = np.arange(secs * SR) / SR
    return (0.3 * np.sin(2 * np.pi * 330 * t))[None, :].repeat(2, axis=0).astype(np.float32)


def _toy_layers(monkeypatch) -> None:
    """Replace each layer with a short phrase of its own length (1 s, 2 s, ...). Keeps the real
    names, so the file names are the real ones."""
    layers = {name: (lambda secs=i: _toy_phrase(secs)) for i, name in enumerate(arrange.LAYERS, 1)}
    monkeypatch.setattr(arrange, "LAYERS", layers)


def _expected_layer_files() -> list[str]:
    names = [f"{i:02d}-{name}.mp3" for i, name in enumerate(arrange.LAYERS, 1)]
    n = len(names)
    shepards = [c for c in arrange.MAIN_CUES if isinstance(c, arrange.ShepardCue)]
    names += [f"{n + i:02d}-shepard-{c.at:g}s.mp3" for i, c in enumerate(shepards, 1)]
    return names


def test_peak_scaled_hits_the_target_peak_and_refuses_silence():
    x = np.random.default_rng(0).standard_normal((2, 1000)) * 0.123
    y = build_starswarm_bgm.peak_scaled(x)
    assert y.dtype == np.float32 and y.shape == x.shape
    assert np.max(np.abs(y)) == pytest.approx(build_starswarm_bgm.LAYER_PEAK, rel=1e-6)
    with pytest.raises(ValueError):
        build_starswarm_bgm.peak_scaled(np.zeros((2, 10)))


def test_layers_writes_one_numbered_mp3_per_layer_and_shepard_cue(tmp_path, monkeypatch):
    _need_mp3_encoder()
    _toy_layers(monkeypatch)
    out = tmp_path / "layers"
    assert build_starswarm_bgm.main(["--layers", str(out)]) == 0
    assert sorted(p.name for p in out.iterdir()) == sorted(_expected_layer_files())
    assert [n for n in _expected_layer_files() if "shepard" in n] == [
        "06-shepard-136s.mp3",
        "07-shepard-333s.mp3",
    ]


def test_layers_alone_does_not_call_the_full_build(tmp_path, monkeypatch):
    _need_mp3_encoder()
    _toy_layers(monkeypatch)

    def must_not_build(*_args, **_kwargs):
        pytest.fail("--layers alone ran the full build")

    monkeypatch.setattr(build_starswarm_bgm, "build", must_not_build)
    assert build_starswarm_bgm.main(["--layers", str(tmp_path / "layers")]) == 0


def test_layers_with_out_or_stages_also_runs_the_build(tmp_path, monkeypatch):
    _need_mp3_encoder()
    _toy_layers(monkeypatch)
    calls = []
    monkeypatch.setattr(build_starswarm_bgm, "build", lambda *a, **k: calls.append((a, k)))
    layers, stages = tmp_path / "layers", tmp_path / "stages"
    assert build_starswarm_bgm.main(["--layers", str(layers), "OUT.mp3"]) == 0
    assert build_starswarm_bgm.main(["--layers", str(layers), "--stages", str(stages)]) == 0
    assert calls == [((Path("OUT.mp3"), None), {}), ((None, stages), {})]
    assert (layers / "01-rise.mp3").exists()


def test_no_output_layers_or_check_is_rejected(monkeypatch):
    def must_not_build(*_args, **_kwargs):
        pytest.fail("built with nothing to write")

    monkeypatch.setattr(build_starswarm_bgm, "build", must_not_build)
    with pytest.raises(SystemExit) as exc:
        build_starswarm_bgm.main([])
    assert exc.value.code == 2  # argparse's ap.error: nothing to do


def test_layers_rejects_write_fingerprint_and_a_file_path(tmp_path, monkeypatch):
    def must_not_build(*_args, **_kwargs):
        pytest.fail("built although --layers was refused")

    monkeypatch.setattr(build_starswarm_bgm, "build", must_not_build)
    out = tmp_path / "layers"
    with pytest.raises(SystemExit) as exc:
        build_starswarm_bgm.main(["--layers", str(out), "--write-fingerprint"])
    assert exc.value.code == 2 and not out.exists()
    # A file where DIR should be: refuse instead of a traceback, and leave the file alone.
    f = tmp_path / "file.txt"
    f.write_text("keep")
    with pytest.raises(SystemExit) as exc:
        build_starswarm_bgm.main(["--layers", str(f)])
    assert exc.value.code == 2 and f.read_text() == "keep"


def test_layers_hand_each_full_phrase_and_shepard_cue_to_the_encoder(tmp_path, monkeypatch):
    # No ffmpeg: the encoder is stubbed, so this checks what each file is made from. The real
    # encoder and decoder run in the test below.
    _toy_layers(monkeypatch)
    encoded = []

    def fake_encode(x):
        encoded.append(x)
        return b"x"

    monkeypatch.setattr(build_starswarm_bgm, "encode_mp3_f32", fake_encode)
    rendered_cues = []
    real_render = shepard.render

    def spy_render(duration, rate=0.15, base=245.0, n=None):
        rendered_cues.append((duration, rate, base))
        return real_render(duration, rate, base, n)

    monkeypatch.setattr(shepard, "render", spy_render)
    out = tmp_path / "layers"
    assert build_starswarm_bgm.main(["--layers", str(out)]) == 0

    cues = [c for c in arrange.MAIN_CUES if isinstance(c, arrange.ShepardCue)]
    assert rendered_cues == [(c.secs, c.rate, c.base) for c in cues]
    assert len(encoded) == len(arrange.LAYERS) + len(cues)
    peak = build_starswarm_bgm.LAYER_PEAK
    for i in range(len(arrange.LAYERS)):
        x = encoded[i]  # the whole toy phrase, i + 1 seconds long, at the target peak
        assert x.shape == (2, (i + 1) * SR), x.shape
        assert np.max(np.abs(x)) == pytest.approx(peak, rel=1e-5)
    for j, cue in enumerate(cues):
        x = encoded[len(arrange.LAYERS) + j]
        assert x.shape == (2, round(cue.secs * SR)), cue
        assert np.max(np.abs(x)) == pytest.approx(peak, rel=1e-5)  # not silent
        # The fades are applied: the tone starts and ends at silence, as in the mix.
        assert np.all(x[:, 0] == 0) and np.max(np.abs(x[:, -1])) < 1e-3 * peak, cue


def _channels(path: Path) -> int:
    done = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=channels", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    return int(done.stdout.strip())


def _duration(path: Path) -> float:
    done = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    )  # fmt: skip
    return float(done.stdout.strip())


def test_layer_files_are_stereo_non_silent_and_roughly_at_the_target(tmp_path):
    # The real renderers, end to end through ffmpeg. The float render peaks at exactly LAYER_PEAK
    # (the test above checks it); libmp3lame at 128 kbps then decodes a full-scale sine at 0.475
    # (measured), so the decoded peak gets only a loose sanity bound.
    _need_mp3_encoder()
    out = tmp_path / "layers"
    assert build_starswarm_bgm.main(["--layers", str(out)]) == 0
    assert sorted(p.name for p in out.iterdir()) == sorted(_expected_layer_files())
    for path in sorted(out.iterdir()):
        assert _channels(path) == 2, path.name
        peak = float(np.max(np.abs(_decode(path))))
        assert 0.40 <= peak <= 0.55, f"{path.name} decodes to a peak of {peak:.3f}"
    shepard_names = _expected_layer_files()[len(arrange.LAYERS) :]
    cues = [c for c in arrange.MAIN_CUES if isinstance(c, arrange.ShepardCue)]
    for name, cue in zip(shepard_names, cues, strict=True):
        assert abs(_duration(out / name) - cue.secs) < 0.1, name
