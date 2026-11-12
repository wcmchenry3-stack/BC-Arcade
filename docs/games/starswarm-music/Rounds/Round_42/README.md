# Round 42 — Seven-minute continuous musical foundation (creative rough)

**Status: ready for owner audition, November 12, 2026.** This is **foundation-only**, not final Star Swarm BGM and **not** a loop-/gameplay-mix-approved release. The next phase (Round 43) will arrange varied signature features once this underlying musical arc works.

## Creative goals

Follow the [Round 41 full-score storyboard](../Round_41/STORYBOARD.md), preserving previously favored: **Round 34B's coordinated force, Round 35B's increased urgency, Round 37B's continuous undercurrent through quiet passages and Round 38's connected thematic development**.

The underlying soundtrack must be compelling for continuous combat with the signatures absent. No old ambient recordings or previously rendered MP3s are layered or repeated. This draft synthesizes all the notes, voices, harmonic movement and musical textures from its own deterministic procedural score; the original BG1–4 recordings are not read or sampled. It is an original composition using the project's established electromagnetic timbral vocabulary.

## Musical arrangement

**Target/current length 7:00**, divided for *developmental design* into seven organically connected ~60-second movements, not seven replayed clips. Three original melodic/motivic contour families recur at structurally different times, with contrasting harmonic paths, varying phrase entrances/omissions and recontextualized returns. Energy remains active in lower-density parts; orchestral size is pursued through coordinated dynamics and articulate voice leading rather than indiscriminate added layers.

| Approx. time | Underlying score purpose |
|---|---|
| 0:00–1:00 | Determined opening and active theme A; harmonic pressure with D minor/B-flat/G minor/A suspended |
| 1:00–2:00 | Theme B, darker descent and altered harmonic direction; G minor/E-flat/C minor contrasts |
| 2:00–3:00 | Rising theme C and a smaller but moving passage |
| 3:00–4:00 | More forceful pursuit and a different return of B |
| 4:00–5:00 | Reharmonized theme A with renewed pressure and variation |
| 5:00–6:00 | Subdued uncertainty with forward-moving undercurrent; theme C changes shape |
| 6:00–7:00 | Stronger musical continuation and changed return toward opening material; no final triumphant cadence |

These labels are **composing prompts**, not gameplay narrative events. The game remains completely independent of BGM timing.

## Audio and source

- `starswarm-round42-seven-minute-foundation-rough.mp3`: verified **420.048 seconds** (MP3 codec padding), **5,881,052 bytes**, 112 kbps stereo, 24 kHz sample rate, integrated **−22.9 LUFS**, loudness range **6.0 LU**, true peak **−10.6 dBFS**.
- `starswarm_round42_foundation.py`: reproducible source, with deterministic seed, no source audio dependencies. Requires Python with numpy/scipy and ffmpeg.
- ZIP: `StarSwarm_Round42_Audio_and_Source.zip`, containing MP3, script, and short README; integrity checked.

**SHA-256:**
- MP3: `6d5701c2b50a53cb6d5607305dc06d605c5662767fb319cf8e4631fbdc11f11b`
- Generator: `8557f487f2151cb0fec14859c762c1489f5ad2ceccf4d9a17a5161b244f4f950`

**Quality caveat:** the first processing attempt stalled, but the complete score was successfully rerendered at **24 kHz stereo** in the same audition format as recent rounds. This is still a *creative rough*, not final mastering. Do **not** infer final treble fidelity, in-game clarity, loop smoothness or device playback quality from this audition. The file has a short fade instead of a certified seamless loop.

## What the owner should evaluate

1. Does the **entire 7 minutes** continue to feel urgent, powerful and dark, not only during opening/theme peaks?
2. Do returning themes feel **familiar but transformed**, rather than pasted/replayed?
3. Are the changes in harmony and melodic ideas **musically compelling**, or do some minute-long stretches sound samey/aimless?
4. Do quieter movements continue carrying the player forward?
5. Does the ending lead naturally back conceptually to the beginning, even though the actual loop seam is **not implemented**?

**Do not introduce signatures or wire into gameplay until creative feedback.** After a successful foundation review, Round 43 should integrate the separate, varied astronomical rises, Shepard descents, Gathering Swarm, Electromagnetic Choir, robotic gestures and distant organ from the Round 41 plan with musically flexible ~10–20-second foundation-only breathing intervals.

## Archive status

This README is committed to [ongoing draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734). The MP3 and Python source are available together in the ChatGPT ZIP. The available GitHub connection cannot stream generated local artifacts to GitHub, so these two files still need owner upload to this folder; do not claim them committed. Production assets and code have **not** been changed.

Related: [epic #3635](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3635), [auditions #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642).

## Owner listening response — November 12, 2026: musical form passes, emotional tone does not yet

The owner listened to the complete seven-minute foundation and confirms that it **sustains, develops, and does not feel repetitive**. That is an important approval of its **long-form compositional structure**. However, its overall emotional character feels **mournful / sad**, which is not suitable as the main accompaniment to Star Swarm's continuous military sci-fi combat. This is a substantial open issue, not a production signoff.

**Primary desired emotion:** mission-driven **determination and urgency with power**. Dark, anxious, uncertain, ominous and courageous qualities remain, but the soundtrack should not read as grief, resignation, lament or melancholy. The player is seeking a known adversary and fighting continuously, not mourning a loss. Do not simply make everything major-key, cheerful, bombastic or triumphant, and do not erase the serious tonal identity.

**Do not assume signature sounds alone will solve the issue.** Astronomical rises, swarm choruses, electromagnetic choir, Shepard descents and robotic signals can reinforce sci-fi identity and impact, but they will not change the emotional read of long foundation-only passages reliably. Preserve the seven-minute **form and development architecture**, but validate an emotional/harmonic correction of the base before a full Round 43 signature orchestration.

**Recommended diagnostic Round 42.5:** select 45–75 seconds from a representative mournful portion of the current score, then create a controlled A/B retaining melodic contour, pacing, movement, and electronic instrument palette while revising *harmonic direction, cadences, voicing and melodic emphasis* to move the tone from lament to **purposeful tension / determined pursuit**. Analyze whether descending minor contours, long sustained resolutions, low register, slow attack/release or specific chord tones are contributing (do not guess a single culprit without hearing stems). Compare at matched perceived loudness. Optionally layer one already approved signature as a secondary test only **after** the foundation-only variant passes; if it still sounds sad underneath, fix the score itself. Then propagate the approved emotional grammar through the longer arrangement with variations. No production integration or final loop authorization yet.
