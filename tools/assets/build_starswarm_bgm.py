"""Build the Star Swarm background music from its recipe (`starswarm_bgm/`).

Renders the Round 44 bed, the five signature layers (astronomical rise, robotic signals, Gathering
Swarm Chorus, Electromagnetic Choir, distant organ) and the Shepard descents, arranges them as
Rounds 45 and 46 did, then applies the loop edit (`make_starswarm_bgm_loop.py`). The output is
byte-identical to the shipped `frontend/assets/sounds/starswarm-bgm.mp3` under the same ffmpeg /
libmp3lame build (Ubuntu 24.04's ffmpeg 6.1.1, the one CI uses) with the pinned numpy and scipy.

Takes about a minute and needs numpy, scipy, soundfile and ffmpeg (tools/assets/requirements.txt).

Usage:
  python tools/assets/build_starswarm_bgm.py OUT.mp3                  # the game track
  python tools/assets/build_starswarm_bgm.py OUT.mp3 --stages DIR     # also keep the bed, intro,
                                                                      # full mix and cues.json
  python tools/assets/build_starswarm_bgm.py --check                  # rebuild; compare with the
                                                                      # shipped file
  python tools/assets/build_starswarm_bgm.py --write-fingerprint      # refresh the reference
                                                                      # the CI test compares to;
                                                                      # refuses if the shipped MP3
                                                                      # is unchanged (--force: only
                                                                      # when you have deliberately
                                                                      # decided it stays as is)

Changing the music: edit a layer or a cue in `starswarm_bgm/`, rebuild, listen, then replace the
shipped file, run --write-fingerprint, and update the shipped file's SHA-256 and size
(SOUND_CREDITS.md, scripts/check_large_files.py, and EXPECTED_SHA256 in
frontend/src/__tests__/starswarmBgm.test.ts).
See docs/games/starswarm-music-design.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import make_starswarm_bgm_loop
from starswarm_bgm import arrange, fingerprint

SHIPPED = HERE.parents[1] / "frontend/assets/sounds/starswarm-bgm.mp3"


def build(
    out_mp3: Path | None, stages: Path | None = None, log=print, with_fingerprint: bool = False
) -> dict | None:
    """Build the track at `out_mp3` (None: skip the loop edit; for --write-fingerprint).

    With `with_fingerprint`, also renders the encoder-free stages and returns their fingerprint
    (starswarm_bgm/fingerprint.py); otherwise returns None.
    """
    built = arrange.build_stages(log, dry=with_fingerprint)
    renders = built.mp3
    if out_mp3 is not None:
        with tempfile.TemporaryDirectory() as tmp:
            mix = Path(tmp) / "mix.mp3"
            mix.write_bytes(renders["mix"])
            make_starswarm_bgm_loop.main([str(mix), str(out_mp3)])
    if stages:
        stages.mkdir(parents=True, exist_ok=True)
        for name, data in renders.items():
            (stages / f"{name}.mp3").write_bytes(data)
        (stages / "cues.json").write_text(json.dumps(arrange.cue_sheet(), indent=2) + "\n")
        log(f"stages written to {stages}")
    return fingerprint.compute(built) if with_fingerprint else None


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("out_mp3", type=Path, nargs="?")
    ap.add_argument("--stages", type=Path, help="also write the intermediate renders here")
    ap.add_argument(
        "--write-fingerprint",
        action="store_true",
        help="rebuild and rewrite starswarm_bgm/reference_fingerprint.json (after a recipe change)",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="with --write-fingerprint: overwrite even though the shipped MP3 is unchanged "
        "(only when you have deliberately decided the shipped MP3 stays as is)",
    )
    ap.add_argument("--check", action="store_true", help="compare a rebuild with the shipped file")
    args = ap.parse_args(argv)
    if args.write_fingerprint:
        fp = build(None, args.stages, with_fingerprint=True)
        shipped = sha256(SHIPPED)
        committed = (
            fingerprint.load(fingerprint.REFERENCE) if fingerprint.REFERENCE.exists() else None
        )
        why = fingerprint.refuse_reason(fp, committed, shipped)
        if why and not args.force:
            print(f"refusing to write {fingerprint.REFERENCE.name}: {why}", file=sys.stderr)
            return 1
        fingerprint.write({**fp, "shipped_sha256": shipped}, fingerprint.REFERENCE)
        print(f"wrote {fingerprint.REFERENCE} ({fingerprint.REFERENCE.stat().st_size} bytes)")
        return 0
    if not args.check and not args.out_mp3:
        ap.error("give OUT.mp3, or --check")
    if args.check and args.out_mp3 and args.out_mp3.resolve() == SHIPPED.resolve():
        ap.error("--check must not write over the shipped file; give another OUT.mp3 or none")

    if not args.check:
        build(args.out_mp3, args.stages)
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        out = args.out_mp3 or Path(tmp) / "starswarm-bgm.mp3"
        build(out, args.stages)
        got, want = sha256(out), sha256(SHIPPED)
    print(f"rebuilt  {got}\nshipped  {want}")
    if got != want:
        print("DIFFERENT: the recipe no longer makes the shipped track (or the encoder changed)")
        return 1
    print("identical")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
