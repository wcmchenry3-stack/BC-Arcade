"""pytest suite for check_bgm_originality.py (#3637). Synthetic audio only; no repo audio."""

import shutil
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import check_bgm_originality as cbo

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")

FRAMES = 40  # 80 s of chroma


def rand_chroma(seed: int, n: int = FRAMES) -> np.ndarray:
    c = np.random.default_rng(seed).random((n, 12))
    return c / np.linalg.norm(c, axis=1, keepdims=True)


def tone_track(freqs: list[float], seconds: int = 40) -> np.ndarray:
    """A chord progression: each 2 s frame holds one freq (plus its fifth), so chroma varies."""
    t = np.arange(cbo.FRAME_SAMPLES) / cbo.SR
    frames = []
    for i in range(seconds // cbo.FRAME_S):
        f = freqs[i % len(freqs)]
        frames.append(np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * f * 1.5 * t))
    return np.concatenate(frames).astype(np.float32)


def test_chroma_shape_and_unit_norm():
    ch = cbo.chroma_from_pcm(tone_track([220.0, 247.0]))
    assert ch.shape == (20, 12)
    assert np.allclose(np.linalg.norm(ch, axis=1), 1.0)


def test_chroma_of_a440_peaks_on_pitch_class_a():
    ch = cbo.chroma_from_pcm(tone_track([440.0]))
    assert ch.shape[1] == 12 and int(np.argmax(ch[0])) == 9  # C=0 ... A=9


def test_track_scores_one_against_itself():
    a = rand_chroma(1)
    assert cbo.best_similarity(a, a) == pytest.approx(1.0, abs=1e-6)


def test_transposed_copy_scores_about_one():
    a = rand_chroma(2)
    assert cbo.best_similarity(a, np.roll(a, 5, axis=1)) == pytest.approx(1.0, abs=1e-6)


def test_time_shifted_excerpt_scores_one():
    a = rand_chroma(3, 60)
    assert cbo.best_similarity(a, a[9:49]) == pytest.approx(1.0, abs=1e-6)


def test_unrelated_chroma_scores_clearly_lower():
    a, b = rand_chroma(4), rand_chroma(5)
    assert cbo.best_similarity(a, b) < 0.9


def test_audio_transposed_by_a_fifth_is_caught():
    prog = [220.0, 261.63, 196.0, 246.94]
    a = cbo.chroma_from_pcm(tone_track(prog))
    b = cbo.chroma_from_pcm(tone_track([f * 1.5 for f in prog]))
    assert cbo.best_similarity(a, b) > 0.95


def test_evaluate_pass_and_fail_follow_threshold():
    sources = {"s1": rand_chroma(10), "s2": rand_chroma(11), "s3": rand_chroma(12)}
    ok = cbo.evaluate(rand_chroma(13), sources)
    assert ok["threshold"] == max(ok["baseline"].values())
    assert len(ok["baseline"]) == 3
    assert ok["passed"] == all(s <= ok["threshold"] for s in ok["scores"].values())
    copy = cbo.evaluate(np.roll(sources["s1"], 3, axis=1), sources)
    assert copy["scores"]["s1"] == pytest.approx(1.0, abs=1e-6)
    assert copy["passed"] is False
    assert "FAIL" in cbo.format_report("cand", copy)


def test_evaluate_needs_two_sources():
    with pytest.raises(ValueError):
        cbo.evaluate(rand_chroma(1), {"only": rand_chroma(2)})


def test_report_is_markdown_table_with_verdict():
    sources = {"s1": rand_chroma(10), "s2": rand_chroma(11)}
    text = cbo.format_report("cand", cbo.evaluate(rand_chroma(13), sources))
    assert text.startswith("| Pair |")
    assert "threshold" in text and ("PASS" in text or "FAIL" in text)


def _write_wav(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(cbo.SR)
        w.writeframes((np.clip(pcm, -1, 1) * 20000).astype("<i2").tobytes())


def _similar_sources() -> dict[str, np.ndarray]:
    """Two sources that resemble each other (high baseline), so unrelated candidates pass."""
    s1 = rand_chroma(20)
    s2 = np.abs(s1 + 0.05 * rand_chroma(21))
    return {"s1.mp3": s1, "s2.mp3": s2 / np.linalg.norm(s2, axis=1, keepdims=True)}


def test_cli_exit_codes_follow_verdict(monkeypatch, capsys):
    tracks = {**_similar_sources(), "copy.mp3": np.roll(_similar_sources()["s1.mp3"], 2, axis=1)}
    tracks["fresh.mp3"] = rand_chroma(99)
    monkeypatch.setattr(cbo, "chroma_from_file", lambda p: tracks[Path(p).name])
    assert cbo.main(["fresh.mp3", "s1.mp3", "s2.mp3"]) == 0
    assert "PASS" in capsys.readouterr().out
    assert cbo.main(["copy.mp3", "s1.mp3", "s2.mp3"]) == 1
    assert "FAIL" in capsys.readouterr().out


@needs_ffmpeg
def test_cli_decodes_real_files(tmp_path, capsys):
    prog = [220.0, 261.63, 196.0, 246.94]
    _write_wav(tmp_path / "a.wav", tone_track(prog))
    _write_wav(tmp_path / "b.wav", tone_track([330.0, 294.0, 349.0, 311.0]))
    _write_wav(tmp_path / "copy.wav", tone_track(prog))
    assert (
        cbo.main([str(tmp_path / "copy.wav"), str(tmp_path / "a.wav"), str(tmp_path / "b.wav")])
        == 1
    )
    assert "FAIL" in capsys.readouterr().out
