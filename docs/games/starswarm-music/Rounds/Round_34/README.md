# Round 34 — Why does the original music feel more forceful?

**Status:** diagnostic measurement complete; 22-second A/B audition awaiting owner review (November 11, 2026). No production game asset changed.

## Grounded observations

Measurements were made from the actual original BG-1/BG-2 recordings and previously generated Round 18/20/23/30–33 MP3s. The source recordings are **not** imported into the generated music. The full method, windows and caveats are in [ANALYSIS.md](./ANALYSIS.md).

- BG-1 first 22 s: ~**4.9 dB** 0.5-second RMS 90th–10th percentile span, compared with **2.2 dB** in Round 32 and **1.7 dB** in rejected bigger-ensemble Round 33B.
- BG-1's early two-second average was **−33.8 dBFS**, vs next 2–8s **−17.1 dBFS**: it grows rapidly, rather than starting at a sustained full level. Round 32 opened louder but comparatively static.
- Median spectral energy below 80 Hz: **~40% in BG-1**, ~**70% in Round 32**. This is energy distribution, not perceived bass loudness.
- BG-1's stereo channel correlation approximately **0**, versus **0.95** for the recent original synthetic foundation. Width may matter, but it was **not changed** in this test.
- BG-2's foreground chorus has substantial midrange presence and spectral change. This does not establish that the exact spectrum causes perceived force, only that the successful cues move and redistribute energy more.

**Interpretation:** The music needs dynamically coordinated *arrival, withdrawal, tension and reentry*, not a larger number of simultaneously sounding notes. The observations suggest the score might lack expressive cross-register dynamics and attack direction.

## New controlled audition (same melody, no effects)

| File | Duration | Encoded size | Integrated loudness | Loudness range |
|---|---:|---:|---:|---:|
| `starswarm-round34-A-original-score-control.mp3` | 22.056 s | 353,324 B | −19.2 LUFS | 1.9 LU |
| `starswarm-round34-B-directed-musical-force.mp3` | 22.056 s | 353,324 B | −18.7 LUFS | 2.7 LU |

- **A:** 22-second excerpt of independently synthesized Round 31 coherent theme with original accompaniment. New render ensures the same encoding and control gain.
- **B:** Exactly the same original scored notes and number of instruments. The bass level is slightly reduced to free up the supporting midrange, while the score's energy rises across the opening and deliberately retreats/re-enters at harmonic changes. No added orchestra, melody, effects, sample or stereo widener.

The source is `starswarm_round34_dynamic_test.py`, committed on the ongoing [draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734). It imports the original project Round 31 synth script from `../Round_31/`. The ChatGPT ZIP includes this dependency, analysis script, measurement JSON and both MP3s. **The MP3 files still need to be added to the repository branch by the owner.**

## Owner decision gate

At matched listening volume, does B sound more *forceful, urgent and meaningfully musical* despite being based on the same notes? Or is it merely louder at selected points / too obviously automated? If B doesn't help, reconsider melodic/harmonic composition itself before attempting a seven-minute extension. Do not claim approval based on measurements alone.

Related [audition issue #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642), [epic #3635](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3635).
