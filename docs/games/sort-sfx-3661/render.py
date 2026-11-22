import sys, subprocess, wave
from pathlib import Path
import numpy as np
import _paths
from sort_sfx import *
from synth_common import write_ogg, SR, decoded_pcm_sha256

out = _paths.SCRATCH / "out"


def wav(x, p):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


rows = []
for name, (fn, nv) in SOUNDS.items():
    for opt in "ABC":
        for i in range(nv):
            x = fn(opt, i)
            stem = f"{name}-{opt}-{i+1}"
            write_ogg(x, out / f"{stem}.ogg")
            wav(x, out / f"{stem}.wav")
            w = int(0.05 * SR)
            r = np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid")).max()
            F = np.abs(np.fft.rfft(x)) ** 2
            fr = np.fft.rfftfreq(len(x), 1 / SR)
            lo = F[fr < 300].sum() / F.sum() * 100
            rows.append(
                (
                    name,
                    opt,
                    i + 1,
                    len(x) / SR,
                    (out / f"{stem}.ogg").stat().st_size,
                    20 * np.log10(r),
                    20 * np.log10(np.abs(x).max()),
                    lo,
                )
            )
import json

json.dump(rows, open(out / "table.json", "w"))
for r in rows:
    print("%-9s %s%d %.3fs %6dB rms50 %.1f peak %.1f <300Hz %.2f%%" % r)
