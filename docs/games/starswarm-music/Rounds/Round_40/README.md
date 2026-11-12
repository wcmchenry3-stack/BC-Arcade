# Round 40 — Better signature spacing, fuller signals and audible Shepard

**Status: owner approves Round 40B as working creative direction; long-form score still to compose (November 12, 2026).** This is a focused arrangement revision of Round 39B, not a rewritten foundation, final loop, mastered in-game mix or production audio change.

## Owner requirements

- Preserve Round 39's successful **astronomical rising passage**, including its gradual entrance and music return.
- Give the underlying music a **small breathing interval** before the robotic sounds, rather than jumping immediately from the rise to signals.
- Add **more varied robotic gestures before the Gathering Swarm Chorus**, establishing a sequence that naturally leads into that chorus.
- **Keep the electromagnetic choir** from Round 39; owner explicitly approved it.
- A descending **Shepard illusion must be more clearly perceptible**, but should occur **over a continuing moving background musical foundation**, not isolated in silence. Do not force the effect if it doesn't musically work.
- Preserve Round 38's musical development and Round 35B's urgent pacing; signatures can be relatively frequent while still distinct, not a muddy soup.

## Musical arrangement (90-second experiment)

| Approx time | What happens |
|---|---|
| 0:07–0:26 | Original project-synthesized **astronomical rise** enters, briefly foregrounds, fades back into the score |
| 0:26–0:32 | **Foundation-only space** (about six seconds): continuous urgency but no signature foreground event |
| 0:32–0:56.5 | **Extended robotic signals**, using multiple different gestures from the originally approved procedural Round 20 sequence |
| 0:54–1:12.5 | **Gathering Swarm Chorus**, entering near the end of the robotic prelude as a deliberate handoff |
| 1:12–1:21.2 | **Electromagnetic Choir**, retained as its own distinct signature treatment |
| 1:21–1:30 | **Descending Shepard** with stronger direct amplitude and temporary attenuation of the existing musical bed, which continues under it |

These timings are for a **short arrangement test only**. Near the clip's end, the Shepard is deliberately showcased to make A/B comparison easier; the final composition would need more development after it, not a hard termination. The standalone original Round 38 music is the only continuous backing. Signature stems are resynthesized from project-owned generator code with their original demo backgrounds zeroed; **no third-party BG recordings sampled**.

## Audition files

- `starswarm-round40-A-round39-control.mp3` — 90.048 s / 1,441,196 bytes, a freshly encoded Round 39B control
- `starswarm-round40-B-spaced-signatures.mp3` — 90.048 s / 1,441,196 bytes, the revised arrangement
- `starswarm_round40_signature_spacing.py` — exact reproducible construction code; dependencies are the original `Round_38` foundation MP3, original Round 39B reference render, and the Round 18 and Round 20 synthesizer scripts.

Both files measure **−21.2 LUFS integrated**, with loudness ranges 4.6 LU (A) and 4.4 LU (B), true peaks −7.6 and −7.3 dBFS. Those levels are **for fair listening comparison**, not mastered to the old ~−12 LUFS target or checked with the current 20%-volume gameplay SFX.

| File | SHA-256 |
|---|---|
| `starswarm-round40-A-round39-control.mp3` | `e904120e6de8f54a03fc0b84b51c1d8b9262b605b7f85a104d6c8bb3fa481e26` |
| `starswarm-round40-B-spaced-signatures.mp3` | `fd8e5d760afb9c282dac9b2b326d402c509241b07394e4996f165125e9e1e7dc` |
| `starswarm_round40_signature_spacing.py` | `300f8241068208b0dcd357822965db16b539c028dc5d2d9d4344c12ffb8efaad` |

## Owner listening questions

1. Does the short gap after the rise feel like enough musical breathing room without over-spacing signature events?
2. Do the longer, varied robotic gestures lead naturally into the Gathering Swarm Chorus?
3. Is the electromagnetic choir still clearly recognizable and welcome?
4. Can the descending Shepard finally be **heard as a downward illusion** over the musical bed, rather than drowned out or an unnatural isolated effect?
5. Does the foundation preserve urgency while these elements recur more prominently?

**Archive status:** the two MP3s (`starswarm-round40-A-round39-control.mp3`, `starswarm-round40-B-spaced-signatures.mp3`) and the generator `starswarm_round40_signature_spacing.py` are committed in this directory. Regeneration inputs: the Round 38 and Round 39B MP3s are in `../Round_38/` and `../Round_39/`; the Round 18 and Round 20 generators are in `../Round_18/` and `../Round_20/`. The original ZIP was unpacked into loose files because it exceeded the 5 MiB tracked-file limit.

[Audition issue #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642) · [Epic #3635](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3635).

## Owner approval and long-form arrangement principle — November 12, 2026

**Round 40B approved as the working musical/sonic direction.** Owner says "I think we've got it" and likes **all of the signature elements**, including the astronomical rise, Gathering Swarm Chorus, robotic signals, electromagnetic choir and now the **descending Shepard tone, finally audible and functioning as intended**. Preserve the Round 40B Shepard treatment with the continuous backing score under it.

**Critical new spacing requirement:** ALL signature events need breathing room—not merely the astronomical-to-robotic handoff. As a typical musical aim, allow **about 10–20 seconds of foundation-only music between significant featured events** (musically adjusted, not an inflexible stopwatch rule). This must be a meaningful stretch of the established urgent, developing Round 38-style score, not silence or static pads. Do **not** return to Round 23's whole-minute gaps or Round 39's near-back-to-back dense features. The astronomical upward rises and descending Shepard falls especially **must remain distinct and well separated**, never competing or directly adjacent; avoid effects soup or masking a foreground voice with the next one.

**Approval scope:** this approves the creative direction and individual treatments in the short 90-second study, **not** an exact final-event schedule, a finished seven-minute arrangement, production mix/master, saved session entry cues or loop implementation. Round 40's packed 90-second audition exists to test features and should **not** be mechanically repeated.

**Next recommended workflow:** move into long-form composition planning. Draft a **6–8-minute macro-arrangement/storyboard** built on Round 38's development, Round 35B urgency, Round 34B force and Round 37B quiet-passage propulsion; include new contrasting phrases and coordinated reprises, and identify several **10–20s foundation-only intervals** across the piece. Place approved signature sounds as distinct, clear events with varied prominence, no literal gameplay sync, and with independent space for astronomical rises vs Shepard descents. Review the plan before building a complete audition. Then render a first long-form *musical rough* (not loop/master) for owner review; after approval validate SFX balance at 20%, actual iOS/Android playback, seamless codec loop, target loudness, filesize and distributed entry/carry-over points (old Round 23 cue timestamps are obsolete). Keep versioned assets and creative decisions on PR #3734 and issue #3642. No production changes authorized yet.

