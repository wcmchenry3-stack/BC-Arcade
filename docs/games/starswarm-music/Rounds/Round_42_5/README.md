# Round 42.5 — Determined Pursuit (foundation-only emotional experiment)

**Status: awaiting owner feedback (November 12, 2026).** Following the full Round 42 review, the owner approved the seven-minute structure and development but identified a mournful/sad emotional tone. They explicitly requested **no signature sounds** in the next experiment: the underlying score must convey urgency, power and determined engagement by itself.

## Controlled 60-second A/B
- **A — `starswarm-round42_5-A-mournful-control.mp3`**: independent source-code render of original Round 42's opening minute, preserving its original chord and melodic material.
- **B — `starswarm-round42_5-B-determined-pursuit.mp3`**: identical 60-second source-synthesized architecture, pace, dynamics, instrument roles, and section boundaries; only the harmonic grammar and melodic contour/pitch vocabulary are revised. The new passage uses D-minor-ninth, G-major, C-add-nine and A-suspended colors with a more upward-leaning melodic trajectory, intending *conviction and suspense*, **not** celebratory major-key or fantasy music.
- **Neither** contains robotic signals, astronomical rises, Shepard tones, swarm chorus, organ color or electromagnetic choir.

Both are **60.048 seconds**, **24 kHz stereo MP3 at 112 kbps**, **841,052 bytes** each, and approximately **−23.0 LUFS**. This is a controlled *composition and emotion* test, not a final mix or master, and the different melodic material means it is not a literal one-variable instrumentation test.

## Listening gate
1. Does B feel **determined, urgent and mission-driven** rather than mournful or resigned?
2. Does it retain coherent, dark sci-fi suspense rather than becoming triumphant, bright fantasy, or dissonant/noisy?
3. Is the continuous musical motion and expressiveness maintained without signature effects?
4. If it works, transfer the **musical logic** (not a mechanically repeated chord progression) into a revised seven-minute foundation while preserving Round 42's development and variety. If not, revise the underlying emotional grammar before Round 43.

## Reproducibility and files
The complete **`StarSwarm_Round42_5_Determined_Pursuit.zip`** includes the two rendered MP3s, exact procedural original Round 42 source, the short `make_variants.py` orchestration script, exact render scripts `_A_render.py` and `_B_render.py`, and README. No third-party source recordings, samples or prior rendered MP3 were read by the render.

| File | SHA-256 |
|---|---|
| A MP3 | `816294e1562ef9ba5e81194744682b1a13a57cfcb0fe8a303d0164ddfc1f6913` |
| B MP3 | `2d43f82d18fc84303d372e40c007a552547487a41466e0bc0b0233cb1685ea6e` |
| `make_variants.py` | `35c44b1f7357b44e07255d574613f0f69849ba0049b3b4781324d9b480387e3d` |
| `_A_render.py` | `1109fe060759f6ef82e26e4cd092729e18350da3fa041bbca84d0d64aa610865` |
| `_B_render.py` | `066dc301d08d08bf941969e952052647b23023219690c532507edfe2e4d8d5f7` |

**Archive state:** this README is committed to existing draft PR #3734; ZIP and render files are available in ChatGPT but have **not** been uploaded to the PR branch through this connector. Owner can upload the ZIP to this folder. Production game audio remains untouched.

Related: epic #3635, audition #3642, Round 42 README and Round 41 storyboard.
