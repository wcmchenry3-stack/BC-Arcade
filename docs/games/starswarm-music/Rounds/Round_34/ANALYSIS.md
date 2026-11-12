# Round 34 — Reference comparison: musical force vs added density

**Status:** diagnostic analysis, not a new owner-approved audition (November 11, 2026). The owner rejected Round 33B as noisier, not more forceful; this analysis compares previously available audio before designing any new clip.

## Inputs and method

The analysis decoded local original BG-1/BG-2 MP3s plus our already synthesized experimental MP3s to 16 kHz stereo, examined **0.5-second** mono windows for short-term levels/spectral distribution, and measured whole-excerpt L/R correlation and relative spectral-change statistics. All excerpts are project/context audio used for measurement only. **No original licensed recording, pitches or melody are used as a synthesis input**. These are exploratory RMS/spectral metrics, **not** equal-loudness controlled subjective testing or LUFS and not proof of causation.

| Excerpt analyzed | Window |
|---|---|
| Original BG-1 opening | 0:00–0:22 |
| BG-1 astronomical passage | 0:47–1:04 |
| BG-2 chorus | 1:06–1:26 |
| Original procedural Round 18 Gathering Chorus | 0:12–0:36 |
| Original procedural Round 20 Astronomical Spotlight | 0:09–0:33 |
| Round 23 astronomical emphasis | 1:25–1:49 |
| Round 23 swarm emphasis | 2:38–3:02 |
| Rounds 30, 31, 32 and rejected 33B | each 0:00–0:22 |

## Findings

| Metric | BG-1 first 22 s | Round 30 first 22 s | Round 31 | Round 32 | Round 33B |
|---|---:|---:|---:|---:|---:|
| 90th–10th percentile 0.5s RMS dB | **4.9** | 2.2 | 2.2 | 2.2 | **1.7** |
| Median energy below 80 Hz | **40.2%** | 72.7% | 70.0% | 70.2% | 65.9% |
| Median energy 500–3000 Hz | 5.8% | 6.6% | 7.5% | 8.1% | 8.7% |
| Left/right waveform correlation | **~0.00** | 0.95 | 0.95 | 0.95 | 0.94 |
| Mean normalized spectral change statistic (arbitrary comparable units) | **3.96** | 1.59 | 1.57 | 1.57 | 1.65 |

BG-1's first **two seconds** average about **−33.8 dBFS** in mono 0.5s RMS windows; seconds 2–8 average **−17.1 dBFS**. It is **not** a constant loud arrival: it **grows dramatically in the first seconds and then remains active**. Round 32 first two seconds average **−17.2 dBFS**, seconds 2–8 **−14.6 dBFS**. Round 32 is louder earlier but feels less commanding. This is evidence *against* solving force by beginning at full volume.

Original BG-2 chorus (1:06–1:26) shows higher middle-register presence (median ~**55%** 500–3000 Hz energy) and greater ongoing spectral change (~**6.17** normalized statistic). The approved Round 18 chorus and Round 20 rise show different, more dynamic foreground/bed handoff mechanisms. These are not one-to-one same-loudness comparisons.

Round 33B made the mix denser but its short-term dynamic range **decreased** (1.7 vs 2.2 dB). The owner's perception of **extra noise but no extra force** is consistent with this result.

## Interpretation (hypotheses, not established facts)

1. **Dynamic trajectory / coordinated entrance** is likely more important than instantaneous level or sheer number of simultaneous tones. Current foundation has weak contrast and unchanging energy despite a decent overall master level.
2. **Midrange articulation and spectral motion** may be needed more than continuously increasing sub-bass or ensemble size; avoid simply boosting everything above 500 Hz.
3. **Stereo differentiation** is greatly reduced in current synths, but the owner's immediate concern is musical force, not surround width. Treat it as a later controlled test; indiscriminate phase decorrelation risks mono collapse and stereo masking of gameplay effects.

## Recommended Round 34 audible experiment (NOT YET RENDERED)

Keep the Round 31/32 coherent original melody/harmony and *number of voices* with no added effects, new ostinati, traditional orchestral lines or licensed input. Generate **one 18–25-second matched-loudness A/B**:

- **Control A:** current small, coherent electronic score.
- **Test B:** **recompose the performance envelopes and section handoffs**, not the music's note count: enter with a coordinated but incomplete statement; **ramp energy through first 2–5 seconds**, distribute attack transients across complementary registers, articulate important harmonic changes in the midrange, allow deliberate 1–2-second withdrawals and stronger re-entries, preserve a clear melodic destination at the end. Slight evolving spectral motion should be *performance-coupled*, not random oscillators. Keep bass weight but reduce its masking of expressive middle registers.
- Do **not** widen the stereo image in this first A/B; that should be a separately isolated later test if musical force improves.
- Test beneath actual gameplay SFX at the current BGM 0.2 volume; keep signature effects out. If B improves force but loses melodic clarity, revise phrase articulation rather than adding a wall of instruments.

## Decision

Owner must judge whether the **same notes, with better dynamics and coordination**, feel more powerful and urgent. If not, the force likely requires a deeper compositional change to melodic/harmonic motion instead of production tricks. Do not mark any next audio as approved until tested.

Relevant [draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734), [audition issue #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642), and [music epic #3635](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3635).
