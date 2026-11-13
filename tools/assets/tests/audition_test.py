"""pytest suite for the sound audition tools in tools/assets/audition/ (#3673).

Covers the pure helpers (level, low-frequency share, mixing at times, resolving a logged URL),
`preview.py` (an mp4 and a spectrogram still, with its report), `mix.py` (the logged sounds laid
onto a video, frames at given times) and the `run.js` scenario list. The ffmpeg tests build their
own tiny inputs, so they need no web build; they skip when ffmpeg is missing.
"""

import base64
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

AUDITION = Path(__file__).resolve().parents[1] / "audition"
sys.path.insert(0, str(AUDITION))

import audition_common as common
import mix
import preview

SR = common.SR
needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="needs ffmpeg"
)


def _tone(freq: float, dur: float, amp: float) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    return amp * np.sin(2 * np.pi * freq * t)


def _probe(path: Path, entries: str) -> str:
    cmd = ["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", str(path)]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()


# --- measuring ----------------------------------------------------------------------------------


def test_level_rms_is_the_loudest_50_ms_in_dbfs():
    # A sine of amplitude 0.1 has RMS 0.0707, which is -23.0 dBFS.
    tone = _tone(1000, 0.5, 0.1)
    assert common.level_rms_db(tone) == pytest.approx(-23.0, abs=0.1)
    # A quiet bed with one louder 50 ms burst: the burst sets the level.
    x = _tone(1000, 1.0, 0.001)
    x[SR // 2 : SR // 2 + SR // 20] = _tone(1000, 0.05, 0.1)
    assert common.level_rms_db(x) == pytest.approx(-23.0, abs=0.3)


def test_level_rms_pads_a_sound_shorter_than_50_ms():
    assert common.level_rms_db(np.ones(100)) < 0.0  # a click: its 50 ms RMS, not its peak


def test_low_energy_share_separates_bass_from_treble():
    assert common.low_energy_pct(_tone(100, 0.5, 0.3)) > 99.0
    assert common.low_energy_pct(_tone(1000, 0.5, 0.3)) < 1.0
    both = _tone(100, 0.5, 0.3) + _tone(1000, 0.5, 0.3)
    assert common.low_energy_pct(both) == pytest.approx(50.0, abs=2.0)
    assert common.low_energy_pct(np.zeros(1000)) == 0.0


# --- mixing -------------------------------------------------------------------------------------


def test_mix_places_each_sound_at_its_time():
    click = np.full(100, 0.5)
    out = common.mix_events([(click, 0.5), (click, 1.0)])
    assert out[int(0.5 * SR)] == 0.5 and out[int(0.5 * SR) - 1] == 0.0
    assert out[int(1.0 * SR)] == 0.5
    assert len(out) == int(1.0 * SR) + 100


def test_mix_pads_to_the_video_length():
    out = common.mix_events([(np.ones(10) * 0.1, 0.0)], total=2.0)
    assert len(out) == 2 * SR


def test_mix_sums_overlaps_and_only_scales_down_a_clipping_mix():
    quiet = common.mix_events([(np.full(10, 0.2), 0.0), (np.full(10, 0.3), 0.0)])
    assert quiet[0] == pytest.approx(0.5)
    loud = common.mix_events([(np.full(10, 0.9), 0.0), (np.full(10, 0.9), 0.0)])
    assert np.abs(loud).max() == pytest.approx(common.PEAK_CEILING)


def test_mix_rejects_a_sound_before_the_video_starts():
    with pytest.raises(ValueError, match="before the video"):
        common.mix_events([(np.ones(10), -0.1)])


def test_parse_spec_reads_file_and_time():
    assert common.parse_spec("a.ogg") == (Path("a.ogg"), 0.0)
    assert common.parse_spec("dir/a.ogg@1.25") == (Path("dir/a.ogg"), 1.25)
    with pytest.raises(SystemExit, match="bad spec"):
        common.parse_spec("a.ogg@soon")


def test_resolve_play_src_finds_the_served_file(tmp_path):
    sound = tmp_path / "assets" / "assets" / "sounds" / "x.abc.ogg"
    sound.parent.mkdir(parents=True)
    sound.write_bytes(b"x")
    url = "http://localhost:8081/assets/assets/sounds/x.abc.ogg"
    assert common.resolve_play_src(url, tmp_path) == sound
    with pytest.raises(FileNotFoundError, match="is not in"):
        common.resolve_play_src("http://localhost:8081/assets/nope.ogg", tmp_path)
    with pytest.raises(ValueError, match="not a served file"):
        common.resolve_play_src("blob:http://localhost:8081/1234", tmp_path)


# --- preview.py ---------------------------------------------------------------------------------


@needs_ffmpeg
def test_preview_writes_an_mp4_a_spectrogram_still_and_a_report(tmp_path):
    wav = tmp_path / "a.wav"
    common.write_wav(_tone(1000, 0.6, 0.1), wav)
    out = tmp_path / "out" / "a.mp4"
    r = preview.make_preview([str(wav)], out, title="Option A: wood")
    assert out.is_file() and out.with_suffix(".png").is_file()
    assert not out.with_suffix(".wav").exists()  # the scratch wav is cleaned up
    assert r["length_s"] == pytest.approx(0.6, abs=0.01)  # the sound, without the preview's tail
    assert r["level_rms_dbfs"] == pytest.approx(-23.0, abs=0.2)
    assert r["below_300hz_pct"] < 1.0
    assert r["size_kb"] == pytest.approx(wav.stat().st_size / 1024, abs=0.1)
    assert r["mp4_kb"] > 0
    streams = _probe(out, "stream=codec_name")
    assert "h264" in streams and "aac" in streams


@needs_ffmpeg
def test_preview_lays_a_rhythm_at_its_times(tmp_path):
    click = tmp_path / "click.wav"
    common.write_wav(_tone(2000, 0.1, 0.2), click)
    out = tmp_path / "rhythm.mp4"
    r = preview.make_preview([f"{click}@0.0", f"{click}@1.0", f"{click}@2.0"], out)
    assert r["length_s"] == pytest.approx(2.1, abs=0.02)
    assert float(_probe(out, "format=duration")) >= 2.4  # the sequence plus the preview's tail


@needs_ffmpeg
def test_preview_cli_prints_the_report_and_rejects_a_missing_file(tmp_path, capsys):
    wav = tmp_path / "a.wav"
    common.write_wav(_tone(500, 0.3, 0.1), wav)
    preview.main([str(tmp_path / "p.mp4"), str(wav), "--title", "X: Y"])
    printed = capsys.readouterr().out
    for field in ("length", "size", "level_rms", "below 300 Hz"):
        assert field in printed
    with pytest.raises(SystemExit, match="no such sound"):
        preview.main([str(tmp_path / "q.mp4"), str(tmp_path / "missing.ogg")])
    with pytest.raises(SystemExit, match=r"\.mp4"):
        preview.main([str(tmp_path / "q.mov"), str(wav)])


# --- mix.py -------------------------------------------------------------------------------------


def _make_video(path: Path, seconds: float = 3.0) -> None:
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=blue:s=101x75:d={seconds}"]
    cmd += ["-r", "10", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True)


def _make_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    sounds = dist / "assets" / "assets" / "sounds"
    sounds.mkdir(parents=True)
    common.write_wav(_tone(1000, 0.2, 0.3), sounds / "tick.aaa.wav")
    common.write_wav(_tone(400, 0.2, 0.3), sounds / "mahjong-bg-1.bbb.wav")
    return dist


def _log(tmp_path: Path, plays: list[dict]) -> Path:
    log = tmp_path / "game.plays.json"
    log.write_text(json.dumps({"scenario": "game", "marks": [], "plays": plays}))
    return log


def test_load_plays_reads_a_log_in_time_order(tmp_path):
    plays = [{"t": 2.0, "src": "b"}, {"t": 1.0, "src": "a"}]
    assert [p["src"] for p in mix.load_plays(_log(tmp_path, plays))] == ["a", "b"]
    bare = tmp_path / "bare.json"
    bare.write_text(json.dumps(plays))
    assert [p["src"] for p in mix.load_plays(bare)] == ["a", "b"]


@needs_ffmpeg
def test_build_track_puts_each_logged_sound_at_its_time(tmp_path):
    dist = _make_dist(tmp_path)
    url = "http://localhost:8081/assets/assets/sounds/tick.aaa.wav"
    plays = [{"t": 0.5, "src": url}, {"t": 1.5, "src": url}]
    track, lines = mix.build_track(plays, dist, total=3.0)
    assert len(track) == 3 * SR
    for at in (0.5, 1.5):
        k = int(at * SR)
        assert np.abs(track[k : k + SR // 10]).max() > 0.1
    assert np.abs(track[int(1.0 * SR) : int(1.4 * SR)]).max() < 1e-6  # silent between them
    assert lines[0].strip().startswith("0.500 s") and "tick.aaa.wav" in lines[0]


@needs_ffmpeg
def test_build_track_offset_and_skip(tmp_path):
    dist = _make_dist(tmp_path)
    tick = "http://localhost:8081/assets/assets/sounds/tick.aaa.wav"
    music = "http://localhost:8081/assets/assets/sounds/mahjong-bg-1.bbb.wav"
    plays = [{"t": 0.0, "src": music}, {"t": 1.0, "src": tick}]
    track, lines = mix.build_track(plays, dist, offset=0.25, total=2.0, skip=("-bg-",))
    assert np.abs(track[: int(1.2 * SR)]).max() < 1e-6  # the music is left out
    assert np.abs(track[int(1.25 * SR) : int(1.35 * SR)]).max() > 0.1  # shifted 0.25 s later
    assert "left out" in lines[0]


@needs_ffmpeg
def test_build_track_notes_a_source_it_cannot_play_and_fails_on_a_missing_file(tmp_path):
    dist = _make_dist(tmp_path)
    _, lines = mix.build_track([{"t": 0.1, "src": "blob:http://x/1"}], dist, total=1.0)
    assert "skipped" in lines[0]
    with pytest.raises(FileNotFoundError):
        mix.build_track([{"t": 0.1, "src": "http://x/assets/nope.ogg"}], dist)


@needs_ffmpeg
def test_mix_cli_mixes_sounds_onto_the_video_and_grabs_frames(tmp_path, capsys):
    video = tmp_path / "game.webm"
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=101x75:d=3"]
    subprocess.run([*cmd, "-r", "10", "-c:v", "libvpx", str(video)], check=True)
    dist = _make_dist(tmp_path)
    url = "http://localhost:8081/assets/assets/sounds/tick.aaa.wav"
    log = _log(tmp_path, [{"t": 1.0, "src": url}])
    out = tmp_path / "audition.mp4"
    frames = tmp_path / "frames"
    args = [str(video), "--log", str(log), "--dist", str(dist), "--out", str(out)]
    mix.main([*args, "--frames", "0.5,2.0", "--frames-dir", str(frames)])
    streams = _probe(out, "stream=codec_name")
    assert "h264" in streams and "aac" in streams  # the sounds are in the video
    assert float(_probe(out, "format=duration")) == pytest.approx(3.0, abs=0.3)
    assert sorted(p.name for p in frames.iterdir()) == ["game-0.50s.png", "game-2.00s.png"]
    assert "1 sounds mixed" in capsys.readouterr().out


@needs_ffmpeg
def test_mix_cli_frames_alone_and_argument_checks(tmp_path):
    video = tmp_path / "v.mp4"
    _make_video(video)
    mix.main([str(video), "--frames", "1.0", "--frames-dir", str(tmp_path / "f")])
    assert (tmp_path / "f" / "v-1.00s.png").is_file()
    with pytest.raises(SystemExit, match="nothing to do"):
        mix.main([str(video)])
    with pytest.raises(SystemExit, match="--out needs"):
        mix.main([str(video), "--out", str(tmp_path / "o.mp4")])
    with pytest.raises(SystemExit, match="no such video"):
        mix.main([str(tmp_path / "gone.webm"), "--frames", "1"])


# --- run.js -------------------------------------------------------------------------------------

RUN_JS = AUDITION / "run.js"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


def _node(code: str) -> str:
    cmd = ["node", "-e", f"const r = require({json.dumps(str(RUN_JS))}); {code}"]
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()


@needs_node
def test_run_js_lists_a_scenario_for_each_game():
    listed = subprocess.run(
        ["node", str(RUN_JS), "--list"], capture_output=True, text=True, check=True
    ).stdout
    for scenario in ("daily-word", "daily-word-loss", "mahjong", "yacht", "twenty48", "2048"):
        assert scenario in listed


@needs_node
def test_run_js_rejects_an_unknown_scenario_without_starting_a_browser():
    done = subprocess.run(
        ["node", str(RUN_JS), "no-such"], capture_output=True, text=True, check=False
    )
    assert done.returncode == 2 and "unknown scenario" in done.stderr


@needs_node
def test_run_js_scores_guesses_against_the_fixed_answer():
    got = _node("console.log(r.scoreGuess('crane', 'trace').map((t) => t.status).join())")
    assert got == "absent,correct,correct,present,correct"
    got = _node("console.log(r.scoreGuess('crane', 'crane').map((t) => t.status).join())")
    assert got == "correct,correct,correct,correct,correct"
    # The answer has one E and the last guess E is in place, so the earlier Es score absent.
    got = _node("console.log(r.scoreGuess('crane', 'eerie').map((t) => t.status).join())")
    assert got == "absent,absent,present,absent,correct"


@needs_node
def test_run_js_daily_word_mock_answers_today_guess_and_answer():
    mock = "r.dailyWordMock"
    today = json.loads(
        _node(f"console.log(JSON.stringify({mock}({{pathname: '/daily-word/today'}})))")
    )
    assert today["status"] == 200 and today["json"]["word_length"] == 5
    body = json.dumps({"guess": "slate"})
    call = f"{{pathname: '/daily-word/guess', method: 'POST', body: {json.dumps(body)}}}"
    guess = json.loads(_node(f"console.log(JSON.stringify({mock}({call})))"))
    assert [t["status"] for t in guess["json"]["tiles"]] == [
        "absent",
        "absent",
        "correct",
        "absent",
        "correct",
    ]
    bad = json.dumps({"guess": "xyzzy"})
    call = f"{{pathname: '/daily-word/guess', method: 'POST', body: {json.dumps(bad)}}}"
    refused = json.loads(_node(f"console.log(JSON.stringify({mock}({call})))"))
    assert refused["status"] == 422 and refused["json"] == {"detail": "not_a_word"}
    answer = json.loads(
        _node(f"console.log(JSON.stringify({mock}({{pathname: '/daily-word/answer'}})))")
    )
    assert answer["json"]["answer"] == "crane"
    assert _node(f"console.log({mock}({{pathname: '/games/catalog', method: 'GET'}}))") == "null"


@needs_node
def test_run_js_entitlements_mock_matches_the_e2e_helper():
    # run.js repeats the token api-mock.ts builds; this keeps the two in step.
    helper = (AUDITION.parents[2] / "e2e" / "tests" / "helpers" / "api-mock.ts").read_text()
    body = json.loads(_node("console.log(JSON.stringify(r.entitlementsBody()))"))
    for game in ("blackjack", "cascade", "hearts", "starswarm", "mahjong"):
        assert f'"{game}"' in helper
    payload = body["token"].split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert claims["entitled_games"] == ["blackjack", "cascade", "hearts", "starswarm", "mahjong"]
    assert claims["sub"] == "e2e-test" and body["expires_at"].startswith("2286-")
    assert "iat: 1000000000" in helper and "exp: 9999999999" in helper
    assert body["token"].endswith(".e2e-sig")


@needs_node
def test_run_js_only_reaches_the_dev_api_and_aborts_the_rest():
    src = RUN_JS.read_text()
    assert 'const API_ORIGIN = "https://dev-games-api.buffingchi.com";' in src
    assert "route.abort()" in src and "/entitlements" in src


# --- resolve_play_src stays inside dist ---------------------------------------------------------


def test_resolve_play_src_refuses_paths_that_leave_dist(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (tmp_path / "secret.ogg").write_bytes(b"x")
    for url in (
        "http://h/%2e%2e/secret.ogg",
        "http://h/..%2fsecret.ogg",
        "http://h/%2e%2e%2f%2e%2e/secret.ogg",
        f"http://h/{tmp_path}/secret.ogg",
    ):
        with pytest.raises((ValueError, FileNotFoundError)):
            common.resolve_play_src(url, dist)
    with pytest.raises(ValueError, match="outside the build"):
        common.resolve_play_src("http://h/%2e%2e/secret.ogg", dist)


def test_resolve_play_src_refuses_a_symlink_out_of_dist(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    outside = tmp_path / "outside.ogg"
    outside.write_bytes(b"x")
    (dist / "link.ogg").symlink_to(outside)
    with pytest.raises(ValueError, match="outside the build"):
        common.resolve_play_src("http://h/link.ogg", dist)


def test_resolve_play_src_only_serves_audio_files(tmp_path):
    (tmp_path / "index.html").write_text("x")
    with pytest.raises(ValueError, match="not an audio file"):
        common.resolve_play_src("http://h/index.html", tmp_path)


def _stream_duration(path: Path, stream: str) -> float:
    cmd = ["ffprobe", "-v", "error", "-select_streams", stream]
    cmd += ["-show_entries", "stream=duration", "-of", "csv=p=0", str(path)]
    return float(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout)


@needs_ffmpeg
def test_mix_audio_does_not_outlast_the_video_when_a_sound_lands_at_the_end(tmp_path):
    video = tmp_path / "game.webm"
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=101x75:d=3"]
    subprocess.run([*cmd, "-r", "10", "-c:v", "libvpx", str(video)], check=True)
    dist = _make_dist(tmp_path)
    long_sound = dist / "assets" / "assets" / "sounds" / "long.ccc.wav"
    common.write_wav(_tone(800, 1.5, 0.3), long_sound)
    log = _log(
        tmp_path, [{"t": 2.8, "src": "http://localhost:8081/assets/assets/sounds/long.ccc.wav"}]
    )
    out = tmp_path / "audition.mp4"
    mix.main([str(video), "--log", str(log), "--dist", str(dist), "--out", str(out)])
    v, a = (_stream_duration(out, kind) for kind in ("v:0", "a:0"))
    assert v == pytest.approx(3.0, abs=0.3)  # the picture is not cut short
    assert a <= v + 0.05


# --- volume, pauses and the recording's end -----------------------------------------------------

SOUND_URL = "http://localhost:8081/assets/assets/sounds/{}"


def _dist_with(tmp_path: Path, name: str, x: np.ndarray) -> Path:
    dist = _make_dist(tmp_path)
    common.write_wav(x, dist / "assets" / "assets" / "sounds" / name)
    return dist


@needs_ffmpeg
def test_build_track_applies_each_elements_volume_and_skips_a_muted_one(tmp_path):
    dist = _dist_with(tmp_path, "music.ddd.wav", _tone(400, 0.5, 0.5))
    url = SOUND_URL.format("music.ddd.wav")
    full, _ = mix.build_track([{"t": 0.0, "src": url}], dist, limit=1.0)
    quiet, lines = mix.build_track([{"t": 0.0, "src": url, "volume": 0.2}], dist, limit=1.0)
    assert np.abs(quiet).max() == pytest.approx(0.2 * np.abs(full).max(), rel=0.02)
    assert "volume 0.2" in lines[0]
    muted, lines = mix.build_track([{"t": 0.0, "src": url, "muted": True}], dist, limit=1.0)
    assert np.abs(muted).max() == 0.0 and "muted" in lines[0]


@needs_ffmpeg
def test_an_old_format_log_still_mixes_at_full_level(tmp_path):
    dist = _dist_with(tmp_path, "music.ddd.wav", _tone(400, 0.5, 0.5))
    old = tmp_path / "old.plays.json"
    old.write_text(json.dumps({"plays": [{"t": 0.5, "src": SOUND_URL.format("music.ddd.wav")}]}))
    plays, pauses, end = mix.load_log(old)
    assert pauses == [] and end is None
    track, _ = mix.build_track(plays, dist, total=2.0, pauses=pauses)
    assert len(track) == 2 * common.SR
    assert np.abs(track[int(0.5 * common.SR) :]).max() == pytest.approx(0.5, abs=0.02)
    bare = tmp_path / "bare.json"
    bare.write_text(json.dumps(plays))
    assert mix.load_log(bare)[0] == plays


@needs_ffmpeg
def test_a_long_sound_is_cut_at_the_recordings_end(tmp_path):
    dist = _dist_with(tmp_path, "long.eee.wav", _tone(300, 60.0, 0.3))
    plays = [{"t": 1.0, "src": SOUND_URL.format("long.eee.wav")}]
    track, _ = mix.build_track(plays, dist, total=3.0, limit=3.0)
    assert len(track) == 3 * common.SR


@needs_ffmpeg
def test_a_paused_element_stops_contributing_at_its_pause(tmp_path):
    dist = _dist_with(tmp_path, "music.ddd.wav", _tone(400, 2.0, 0.5))
    plays = [{"t": 0.5, "src": SOUND_URL.format("music.ddd.wav"), "el": 7}]
    sr = common.SR
    track, _ = mix.build_track(plays, dist, pauses=[{"t": 1.5, "el": 7}], limit=4.0)
    assert np.abs(track[int(1.0 * sr) : int(1.4 * sr)]).max() > 0.3  # still playing
    assert np.abs(track[int(1.55 * sr) :]).max() < 1e-6  # stopped at the pause
    # Another element's pause, or one before this play, does not cut it.
    other = [{"t": 1.5, "el": 8}, {"t": 0.2, "el": 7}]
    track, _ = mix.build_track(plays, dist, pauses=other, limit=4.0)
    assert np.abs(track[int(2.0 * sr) : int(2.4 * sr)]).max() > 0.3


@needs_ffmpeg
def test_end_comes_from_the_log_when_the_video_has_no_duration(tmp_path):
    dist = _dist_with(tmp_path, "long.eee.wav", _tone(300, 60.0, 0.3))
    log = tmp_path / "g.plays.json"
    plays = [{"t": 1.0, "src": SOUND_URL.format("long.eee.wav"), "el": 1, "volume": 1}]
    log.write_text(json.dumps({"recordingEnd": 3.0, "plays": plays, "pauses": []}))
    plays, pauses, end = mix.load_log(log)
    assert end == 3.0
    track, _ = mix.build_track(plays, dist, total=end, pauses=pauses, limit=end)
    assert len(track) == 3 * common.SR


def test_mix_events_limit_cuts_and_pads_to_the_recording():
    out = common.mix_events([(np.full(10 * common.SR, 0.1), 1.0)], limit=3.0)
    assert len(out) == 3 * common.SR
    assert common.mix_events([(np.full(10, 0.1), 5.0)], limit=3.0).max() == 0.0


@needs_ffmpeg
def test_preview_never_touches_an_input_wav_named_like_the_old_scratch_file(tmp_path):
    # The scratch wav used to be `<output>.wav`: previewing that very file overwrote then deleted it.
    wav = tmp_path / "sound.wav"
    common.write_wav(_tone(1000, 0.4, 0.1), wav)
    before = wav.read_bytes()
    r = preview.make_preview([str(wav)], tmp_path / "sound.mp4")
    assert wav.read_bytes() == before
    assert r["length_s"] == pytest.approx(0.4, abs=0.01)
    assert (tmp_path / "sound.mp4").is_file()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["sound.mp4", "sound.png", "sound.wav"]
