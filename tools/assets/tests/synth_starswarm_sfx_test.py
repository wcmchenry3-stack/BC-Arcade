"""pytest suite for synth_starswarm_sfx.py (#3672): determinism, range and unknown-name rejection.

That the shipped files equal the recipes is `synth_shipped_test.py`.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import synth_starswarm_sfx
from synth_common import SR


def test_generator_rejects_unknown_sound(tmp_path):
    with pytest.raises(SystemExit, match="unknown sound"):
        synth_starswarm_sfx.main(tmp_path, ["no-such-sound"])
    assert list(tmp_path.iterdir()) == []


def test_every_sound_is_deterministic_and_in_range():
    for name, (recipe, peak) in synth_starswarm_sfx.SOUNDS.items():
        a = synth_starswarm_sfx.norm(recipe(), peak)
        b = synth_starswarm_sfx.norm(recipe(), peak)
        assert np.array_equal(a, b), name
        assert 0 < len(a) <= 12 * SR, name
        assert np.max(np.abs(a)) <= 1.0, name


def test_normal_run_writes_only_starswarm_prefixed_files(tmp_path, monkeypatch):
    # The encoder is stubbed, so this runs without ffmpeg: it is the names that are checked.
    monkeypatch.setattr(
        synth_starswarm_sfx, "write_ogg", lambda _x, path: Path(path).write_bytes(b"x")
    )
    synth_starswarm_sfx.main(tmp_path, ["explosion", "pickup"])
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "starswarm-explosion.ogg",
        "starswarm-pickup.ogg",
    ]
