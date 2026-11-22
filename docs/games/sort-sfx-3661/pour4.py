import sys, wave, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import _paths

HERE = ROOT = _paths.SCRATCH
from sort_sfx import *
from synth_common import write_ogg

TAIL = 0.18
SPEC = {  # rate: bubbles/s; rmin/rmax mm; beta: radius pdf ~ r^-beta; alpha: amp ~ r^alpha; fill: octaves per unit; imp: impact noise dB re bubbles
    "A": dict(rate=1400, rmin=0.5, rmax=4.0, beta=2.5, alpha=1.0, fill=0.20, imp=-26),
    "B": dict(rate=600, rmin=0.7, rmax=9.0, beta=1.6, alpha=1.3, fill=0.15, imp=-24),
    "C": dict(rate=120, rmin=0.5, rmax=4.0, beta=2.0, alpha=1.0, fill=0.20, imp=-34),
}
SIGMA = 0.1


def bubble(f0, a, rng):
    d = 0.043 * f0 + 0.0014 * f0**1.5  # van den Doel damping (1/s)
    n = int(min(7 / d, 0.15) * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * f0 * (t + SIGMA * d * t * t / 2) + rng.uniform(
        0, 2 * np.pi
    )  # f(t)=f0(1+sigma d t)
    return a * np.sin(ph) * np.exp(-d * t) * np.clip(t / 0.0004, 0, 1)


def stream(opt, units, i):
    s = SPEC[opt]
    seed = 1000 * (1 + "ABC".index(opt)) + 100 * units + i
    rng = np.random.default_rng(seed)
    D = 0.3 * units
    dur = D + TAIL
    n = int(dur * SR)
    x = np.zeros(n + int(0.2 * SR))
    # Poisson stream: exponential gaps; rate ramps in over 15 ms, flows to D, then dies away over the tail
    t = 0.0
    while t < dur:
        r_in = min(1.0, t / 0.015) if t < D else np.exp(-(t - D) / 0.05)
        lam = s["rate"] * max(r_in, 0.03)
        t += rng.exponential(1.0 / s["rate"])  # thinning below
        if rng.random() > max(r_in, 0.03):
            continue
        p = min(t / D, 1.0)
        b = 1 - s["beta"]  # inverse-CDF draw from pdf ~ r^-beta on [rmin, rmax]
        u = rng.random()
        r = (s["rmin"] ** b + u * (s["rmax"] ** b - s["rmin"] ** b)) ** (1 / b)
        r *= 2 ** (-s["fill"] * units * p)  # destination fills: radii shrink, pitch rises
        f0 = 3260.0 / r
        if f0 > 9000 or f0 < 250:
            continue
        a = (r ** s["alpha"]) * rng.lognormal(0, 0.25)
        place(x, bubble(f0, a, rng), t)
    x = x[:n]
    rb = np.sqrt(np.mean(x**2)) + 1e-12
    imp = lp2(highpass(noise(n, seed + 9), 2000), 8000)
    imp /= np.std(imp) + 1e-12
    onset = np.exp(-t_axis(dur) / 0.03) * np.clip(
        t_axis(dur) / 0.001, 0, 1
    )  # a light tap as the stream hits
    x = x + rb * 10 ** (s["imp"] / 20) * imp * (0.3 + 1.5 * onset)
    x = highpass(x, 250)
    return level_rms(fade(x, 0.002, 0.05), -21, -3)


def wav(x, p):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


out = HERE / "out"
rows = []
for opt in "ABC":
    for u in (1, 2, 3, 4):
        for i in range(3):
            x = stream(opt, u, i)
            stem = f"stream4-{opt}-{u}u-{i+1}"
            write_ogg(x, out / f"{stem}.ogg")
            wav(x, out / f"{stem}.wav")
            w = int(0.05 * SR)
            r = np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid")).max()
            F = np.abs(np.fft.rfft(x)) ** 2
            fr = np.fft.rfftfreq(len(x), 1 / SR)
            rows.append(
                (
                    opt,
                    u,
                    i + 1,
                    len(x) / SR,
                    (out / (stem + ".ogg")).stat().st_size,
                    20 * np.log10(r),
                    20 * np.log10(abs(x).max()),
                    F[fr < 300].sum() / F.sum() * 100,
                )
            )
for r in rows:
    if r[2] == 1:
        print("%s %du v%d %.2fs %6dB rms %.1f peak %.1f <300 %.2f%%" % r)
for o in "ABC":
    print(
        o,
        "total bytes all 12 files",
        sum(r[4] for r in rows if r[0] == o),
        " one variation set (4 counts)",
        sum(r[4] for r in rows if r[0] == o and r[2] == 1),
    )
print(
    "max <300:",
    max(r[7] for r in rows),
    "rms range",
    min(r[5] for r in rows),
    max(r[5] for r in rows),
)


def load(p):
    with wave.open(str(p)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767


FS, LAT = 0.300, 0.05


def pour(x, t, n, opt, k):
    place(x, load(ROOT / "out" / f"lift-A-{k[0]%3+1}.wav"), t + LAT)
    place(x, load(out / f"stream4-{opt}-{n}u-{k[0]%3+1}.wav"), t + LAT + FS)
    k[0] += 1
    return t + LAT + FS + 0.3 * n + 0.18


def seq(opt):
    x = np.zeros(int(14 * SR))
    k = [0]
    t = 0.3
    t = pour(x, t, 1, opt, k) + 1.0
    t = pour(x, t, 4, opt, k) + 1.2
    for _ in range(3):
        t = pour(x, t, 2, opt, k) + 0.12
    return x[: int((t + 0.6) * SR)]


DESC = {
    "A": "glass of water poured: dense small bubbles, bright, rising fill",
    "B": "fuller pour: more large bubbles, body, slower rate",
    "C": "light trickle: sparse bubbles, distinct plinks",
}
font = lambda s, b=True: ImageFont.truetype(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if b else ""), s
)
segs = []
for opt in "ABC":
    x = seq(opt)
    wp = HERE / f"seq4-{opt}.wav"
    wav(x, wp)
    sp = HERE / f"spec4-{opt}.png"
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
    d.text(
        (300, 70),
        f"Sort / pour (v4, bubbles)  -  option {opt}",
        font=font(40),
        fill=(235, 240, 245),
    )
    d.text((300, 140), DESC[opt], font=font(24, False), fill=(170, 190, 210))
    d.text(
        (300, 190),
        "lift A + bubble stream | 1-unit, 4-unit, then 3 quick 2-unit pours",
        font=font(20, False),
        fill=(120, 140, 160),
    )
    im.paste(Image.open(sp).convert("RGB"), (40, 340))
    ip = HERE / f"card4-{opt}.png"
    im.save(ip)
    seg = HERE / f"seg4-{opt}.mp4"
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
            "25",
            "-i",
            str(ip),
            "-i",
            str(wp),
            "-af",
            "apad=pad_dur=1,aformat=channel_layouts=stereo",
            "-t",
            f"{dur:.3f}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "25",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "44100",
            "-ac",
            "2",
            str(seg),
        ],
        check=True,
    )
    segs.append(seg)
final = HERE / "sort-pour4-ABC.mp4"
cmd = ["ffmpeg", "-v", "error", "-y"]
for s in segs:
    cmd += ["-i", str(s)]
cmd += [
    "-filter_complex",
    "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "25",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    str(final),
]
subprocess.run(cmd, check=True)
tot = float(
    subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(final)]
    )
)
print("duration", tot)
for name, f in [("third", tot / 3 + 1), ("twothird", 2 * tot / 3 + 1)]:
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            f"{f:.2f}",
            "-i",
            str(final),
            "-frames:v",
            "1",
            str(HERE / f"check4-{name}.png"),
        ],
        check=True,
    )
