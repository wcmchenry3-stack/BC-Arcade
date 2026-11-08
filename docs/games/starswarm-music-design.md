# Star Swarm music design log (#3635)

Why Star Swarm's background music sounds the way it does: the owner's brief, the plan, the
options auditioned, what was picked and why. The **recipes** live in
`tools/assets/synth_starswarm_bgm.py` (its module docstring documents every one). This log keeps
the **reasoning**. It follows the practice of the [sound design log](starswarm-sound-design.md)
(#3560).

Stories: #3636 (generator, rough draft and audition clips; this entry), #3637 (full render,
originality check, starting-point list), #3638 (playback with carry-over and starting points;
retiring the licensed tracks).

## The brief

- **One original track** of about 11:45 (705 s), synthesized in-house, replaces the four
  third-party Pixabay tracks (11:45.1 in total). It must carry the best of all four, as **one
  composition rather than four tracks glued together**.
- **Most players only hear the opening.** The app will carry the music over between games and,
  on a returning visit, start at the next of six composed **starting points**, so players hear the
  whole piece over time (#3638).
- **Same loudness as today** (about −12 LUFS), so `BG_VOLUME` (0.2) stays unchanged.
- **Beatless.** Pads, drones and texture; no drums, no tune.

## What each source track contributes (in words only)

Nothing from the source tracks is used: no audio, no samples, no transcription, no analysis by
the generator. The owner described what he likes in each, and the storyboard takes the **moods**:

| Source | Mood taken                                                                                                                                         | Becomes       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| bg-1   | Cinematic; the owner's pick for tone. A bright, triumphant opening that turns darker and keeps building tension; occasional shooting-star streaks. | I. Cold Open  |
| bg-3   | The organ track: slow, sustained, minor, plagal (IV → I) movement; brighter and airier.                                                            | II. Cathedral |
| bg-2   | Open suspended chords in the middle register, and swelling choruses of voices.                                                                     | III. Swarm    |
| bg-4   | Tension from below: a sub-bass drone, a regular breathing hiss, a moment where the top end goes quiet and "something comes out of the shadows".    | IV. Shadows   |

**The Revenant (Ryuichi Sakamoto)** is the owner's reference for the organ track's feel. It is a
**mood reference only**: slow, sustained, minor, with plagal motion. Its melody is never
transcribed, imitated or worked from.

## The four threads

Four elements recur across the parts, so the piece reads as one world:

- **Shooting stars.** Short (0.5–1.7 s) bright noise streaks whose band falls from ~2.6 kHz to
  ~1.4 kHz while they pan across the field, about +10 dB above the bed in their band. A volley of
  7 at 0:50 as the Cold Open darkens, two singles about 2:10, one in the Cathedral (4:51), and
  falling streaks between the Swarm's choruses.
- **Falling Shepard tones** (new). A Shepard–Risset glissando: nine octave-spaced sine partials
  slide down under a **fixed** bell-shaped spectral envelope, so the fall seems endless without
  ever getting lower. Quiet, under the bed, 10–20 s each, six in all, where tension builds: 1:40
  (the dark turn), 2:30, 5:52, 7:28, 8:36 (into the last chorus) and 10:18 (under the stir).
- **Chorus voices.** Many slightly detuned voices stacked in octaves, coloured by vowel formants
  ("ah", "oo", "ee"). They gather faintly at the end of the Cathedral and sing the Swarm's three
  choruses.
- **The organ.** Additive drawbars (16', 8', 4', 2⅔', 2', and more in the full voicing) through a
  rotating-speaker shimmer of about 1 Hz (amplitude, plus a few cents of Doppler pitch). A faint
  flute stop foreshadows it at the end of Part I; it lingers at the start of Part III.

## Storyboard

One circular timeline of 705 s: the end flows back into 0:00.

| Time       | Part              | What you hear                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–3:20  | **I. Cold Open**  | Triumphant open C (C, G, D; no third) with a faint high E, bright. About 0:45 the E falls to E♭ and the brightness ramps down over ~40 s. C minor → E♭/B♭ (1:18) → D half-diminished, the dark turn (1:40, first Shepard fall) → F minor (2:12) → F minor 7 to the end. A C2 sub pedal and an 11 s breathing swell throughout. A faint flute organ stop from about 2:40.                   |
| 3:20–6:40  | **II. Cathedral** | The organ grows out of F minor into C minor: iv → i, the plagal "amen", so the handover is itself the Cathedral's motion. C minor → B♭ → F → C minor, a chord every 10–16 s, wide voicings, an airy breath band on top. 4:18 F major, then 4:30 a 15 s lift into C major (another amen), back to minor. Near the end the first chorus voices gather and the organ settles on A♭ major.     |
| 6:40–9:40  | **III. Swarm**    | Open suspended D♭ chords (D♭, A♭, G♭, E♭, C♭/B), mostly 140 Hz–1 kHz. Chorus 1 (7:45): the full swell, a 5 s build then ~10 s, C♯5, D♯5, C♯6 entering in turn, upper bands up ~9 dB. Chorus 2 (8:23): shorter, lower, darker ("oo"), a sub bump, little air. Chorus 3 (8:52): brightest and airiest ("ee", an octave up, sparkle above 4 kHz). Streaks between them.                       |
| 9:40–11:45 | **IV. Shadows**   | The Swarm's high C♯ and G♯ keep sounding while a G1/G2/G3 drone rises beneath (the G against G♯/C♯ clash). A breath of hiss every 6 s. 10:21 the top end drops to near silence. 10:24–10:38 something stirs: irregular, darker bursts (~1.8 kHz) with a grainy 40 Hz rattle over a low growl, and a 20 s Shepard fall. Then G♯ falls to G, C♯ to C, and the Cold Open's C minor creeps in. |

**Transitions are never stark.** Parts hand over through equal-power crossfades of 24–26 s
(`XFADES`): 2:58–3:22, 6:18–6:42, 9:16–9:42 and 11:20–11:45 (the loop). Each goes through shared
notes: F minor → C minor (the amen), A♭ (the held organ chord, VI of C minor and V of D♭) → D♭,
C♯ and G♯ held into Shadows, and G → C resolving the loop. Brightness follows one curve
(`TILT`, dB per octave around 1 kHz) that ramps and never steps.

**The loop.** The render is circular: notes, reverb tails and the EQ that run past 11:45
continue at 0:00. The Cold Open's pad starts at 11:17 under Shadows, so 0:00 is already sounding.

## Starting points

`STARTING_POINTS` in the script, in seconds. Each is a phrase start outside every crossfade
window (a test checks this, including the 1.5 s fade-in).

| #   | Time | Lands on                                            |
| --- | ---- | --------------------------------------------------- |
| 1   | 0:00 | Cold Open, the triumphant open C                    |
| 2   | 1:40 | The dark turn (D half-diminished, the Shepard fall) |
| 3   | 3:25 | Cathedral, the organ's first C minor                |
| 4   | 4:30 | The C major lift                                    |
| 5   | 6:45 | Swarm, the first open D♭                            |
| 6   | 9:45 | Shadows, the drone's G2/G3 entry and a breath       |

## Motifs

The only melodic shapes, all 2–4 notes, each a named constant in the script:

- **`MOTIF_DARK_TURN` (E5 → E♭5).** The lifted major third falling a semitone as the Cold Open
  darkens. One step, so it marks the change of mood without becoming a tune.
- **`MOTIF_CHORUS` (C♯5, D♯5, C♯6).** The order in which chorus 1's voices enter: root, ninth,
  octave. It is an open stack built up one voice at a time, not a melody; the voices then hold.
- **`MOTIF_SHADOW_RESOLVE` (G♯5 → G5, C♯6 → C6).** Shadows letting go: two held notes each slide
  down a semitone, turning the G♯/C♯ clash into C minor's G and C for the loop.

## Originality rules and paper trail

Chord progressions, keys, textures and moods are not copyrightable; melodies are.

- **No source audio in.** The generator builds every sound from oscillators, noise, envelopes
  and filters. It never opens, reads, samples or analyses the source tracks or any other
  recording. A test asserts the script contains no reference to the source files' names.
- **No borrowable melody.** Pads, drones and texture only; no motif longer than 4 notes (a test
  checks every `MOTIF_` constant).
- **The Revenant is a mood reference only** (above).
- **Records.** The script and seed in git re-render the same audio; this log; the audition issue
  with the owner's picks; review rounds on each PR. The originality check against the source
  tracks' pitch-class and chord sequences, and the credits and rights-audit updates, come with
  #3637 and #3638.

## How it is built

The script's docstring has every recipe. In short:

- **Pads and choirs** use a PADsynth-style ensemble: each harmonic spread into a narrow Gaussian
  band of random-phase partials (the sound of many detuned voices), built with one inverse FFT per
  chord. Vowel formants colour the choirs.
- **The organ** is one sine per drawbar rank with a rotating-speaker model. Its phases depend only
  on absolute time, so notes shared by consecutive chords hold through the change (true legato).
- **Space** comes from a convolution reverb with a synthetic impulse response (seeded noise in
  8 bands, ~4.2 s decay low, ~1.6 s high).
- **Master:** an STFT EQ applies the brightness tilt, the 10:22 top cut and a 30 Hz high-pass; a
  gentle leveller pulls 3 s loudness halfway toward the average; the whole is normalised to
  −12 LUFS with a look-ahead limiter at −2 dBFS. Everything is enveloped (no clicks), additive
  partials stay below ~14 kHz (no aliasing).

## Rough draft measurements (#3636)

Measured on `00-draft-full.mp3` with ffmpeg `ebur128` (loudness) and an FFT magnitude centroid
(20 Hz–16 kHz):

- Integrated **−12.0 LUFS**, LRA **2.4 LU**, true peak **−1.6 dBTP**.
- 10 s windows from −13.3 to −10.7 LUFS; the largest step between neighbours is 2.0 LU (9:10, chorus 3
  giving way to the Shadows handover).
- Crossfades are equal-power as rendered: events that cross a window are at full level through it
  (`fit_to_part`), so only the part crossfade moves the level. Before this fix (review of #3643)
  the I → II handover dipped to −15.1 LUFS (3 s) mid-window; it now stays within −11.4 to −13.7.
  The 3 s loudness inside each window stays within about 2.5 LU, with 1 s steps of at most 1.2 LU.
- The loop seam is continuous: the leveller and limiter are computed on the circle.
- Spectral centroid: Cold Open triumphant ~1.7 kHz falling to ~0.7 kHz once dark; Cathedral
  ~1.8 kHz (the C major lift ~2.9 kHz); Swarm ~1.7 kHz (chorus 2 ~0.9 kHz, chorus 3 ~3 kHz);
  Shadows ~0.6 kHz (~0.4 kHz during the top cut, where the band above 4 kHz falls another 11 dB).
- Render time: about 80 s for the draft and 2 minutes for every clip, on 4 cores.

## Auditioned (#3636)

Rendered into `tools/assets/out/bgm-audition/` (git-ignored); `index.md` there lists every file,
its length and what to listen for. Variants exist where the brief left a real choice:

- **Organ, three voicings on the same chords** (C minor, B♭, F, C minor):
  - **A, cathedral** (the draft's voice): 16' 8' 4' 2⅔' 2', ~0.9 Hz shimmer. Round and full.
  - **B, flute**: 8' 4' and a whisper of 2', a slower ~0.55 Hz shimmer. Softer and more
    chorale-like, closest to the slow, sustained mood reference.
  - **C, full**: every drawbar to 1', a faster ~1.35 Hz shimmer. Brightest, most "organ-like".
  - Contrast file: A, B, C back to back.
- **Shepard falls, two shapes and lengths:** **A, a continuous 16 s glide** (the draft uses this
  for most falls) and **B, 12 s of smooth semitone steps** (one every 0.6 s; the draft uses it at
  2:30 and 7:28). Contrast file: A then B. Both are raised 4 dB over their draft level so they
  can be heard.
- **The three choruses**, back to back and separately, so the contrast can be judged.
- **Moments from the draft:** the Cold Open's triumphant-to-dark turn, the dark turn, the
  C major lift, the shooting-star volley, the shadows stir, all four transitions (including the
  loop seam, last 20 s into the first 20 s) and each starting point with the app's 1.5 s fade-in.

## How to re-render

From the repo root, with numpy and ffmpeg (libmp3lame):

```sh
python tools/assets/synth_starswarm_bgm.py                    # everything, into tools/assets/out/bgm-audition/
python tools/assets/synth_starswarm_bgm.py 03b-organ-flute 06a-shepard-glide   # just these clips
python tools/assets/synth_starswarm_bgm.py --out /tmp/bgm 00-draft-full        # another folder
```

The seed is `SEED = 3635` in the script; the same script and seed decode to the same samples.

## Audition results

_Pending: the owner's picks and feedback are recorded in the audition issue (`blocked:owner-decision`)
and will be copied here._
