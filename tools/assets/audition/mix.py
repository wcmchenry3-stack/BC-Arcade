"""Mix the sounds a gameplay recording logged onto its video, and grab frames to check timing.

The second step of the sound process: `run.js` plays a game in the web build, records a video and
logs every `HTMLMediaElement.play` with its time. This decodes each logged file from `dist` (the
build the recording came from), lays it at its logged time under the video, and writes an mp4 the
owner can watch. `--frames` grabs stills at given times, to check that a sound lands on the frame
it should (a tile turning, a card showing).

Run from the repo root (needs numpy and ffmpeg with libx264 and aac):

    python tools/assets/audition/mix.py out/daily-word.webm \\
        --log out/daily-word.plays.json --dist frontend/dist --out out/daily-word-audition.mp4

    # leave Mahjong's background music out, so only the effects are heard
    python tools/assets/audition/mix.py out/mahjong.webm --log out/mahjong.plays.json \\
        --dist frontend/dist --skip=-bg- --out out/mahjong-audition.mp4

    # stills at 3.2 s and 4.5 s (alone, or alongside the mix)
    python tools/assets/audition/mix.py out/daily-word.webm --frames 3.2,4.5 --frames-dir out/frames

A log's times are measured from when run.js opened the page, which is when the recording starts,
give or take a frame or two; `--offset` shifts every sound (seconds, positive = later).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audition_common import (
    SR,
    decode,
    media_duration,
    mix_events,
    resolve_play_src,
    run,
    write_wav,
)


def load_log(log: Path) -> tuple[list[dict], list[dict], float | None]:
    """A `run.js` log: its plays and pauses in time order, and the recording's length if logged.

    Older logs are a bare list or have only `plays` with `t` and `src`: they still load, and
    every sound then plays at full level until its file ends."""
    data = json.loads(log.read_text())
    plays = data["plays"] if isinstance(data, dict) else data
    pauses = data.get("pauses", []) if isinstance(data, dict) else []
    end = data.get("recordingEnd") if isinstance(data, dict) else None
    return sorted(plays, key=_time), sorted(pauses, key=_time), end


def _time(entry: dict) -> float:
    return entry["t"]


def load_plays(log: Path) -> list[dict]:
    """The `plays` of a `run.js` log: [{"t": seconds, "src": url, ...}, ...], in time order."""
    return load_log(log)[0]


def _stop_at(play: dict, pauses: list[dict], limit: float | None, offset: float) -> float | None:
    """When a sound stops contributing: its element's next pause or end, or the recording's end."""
    stops = [
        q["t"] + offset
        for q in pauses
        if play.get("el") is not None and q.get("el") == play["el"] and q["t"] > play["t"]
    ]
    if limit is not None:
        stops.append(limit)
    return min(stops) if stops else None


def build_track(
    plays: list[dict],
    dist: Path,
    offset: float = 0.0,
    total: float | None = None,
    skip: tuple[str, ...] = (),
    pauses: list[dict] | None = None,
    limit: float | None = None,
) -> tuple[np.ndarray, list[str]]:
    """The mixed audio for a log, and a line per sound saying what landed when.

    Each sound plays at the `volume` its element had (a muted one is left out), stops where its
    element paused or ended, and is cut at `limit`, the end of the recording."""
    cache: dict[Path, np.ndarray] = {}
    events: list[tuple[np.ndarray, float]] = []
    lines: list[str] = []
    for p in plays:
        at = p["t"] + offset
        try:
            path = resolve_play_src(p["src"], dist)
        except ValueError as err:
            lines.append(f"{at:8.3f} s  skipped ({err})")
            continue
        if any(part in path.name for part in skip):
            lines.append(f"{at:8.3f} s  left out  {path.name}")
            continue
        if p.get("muted"):
            lines.append(f"{at:8.3f} s  muted     {path.name}")
            continue
        if path not in cache:
            cache[path] = decode(path)
        gain = float(p.get("volume", 1.0))
        x = cache[path] * gain
        stop = _stop_at(p, pauses or [], limit, offset)
        if stop is not None:
            x = x[: max(0, round((stop - max(0.0, at)) * SR))]
        events.append((x, max(0.0, at)))
        note = f"  (volume {gain:g})" if gain != 1.0 else ""
        lines.append(f"{at:8.3f} s  {path.name}{note}")
    return mix_events(events, total, limit), lines


def grab_frame(video: Path, t: float, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video)]
    run([*cmd, "-frames:v", "1", str(out)])


def write_audition(video: Path, track: np.ndarray, out: Path, trim: bool = False) -> None:
    """Mux the track under the video. `trim` ends the output with the video (use it when the track was
    padded to the video's length, so a sound near the end cannot outlast the picture)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    wav = out.with_suffix(".wav")
    write_wav(track, wav)
    try:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(wav)]
        cmd += ["-map", "0:v", "-map", "1:a", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"]
        run([*cmd, *(["-shortest"] if trim else []), str(out)])
    finally:
        wav.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video", type=Path, help="the recording (webm or mp4) from run.js")
    ap.add_argument("--log", type=Path, help="the plays.json run.js wrote beside the video")
    ap.add_argument("--dist", type=Path, help="the web build the recording came from")
    ap.add_argument("--out", type=Path, help="the mp4 to write, with the sounds mixed in")
    ap.add_argument("--offset", type=float, default=0.0, help="shift every sound, in seconds")
    ap.add_argument(
        "--skip",
        action="append",
        default=[],
        help="leave out logged files whose name contains this (repeatable), e.g. --skip=-bg-",
    )
    ap.add_argument("--frames", help="comma-separated times (seconds) to grab a still at")
    ap.add_argument("--frames-dir", type=Path, default=Path("frames"))
    args = ap.parse_args(argv)
    if not args.video.is_file():
        raise SystemExit(f"no such video: {args.video}")
    if not args.out and not args.frames:
        raise SystemExit("nothing to do: give --out (mix) and/or --frames")

    if args.out:
        if not (args.log and args.dist):
            raise SystemExit("--out needs --log and --dist")
        plays, pauses, logged_end = load_log(args.log)
        duration = media_duration(args.video)
        # Playwright's webm often has no container duration: the log's recording length stands in.
        limit = duration if duration is not None else logged_end
        skip = tuple(args.skip)
        track, lines = build_track(plays, args.dist, args.offset, limit, skip, pauses, limit)
        print("\n".join(lines))
        write_audition(args.video, track, args.out, trim=duration is not None)
        print(f"{args.out}: {len(plays)} sounds mixed onto {args.video.name}")

    for raw in (args.frames or "").split(","):
        if raw.strip():
            t = float(raw)
            out = args.frames_dir / f"{args.video.stem}-{t:.2f}s.png"
            grab_frame(args.video, t, out)
            print(out)


if __name__ == "__main__":
    main()
