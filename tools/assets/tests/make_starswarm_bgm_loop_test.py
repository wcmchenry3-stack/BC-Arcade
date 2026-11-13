"""pytest suite for make_starswarm_bgm_loop.py (#3638). Synthetic audio only; no repo audio."""

import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import make_starswarm_bgm_loop as m

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")

SR = 1000  # a low rate keeps the synthetic cases tiny; the maths does not depend on it
HEAD, TAIL, XF = 2.0, 18.0, 3.0


def noise(seconds: float = 20.0, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-0.2, 0.2, (int(seconds * SR), 2))


def loop(x: np.ndarray, gain_db: float = 0.0) -> np.ndarray:
    return m.make_loop(x, HEAD, TAIL, XF, gain_db, SR)


def test_constants_are_the_approved_values():
    assert (m.TRIM_HEAD_S, m.TRIM_TAIL_S, m.XFADE_S, m.GAIN_DB) == (2.5, 418.2, 3.0, 2.9)


def test_output_length_is_trimmed_span_minus_crossfade():
    assert len(loop(noise())) == int((TAIL - HEAD) * SR) - int(XF * SR)


def test_seam_is_continuous_across_the_loop_point():
    # A smooth tone: the step from the last sample back round to the first is an ordinary step.
    t = np.arange(20 * SR) / SR
    x = (0.3 * np.sin(2 * np.pi * 5 * t))[:, None] * np.ones((1, 2))
    y = loop(x)
    wrap_step = np.abs(y[0] - y[-1]).max()
    typical_step = np.abs(np.diff(y, axis=0)).max()
    assert wrap_step <= typical_step * 1.5


def test_file_starts_where_the_seam_ends():
    x = noise()
    y = loop(x)
    s = x[int(HEAD * SR) : int(TAIL * SR)]
    n = int(XF * SR)
    np.testing.assert_allclose(y[0], s[n])  # the sample after the faded-in opening block
    t = (n - 0.5) / n  # last seam sample: tail almost gone, opening almost fully in
    expected = s[-1] * np.cos(t * np.pi / 2) + s[n - 1] * np.sin(t * np.pi / 2)
    np.testing.assert_allclose(y[-1], expected)


def test_gain_is_2_9_db():
    x = noise()
    flat, gained = loop(x, 0.0), loop(x, m.GAIN_DB)
    db = 20 * np.log10(np.sqrt(np.mean(gained**2)) / np.sqrt(np.mean(flat**2)))
    assert db == pytest.approx(2.9, abs=1e-9)


def test_crossfade_is_equal_power():
    # Uncorrelated signals keep constant power through an equal-power seam (a linear one dips 3 dB).
    x = np.random.default_rng(1).standard_normal((20 * SR, 2)) * 0.1
    y = loop(x)
    n = int(XF * SR)
    s = x[int(HEAD * SR) : int(TAIL * SR)]
    body_rms = np.sqrt(np.mean(s[n:-n] ** 2))
    mid = y[-n:][n // 4 : 3 * n // 4]
    assert np.sqrt(np.mean(mid**2)) == pytest.approx(body_rms, rel=0.1)
    # and the weights themselves: cos^2 + sin^2 == 1 at every sample
    tt = (np.arange(n) + 0.5) / n
    np.testing.assert_allclose(np.cos(tt * np.pi / 2) ** 2 + np.sin(tt * np.pi / 2) ** 2, 1.0)


@needs_ffmpeg
def test_cli_writes_a_decodable_mp3_of_the_expected_length(tmp_path, monkeypatch):
    n = 30 * m.SR
    t = np.arange(n) / m.SR
    src = tmp_path / "src.wav"
    m.write_wav((0.1 * np.sin(2 * np.pi * 220 * t))[:, None] * np.ones((1, 2)), src)
    real = m.make_loop
    monkeypatch.setattr(m, "make_loop", lambda x: real(x, 2.0, 28.0, 3.0))
    out = tmp_path / "out.mp3"
    assert m.main([str(src), str(out), "--wav", str(tmp_path / "mid.wav")]) == 0
    assert (tmp_path / "mid.wav").exists()
    assert len(m.decode(out)) == (28 - 2 - 3) * m.SR
