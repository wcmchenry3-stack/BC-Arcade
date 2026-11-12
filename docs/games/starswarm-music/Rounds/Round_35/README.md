# Round 35 — Dark forward momentum without losing force

**Status: Round 35B preferred for increased urgency; full soundtrack still in development (November 12, 2026).** Both tests are 22.056 s, original procedural MP3s, 24 kHz stereo / 128 kbps, 353,324 bytes, **−18.6 LUFS each**. No production audio changed.

## Why this test

Owner reported Round 34B is finally getting closer to the musical force they want, but BG-1 and BG-2 still feel **faster without feeling lighter**. Past attempts at a generic pulse, random harmonic churn, and bigger ensembles failed. This experiment isolates the **rate of meaningful musical phrase movement** while preserving Round 34's dynamics.

## Two controlled renders

- **A — `starswarm-round35-A-directed-force-control.mp3`**: Round 34B's original expressive score, with its directed level arc and spectral balance, resynthesized as the comparison.
- **B — `starswarm-round35-B-dark-forward-motion.mp3`**: the *same original notes, chord vocabulary, voices, patch types and arrangement*, but the scored note starts/lengths and harmonic entries happen at **87% of their original time spacing** (13% compressed musical timing); underlying synthesis still uses the original oscillator pitches, **not MP3 playback speedup or pitch-shifting**. Directed crescendos and retreats also follow the faster phrase boundaries.

No drums, added instruments, extra arpeggios, new melodies, licensed source audio, or previous-round MP3 layers. A and B have been matched to the same whole-file LUFS, so B should not win because it's louder.

**Technical caution:** B's 22-second excerpt contains a later musical portion than A because its scored events advance faster. Both files have the same duration for easy playback A/B; this is a *compositional pace test*, not a fully controlled identical-content comparison. An abrupt ending isn't a proposed final loop seam.

## Decision gate

Does **B** feel more *urgent and forward-driving* while retaining A's **darkness, harmonic weight, sci-fi identity, musicality, and force**? Or does it feel rushed/light/busy? If it succeeds, develop an actually contrasting musical phrase rather than repeating the 22-second motif to reach seven minutes.

## Files

| Path | SHA-256 |
|---|---|
| `starswarm-round35-A-directed-force-control.mp3` | `865d1d546c2af23e550911618bd67fe1531ddd30dcffa32eb0a4eb202df8949f` |
| `starswarm-round35-B-dark-forward-motion.mp3` | `f68a01447ad6770e866716a850707bb496f4f805d50f1ac8858709d56d9a2367` |
| `starswarm_round35_momentum.py` | exact reproducible generator, requires the independently generated `starswarm_round31_expressive_lead.py` included in the ChatGPT bundle |

**Archive status:** Both MP3s and the Python source are in `StarSwarm_Round35_Audio_and_Source.zip` in ChatGPT; the current GitHub connector cannot transfer local binary artifacts. They are **not yet on the PR branch**. Upload the three files via the repository UI into `Rounds/Round_35/`, and ensure the Round 31 generator is in its sibling directory before claiming repository-side reproducibility.

Ongoing [draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734) · [audition issue #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642).

## Owner feedback — November 12, 2026

**Round 35B is preferred on urgency.** Owner confirms, "Yes b i am feeling more of the urgency." The 13%-closer note/phrase timing increased the intended sense of forward movement relative to the control. This is **approval of the tempo/musical-motion direction**, not yet a blanket approval of the sound design, full musical foundation, seven-minute arrangement, or final production master.

**Carry forward:** Round 34's successful coordinated dynamic force plus Round 35B's more urgent phrasing, while preserving serious, dark sci-fi musical weight. Do **not** automatically increase speed further: the current successful test establishes that more directed musical pace helps, not an optimal BPM. Avoid reverting to rhythmic busyness, adding noisy orchestration, or losing melodic coherence.

**Recommended next composition test:** use 35B's pace as a reference and **compose an original contrasting second phrase** with different melodic contour/harmonic movement but comparable urgency and weight, joined musically to the existing opening. Test short connected passages before growing the track. Previously approved Shepard descents, astronomical rises, robotic signals, choruses and organ remain separate and should not be used to hide a weak musical bed. Validate beneath gameplay SFX once the music itself is convincing.
