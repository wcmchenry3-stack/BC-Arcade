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

### Card place (`solitaire.cardPlace`, `freecell.cardPlace`, `hearts.cardPlay`)

- **Brief.** Feel: "A (felt tap) with a touch of B (crisp snap)". One file for all three games at volume 1.0, with slight variations so repeats don't sound mechanical.
- **Constraints.**
  - There is no landing animation: the card snaps into place and the sound fires at once, so the hit must start within a few ms. Both old files started late: Solitaire's peaked at 0.20 s, FreeCell's at 0.14 s.
  - Auto-Complete (Solitaire and FreeCell, `AUTO_STEP_MS` = 120) plays it up to ~50 times, 120 ms apart, so the body has to be short.
  - Hearts' AI plays a card every 400 ms.
  - Phone speakers: 41% of the old FreeCell file's energy was below 100 Hz, which phones barely play.
- **Round 1: rejected, "sounds like someone striking something".**
  - Three felt taps (soft felt, felt + snap, card stock), each built from paper noise, a small snap and a short sine "body" at 160–230 Hz.
  - Why it failed: the pitched body is what made them read as a mallet. A real card has no tone at all. The recorded card it replaced is two broadband ticks of 5–10 ms, about 50 ms apart (the edge, then the card landing flat).
- **Round 2: air and paper only, no oscillators.**
  - Option 4, "edge, then flat": close one card at a time, but it galloped in a fast run (two hits 34–45 ms apart, repeated every 120 ms).
  - Option 5, "slide and settle".
  - Option 6, "single flap": "a miss".
- **Round 3: refinements of option 4.**
  - Three refinements: a tighter gap, a softer edge, and more varied gaps.
  - The owner noted that a run felt like many cards being played one at a time, very fast. Auto-Complete really does that, one card every 120 ms.
  - A dedicated Auto-Complete sound (a riffle) was offered as an alternative.
- **Gameplay audition.** Option 5 in Solitaire: four hand moves, then a 40-card Auto-Complete, with the three variations rotated by a local patch. Approved: "yes I like it".
- **Pick: option 5, "slide and settle"** (`card-place-1/2/3.ogg`, 0.10 s each).
  - About 40–50 ms of grainy card-on-felt friction ends in a soft flat flap of air.
  - The friction is band-limited noise (1.2–7.5 kHz) with sparse micro-bursts for the texture of card stock.
  - The flap is a ~3 ms broadband puff with a darker after-puff.
  - The three variations differ in slide length (45, 50 and 40 ms) and noise seeds. They are matched by short-term loudness (loudest 50 ms at −21.5 dBFS, within 0.3 dB), not by peak, because short transients vary a lot in crest factor.
- **Why it works.**
  - It is made of what a card is (paper sliding, air pushed out as it lands flat), so it reads as a card rather than a hit.
  - The slide starts at once, so there's no lag.
  - It is over by about 70 ms, so a 120 ms Auto-Complete stays a stream of separate cards.
  - Random variation, never the same twice in a row, keeps a run from sounding mechanical. With one player per variation, a card's tail can ring on under the next instead of being cut off.
  - Under 1.5% of its energy is below 300 Hz, so it carries on phone speakers.
- **Trigger and volume changes.**
  - New shared hook `useSoundVariants` (`frontend/src/game/_shared/useSoundVariants.ts`).
  - Each game has three keys (`…cardPlace`, `…cardPlace2`, `…cardPlace3`; Hearts: `hearts.cardPlay…`).
  - FreeCell's 0.4 volume override is removed. In loudness terms:
    - **FreeCell:** about 6 dB louder than before (−27.4 → −21.6 dBFS over the loudest 50 ms).
    - **Solitaire and Hearts:** about 2 dB quieter (−19.8 → −21.6 dBFS), and the old file's clipping (+1.0 dBFS peak) is gone.

| File                       | Old size               | New size               | Old length | New length |
| -------------------------- | ---------------------- | ---------------------- | ---------- | ---------- |
| `solitaire-card-place.ogg` | 8.0 KB                 | removed                | 0.46 s     | —          |
| `freecell-card-place.mp3`  | 8.2 KB (MP3)           | removed                | 0.82 s     | —          |
| `card-place-1.ogg`         | —                      | 5.2 KB                 | —          | 0.10 s     |
| `card-place-2.ogg`         | —                      | 5.2 KB                 | —          | 0.10 s     |
| `card-place-3.ogg`         | —                      | 5.2 KB                 | —          | 0.10 s     |
| **Total**                  | **15.8 KB** (16,230 B) | **15.2 KB** (15,581 B) |            |            |

Three variations cost no more than the two files they replace (−649 B), and the set drops one third-party file from Kenney and one from Freesound.
