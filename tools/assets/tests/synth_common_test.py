"""pytest suite for synth_common.py and synth_arcade_sfx.py (#3563)."""

import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import synth_arcade_sfx
from synth_common import (
    SR,
    decoded_pcm_sha256,
    fade,
    loopify,
    noise,
    norm,
    place,
    t_axis,
    write_ogg,
)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")


def test_noise_is_seeded():
    assert np.array_equal(noise(100, 7), noise(100, 7))
    assert not np.array_equal(noise(100, 7), noise(100, 8))


def test_norm_sets_peak():
    x = norm(np.sin(np.linspace(0, 20, 1000)) * 0.3, -6.0)
    assert np.max(np.abs(x)) == pytest.approx(10 ** (-6 / 20))


def test_fade_ends_at_silence():
    x = fade(np.ones(SR), 0.01, 0.01)
    assert x[0] == 0 and x[-1] == 0 and x[SR // 2] == 1


def test_place_clips_to_destination():
    dst = np.zeros(10)
    place(dst, np.ones(20), 5 / SR)
    assert dst.tolist() == [0] * 5 + [1] * 5


def test_loopify_is_seamless():
    # A 3 Hz sine over 2 s + the crossfade: the seam step is no bigger than a normal step.
    t = t_axis(2.15)
    y = loopify(np.sin(2 * np.pi * 3 * t))
    assert len(y) == int(2.15 * SR) - int(0.15 * SR)
    typical = np.max(np.abs(np.diff(y)))
    assert abs(y[0] - y[-1]) <= typical * 1.01


@needs_ffmpeg
def test_decoded_audio_is_reproducible(tmp_path):
    x = norm(np.sin(2 * np.pi * 440 * t_axis(0.2)) * noise(int(0.2 * SR), 1), -3.0)
    write_ogg(x, tmp_path / "a.ogg")
    write_ogg(x, tmp_path / "b.ogg")
    assert decoded_pcm_sha256(tmp_path / "a.ogg") == decoded_pcm_sha256(tmp_path / "b.ogg")


def test_generator_rejects_unknown_sound(tmp_path):
    with pytest.raises(SystemExit, match="unknown sound"):
        synth_arcade_sfx.main(tmp_path, ["no-such-sound"])
