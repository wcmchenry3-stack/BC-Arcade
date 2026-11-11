# Star Swarm music design log (#3637)

Provenance and design record for the Star Swarm background track
(`frontend/assets/sounds/starswarm-bgm.mp3`). Part of epic #3635. The full round-by-round working
log is in [#3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642); the owner's decisions
are in [its decision comment](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642#issuecomment-6743260355).

## Brief

Replace the four Pixabay tracks (`starswarm-bg-1..4.mp3`) with **one original track** that carries
their elements. Mood: dark sci-fi. An organ colour runs through the later sections. The track plays
as a loop, with starting points so each game does not open on the same bar.

## Rounds in brief

The owner built the track over 23 rounds of procedural synthesis. Full detail is in #3642.

- Rounds 1 to 4: opening sketches.
- Rounds 5 to 10: foundations, extension, development, blend, tension, storytelling.
- Rounds 11 to 17: adventure, space motion, danger, patrol swarm, momentum, long-form structure.
- Rounds 18 to 20: foreground chorus, the remaining colours, spotlight signals.
- Round 21: first full-length rough. Round 22: transitions.
- **Round 23: the integrated 7:00 rough, the approved track.**

## Archive and fingerprints

Every round's generator script and render, plus `MANIFEST.csv` and `README.txt`, is archived in
[`docs/games/starswarm-music/`](starswarm-music/) (#3675).

| Item        | File                                                     | SHA-256                                                            |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Final track | `Rounds/Round_23/starswarm-round23-integrated-rough.mp3` | `11acf79c322822775dee43a0b587b9e583885d527aa3e827b78db8ba748106f5` |
| Generator   | `Rounds/Round_23/starswarm_round23_integrated_rough.py`  | `8d5e9224f55b59e5a105d9a7fdddb0802c70cc7422f2d180b2ccf0a7aa0bf3dd` |

The shipped file is a byte-for-byte copy of the final track (a Jest test checks the hash).

## Toolchain and rights

Procedural Python synthesis (numpy, scipy, soundfile, ffmpeg/libmp3lame), generated in a ChatGPT
workspace. Later rounds layer the project's own earlier renders. There are **no third-party
samples**. `starswarm-bg-1..4` were listening and analysis references only; none was sampled. The
rights wording was confirmed by the owner on 2026-11-11 (see `SOUND_CREDITS.md`).

## Round 23 time map

Feature placements in the generator, in seconds (m:ss):

| Time                      | Feature                                                    |
| ------------------------- | ---------------------------------------------------------- |
| 72 (1:12)                 | Astronomical rise feature (enters at 11 s)                 |
| 155 (2:35)                | Signals into the gathering chorus                          |
| 250 (4:10), 371 (6:11)    | Shepard falls                                              |
| 269 (4:29)                | Organ colour, into the electromagnetic choir at 293 (4:53) |
| 326 (5:26)                | A shorter astronomical rise                                |
| 380 (6:20)                | Organ reprise                                              |
| 413 to 420 (6:53 to 7:00) | Seam crossfade for the loop                                |

## Starting points

`frontend/src/game/starswarm/bgmCues.ts`: 0:00, 1:12, 2:35, 4:29, 5:26. Each is a feature entry in
the time map, so a game opening there starts on something that sounds intentional. All fall before
the 6:53 loop crossfade.

| Cue  | Why                                         |
| ---- | ------------------------------------------- |
| 0:00 | The designed opening                        |
| 1:12 | The astronomical rise                       |
| 2:35 | Signals into the gathering chorus           |
| 4:29 | Organ colour into the electromagnetic choir |
| 5:26 | The shorter late rise                       |

**Owner-confirmed by ear on 2026-11-11.** Audition clips (20 s, 1.5 s fade-in, plus the loop seam) are
rendered by `python tools/assets/render_bgm_cue_clips.py` into the git-ignored `tools/assets/out/bgm-cues/`.
The owner approved all five points as they stand.

## Originality report

Method (`tools/assets/check_bgm_originality.py`, numpy and ffmpeg only): decode to mono 11,025 Hz;
12-bin chroma over 2 s frames (STFT 8192, pitch classes over 55 to 2000 Hz, L2-normalised per
frame); a pair's score is the best mean cosine similarity over 30 s windows, at every pair of
window starts in the two tracks (every relative offset, including the corners) and all 12 transpositions. The threshold is the highest score
among the four source tracks compared with each other; the candidate passes if every score against
the sources is at or below it. Scores from this script are not comparable with those of the
earlier #3636 draft, which used a different chroma implementation.

| Pair                                               | Best similarity |
| -------------------------------------------------- | --------------- |
| starswarm-bgm.mp3 vs starswarm-bg-1.mp3            | 0.9181          |
| starswarm-bgm.mp3 vs starswarm-bg-2.mp3            | 0.9068          |
| starswarm-bgm.mp3 vs starswarm-bg-3.mp3            | 0.8817          |
| starswarm-bgm.mp3 vs starswarm-bg-4.mp3            | 0.9044          |
| baseline: starswarm-bg-1.mp3 vs starswarm-bg-2.mp3 | 0.9535          |
| baseline: starswarm-bg-1.mp3 vs starswarm-bg-3.mp3 | 0.9313          |
| baseline: starswarm-bg-1.mp3 vs starswarm-bg-4.mp3 | 0.9464          |
| baseline: starswarm-bg-2.mp3 vs starswarm-bg-3.mp3 | 0.9343          |
| baseline: starswarm-bg-2.mp3 vs starswarm-bg-4.mp3 | 0.9187          |
| baseline: starswarm-bg-3.mp3 vs starswarm-bg-4.mp3 | 0.8921          |
| threshold (baseline maximum)                       | 0.9535          |
| result                                             | PASS            |

Numbers only; the check was run on the shipped file against `starswarm-bg-1..4.mp3`.

Limit: the baseline-maximum threshold detects copies and near-copies (scores near 1.0) of any 30 s
stretch, at any offset or key. It does not detect loose stylistic resemblance. If two sources were
near-duplicates of each other, the threshold would rise toward 1.0 and the check would lose its bite.

## Technical facts and loudness

- 420.048 s by ffprobe (decodes to exactly 420.0 s), 5,881,052 B, MP3 24 kHz stereo 112 kbps.
- Loudness −21.1 LUFS, LRA 9.6 LU, true peak −4.7 dBTP.
- Decision (owner, option a): keep the audio unchanged and handle loudness with a per-game volume.
  Star Swarm's music volume is about 0.57, tuned in #3638. Never re-encode or normalise the file.

## Device checks

Loop restart (7:00 back to 0:00) on iOS and Android: listen for a gap or click. **Pending (owner or
device); this check moves to #3638.** If there is a gap, the fix is a playback concern for #3638 (a small overlap or seek),
not a re-encode.
