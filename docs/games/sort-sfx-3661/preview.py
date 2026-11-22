import sys, subprocess, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import _paths
from sort_sfx import *

OUT = _paths.SCRATCH / "out"
PV = _paths.SCRATCH / "preview"
LAT = 0.05


def tl(n):  # pourTimeline (s) from motion.ts
    fs = 0.300
    land = [fs + i * 0.3 + 0.18 + 0.12 for i in range(n)]
    return land, fs + n * 0.3 + 0.18


def load(name, opt, i):
    with wave.open(str(OUT / f"{name}-{opt}-{i}.wav")) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767


def sequence(snd, opt):
    ev = []  # (time, name, variation)
    k = [0]

    def v():
        k[0] += 1
        return (k[0] - 1) % 3 + 1

    if snd == "pour":
        t = 0.3
        for n, gap in [(1, 1.0), (4, 1.2)]:
            ev.append((t + LAT, "lift", v()))
            land, end = tl(n)
            for l in land:
                ev.append((t + LAT + l, "glug", v()))
            t += LAT + end + gap
        for _ in range(3):  # quick burst: 2-unit pours back to back
            ev.append((t + LAT, "lift", v()))
            land, end = tl(2)
            for l in land:
                ev.append((t + LAT + l, "glug", v()))
            t += LAT + end + 0.12
    else:
        calm, burst, gap_b = {
            "select": (4, 5, 0.14),
            "refused": (3, 4, 0.3),
            "complete": (3, 3, 0.45),
            "undo": (3, 3, 0.32),
            "hint": (3, 2, 0.8),
            "win": (2, 0, 0),
        }[snd]
        gap = {"win": 3.0, "hint": 1.5}.get(snd, 1.1)
        t = 0.3
        for _ in range(calm):
            ev.append((t, snd, v()))
            t += gap
        t += 0.2
        for _ in range(burst):
            ev.append((t, snd, v()))
            t += gap_b
    total = max(t0 + len(load(n, opt, min(vi, SOUNDS[n][1]))) / SR for t0, n, vi in ev) + 0.5
    x = np.zeros(int(total * SR))
    for t0, n, vi in ev:
        place(x, load(n, opt, min(vi, SOUNDS[n][1])), t0)
    return x


def wav(x, p):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


DESC = {
    "select": {
        "A": "bright glass tick",
        "B": "rounder glass 'tok' on the bottle body",
        "C": "water droplet pip, rising",
    },
    "pour": {
        "A": "lift: glass touch + soft puff; glug: bright quick bubble",
        "B": "lift: water slosh rising; glug: round, deeper bubble droop",
        "C": "lift: glass scoot + settle clink; glug: bubbly triple bubble",
    },
    "refused": {
        "A": "two dull glass taps, falling",
        "B": "falling water 'bloop' (reverse glug)",
        "C": "soft glass rattle, 5 damped ticks",
    },
    "complete": {
        "A": "two-note glass chime, rising fifth",
        "B": "one bright wine-glass ring with shimmer",
        "C": "bubble run up into a glass ting",
    },
    "undo": {
        "A": "reversed clink swell",
        "B": "reverse bubble, falling water",
        "C": "two soft falling glass notes",
    },
    "hint": {
        "A": "three rising glass pings",
        "B": "glints of light on water: random high droplets",
        "C": "glass harmonica swell with shimmer",
    },
    "win": {
        "A": "rising glass chime cascade, chord at the card (1.38 s)",
        "B": "rain of falling-pitch glugs filling a glass, ting at the card",
        "C": "dense glass wind-chime glissando up, ring at the card",
    },
}
font = lambda s, b=True: ImageFont.truetype(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if b else ""), s
)
for snd in DESC:
    segs = []
    for opt in "ABC":
        x = sequence(snd, opt)
        wp = PV / f"{snd}-{opt}-seq.wav"
        wav(x, wp)
        sp = PV / f"{snd}-{opt}-spec.png"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(wp),
                "-lavfi",
                "showspectrumpic=s=1200x330:legend=0:scale=log:fscale=log:color=intensity",
                "-frames:v",
                "1",
                str(sp),
            ],
            check=True,
        )
        im = Image.new("RGB", (1280, 720), (14, 22, 36))
        d = ImageDraw.Draw(im)
        d.text((60, 40), opt, font=font(190), fill=(120, 210, 240))
        d.text((300, 70), f"Sort / {snd}  -  option {opt}", font=font(44), fill=(235, 240, 245))
        d.text((300, 140), DESC[snd][opt], font=font(28, False), fill=(170, 190, 210))
        d.text(
            (300, 190),
            "glass and water  |  spectrogram (log freq, 20 Hz - 22 kHz)",
            font=font(20, False),
            fill=(120, 140, 160),
        )
        im.paste(Image.open(sp).convert("RGB"), (40, 340))
        ip = PV / f"{snd}-{opt}-card.png"
        im.save(ip)
        seg = PV / f"{snd}-{opt}.mp4"
        dur = len(x) / SR + 1.0
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-loop",
                "1",
                "-framerate",
                "10",
                "-i",
                str(ip),
                "-i",
                str(wp),
                "-af",
                "apad=pad_dur=1",
                "-t",
                f"{dur:.3f}",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-ar",
                "44100",
                "-ac",
                "1",
                str(seg),
            ],
            check=True,
        )
        segs.append(seg)
    lst = PV / f"{snd}-list.txt"
    lst.write_text("".join(f"file '{s}'\n" for s in segs))
    final = _paths.SCRATCH / f"preview-sort-{snd}.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(lst),
            "-c",
            "copy",
            str(final),
        ],
        check=True,
    )
    print(final)
