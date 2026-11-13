import sys, wave, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import _paths

HERE = ROOT = _paths.SCRATCH
from sort_sfx import *
from synth_common import write_ogg


def gulp(f0, dur, decay, h2, h3, dip=0.22, att=0.005):
    """Helmholtz-ish gulp: pitch starts high, drops fast, then rises again; harmonics for phone speakers."""
    t = t_axis(dur)
    f = f0 * (1.12 - dip * (1 - np.exp(-t / 0.012)) + 0.2 * (1 - np.exp(-t / 0.05)) * 0.5)
    ph = phase(f)
    x = np.sin(ph) + h2 * np.sin(2 * ph) + h3 * np.sin(3 * ph)
    return x * np.exp(-t / decay) * np.clip(t / att, 0, 1)


SPEC = {  # opt: f0, gulp times (s), decay, h2, h3, bed (lo, hi, gain), pips
    "A": dict(
        f0=520,
        times=[0.0, 0.105, 0.208],
        dec=0.04,
        h2=0.3,
        h3=0.1,
        bed=(700, 3000, 0.18),
        gain=[1, 0.85, 0.95],
    ),
    "B": dict(
        f0=400,
        times=[0.0, 0.115, 0.225],
        dec=0.065,
        h2=0.6,
        h3=0.3,
        bed=(400, 2500, 0.45),
        gain=[1, 0.9, 1],
    ),
    "C": dict(
        f0=680,
        times=[0.0, 0.07, 0.14, 0.215],
        dec=0.028,
        h2=0.25,
        h3=0.1,
        bed=(1800, 6500, 0.3),
        gain=[0.9, 0.75, 0.85, 0.7],
    ),
}


def glug2(opt, i=0):
    s = SPEC[opt]
    rng = np.random.default_rng(700 + i + 10 * "ABC".index(opt))
    scale = [0.95, 1.0, 1.05][i % 3]
    x = np.zeros(int(0.38 * SR))
    for k, (at, g) in enumerate(zip(s["times"], s["gain"])):
        at += rng.uniform(-0.01, 0.01) * (k > 0)
        f = s["f0"] * scale * (1 + 0.04 * k) * rng.uniform(0.97, 1.03)
        place(x, gulp(f, 0.16, s["dec"], s["h2"], s["h3"]) * g, max(at, 0))
    # liquid bed: soft filtered noise through the whole unit, pulsing with each gulp
    n = len(x)
    t = t_axis(0.38)
    bed = lp2(highpass(noise(n, 800 + i + 10 * "ABC".index(opt)), s["bed"][0]), s["bed"][1])
    bed /= np.std(bed) + 1e-12
    pulse = np.full(n, 0.35)
    for at in s["times"]:
        pulse += 0.65 * np.exp(-np.clip(t - at, 0, None) / 0.05) * (t >= at)
    pulse *= np.clip(t / 0.01, 0, 1) * np.exp(-np.clip(t - 0.28, 0, None) / 0.04)
    x = x / (np.abs(x).max() + 1e-9) + s["bed"][2] * 0.5 * bed * pulse
    if opt == "C":  # trickle: tiny high pips
        for k in range(5):
            place(
                x,
                chirp(1800 * rng.uniform(0.9, 1.3), 2800, 0.03, 0.008, curve=4, att=0.002) * 0.12,
                rng.uniform(0.02, 0.28),
            )
    x = highpass(x, 250)  # keep phone speakers clean
    return level_rms(fade(x, 0.002, 0.05), -21, -3)


def wav(x, p):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


out = HERE / "out"
out.mkdir(exist_ok=True)
print("opt len size rms50 peak <300")
for opt in "ABC":
    for i in range(3):
        x = glug2(opt, i)
        stem = f"glug2-{opt}-{i+1}"
        write_ogg(x, out / f"{stem}.ogg")
        wav(x, out / f"{stem}.wav")
        w = int(0.05 * SR)
        r = np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid")).max()
        F = np.abs(np.fft.rfft(x)) ** 2
        fr = np.fft.rfftfreq(len(x), 1 / SR)
        print(
            f"{stem} {len(x)/SR:.2f}s {(out/(stem+'.ogg')).stat().st_size} B rms {20*np.log10(r):.1f} peak {20*np.log10(abs(x).max()):.1f} <300Hz {F[fr<300].sum()/F.sum()*100:.2f}%"
        )


# ---- preview
def load(p):
    with wave.open(str(p)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767


FS, UNIT, LAT = 0.300, 0.300, 0.05


def pour(x, t, n, opt, k):
    place(x, load(ROOT / "out" / f"lift-A-{k[0]%3+1}.wav"), t + LAT)
    k[0] += 1
    for u in range(n):
        place(x, load(out / f"glug2-{opt}-{k[0]%3+1}.wav"), t + LAT + FS + u * UNIT)
        k[0] += 1
    return t + LAT + FS + n * UNIT + 0.18


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
    "A": "classic bottle glug: 3 clear gulps per unit, light liquid bed",
    "B": "deeper, fuller gulps with a strong liquid bed",
    "C": "quicker, bubblier: 4 small gulps per unit with a trickle",
}
font = lambda s, b=True: ImageFont.truetype(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if b else ""), s
)
segs = []
for opt in "ABC":
    x = seq(opt)
    wp = HERE / f"seq-{opt}.wav"
    wav(x, wp)
    sp = HERE / f"spec-{opt}.png"
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
    d.text((300, 70), f"Sort / pour (v2)  -  option {opt}", font=font(44), fill=(235, 240, 245))
    d.text((300, 140), DESC[opt], font=font(26, False), fill=(170, 190, 210))
    d.text(
        (300, 190),
        "lift A + glug sequence | 1-unit, 4-unit, then 3 quick 2-unit pours",
        font=font(20, False),
        fill=(120, 140, 160),
    )
    im.paste(Image.open(sp).convert("RGB"), (40, 340))
    ip = HERE / f"card-{opt}.png"
    im.save(ip)
    seg = HERE / f"seg-{opt}.mp4"
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
final = HERE / "sort-pour2-ABC.mp4"
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
            str(HERE / f"check-{name}.png"),
        ],
        check=True,
    )
