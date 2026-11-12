# Round 46 — Seven-minute Star Swarm signature orchestration

**Status: creative audition ready, owner feedback pending (November 12, 2026).** Full seven-minute mix arranged from **owner-approved Round 44 ambient foundation** and **owner-approved Round 45 first two-minute treatment**. This is *not* the final loop, master or actual gameplay mix.

## Arrangement / audible signatures

The first 120 seconds are taken from the approved Round 45B MP3 (re-encoded with a 0.7-second boundary blend). The musical score from Round 44 continues unbroken underneath all added features. Multiple returning signature families are **varied in segment selection, pitch/register, duration and foreground level**, rather than identical pasted samples. The project-owned generator code synthesizes the stems from scratch with the old demo backing nulled; no Pixabay/other licensed BG recordings are read or sampled.

| Time | Foreground feature |
|---|---|
| **0:10–0:27** | Astronomical rise, approved first-minute treatment |
| **0:42–1:00** | Varied robotic gestures |
| **1:16–1:33** | Gathering Swarm Chorus |
| **1:49–1:59** | Electromagnetic Choir |
| **2:16–2:29** | Distinct audible descending Shepard, over continued bed |
| **2:46–3:01** | Restrained distant organ color |
| **3:18–3:34** | Robotic gestures, altered/higher-register |
| **3:53–4:10** | Astronomical rise, different arc |
| **4:26–4:42** | Gathering Swarm, darker/shorter reprise |
| **5:00–5:15** | Electromagnetic Choir, different register |
| **5:33–5:47** | Descending Shepard, lower start and altered descent rate |
| **6:04–6:19** | Robotic gestures, fragmented reprise |
| **6:34–6:47** | Gathering Swarm, shortened return |
| **6:47–7:00** | Foundation only; no dramatic final impact |

**Breathing room:** approximately 15–19 s of uninterrupted foundation between added featured events. The first four signatures preserve Round 45's approved pacing. The rise and Shepard descent are not adjacent. The user-approved Round 40 Shepard octave illusion is embedded with continuing music and temporary backing clearance.

## Render and reproducibility

- MP3: `starswarm-round46-seven-minute-signature-mix.mp3`
- Duration **420.048 seconds**, **24 kHz stereo**, **128 kbps**, **6,721,196 bytes**.
- Integrated loudness **−24.0 LUFS**, loudness range **6.4 LU**, true peak **−9.9 dBTP**, no clipping.
- MP3 SHA-256: `29b0a1604e458fa1b0cb92d0502c283b836d1b1f9b2a63a3f012fd3c815f442a`.
- Generator SHA-256: `777de55dbf1eff9fbe8f85c3bcfa6b9be96dfce03a59bbd32d2839e874702e4f`.
- First 2-minute fidelity: decoded correlation to approved Round 45B **over 0.99997** in windows before 119s (not byte-identical, due to MP3 re-encoding).
- Reproducible files, committed in this directory (the original ZIP was unpacked: it exceeded the 5 MiB limit): the render `starswarm-round46-seven-minute-signature-mix.mp3` (6.4 MiB, allow-listed by exact path and size in `scripts/check_large_files.py`), generator `starswarm_round46_full_orchestration.py` and cue file `round46_cues.json`. Inputs the ZIP bundled as duplicates live with their rounds: Round 44 MP3 in `../Round_44/`, Round 45B MP3 in `../Round_45/`, and the Round 18/19/20 synth generators in `../Round_18/`, `../Round_19/`, `../Round_20/`.

## Review gate

1. Does the music remain an **ambient-first gameplay bed** under each signature?
2. Do the seven minutes sustain enough variation and sufficient **15–19s breathing room**?
3. Is **Shepard** clear and audible within the music (twice), not adjacent to the astronomical rise?
4. Are repeated choruses/robotic events distinct yet recognizably part of the same composition?
5. Are the sounds too present, too sparse, or balanced?

After creative approval, test with the actual game's laser/explosion SFX at true BGM playback gain; verify device codec/loop, master level, filesize, local phrase-safe entry/reentry and cross-game carry-over. **The current Round 44-based rough fades at the beginning and end, so it is NOT seamless-loop-ready. No production assets have changed.**

Related: [music epic #3635](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3635), [audition log #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642), and [draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734).


## Owner creative sign-off — November 12, 2026

**Owner verdict: “this is a winner.”** Round 46 is **approved as the full seven-minute creative composition / signature orchestration**. The underlying Round 44 atmospheric bed, approved Round 45 intro, repeated and varied astronomical rises, robotic signals, Gathering Swarm Chorus, electromagnetic choir, distant organ color and two clearly articulated Shepard descents are accepted as the intended *musical direction and arrangement*. Preserve the mix's spacious foundation, 15–19-second breathing intervals, varied returns and separation between rises and Shepard tones. **Do not undertake another creative rewrite without a specific new owner request.**

**This is creative acceptance, not a production-ready audio sign-off.** Remaining tasks: test soundtrack with actual gameplay laser/explosion SFX at the game's real background music gain, refine music-vs-effects headroom and device translation, render/master release-grade audio while retaining dynamics, implement an actually seamless codec-safe loop (the audition rough has intro/outro fades), confirm file size compared with prior 11.28 MB combined BG asset budget, choose and test phrase-safe return-session start points, and preserve playback position across contiguous games/local sessions. Integrate/remove licensed background files only after review. Keep draft PR #3734 open until production QA and owner acceptance.
