"""The shipped sounds are what their generator recipes render now (#3672).

Every in-house sound in `frontend/assets/sounds/` is made by `synth_starswarm_sfx.py`,
`synth_arcade_sfx.py` or `synth_puzzle_sfx.py`. These tests fail when a recipe changes without the
`.ogg` being regenerated, or an `.ogg` is replaced by hand.

The comparison is on decoded samples, not encoded bytes, so a different Ogg/Vorbis encoder build does
not trip it. Each recipe is rendered, encoded the way the generator encodes it, decoded, and compared
with the decoded shipped file. The tolerance is a relative RMS error: well above what an encoder
update moves (nothing, today: the decodes are bit-identical) and well below a 0.5 dB level change in
one recipe parameter (a 5.9% error).

Needs ffmpeg with libvorbis. Locally the comparison skips without it; under CI (`CI` set) it fails
instead, so the guard cannot go quietly missing there. The ownership tests need nothing.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import synth_arcade_sfx
import synth_puzzle_sfx
import synth_starswarm_sfx
from synth_common import SHIPPED_SOUNDS_DIR, write_ogg

CREDITS = SHIPPED_SOUNDS_DIR / "SOUND_CREDITS.md"

# Relative RMS error between decoded shipped audio and decoded fresh audio. See the module docstring.
TOLERANCE = 0.02
# Encoders pad differently; a sound this many samples longer or shorter is a real change.
LENGTH_SLACK = 2048


def _starswarm(name):
    recipe, peak = synth_starswarm_sfx.SOUNDS[name]
    return recipe, lambda x: synth_starswarm_sfx.norm(x, peak)


def _two_part(module):
    return lambda name: (module.SOUNDS[name][0], module.SOUNDS[name][1])


# generator script -> (SOUNDS table, shipped filename for a name, (recipe, finish) for a name)
GENERATORS = {
    "synth_starswarm_sfx.py": (
        synth_starswarm_sfx.SOUNDS,
        lambda name: f"starswarm-{name}.ogg",
        _starswarm,
    ),
    "synth_arcade_sfx.py": (
        synth_arcade_sfx.SOUNDS,
        lambda name: f"{name}.ogg",
        _two_part(synth_arcade_sfx),
    ),
    "synth_puzzle_sfx.py": (
        synth_puzzle_sfx.SOUNDS,
        lambda name: f"{name}.ogg",
        _two_part(synth_puzzle_sfx),
    ),
}

CASES = [
    pytest.param(script, name, id=f"{script.removesuffix('.py')}:{name}")
    for script, (sounds, _, _) in GENERATORS.items()
    for name in sounds
]


def _ffmpeg_problem() -> str | None:
    """Why the decoded comparison cannot run here, or None when it can."""
    if shutil.which("ffmpeg") is None:
        return "ffmpeg is not installed"
    done = subprocess.run(
        ["ffmpeg", "-v", "error", "-encoders"], check=False, capture_output=True, text=True
    )
    if "libvorbis" not in done.stdout:
        return "ffmpeg has no libvorbis encoder"
    return None


@pytest.fixture(scope="module")
def ffmpeg_ready():
    problem = _ffmpeg_problem()
    if problem is None:
        return
    # CI installs ffmpeg for this job (.github/workflows/ci.yml); a silent skip there would void the guard.
    if os.environ.get("CI"):
        pytest.fail(f"{problem}; the CI test-tools job must provide it (#3672)")
    pytest.skip(problem)


def _decode(path: Path) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def _distance(shipped: Path, fresh_audio: np.ndarray, scratch: Path) -> float:
    """Relative RMS error of the shipped sound against `fresh_audio` after the generator's encode.

    Returns infinity when the lengths differ by more than the encoder's padding.
    """
    encoded = scratch / "fresh.ogg"
    write_ogg(fresh_audio, encoded)
    a, b = _decode(shipped), _decode(encoded)
    if abs(len(a) - len(b)) > LENGTH_SLACK:
        return float("inf")
    n = min(len(a), len(b))
    return float(np.sqrt(np.mean((a[:n] - b[:n]) ** 2)) / max(np.sqrt(np.mean(b[:n] ** 2)), 1e-9))


# --- shipped == generator -----------------------------------------------------------------------


@pytest.mark.usefixtures("ffmpeg_ready")
@pytest.mark.parametrize(("script", "name"), CASES)
def test_shipped_sound_is_the_generator_output(script, name, tmp_path):
    _, filename, build = GENERATORS[script]
    shipped = SHIPPED_SOUNDS_DIR / filename(name)
    assert shipped.is_file(), f"{script} owns {filename(name)} but it is not shipped"
    recipe, finish = build(name)
    err = _distance(shipped, finish(recipe()), tmp_path)
    assert err <= TOLERANCE, (
        f"{filename(name)} differs from {script} '{name}' (relative RMS error {err:.4f} > "
        f"{TOLERANCE}). Regenerate it: python tools/assets/{script} frontend/assets/sounds {name}"
    )


@pytest.mark.usefixtures("ffmpeg_ready")
def test_a_one_parameter_recipe_change_exceeds_the_tolerance(tmp_path):
    # A 0.5 dB change to a recipe's level, shipped file untouched: the comparison must notice.
    name = "daily-word-win"
    recipe, level = synth_puzzle_sfx.SOUNDS[name]
    shipped = SHIPPED_SOUNDS_DIR / f"{name}.ogg"
    unchanged = level(recipe())
    assert _distance(shipped, unchanged, tmp_path) <= TOLERANCE
    louder = np.clip(unchanged * 10 ** (0.5 / 20), -1, 1)
    assert _distance(shipped, louder, tmp_path) > TOLERANCE


@pytest.mark.usefixtures("ffmpeg_ready")
def test_a_different_sound_exceeds_the_tolerance(tmp_path):
    # A swapped or hand-replaced file: another sound of the same generator is nowhere near.
    recipe, level = synth_puzzle_sfx.SOUNDS["die-hold-1"]
    shipped = SHIPPED_SOUNDS_DIR / "die-release-1.ogg"
    assert _distance(shipped, level(recipe()), tmp_path) > TOLERANCE


# --- ownership: recipes and credits agree -------------------------------------------------------


def _credited_generators() -> dict[str, str]:
    """Shipped file -> generator script, for every `### <file>.ogg` credit naming a generator."""
    out = {}
    for section in re.split(r"\n### ", CREDITS.read_text(encoding="utf-8"))[1:]:
        # A heading is the file, sometimes followed by the keys it serves: "x.ogg (`game.key`)".
        file = section.split("\n", 1)[0].split()[0]
        found = re.search(r"\*\*Generator:\*\* `tools/assets/(synth_\w+\.py)`", section)
        if found:
            out[file] = found.group(1)
    return out


def test_every_generated_file_credited_has_a_recipe_and_back():
    credited = _credited_generators()
    owned = {
        filename(name): script
        for script, (sounds, filename, _) in GENERATORS.items()
        for name in sounds
    }
    assert credited, "no generator credits parsed from SOUND_CREDITS.md"
    assert credited == owned


def test_every_file_a_generator_owns_ships():
    missing = [
        filename(name)
        for sounds, filename, _ in GENERATORS.values()
        for name in sounds
        if not (SHIPPED_SOUNDS_DIR / filename(name)).is_file()
    ]
    assert missing == []
