"""pytest suite for synth_starswarm_bgm.py (#3636). Renders only short excerpts."""

import re
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import synth_starswarm_bgm as bgm
from synth_common import SR

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
SCRIPT = Path(bgm.__file__)


def _centroid(x: np.ndarray) -> float:
    mag = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float((mag * f).sum() / mag.sum())


# --- determinism -----------------------------------------------------------------------------


@pytest.fixture(scope="module")
def window():
    """One short window of the real track (rendered once for the module), with its stats."""
    st: dict = {}
    return bgm.render_track(300.0, 300.5, stats=st), st


def test_same_seed_renders_identical_samples(window):
    a = window[0]
    b = bgm.render_track(300.0, 300.5)
    assert a.shape == (2, SR // 2)
    assert a.dtype == np.float32
    assert np.array_equal(a, b)
    assert np.abs(a).max() > 0.01  # not silence


def test_recipes_are_seeded():
    ev = bgm.Ev("pad", 0.0, 2.0, p={"notes": ["C4", "G4"], "seed": 1})
    other = bgm.Ev("pad", 0.0, 2.0, p={"notes": ["C4", "G4"], "seed": 2})
    n = 2 * SR
    assert np.array_equal(bgm.r_pad(ev, n), bgm.r_pad(ev, n))
    assert not np.array_equal(bgm.r_pad(ev, n), bgm.r_pad(other, n))


def test_event_list_is_deterministic():
    a, b = bgm.track_events(), bgm.track_events()
    assert [(e.kind, e.start, e.dur, e.p.get("seed")) for e in a] == [
        (e.kind, e.start, e.dur, e.p.get("seed")) for e in b
    ]


# --- Shepard tone ----------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["glide", "stepped"])
def test_shepard_envelope_stays_fixed_while_partials_fall(mode):
    t = np.arange(0, 12, 0.01)
    f, a = bgm.shepard_partials(t, mode=mode)
    # The amplitude-weighted mean log-frequency (the envelope's centre) does not move...
    w = a**2
    centre = (w * np.log2(f)).sum(0) / w.sum(0)
    assert np.ptp(centre) < 0.02  # octaves
    assert abs(centre.mean() - np.log2(600.0)) < 0.1
    # ...while every partial only ever falls, except when it wraps from the bottom to the top,
    # where its amplitude is negligible.
    d = np.diff(np.log2(f), axis=1)
    wraps = d > 1
    assert (d[~wraps] <= 1e-12).all()
    assert (d[~wraps] < 0).mean() > (0.99 if mode == "glide" else 0.15)
    assert a[:, 1:][wraps].max() < 1e-3
    assert np.log2(f[4, -1]) < np.log2(f[4, 0])  # a mid partial ends lower than it started


def test_rendered_shepard_centroid_stays_put():
    ev = bgm.Ev("shepard", 0.0, 8.0, p={"mode": "glide", "seed": 0})
    x = bgm.r_shepard(ev, 8 * SR)[0]
    w = SR // 2
    cents = [_centroid(x[i : i + w]) for i in range(SR * 3, SR * 5, w // 2)]
    assert max(cents) / min(cents) < 1.15


# --- crossfades and starting points ----------------------------------------------------------


def _envelope_only(ev, i0, i1):
    """Stand-in recipe: the event's own envelope at unit power, both channels."""
    a_def, r_def = bgm.DEFAULT_AR.get(ev.kind, (1.0, 1.0))
    t = np.arange(i0, i1) / SR
    e = bgm.env_ar(t, ev.dur, ev.p.get("attack", a_def), ev.p.get("release", r_def))
    return np.stack([e, e])


@pytest.mark.parametrize("window", list(bgm.XFADES))
def test_rendered_handover_power_is_equal_power(window, monkeypatch):
    """Render the two parts across a crossfade through the real gain path (window fitting,
    part_gain, level curves) with each sound replaced by its envelope at unit power; the
    summed power must not dip or bulge in the window (the bug was a ~2 dB dip mid-window,
    from event attacks multiplying the part crossfade)."""
    monkeypatch.setattr(bgm, "WHOLE", {})
    monkeypatch.setattr(
        bgm, "RANGED", dict.fromkeys(bgm.DEFAULT_AR | {"shepard": 0}, _envelope_only)
    )
    a, b = bgm.XFADES[window]
    parts = [p for p, (wi, wo) in bgm.PART_WINDOWS.items() if window in (wi, wo)]
    events = [
        bgm.Ev(e.kind, e.start, e.dur, e.gain_db, e.send, e.part,
               {k: v for k, v in e.p.items() if k != "swell"})  # the swell is breath, not a fade
        for e in bgm.track_events() if e.part in parts
    ]  # fmt: skip
    t0, t1 = a - 6, b + 6
    w0, n = round(t0 * SR), round((t1 - t0) * SR)
    power = np.zeros(n)
    for ev in events:  # one at a time, so the powers add (sounds are uncorrelated)
        dry, _ = bgm.render_events([ev], w0, n, loop=True)
        power += dry[0].astype(np.float64) ** 2
    c = np.concatenate([[0.0], np.cumsum(power)])
    starts = np.arange(0, t1 - t0 - 3, 1.0)
    level = 10 * np.log10(np.array([c[round((s + 3) * SR)] - c[round(s * SR)] for s in starts]))
    level -= 10 * np.log10(3 * SR)
    edges = np.r_[level[:3], level[-3:]]
    assert np.abs(np.diff(level)).max() < 1.0, window
    assert level.min() >= edges.min() - 1.0, window
    assert level.max() <= edges.max() + 1.0, window


def test_equal_power_crossfade():
    p = np.linspace(0, 1, 1001)
    out, inn = bgm.equal_power(p)
    assert np.allclose(out**2 + inn**2, 1.0)
    assert out[0] == 1 and inn[0] == 0
    assert inn[-1] == pytest.approx(1) and out[-1] == pytest.approx(0, abs=1e-12)
    assert (np.diff(out) <= 0).all() and (np.diff(inn) >= 0).all()


def test_part_gains_are_equal_power_across_every_window():
    for name, (a, b) in bgm.XFADES.items():
        t = np.linspace(a, b, 500, endpoint=False)
        gains = {p: bgm.part_gain(p, t) for p in bgm.PARTS}
        live = [p for p, g in gains.items() if g.max() > 0]
        assert len(live) == 2, name
        total = sum(g**2 for g in gains.values())
        assert np.allclose(total, 1.0), name


def test_part_gains_cover_the_whole_track():
    t = np.arange(0, bgm.T_TOTAL, 0.25)
    total = sum(bgm.part_gain(p, t) ** 2 for p in bgm.PARTS)
    assert np.allclose(total, 1.0)


def test_crossfades_are_20_to_30_seconds():
    for a, b in bgm.XFADES.values():
        assert 20 <= b - a <= 30


def test_starting_points():
    sp = bgm.STARTING_POINTS
    assert len(sp) == 6
    assert list(sp) == sorted(set(sp))
    assert sp[0] == 0
    assert all(0 <= s < bgm.T_TOTAL for s in sp)
    for s in sp:
        assert not bgm.in_window(s), s
        # ...and far enough from a window that the start clip's fade-in is outside it too.
        assert not bgm.in_window(s + bgm.START_FADE_IN), s


def test_track_length():
    assert abs(bgm.T_TOTAL - 705.1) <= 5
    assert round(bgm.T_TOTAL * SR) == bgm.NT


def test_brightness_curves_ramp():
    for curve in (bgm.TILT, bgm.TOPCUT):
        times = [p[0] for p in curve]
        assert times == sorted(times)
        assert len(set(times)) == len(times)  # no two values at one time: no jumps
    tilt = bgm.curve_db(bgm.TILT, np.array([0.0, bgm.T_TOTAL]))
    assert tilt[0] == tilt[1]  # the loop seam has no brightness step


# --- clips -----------------------------------------------------------------------------------


def test_clip_lengths_are_as_specified():
    secs = {n: bgm.clip_seconds(n) for n in bgm.CLIPS}
    assert secs["00-draft-full"] == bgm.T_TOTAL
    assert secs["01-cold-open-triumphant-to-dark"] == 60.0  # 0:00-1:00, as specified
    joins = {n for n, c in bgm.CLIPS.items() if c.kind == "join"}
    for n, s in secs.items():
        if n in joins or n in ("00-draft-full", "01-cold-open-triumphant-to-dark"):
            continue
        assert 20 <= s <= 40, n
    for n in joins:
        c = bgm.CLIPS[n]
        expected = sum(secs[p] for p in c.parts) + c.gap * (len(c.parts) - 1)
        assert secs[n] == pytest.approx(expected)


def test_every_requested_clip_exists():
    names = set(bgm.CLIPS)
    required = {
        "00-draft-full",
        "01-cold-open-triumphant-to-dark",
        "02-dark-turn",
        "04-c-major-lift",
        "05-three-choruses",
        "06a-shepard-glide",
        "06b-shepard-stepped",
        "07-shooting-stars",
        "08-shadows-stir",
        "09a-coldopen-to-cathedral",
        "09b-cathedral-to-swarm",
        "09c-swarm-to-shadows",
        "09d-loop-seam",
    }
    assert required <= names
    assert len([n for n in names if n.startswith("03")]) >= 2  # organ voicings
    assert len([n for n in names if re.match(r"05[abc]-", n)]) == 3  # each chorus alone
    assert {f"10-start-{k}" for k in range(1, 7)} <= names
    contrasts = [c for c in bgm.CLIPS.values() if "contrast" in c.name]
    assert any(all(p.startswith("03") for p in c.parts) and len(c.parts) >= 2 for c in contrasts)
    assert any(all(p.startswith("06") for p in c.parts) and len(c.parts) == 2 for c in contrasts)


def test_start_clips_match_starting_points():
    for k, s in enumerate(bgm.STARTING_POINTS):
        c = bgm.CLIPS[f"10-start-{k + 1}"]
        assert (c.a, c.fade_in) == (s, 1.5)
        assert bgm.clip_seconds(c.name) == pytest.approx(20)


def test_excerpt_length_and_loop_wrap():
    track = np.tile(np.arange(10 * SR, dtype=np.float32), (2, 1))
    x = bgm.excerpt(track, 8.0, 12.0)  # wraps past the end
    assert x.shape == (2, 4 * SR)
    assert x[0, 0] == 8 * SR and x[0, 2 * SR] == 0
    assert np.all(np.diff(x[0, : 2 * SR]) == 1) and np.all(np.diff(x[0, 2 * SR :]) == 1)


def test_loop_seam_clip_spans_the_end():
    c = bgm.CLIPS["09d-loop-seam"]
    assert c.a < bgm.T_TOTAL < c.b
    assert bgm.T_TOTAL - c.a == pytest.approx(20) and c.b - bgm.T_TOTAL == pytest.approx(20)


def test_fade_edges():
    x = bgm.fade_edges(np.ones((2, SR), np.float32), 0.1, 0.1)
    assert x[0, 0] == 0 and x[0, -1] == 0 and x[0, SR // 2] == 1


# --- originality guards ----------------------------------------------------------------------


def test_script_never_references_the_source_tracks():
    src = SCRIPT.read_text()
    assert "starswarm-bg-" not in src
    assert '.mp3"' not in src.replace('f"{c.name}.mp3"', "").replace('f"{n}.mp3"', "")
    assert "frontend" not in src  # reads nothing from the app's assets


def test_motifs_are_at_most_four_notes():
    assert bgm.MOTIFS
    for name, motif in bgm.MOTIFS.items():
        assert name.startswith("MOTIF_")
        assert getattr(bgm, name) == motif
        assert 1 <= len(motif) <= 4, name
        for n in motif:
            bgm.midi(n)  # every entry is a note name
    # Every MOTIF_ constant in the module is registered (none slips past this test).
    assert {k for k in vars(bgm) if k.startswith("MOTIF_")} == set(bgm.MOTIFS)


def test_note_names():
    assert bgm.midi("A4") == 69 and bgm.midi("C4") == 60 and bgm.midi("C#5") == 73
    assert bgm.hz("A4") == pytest.approx(440.0)
    assert bgm.midi("Db4") == bgm.midi("C#4")
    with pytest.raises(ValueError):
        bgm.midi("H2")


# --- mixing helpers --------------------------------------------------------------------------


def test_envelopes_have_no_clicks():
    t = np.arange(0, 10, 1 / SR)
    e = bgm.env_ar(t, 10.0, 2.0, 3.0)
    assert e[0] == 0 and e[-1] < 1e-6
    assert np.abs(np.diff(e)).max() < 1e-4


def test_limiter_respects_ceiling():
    rng = np.random.default_rng(0)
    x = (rng.standard_normal((2, SR)) * 0.5).astype(np.float32)
    y = bgm.limit(x, -2.0)
    assert np.abs(y).max() <= 10 ** (-2 / 20) + 1e-6
    quiet = x * 0.1
    assert np.allclose(bgm.limit(quiet, -2.0), quiet)


def test_k_weighting_matches_bs1770():
    w = bgm.k_weight_power(np.array([20.0, 1000.0, 10000.0]))
    db = 10 * np.log10(w)
    assert db[1] == pytest.approx(0.7, abs=0.2)  # ~+0.7 dB at 1 kHz
    assert db[2] == pytest.approx(4.0, abs=0.3)  # the +4 dB high shelf
    assert db[0] < -10  # the RLB high-pass


def test_stft_identity_reconstructs():
    rng = np.random.default_rng(1)
    x = rng.standard_normal(SR)
    y = bgm.stft_process(x, lambda tc, f: np.ones((len(tc), len(f))))
    assert np.allclose(x, y, atol=1e-9)
    yc = bgm.stft_process(x, lambda tc, f: np.ones((len(tc), len(f))), circular=True)
    assert np.allclose(x, yc, atol=1e-9)


@needs_ffmpeg
def test_write_mp3_is_stereo_44k(tmp_path):
    import subprocess

    t = np.arange(SR) / SR
    x = np.stack([np.sin(2 * np.pi * 440 * t), np.sin(2 * np.pi * 660 * t)]).astype(np.float32)
    path = tmp_path / "a.mp3"
    bgm.write_mp3(x * 0.3, path)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=channels,sample_rate,codec_name",
         "-of", "default=nw=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout  # fmt: skip
    assert "codec_name=mp3" in probe and "channels=2" in probe and "sample_rate=44100" in probe


def test_main_rejects_unknown_clip(tmp_path):
    with pytest.raises(SystemExit, match="unknown clip"):
        bgm.main(tmp_path, ["no-such-clip"])


# --- review round 1 (#3643) ------------------------------------------------------------------


def test_cli_clip_name_only_uses_default_out_dir(monkeypatch):
    calls = []
    monkeypatch.setattr(bgm, "main", lambda out, names: calls.append((out, names)))
    bgm.cli(["03b-organ-flute"])
    assert calls == [(bgm.OUT_DEFAULT, ["03b-organ-flute"])]
    bgm.cli(["--out", "x", "06a-shepard-glide", "06b-shepard-stepped"])
    assert calls[-1] == (Path("x"), ["06a-shepard-glide", "06b-shepard-stepped"])
    bgm.cli([])
    assert calls[-1] == (bgm.OUT_DEFAULT, [])


def test_main_writes_only_the_named_clip(tmp_path, monkeypatch):
    written = []

    def no_draft(**_k):
        pytest.fail("no draft needed")

    monkeypatch.setattr(bgm, "render_track", no_draft)
    monkeypatch.setattr(bgm, "render_standalone", lambda *_a, **_k: np.zeros((2, SR), np.float32))
    monkeypatch.setattr(bgm, "write_mp3", lambda _x, path: written.append(path.name))
    bgm.main(tmp_path, ["03b-organ-flute"])
    assert written == ["03b-organ-flute.mp3"]
    assert "--out" in (tmp_path / "index.md").read_text()


def test_window_render_uses_the_draft_gain(window):
    assert window[1]["norm_db"] == bgm.DRAFT_GAIN_DB


_WRITE_SNIPPET = (
    "import sys; sys.path.insert(0, {d!r}); from pathlib import Path; import synth_starswarm_bgm"
    " as b; b.write_mp3(b.render_track(300.0, 300.5), Path({p!r}))"
)


@needs_ffmpeg
def test_mp3_write_path_is_deterministic_across_processes(tmp_path, window):
    import subprocess

    from synth_common import decoded_pcm_sha256

    a, b = tmp_path / "a.mp3", tmp_path / "b.mp3"
    bgm.write_mp3(window[0], a)
    code = _WRITE_SNIPPET.format(d=str(SCRIPT.parent), p=str(b))
    subprocess.run([sys.executable, "-c", code], check=True)
    assert decoded_pcm_sha256(a) == decoded_pcm_sha256(b)


def test_dither_is_seeded():
    x = np.full((2, 1000), 0.25, np.float32)
    assert bgm.to_pcm16(x) == bgm.to_pcm16(x)
    assert bgm.to_pcm16(x) != bgm.to_pcm16(x, seed=1)


def test_leveller_is_continuous_across_the_loop_seam():
    hop = 1024 / SR
    frame_times = (np.arange(round(bgm.T_TOTAL / hop) + 8) * 1024 - 2048) / SR
    # A periodic loudness pattern (one period == the track), with a slow and a fast part.
    ph = 2 * np.pi * frame_times / bgm.T_TOTAL
    ms = 10 ** ((-14 + 3 * np.sin(ph) + 2 * np.sin(17 * ph)) / 10)
    samples = np.array([0, bgm.NT - 1]) / SR
    g = bgm.leveller_db(ms, frame_times, samples, -12.0)
    assert abs(g[0] - g[1]) < 1e-4
    assert np.abs(bgm.leveller_db(ms, frame_times, frame_times, -12.0)).max() <= 4.0


def test_integrated_lufs_all_gated():
    assert bgm.integrated_lufs(np.zeros(400), 1024 / SR) == float("-inf")
    assert np.isfinite(bgm.integrated_lufs(np.full(400, 0.01), 1024 / SR))


def test_loop_limiter_sees_across_the_seam():
    x = np.zeros((2, SR), np.float32)
    x[:, 5] = 1.0  # a peak right after the seam
    y = bgm.limit(x, -6.0, loop=True)
    assert np.abs(y).max() <= 10 ** (-6 / 20) + 1e-6
    assert y.shape == x.shape


def test_render_reads_nothing(monkeypatch):
    """Originality guard: a render succeeds with every file and process read disabled."""
    import builtins
    import subprocess

    def refuse(*a, **_k):
        raise AssertionError(f"the generator tried to read input: {a[:1]}")

    for mod, name in ((builtins, "open"), (np, "fromfile"), (np, "load"), (subprocess, "run")):
        monkeypatch.setattr(mod, name, refuse)
    monkeypatch.setattr(bgm, "_IR_CACHE", {})  # rebuild the reverb too, under the guard
    x = bgm.render_track(300.0, 300.5)
    assert x.shape == (2, SR // 2) and np.abs(x).max() > 0
