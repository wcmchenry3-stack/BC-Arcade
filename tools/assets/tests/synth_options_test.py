"""pytest suite for the runner-up sound options (#3673).

The `OPTIONS` tables and the `--options <sound>` flag keep the alternatives the owner did not pick,
next to each generator, without ever shipping them. These tests pin that: the options write only to a
scratch folder, `SOUNDS` (what ships) is exactly what it was, and the shipped recipes are untouched.
"""

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
from synth_common import (
    SHIPPED_SOUNDS_DIR,
    SR,
    decoded_pcm_sha256,
    options_cli,
    options_scratch_dir,
    write_ogg,
    write_options,
)

ASSETS = Path(__file__).resolve().parents[1]
HAS_FFMPEG = shutil.which("ffmpeg") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg with libvorbis")

# What ships from synth_puzzle_sfx.py, as of #3673. Adding or removing a shipped sound means
# editing this list on purpose, in the story that changes the sound; an option never does.
PUZZLE_SOUNDS = [
    "cpu-full-house",
    "cpu-jackpot-joker",
    "cpu-jackpot-yacht",
    "cpu-large-straight",
    "cpu-score-commit",
    "cpu-score-zero",
    "cpu-small-straight",
    "cpu-upper-bonus",
    "daily-word-correct-1",
    "daily-word-correct-2",
    "daily-word-correct-3",
    "daily-word-loss",
    "daily-word-miss-1",
    "daily-word-miss-2",
    "daily-word-miss-3",
    "daily-word-present-1",
    "daily-word-present-2",
    "daily-word-present-3",
    "daily-word-refused",
    "daily-word-win",
    "dice-roll-1",
    "dice-roll-2",
    "dice-roll-3",
    "die-hold-1",
    "die-hold-2",
    "die-hold-3",
    "die-release-1",
    "die-release-2",
    "die-release-3",
    "full-house",
    "game-over-2048",
    "jackpot-joker",
    "jackpot-yacht",
    "large-straight",
    "mahjong-deadlock",
    "mahjong-match-1",
    "mahjong-match-2",
    "mahjong-match-3",
    "mahjong-select-1",
    "mahjong-select-2",
    "mahjong-select-3",
    "mahjong-shuffle-wash",
    "mahjong-win",
    "score-commit",
    "score-zero",
    "small-straight",
    "sudoku-digit-place",
    "sudoku-digit-place-2",
    "sudoku-digit-place-3",
    "sudoku-error-entered",
    "sudoku-puzzle-complete",
    "sudoku-unit-complete",
    "tile-merge-1",
    "tile-merge-2",
    "tile-merge-3",
    "tile-spawn-1",
    "tile-spawn-2",
    "tile-spawn-3",
    "upper-bonus",
    "win-2048",
    "yacht-loss",
    "yacht-tie",
    "yacht-win",
]


def _finish_puzzle(recipe, level):
    return level(recipe())


def _snapshot(directory: Path) -> dict[str, int]:
    return {p.name: p.stat().st_size for p in directory.iterdir()}


# --- SOUNDS is unchanged ------------------------------------------------------------------------


def test_shipped_sounds_are_exactly_the_approved_set():
    assert sorted(synth_puzzle_sfx.SOUNDS) == sorted(PUZZLE_SOUNDS)


def test_no_option_is_in_the_shipped_set():
    for sound, options in synth_puzzle_sfx.OPTIONS.items():
        for label in options:
            assert f"{sound}-{label}" not in synth_puzzle_sfx.SOUNDS
            assert f"{sound}-{label.lower()}" not in synth_puzzle_sfx.SOUNDS


def test_option_a_is_the_shipped_pick_itself():
    for sound, options in synth_puzzle_sfx.OPTIONS.items():
        assert options["A"] is synth_puzzle_sfx.SOUNDS[sound]


def test_the_generators_normal_run_writes_only_shipped_sounds(tmp_path, monkeypatch):
    # The encoder is stubbed, so this runs without ffmpeg: it is the names that are checked.
    monkeypatch.setattr(
        synth_puzzle_sfx, "write_ogg", lambda _x, path: Path(path).write_bytes(b"x")
    )
    synth_puzzle_sfx.main(tmp_path, ["daily-word-win", "daily-word-loss"])
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "daily-word-loss.ogg",
        "daily-word-win.ogg",
    ]


@needs_ffmpeg
@pytest.mark.parametrize("name", ["daily-word-win", "daily-word-loss"])
def test_the_endings_the_options_sit_beside_still_match_the_committed_files(name, tmp_path):
    committed = SHIPPED_SOUNDS_DIR / f"{name}.ogg"
    if not committed.exists():
        pytest.skip("shipped sound not in this checkout")
    recipe, level = synth_puzzle_sfx.SOUNDS[name]
    fresh = tmp_path / "fresh.ogg"
    write_ogg(level(recipe()), fresh)
    assert decoded_pcm_sha256(fresh) == decoded_pcm_sha256(committed)


# --- the options themselves ---------------------------------------------------------------------


def test_daily_word_win_and_loss_have_options_a_b_and_c():
    assert set(synth_puzzle_sfx.OPTIONS) == {"daily-word-win", "daily-word-loss"}
    for options in synth_puzzle_sfx.OPTIONS.values():
        assert list(options) == ["A", "B", "C"]


@pytest.mark.parametrize("sound", ["daily-word-win", "daily-word-loss"])
def test_options_are_deterministic_distinct_and_in_range(sound):
    rendered = {}
    for label, (recipe, level) in synth_puzzle_sfx.OPTIONS[sound].items():
        a, b = level(recipe()), level(recipe())
        assert np.array_equal(a, b), label
        assert 0 < len(a) <= 4 * SR and np.max(np.abs(a)) <= 1.0, label
        rendered[label] = a
    assert not np.array_equal(rendered["A"], rendered["B"])
    assert not np.array_equal(rendered["B"], rendered["C"])
    assert not np.array_equal(rendered["A"], rendered["C"])


@pytest.mark.parametrize(
    ("sound", "lengths"),
    [
        ("daily-word-win", {"A": 2.4, "B": 2.4, "C": 1.9}),
        ("daily-word-loss", {"A": 1.9, "B": 1.6, "C": 1.5}),
    ],
)
def test_options_have_the_lengths_the_owner_heard(sound, lengths):
    # From the #3665 thread: win 2.4 / 2.4 / 1.9 s and loss 1.9 / 1.6 / 1.5 s.
    for label, (recipe, level) in synth_puzzle_sfx.OPTIONS[sound].items():
        assert len(level(recipe())) / SR == pytest.approx(lengths[label], abs=0.01), label


def test_options_sit_at_the_picks_level():
    def rms50_db(x):
        w = int(0.05 * SR)
        return 20 * np.log10(np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid").max()))

    for sound, level_db in (("daily-word-win", -17.0), ("daily-word-loss", -21.0)):
        for label, (recipe, level) in synth_puzzle_sfx.OPTIONS[sound].items():
            assert rms50_db(level(recipe())) == pytest.approx(level_db, abs=0.1), (sound, label)


def test_option_c_win_is_lighter_than_the_pick():
    # "Small and sweet": a shorter ending than the mallet run, and less energy.
    a, b, c = (synth_puzzle_sfx.OPTIONS["daily-word-win"][k][0]() for k in ("A", "B", "C"))
    assert len(c) < len(a) == len(b)
    assert np.sum(c**2) < np.sum(a**2)


# --- the --options flag -------------------------------------------------------------------------


@needs_ffmpeg
def test_options_flag_writes_a_b_and_c_to_the_scratch_folder_and_nothing_else(tmp_path, capsys):
    handled = options_cli(
        ["--options", "daily-word-win", str(tmp_path)], synth_puzzle_sfx.OPTIONS, _finish_puzzle
    )
    assert handled is True
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "daily-word-win-A.ogg",
        "daily-word-win-B.ogg",
        "daily-word-win-C.ogg",
    ]
    assert len(capsys.readouterr().out.splitlines()) == 3


@needs_ffmpeg
def test_option_a_decodes_to_the_shipped_sound(tmp_path):
    (path,) = [
        p
        for p in write_options(
            {"daily-word-loss": {"A": synth_puzzle_sfx.OPTIONS["daily-word-loss"]["A"]}},
            "daily-word-loss",
            tmp_path,
            _finish_puzzle,
        )
    ]
    shipped = tmp_path / "shipped.ogg"
    recipe, level = synth_puzzle_sfx.SOUNDS["daily-word-loss"]
    write_ogg(level(recipe()), shipped)
    assert decoded_pcm_sha256(path) == decoded_pcm_sha256(shipped)


def test_options_flag_ignores_other_arguments():
    assert options_cli([], synth_puzzle_sfx.OPTIONS, _finish_puzzle) is False
    assert options_cli(["out_dir", "sound"], synth_puzzle_sfx.OPTIONS, _finish_puzzle) is False


def test_options_flag_without_a_sound_names_what_exists():
    with pytest.raises(SystemExit, match="daily-word-win"):
        options_cli(["--options"], synth_puzzle_sfx.OPTIONS, _finish_puzzle)


def test_options_flag_rejects_an_unknown_sound(tmp_path):
    with pytest.raises(SystemExit, match="no runner-up options"):
        options_cli(
            ["--options", "no-such", str(tmp_path)], synth_puzzle_sfx.OPTIONS, _finish_puzzle
        )
    assert list(tmp_path.iterdir()) == []


def test_options_never_write_to_the_shipped_sounds_folder():
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(SHIPPED_SOUNDS_DIR))
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(SHIPPED_SOUNDS_DIR / "sub"))
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(SHIPPED_SOUNDS_DIR / ".." / "sounds"))


def test_options_default_to_a_scratch_folder_outside_the_repo():
    scratch = options_scratch_dir().resolve()
    assert SHIPPED_SOUNDS_DIR not in (scratch, *scratch.parents)


@needs_ffmpeg
def test_the_command_line_writes_options_and_leaves_the_shipped_sounds_alone(tmp_path):
    before = _snapshot(SHIPPED_SOUNDS_DIR)
    cmd = [sys.executable, str(ASSETS / "synth_puzzle_sfx.py"), "--options", "daily-word-loss"]
    done = subprocess.run([*cmd, str(tmp_path)], capture_output=True, text=True, check=True)
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "daily-word-loss-A.ogg",
        "daily-word-loss-B.ogg",
        "daily-word-loss-C.ogg",
    ]
    assert str(tmp_path / "daily-word-loss-B.ogg") in done.stdout
    assert _snapshot(SHIPPED_SOUNDS_DIR) == before


def test_the_command_line_refuses_the_shipped_folder():
    cmd = [sys.executable, str(ASSETS / "synth_puzzle_sfx.py"), "--options", "daily-word-win"]
    before = _snapshot(SHIPPED_SOUNDS_DIR)
    done = subprocess.run(
        [*cmd, str(SHIPPED_SOUNDS_DIR)], capture_output=True, text=True, check=False
    )
    assert done.returncode != 0 and "never writes" in done.stderr
    assert _snapshot(SHIPPED_SOUNDS_DIR) == before


# --- the other generators -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("module", "finish"),
    [
        (synth_arcade_sfx, lambda recipe, level: level(recipe())),
        (synth_starswarm_sfx, lambda recipe, _peak: recipe()),
    ],
)
def test_arcade_and_starswarm_have_the_flag_and_no_recovered_options_yet(module, finish, tmp_path):
    # Their design logs describe the runner-ups in words only (#3673): nothing to recover.
    assert module.OPTIONS == {}
    assert callable(module._finish)
    with pytest.raises(SystemExit, match="no runner-up options"):
        options_cli(["--options", next(iter(module.SOUNDS)), str(tmp_path)], module.OPTIONS, finish)
    assert list(tmp_path.iterdir()) == []


def test_every_generator_option_entry_is_well_formed():
    for module in (synth_puzzle_sfx, synth_arcade_sfx, synth_starswarm_sfx):
        for sound, options in module.OPTIONS.items():
            assert "A" in options, sound
            for recipe, _level in options.values():
                assert callable(recipe)


# --- the checked folder is the folder used (security hardening) ---------------------------------


def test_options_refuse_a_relative_spelling_of_the_shipped_folder(monkeypatch):
    monkeypatch.chdir(SHIPPED_SOUNDS_DIR.parent)
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir("sounds")
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir("./sounds/../sounds")


def test_options_refuse_a_symlink_to_the_shipped_folder(tmp_path):
    link = tmp_path / "link"
    link.symlink_to(SHIPPED_SOUNDS_DIR, target_is_directory=True)
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(link))
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(link / "new"))


def test_options_refuse_any_folder_inside_frontend():
    frontend = SHIPPED_SOUNDS_DIR.parents[1]
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(frontend / "scratch-options"))
    with pytest.raises(SystemExit, match="never writes"):
        options_scratch_dir(str(frontend / "assets" / "other" / "deeper"))


def test_write_options_checks_the_folder_itself_and_writes_to_the_resolved_path(tmp_path):
    with pytest.raises(SystemExit, match="never writes"):
        write_options(
            synth_puzzle_sfx.OPTIONS, "daily-word-win", SHIPPED_SOUNDS_DIR, _finish_puzzle
        )
    assert options_scratch_dir(str(tmp_path)) == tmp_path.resolve()
