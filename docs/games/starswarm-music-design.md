# Star Swarm music design log (#3637, #3638)

Provenance and design record for the Star Swarm background track
(`frontend/assets/sounds/starswarm-bgm.mp3`). Part of epic #3635. The full round-by-round working
log is in [#3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642); the owner's decisions
are in [its decision comment](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642#issuecomment-6743260355).

## Brief

Replace the four Pixabay tracks (`starswarm-bg-1..4.mp3`) with **one original track** that carries
their elements. Mood: dark sci-fi. An organ colour runs through the later sections. The track plays
as a loop, with starting points so each game does not open on the same bar.

## Rounds in brief

The owner built the track over 46 rounds of procedural synthesis. Full detail is in #3642.

- Rounds 1 to 4: opening sketches.
- Rounds 5 to 10: foundations, extension, development, blend, tension, storytelling.
- Rounds 11 to 17: adventure, space motion, danger, patrol swarm, momentum, long-form structure.
- Rounds 18 to 20: foreground chorus, the remaining colours, spotlight signals.
- Round 21: first full-length rough. Round 22: transitions.
- Round 23: the integrated 7:00 rough. It was shipped unbundled in #3723 and is superseded by Round 46.
- Rounds 24 to 45: ongoing audition archive (#3734); Round 44 is the ambient foundation and Round 45B
  the approved first two minutes.
- **Round 46: the seven-minute signature mix, the approved track** (owner: "this is a winner",
  2026-11-12), shipped with one loop edit (below).

## Archive and fingerprints

Every round's generator script and render is archived in [`docs/games/starswarm-music/`](starswarm-music/)
(#3675, #3734). Round 46 is the zip
`Rounds/Round_46/StarSwarm_Round46_Seven_Minute_Signature_Mix.zip` (render, generator, exact cue
JSON, the Round 44 and 45B inputs) with its `README.md`.

| Item              | File                                                                   | SHA-256                                                            |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Source render     | `Round_46/starswarm-round46-seven-minute-signature-mix.mp3` in the zip | `29b0a1604e458fa1b0cb92d0502c283b836d1b1f9b2a63a3f012fd3c815f442a` |
| Generator         | the Round 46 generator in the zip (per its README)                     | `777de55dbf1eff9fbe8f85c3bcfa6b9be96dfce03a59bbd32d2839e874702e4f` |
| Loop edit script  | `tools/assets/make_starswarm_bgm_loop.py`                              | `07cb7200b89775e9c9842e31edc0bae069658f2066d6b8f1b6e59a3e478d64d6` |
| **Shipped track** | `frontend/assets/sounds/starswarm-bgm.mp3`                             | `85950430fbfaf0ed9c6425e7b79ee238a44fd6be40c99de934709f661a13426c` |

The source render is 420.048 s, 24 kHz stereo, 128 kbps, 6,721,196 B, -24.0 LUFS, with baked-in
fades at both ends (so it is not loop-ready as delivered). The shipped file is the output of the
loop edit below and nothing else; a Jest test checks its hash. To reproduce it byte for byte:

```sh
unzip -p docs/games/starswarm-music/Rounds/Round_46/StarSwarm_Round46_Seven_Minute_Signature_Mix.zip \
  Round_46/starswarm-round46-seven-minute-signature-mix.mp3 > /tmp/round46.mp3
python tools/assets/make_starswarm_bgm_loop.py /tmp/round46.mp3 /tmp/starswarm-bgm.mp3
sha256sum /tmp/starswarm-bgm.mp3   # 85950430fbfaf0ed9c6425e7b79ee238a44fd6be40c99de934709f661a13426c
```

Reproduced on 2026-11-12 with the local ffmpeg/libmp3lame; a different encoder build may produce
different bytes from the same audio.

## The loop edit

Owner-approved on **2026-11-12** after a seam audition (before and after clips). It is the only
change to Round 46; the composition, arrangement and mix are unchanged
(`tools/assets/make_starswarm_bgm_loop.py`, with tests):

1. Trim 2.5 s from the head (the baked-in fade-in) and keep audio up to 418.2 s (the baked-in
   fade-out starts at about 418.4 s).
2. Equal-power (cos/sin) crossfade over 3.0 s: the tail fades out while the first 3 s of the trimmed
   audio fade in. The file starts where the seam ends, so the restart is continuous.
3. +2.9 dB gain.
4. One encode: libmp3lame, 128 kbps, 24 kHz stereo.

The file decodes to exactly 9,904,800 samples (412.700 s; ffprobe reports 412.752 s because of the
LAME header) with no added silence. **Time shift:** the file starts at the original 5.5 s (2.5 s
trim + 3 s seam), so every original time t is t - 5.5 s.

## Toolchain and rights

Procedural Python synthesis (numpy, scipy, soundfile, ffmpeg/libmp3lame), generated in a ChatGPT
workspace. Later rounds layer the project's own earlier renders. There are **no third-party
samples**. `starswarm-bg-1..4` were listening and analysis references only; none was sampled. The
rights wording was confirmed by the owner on 2026-11-11 (see `SOUND_CREDITS.md`).

## Round 46 time map

Feature placements from the Round 46 README, shifted by -5.5 s to the shipped file (m:ss):

| Shipped time  | Original  | Feature                                            |
| ------------- | --------- | -------------------------------------------------- |
| 0:04.5-0:21.5 | 0:10-0:27 | Astronomical rise, approved first-minute treatment |
| 0:36.5-0:54.5 | 0:42-1:00 | Varied robotic gestures                            |
| 1:10.5-1:27.5 | 1:16-1:33 | Gathering Swarm Chorus                             |
| 1:43.5-1:53.5 | 1:49-1:59 | Electromagnetic Choir                              |
| 2:10.5-2:23.5 | 2:16-2:29 | Descending Shepard                                 |
| 2:40.5-2:55.5 | 2:46-3:01 | Restrained distant organ colour                    |
| 3:12.5-3:28.5 | 3:18-3:34 | Robotic gestures, higher register                  |
| 3:47.5-4:04.5 | 3:53-4:10 | Astronomical rise, different arc                   |
| 4:20.5-4:36.5 | 4:26-4:42 | Gathering Swarm, darker and shorter                |
| 4:54.5-5:09.5 | 5:00-5:15 | Electromagnetic Choir, different register          |
| 5:27.5-5:41.5 | 5:33-5:47 | Descending Shepard, lower start                    |
| 5:58.5-6:13.5 | 6:04-6:19 | Robotic gestures, fragmented reprise               |
| 6:28.5-6:41.5 | 6:34-6:47 | Gathering Swarm, shortened return                  |
| 6:41.5-6:52.7 | 6:47-7:00 | Foundation only (the last 3 s are the loop seam)   |

## Starting points

`frontend/src/game/starswarm/bgmCues.ts`: 0:00, 1:06.5, 2:36.5, 3:43.5, 4:50.5 (0, 66,500, 156,500,
223,500, 290,500 ms). Each leads into a feature a few seconds ahead, so a game opening there starts
on the bed and arrives at something that sounds intentional. All fall before the 3 s loop crossfade
at the end (the track is 412.7 s).

| Cue    | Original | Why                                     |
| ------ | -------- | --------------------------------------- |
| 0:00   | 0:05.5   | The opening (where the seam ends)       |
| 1:06.5 | 1:12     | Leads into the Gathering Swarm (1:10.5) |
| 2:36.5 | 2:42     | Leads into the organ colour (2:40.5)    |
| 3:43.5 | 3:49     | Leads into the second astronomical rise |
| 4:50.5 | 4:56     | Leads into the electromagnetic choir    |

**Owner-approved on 2026-11-12.** (The Round 23 track's points, confirmed 2026-11-11, went with it.)
Audition clips (20 s, 1.5 s fade-in, plus the loop seam) are rendered by
`python tools/assets/render_bgm_cue_clips.py` into the git-ignored `tools/assets/out/bgm-cues/`.

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
| starswarm-bgm.mp3 vs starswarm-bg-1.mp3            | 0.9004          |
| starswarm-bgm.mp3 vs starswarm-bg-2.mp3            | 0.9134          |
| starswarm-bgm.mp3 vs starswarm-bg-3.mp3            | 0.8849          |
| starswarm-bgm.mp3 vs starswarm-bg-4.mp3            | 0.9158          |
| baseline: starswarm-bg-1.mp3 vs starswarm-bg-2.mp3 | 0.9535          |
| baseline: starswarm-bg-1.mp3 vs starswarm-bg-3.mp3 | 0.9313          |
| baseline: starswarm-bg-1.mp3 vs starswarm-bg-4.mp3 | 0.9464          |
| baseline: starswarm-bg-2.mp3 vs starswarm-bg-3.mp3 | 0.9343          |
| baseline: starswarm-bg-2.mp3 vs starswarm-bg-4.mp3 | 0.9187          |
| baseline: starswarm-bg-3.mp3 vs starswarm-bg-4.mp3 | 0.8921          |
| threshold (baseline maximum)                       | 0.9535          |
| result                                             | PASS            |

Numbers only; re-run on 2026-11-12 on the shipped Round 46 file (SHA-256 `85950430...`), against `starswarm-bg-1..4.mp3`.

**The source tracks were removed in #3638.** To re-run the check, take them from git history: the
last `dev` commit that has them is `d4575e58`. From the repository root:

```sh
mkdir -p /tmp/bgm-src
for n in 1 2 3 4; do
  git show d4575e58:frontend/assets/sounds/starswarm-bg-$n.mp3 > /tmp/bgm-src/starswarm-bg-$n.mp3
done
python tools/assets/check_bgm_originality.py frontend/assets/sounds/starswarm-bgm.mp3 /tmp/bgm-src/starswarm-bg-{1,2,3,4}.mp3
```

Limit: the baseline-maximum threshold detects copies and near-copies (scores near 1.0) of any 30 s
stretch, at any offset or key. It does not detect loose stylistic resemblance. If two sources were
near-duplicates of each other, the threshold would rise toward 1.0 and the check would lose its bite.

## Technical facts and loudness

- 412.700 s decoded (9,904,800 samples; ffprobe 412.752 s with the LAME header), 6,604,461 B, MP3
  24 kHz stereo 128 kbps.
- Loudness -21.5 LUFS, LRA 6.4 LU, peak -7.0 dBFS (pre-encode). The source was -24.0 LUFS; the
  loop edit's +2.9 dB is in the file.
- Decision (owner, option b): the +2.9 dB lives in the file and the game volume stays **0.57**.
  Beyond the loop edit, never re-encode or normalise the file.
- **Volume: 0.57** (#3638), `STARSWARM_BGM_VOLUME` in `frontend/src/hooks/useStarSwarmAudio.ts`
  (the `music` key of `DEFAULT_SFX_VOLUMES`), unchanged. The 0.57 was owner-approved on 2026-11-12
  from an in-game recording of the Round 23 track (-21.1 LUFS) with the sound effects re-mixed at the
  logged times; the Round 46 file is -21.5 LUFS, 0.4 LU quieter, so the level and the relation to
  the effects are about the same. The owner also approved the fade on every visit, and pause or mute
  during the fade ending at the target volume. A phone speaker loses much of the track's bass, so
  re-check on a device. The Star Swarm dev panel's Sound section has a **Music** row that steps the
  volume by 0.05 (about 0.8 dB here) live, without a rebuild. Record any change here and in
  `STARSWARM_BGM_VOLUME`.

## Playback (#3638)

`useStarSwarmAudio` calls the shared `useBackgroundMusic` hook with
`{ volume, cuesMs: STARSWARM_BGM.cuesMs, resumeKey: "bgm.resume.starswarm" }`. Mahjong passes no
options and is unchanged (a random track per game, from 0:00, at 0.2).

- **One player per visit.** Game over pauses it; the next game (New Game, play again, or a new game
  from the pause screen) resumes it from the same position. It never restarts or picks another track.
  Pause holds and resumes it as before.
- **Resume point.** On leaving the screen (unmount) or the app going inactive or to the background
  (an iOS app-switcher swipe kills it from inactive, without background or unmount), the hook
  saves `nextCue(position, cuesMs)` (`frontend/src/game/_shared/nextCue.ts`): the first starting point
  strictly after the position, or 0:00 after 4:50.5. One AsyncStorage write per leave, none during play.
  A leave before the visit's seek has landed writes nothing, so the saved point is kept.
- **Next visit.** The saved value is read once and must be one of the cues; anything else (missing,
  unreadable, out of range) or a storage error starts at 0:00. The player is created at volume 0 and
  `play()` is called at once, as before; the seek runs on the first loaded status (given up after
  3 s without one, `BGM_SEEK_TIMEOUT_MS`, so the track never waits silent); then the volume
  fades from 0 to 0.57 over 1.5 s in 10 steps. Pause, mute or game over during the fade ends it at
  the target volume (silent while paused or muted); a visit that starts muted skips the fade.
- **Self-heal on resume.** A carry-over resume (a new game after game over) re-arms the #2923
  self-heal with the same limits and one immediate check, since the original disarmed once the
  track first played and a lost resume `play()` brings no new status.
- **Why the seek waits for the loaded status** (not `seekTo` before the first `play()`): on iOS,
  expo-audio's `seekTo` calls `AVPlayer.seek(to:completionHandler:)`, and AVFoundation raises an
  exception for a seek with a completion handler before the item is `readyToPlay`; on web, setting
  `currentTime` before the media has metadata can be dropped. Keeping `play()` where it was means the
  #2923 self-heal sees the same sequence of calls and statuses as before.
- **Loop.** `loop = true`; the file's own 3 s equal-power seam (it ends the file, 6:49.7 to 6:52.7) leads straight back into 0:00.

## Device checks

**Pending (owner), on an iOS and an Android device**, after #3638:

- the loop restart (6:52.7 back to 0:00): no gap or click. If there is one, the fix is a playback
  change (a small overlap or seek), not a re-encode;
- carry-over across 3 games in one visit;
- after a relaunch, the music starts at the next starting point, with the fade-in;
- no gap or click at the start or at the seek;
- the volume sits right under the sound effects (the Music row in the dev panel).
