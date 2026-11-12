# Round 38 — 90-second musical development

**Status:** original long-form foundation audition, awaiting owner feedback (November 12, 2026). **No production BGM or gameplay changed.**

## Creative purpose

Build beyond the already useful short experiments without relying on signature effects or merely repeating the opening. Inherit **Round 34B's directed force**, **Round 35B's 0.87 faster phrase spacing**, and **Round 37B's supported finding that musical flow should survive quieter passages**. Round 36 supplied the two connected introductory phrases, while this round adds **two newly scored melodic/harmonic phases**, bringing the uninterrupted music to ~90 seconds.

### Audible narrative (not gameplay synchronization)

| Approximate time | Musical emphasis |
|---|---|
| 0:00–0:21 | Recognizable, serious electromagnetic opening with directed crescendos |
| 0:21–0:46 | Contrasting second phrase, traveling through G minor / E-flat / B-flat / suspended dominant |
| 0:46–1:06 | New rising and redirecting pursuit idea with different contour and harmonic colors |
| 1:06–1:18 | Subdued passage: energy withdraws but existing bass/harmonic voices keep the phrase in motion |
| 1:18–1:30 | Reassertion and unresolved continuation, not a final cadence or loop |

These are *listening guide landmarks*, not rigid musical chapters; exact phrase arrivals may overlap. This draft does **not** contain the already-approved astronomical rises, Shepard falls, organ colors, robotic signals or swarm choruses. Those remain independent, approved *signature sounds* for later arrangement.

## Asset + reproducibility

- MP3: `starswarm-round38-ninety-second-development.mp3`
- Generator: `starswarm_round38_ninety_second_development.py`
- Dependencies: original project synthesis generators in `../Round_36/starswarm_round36_two_phrases.py` and `../Round_31/starswarm_round31_expressive_lead.py`.
- Generator builds the entire track **from source synthesis**, not previous MP3 recordings; no third-party/reference recordings sampled. Uses numpy/scipy/ffmpeg and deterministic score/synth code.
- 90.048 s MP3 (including codec padding), 24 kHz stereo, 128 kbps, **1,441,196 bytes**.
- Measured integrated loudness **−20.6 LUFS**, loudness range **3.2 LU**, true peak **−7.4 dBTP**. This is a *creative working level*, **not loudness-matched to the original BGM** nor tested at BGM=0.2 against combat sound effects.
- Not loop-certified, not mastered, not cue-offset-tested; currently a short audition fade on the end.

## SHA-256

| File | SHA-256 |
|---|---|
| `starswarm-round38-ninety-second-development.mp3` | `dd331be64018fb2656bcb5c2dbef496472d8755e637de228d3a75ba25b7999ef` |
| `starswarm_round38_ninety_second_development.py` | `9ce9fc6991b90b84e62125473ec36a4207e1e7b2fde0b726180efc549609a9e6` |

## Listening gate

**Do not approve because it is longer.** Does the musical idea evolve naturally across the full 90 seconds, remain urgently carried along in the softer span, avoid feeling like a repeated 20-second loop, and retain coherent dark sci-fi character? Does the new melodic material around 0:46 feel like progression rather than a different song? Are any passages too repetitive or mechanically synthetic?

Keep this test at the composition level. If approved, then attempt a *longer* arc and eventually integrate the already approved special sounds, test in game, master, re-audit cue entry points and verify seamless looping.

**Repository archive status:** audio + exact generator + source dependencies have been packaged in ChatGPT in `StarSwarm_Round38_Audio_and_Source.zip`. They are **not yet committed to the GitHub branch**, as this connector does not accept local file/binary uploads. The owner can copy MP3 and generator to this folder; the original source dependencies belong in their existing Round_31 and Round_36 directories. This README is on the ongoing draft [PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734). Audition issue: [#3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642).
