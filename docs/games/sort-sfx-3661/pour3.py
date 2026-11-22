import sys, wave, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import _paths

HERE = ROOT = _paths.SCRATCH
from sort_sfx import *
from synth_common import write_ogg

TAIL = 0.09
SPEC = {
    # f0: cavity start Hz, oct: octaves risen per unit, band: stream hiss band, hiss/res/tone/bub/splash gains, bub rate per s
    "A": dict(
        f0=480,
        oct=0.30,
        band=(1500, 6500),
        hiss=0.55,
        res=0.8,
        tone=0.16,
        splash=0.25,
        bub=7,
        bubg=0.22,
        sp=(900, 3500),
    ),
    "B": dict(
        f0=360,
        oct=0.26,
        band=(500, 3200),
        hiss=0.5,
        res=0.8,
        tone=0.2,
        splash=0.7,
        bub=9,
        bubg=0.2,
        sp=(350, 1800),
    ),
    "C": dict(
        f0=620,
        oct=0.28,
        band=(1800, 7000),
        hiss=0.25,
        res=0.5,
        tone=0.12,
        splash=0.12,
        bub=24,
        bubg=0.3,
        sp=(1200, 4500),
    ),
}


def smooth_rand(n, seed, rate):
    """Slow random curve in 0..1 (lowpassed noise) for turbulence modulation."""
    r = lowpass(noise(n, seed), rate)
    r = (r - r.min()) / (r.max() - r.min() + 1e-12)
    return r


def stream(opt, units, i):
    s = SPEC[opt]
    seed = 1000 * (1 + "ABC".index(opt)) + 100 * units + i
    D = 0.3 * units
    dur = D + TAIL
    n = int(dur * SR)
    t = t_axis(dur)
    p = np.clip(t / D, 0, 1)
    scale = [0.97, 1.0, 1.03][i % 3]
    f = s["f0"] * scale * 2 ** (s["oct"] * units * p)  # cavity pitch rises as the bottle fills
    env = np.clip(t / 0.03, 0, 1) ** 1.5 * np.exp(
        -np.clip(t - D, 0, None) / 0.03
    )  # stream on, then cut
    turb = 0.75 + 0.25 * smooth_rand(n, seed + 1, 40)  # turbulence in the stream
    hiss = lp2(highpass(noise(n, seed + 2), s["band"][0]), s["band"][1])
    hiss /= np.std(hiss) + 1e-12
    res = lowpass(highpass(noise(n, seed + 3), f * 0.75), f * 1.3)
    res /= np.std(res) + 1e-12  # rising cavity formant
    sp = lp2(highpass(noise(n, seed + 4), s["sp"][0]), s["sp"][1])
    sp /= np.std(sp) + 1e-12
    spm = (
        0.3 + 0.7 * smooth_rand(n, seed + 5, 22) ** 2
    )  # splash bursts where the stream hits the surface
    tone = np.sin(phase(f)) + 0.3 * np.sin(phase(2 * f))
    x = (
        s["hiss"] * hiss * turb
        + s["res"] * res * (0.6 + 0.4 * p)
        + s["tone"] * tone * (0.5 + 0.5 * p)
        + s["splash"] * sp * spm
    ) * env
    rng = np.random.default_rng(seed + 6)
    for _ in range(int(s["bub"] * dur)):  # small bubbles rising to the surface
        at = rng.uniform(0.02, dur - 0.03)
        k = min(int(at / dur * n), n - 1)
        fb = rng.uniform(700, 1800) * (0.8 + 0.5 * p[k])
        place(
            x,
            chirp(fb, fb * 1.5, 0.05, 0.012, curve=4, att=0.002) * s["bubg"] * rng.uniform(0.4, 1),
            at,
        )
    place(
        x, chirp(f[0] * 1.6, f[0] * 2.2, 0.06, 0.012, curve=3, att=0.002) * 0.4, 0.0
    )  # entry plip
    x = highpass(x, 250)
    return level_rms(fade(x, 0.004, 0.04), -21, -3)


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
            stem = f"stream3-{opt}-{u}u-{i+1}"
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
    place(x, load(out / f"stream3-{opt}-{n}u-{k[0]%3+1}.wav"), t + LAT + FS)
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
    "A": "clear glass-water pour: bright stream, audible rising fill pitch",
    "B": "fuller, heavier pour: more body and splash, lower cavity",
    "C": "gentle trickle-pour: soft stream with many small bubbles",
}
font = lambda s, b=True: ImageFont.truetype(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if b else ""), s
)
segs = []
for opt in "ABC":
    x = seq(opt)
    wp = HERE / f"seq3-{opt}.wav"
    wav(x, wp)
    sp = HERE / f"spec3-{opt}.png"
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
        (300, 70), f"Sort / pour (v3, stream)  -  option {opt}", font=font(40), fill=(235, 240, 245)
    )
    d.text((300, 140), DESC[opt], font=font(24, False), fill=(170, 190, 210))
    d.text(
        (300, 190),
        "lift A + continuous stream | 1-unit, 4-unit, then 3 quick 2-unit pours",
        font=font(20, False),
        fill=(120, 140, 160),
    )
    im.paste(Image.open(sp).convert("RGB"), (40, 340))
    ip = HERE / f"card3-{opt}.png"
    im.save(ip)
    seg = HERE / f"seg3-{opt}.mp4"
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
final = HERE / "sort-pour3-ABC.mp4"
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
            str(HERE / f"check3-{name}.png"),
        ],
        check=True,
    )
