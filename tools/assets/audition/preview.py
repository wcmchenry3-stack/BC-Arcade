"""Package a sound, or a gameplay-rhythm sequence of sounds, as an mp4 with a spectrogram still.

The first step of the sound process (#3578, #3665): the owner listens to each option as a preview
before any game is played. Writes `<out>.mp4` (the spectrogram as a still, the sound under it) and
`<out>.png`, and prints a report: length, size, `level_rms` (dBFS over the loudest 50 ms) and the
percent of energy below 300 Hz.

Run from the repo root (needs numpy and ffmpeg with libx264, aac, drawtext):

    # one sound
    python tools/assets/audition/preview.py out/win-A.mp4 /tmp/opts/daily-word-win-A.ogg --title "Win A"

    # a gameplay rhythm: each sound is `file@seconds`, laid in at that time
    python tools/assets/audition/preview.py out/rhythm-A.mp4 \\
        miss-1.ogg@0.3 present-2.ogg@0.4 correct-3.ogg@0.5 daily-word-win-A.ogg@1.6

Generators write options with `synth_*_sfx.py --options <sound>`; see README.md.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audition_common import (
    SR,
    decode,
    level_rms_db,
    low_energy_pct,
    mix_events,
    parse_spec,
    run,
    write_wav,
)

TAIL = 0.4  # seconds of silence after the last sound, so a release is not cut


def _drawtext_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "%%")


def report(x: np.ndarray, sources: list[Path], out_mp4: Path) -> dict[str, float]:
    """The numbers the design log quotes for a sound."""
    return {
        "length_s": round(len(x) / SR, 2),
        "size_kb": round(sum(p.stat().st_size for p in sources) / 1024, 1),
        "mp4_kb": round(out_mp4.stat().st_size / 1024, 1),
        "level_rms_dbfs": round(level_rms_db(x), 1),
        "below_300hz_pct": round(low_energy_pct(x), 1),
    }


def make_preview(specs: list[str], out_mp4: Path, title: str | None = None) -> dict[str, float]:
    parsed = [parse_spec(s) for s in specs]
    missing = [str(p) for p, _ in parsed if not p.is_file()]
    if missing:
        raise SystemExit(f"no such sound file(s): {', '.join(missing)}")
    x = mix_events([(decode(p), at) for p, at in parsed])
    padded = np.concatenate([x, np.zeros(int(TAIL * SR))])
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    wav = out_mp4.with_suffix(".wav")
    png = out_mp4.with_suffix(".png")
    write_wav(padded, wav)
    try:
        still = "showspectrumpic=s=1280x480:legend=1:scale=log:stop=12000"
        if title:
            text = _drawtext_escape(title)
            still += f",drawtext=text='{text}':x=20:y=10:fontsize=22:fontcolor=white"
        run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-lavfi", still, str(png)])
        cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", str(png), "-i", str(wav)]
        cmd += ["-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-c:a", "aac"]
        cmd += ["-b:a", "160k", "-shortest", str(out_mp4)]
        run(cmd)
    finally:
        wav.unlink(missing_ok=True)
    return report(x, [p for p, _ in parsed], out_mp4)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out", type=Path, help="the mp4 to write (a .png still is written beside it)")
    ap.add_argument("sounds", nargs="+", help="file.ogg, or file.ogg@seconds for a rhythm")
    ap.add_argument("--title", help="text drawn on the spectrogram")
    args = ap.parse_args(argv)
    if args.out.suffix != ".mp4":
        raise SystemExit("the output must end in .mp4")
    r = make_preview(args.sounds, args.out, args.title)
    print(
        f"{args.out}: length {r['length_s']} s, size {r['size_kb']} KB (sources), "
        f"level_rms {r['level_rms_dbfs']} dBFS, below 300 Hz {r['below_300hz_pct']} %"
    )


if __name__ == "__main__":
    main()
