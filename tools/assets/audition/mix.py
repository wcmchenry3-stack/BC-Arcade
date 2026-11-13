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
    decode,
    media_duration,
    mix_events,
    resolve_play_src,
    run,
    write_wav,
)


def load_plays(log: Path) -> list[dict]:
    """The `plays` of a `run.js` log: [{"t": seconds, "src": url}, ...], in time order."""
    data = json.loads(log.read_text())
    plays = data["plays"] if isinstance(data, dict) else data
    return sorted(plays, key=lambda p: p["t"])


def build_track(
    plays: list[dict],
    dist: Path,
    offset: float = 0.0,
    total: float | None = None,
    skip: tuple[str, ...] = (),
) -> tuple[np.ndarray, list[str]]:
    """The mixed audio for a log, and a line per sound saying what landed when."""
    cache: dict[Path, np.ndarray] = {}
    events: list[tuple[np.ndarray, float]] = []
    lines: list[str] = []
    for p in plays:
        try:
            path = resolve_play_src(p["src"], dist)
        except ValueError as err:
            lines.append(f"{p['t'] + offset:8.3f} s  skipped ({err})")
            continue
        if any(part in path.name for part in skip):
            lines.append(f"{p['t'] + offset:8.3f} s  left out  {path.name}")
            continue
        if path not in cache:
            cache[path] = decode(path)
        events.append((cache[path], max(0.0, p["t"] + offset)))
        lines.append(f"{p['t'] + offset:8.3f} s  {path.name}")
    return mix_events(events, total), lines


def grab_frame(video: Path, t: float, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video)]
    run([*cmd, "-frames:v", "1", str(out)])


def write_audition(video: Path, track: np.ndarray, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    wav = out.with_suffix(".wav")
    write_wav(track, wav)
    try:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(wav)]
        cmd += ["-map", "0:v", "-map", "1:a", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", str(out)]
        run(cmd)
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
        plays = load_plays(args.log)
        duration = media_duration(args.video)
        track, lines = build_track(plays, args.dist, args.offset, duration, tuple(args.skip))
        print("\n".join(lines))
        write_audition(args.video, track, args.out)
        print(f"{args.out}: {len(plays)} sounds mixed onto {args.video.name}")

    for raw in (args.frames or "").split(","):
        if raw.strip():
            t = float(raw)
            out = args.frames_dir / f"{args.video.stem}-{t:.2f}s.png"
            grab_frame(args.video, t, out)
            print(out)


if __name__ == "__main__":
    main()
