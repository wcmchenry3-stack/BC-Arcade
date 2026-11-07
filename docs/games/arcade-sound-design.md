# Card and puzzle games sound design log (#3563)

This log explains why each sound effect in the card and puzzle games sounds the way it does: the owner's brief, the options auditioned, what was picked and why, and the feedback that shaped it. It covers Blackjack, Solitaire, FreeCell, Hearts, Mahjong, Sudoku, 2048, Yacht, Sort and Daily Word. Star Swarm has its own log (#3560), and Cascade is out of scope.

The **recipes** live in `tools/assets/synth_arcade_sfx.py`, with the shared building blocks in `tools/assets/synth_common.py`. Each file's credit and one-line recipe is in `frontend/assets/sounds/SOUND_CREDITS.md`. This log keeps the **reasoning**. Add an entry for every sound you change.

Each game's key → file → trigger → volume table is in the Sound section of its doc: [Blackjack](blackjack.md#sound), [Solitaire](solitaire.md#sound), [FreeCell](freecell.md#sound), [Hearts](hearts.md#sound), [Mahjong](mahjong.md#sound), [Sudoku](sudoku.md#sound), [2048](twenty48.md#sound), [Yacht](yacht.md#sound), [Sort](sort.md#sound), [Daily Word](daily_word.md#sound).

## Direction for the whole set

- **Shared sounds, per-game keys.** These games already reuse each other's files, so the set is designed as one family. One file can back several games' keys, e.g. a single card-place sound for Solitaire, FreeCell and Hearts. Every game keeps its own registry key, so volume and triggers stay per game.
- **Original and synthesized.** Every effect is built in code from oscillators, noise, envelopes and filters, with a fixed seed. There are no samples or third-party audio. Background music (`mahjong.bg1`–`bg3`) is out of scope.
- **Smooth over gritty** (from #3560): sine-led tones, darker filtered noise, little or no distortion.
- **Audible on phones.** iOS and Android are the primary platforms, and phone speakers barely reproduce anything under ~100 Hz. Keep the main energy above that, or add harmonics.
- **Frequent sounds are short and soft-edged.** Card place, tap, 2048 merge and spawn, and key press can play many times a minute, so they must reward without grating.
- **Sounds fit their moment.** A sound tied to an animation fits the animation. A mid-game sound, such as a jackpot in Blackjack or Yacht, must not still be playing when the next action starts.
- **Small files.** Every sound is mono Ogg Vorbis (quality 5). Keep one-shots short, and loops near 2 s with the variation inside the loop. On `dev` the in-scope effects total about 811 KB. Four files make up 557 KB of that: `hearts-moon-shot` 314, `hearts-broken` 107, `freecell-game-win` 86 and `freecell-foundation-complete` 51.

## How a sound is chosen

1. **Brief.** The owner gives the feel. 2–3 concrete directions are offered to react to, with the timing that limits the sound.
2. **Three options.** Each is synthesized with a fixed seed and checked with a spectrogram and a loudness reading. Its length, size and peak/loudness are reported.
3. **Iterate** on feedback until one is picked.
4. **Gameplay audition.**
   - The pick goes into a local web build (the dev URL, with `/entitlements` mocked as in `e2e/tests/helpers/api-mock.ts`).
   - Headless Playwright drives the game to the moment the sound plays.
   - `HTMLMediaElement.play/pause` calls are logged and laid over the recorded video with ffmpeg.
   - Frames at the sound's timestamp are checked against the screen.
5. **Commit.** The recipe goes into the generator and the file is regenerated from it. The generator must reproduce the approved decoded audio exactly (`synth_common.decoded_pcm_sha256`).

## Sounds

_None yet. One entry per sound, in the order they are made._
