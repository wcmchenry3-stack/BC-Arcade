# Round 29 — isolate and replace the fantasy-sounding foreground voice

**Status:** owner audition pending (November 11, 2026).

This is a **controlled diagnostic of the original Round 28 22-second arrangement**, not a new full musical foundation. Owner liked the increased force toward the end of Round 28 but rejected the exposed instrument that reminded them of a Renaissance fair.

## Experiments

- `starswarm-round29-A-without-lead.mp3` — 22.056 s; removes the exposed upper melodic line (and its accompanying octave shadow) entirely, leaving the **same low-end, sustained ensemble harmony, bass steps, short noise gestures and build**. Tests whether the backing itself has the desired sci-fi power.
- `starswarm-round29-B-electromagnetic-lead.mp3` — 22.056 s; preserves exactly the same backing, but gives the original **same pitches and phrase timings** to a softer inharmonic, FM-like electronically modulated tone with slower attacks, rather than the Round 28's exposed conventional melodic instrument. Tests whether revoicing alone removes the fantasy association while maintaining momentum.
- `starswarm_round29_lead_diagnostic.py` — exact reproducible synthesis source, built from the Round 28 original procedural source, not from MP3 recordings.

**Control:** shared deterministic RNG, harmony, bass notes, movement, effects and one common output gain. Measured levels: **A −13.8 LUFS**, **B −13.6 LUFS**, each 24 kHz stereo / 128 kbps MP3 / **353,324 bytes**. The difference is only the lead treatment; neither has existing bed audio, third-party samples, or previously approved signature effects.

## Decision gate

1. Does A still feel **powerful** toward the end, even without the exposed line?
2. Does B sound convincingly **space/electromagnetic** rather than medieval/fantasy, while maintaining the end-of-clip force?
3. If A and B both feel flat, the source of the remaining problem could be the backing itself, so do not add yet another instrument on top. Reassess the harmonic voicing and articulation instead.

Neither version is final soundtrack material, nor has anything in production changed. Future iterations continue through this same draft PR #3734.

## Files and integrity

| File | Size (bytes) | SHA-256 |
|---|---:|---|
| `starswarm-round29-A-without-lead.mp3` | 353324 | `5358142488ce6a4e317bdb794bd9af4ae19135619f53dfad7862be1c2440a563` |
| `starswarm-round29-B-electromagnetic-lead.mp3` | 353324 | `840b99cedf920f01ab5d94871994443677bd9cd9ca87717398e782c59357ea91` |
| `starswarm_round29_lead_diagnostic.py` | 5507 | `8da2c827d949705bb525d31dedde8007faf07c79dfc66ccc167628db5633610a` |

**Repository media/source status:** the exact audio and script are packaged in the ChatGPT Round 29 ZIP, but binary uploads and local file transfer to GitHub remain unsupported by this connection. Add the three files to this folder before describing Round 29 as fully archived.
