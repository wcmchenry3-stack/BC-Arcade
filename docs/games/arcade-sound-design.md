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

### Foundation complete (`solitaire.foundationComplete`, `freecell.foundationComplete`): dropped

- **Decision.** No sound when a suit is completed (A to K on its foundation), in either game. The owner chose to drop it rather than redesign it.
- **Why.**
  - A king is the last card of its suit, so suits complete in the final stretch, very often inside Auto-Complete. In the Solitaire audition all four fired in the last couple of seconds of a 40-card run, stacked on the Auto-Complete riffle and just before the win.
  - The owner also sees completing a suit early as a weak move, since it costs flexibility, so it shouldn't be celebrated.
- **What went.**
  - Solitaire played `blackjack-win.ogg` (Blackjack's, which keeps it).
  - FreeCell played `freecell-foundation-complete.mp3`, 6.46 s and **51 KB**, one of the four files over 50 KB. It is deleted.
- **What stays for now.** Solitaire's sparkle and FreeCell's foundation animation. Removing the effect entirely (visuals and the engine event) is #3567.

### Auto-Complete riffle (`solitaire.autoComplete*`, `freecell.autoComplete*`): new

- **Brief.** Raised while making card place. A fast run of single-card sounds felt like many cards played one at a time, very fast, when the owner expected the run to sound like the deck itself moving. The owner wanted "a dedicated riffle sound for auto complete", ending "like a settle".
- **Constraints.**
  - A run lasts 1 to ~52 cards, one every 120 ms (0.1–6 s), so a one-shot can't fit. It is a lifecycle: a pick-up short enough for a 2-card run, a seamless loop for any length, and a settle when the last card lands.
  - It shares the moment with the win, which plays as the last card lands.
- **Trigger design.**
  - Driven by each screen's `autoCompleting` flag, so it works with Solitaire's button and with FreeCell starting on its own (and with #3566, which gives FreeCell a button).
  - New shared hooks `useRunSound` (start + loop, then loop stop + settle) and `useAutoCompleteRiffle`.
  - The cards the run moves make no card-place sound, the last one included, since the settle replaces it. Solitaire's stock draws during the run make no card-flip sound.
  - The settle plays only if the run solved the board. A run cut short (e.g. New Game) just goes quiet.
  - The foundation-complete sound, which also fired inside the run, was dropped (entry above).
- **Auditioned.** Three directions, each previewed as a full lifecycle (4-, 25- and 50-card runs) matched at about −27 LUFS:
  - **A, riffle shuffle** (picked): a dense flutter of card edges, ~42/s, over a papery whirr.
  - B, thumbing a deck: ~17 flicks/s, each a small flap.
  - C, cascade sweep: a swelling papery whoosh with a light flutter.
- **Gameplay audition.**
  - Solitaire: four hand moves, then a 40-card Auto-Complete.
  - FreeCell: one hand move (5♣ to a free cell) that let Auto-Complete start, then 44 cards.
  - The game's logged sound calls were laid over the video and checked against the frames.
  - Approved: "this is all good, I approve".
- **Why it works.**
  - It is the same air-and-paper material as card place (edge clicks, friction, flaps of air), so the run sounds like the same deck moving all at once rather than a machine-gun of single cards.
  - The pick-up covers the loop's hard start.
  - The loop is a bed under the run, about 5 dB under card place.
  - The settle (a squared deck tapped flat) gives the run an ending that lands with the win instead of trailing off.
- **Recipe notes.**
  - Every edge click is placed with wrap-around and the whirr is crossfaded, so the loop repeats without a seam.
  - The loop's level is set from its measured loudness. That measurement (−16.6 LUFS before scaling) is fixed in the generator, so it doesn't depend on the ffmpeg version.

| File                | Size    | Length |
| ------------------- | ------- | ------ |
| `riffle-start.ogg`  | 6.0 KB  | 0.14 s |
| `riffle-loop.ogg`   | 34.9 KB | 2.00 s |
| `riffle-settle.ogg` | 6.2 KB  | 0.30 s |
| **Total (new)**     | 47.1 KB |        |

A new sound, so it adds about 47 KB. The loop is the costly part, since dense noise texture takes more bits than a click. Dropping foundation complete removed 51 KB in the same round, so the two changes together come out about 4 KB smaller.

### Card flip (`solitaire.cardFlip`) and the Draw-3 fan (`solitaire.cardFan`): new fan

- **Brief.** One shared sound for both kinds of flip (a stock draw, and a face-down card revealed by a move). The owner also wanted a three-card fan for Draw 3, which had played the same single sound as Draw 1.
- **Constraints.**
  - There is no flip animation (cards just turn face up), so the sound plays at once.
  - A reveal comes from the same move as card place and plays at the same instant, so the flip must sit under card place and read as "card lands, then the next one turns over".
  - Stock taps are probably Solitaire's most frequent sound, a few a second when tapping fast, so it is short with three variations.
  - The old file clipped (+1.3 dBFS), was ~9 dB louder than the new card place, started ~60 ms late, and had 80% of its energy below 300 Hz.
- **Auditioned.** Three directions, each with three variations and a fan, previewed alone, as 6 Draw-1 taps, as 2 reveals with card place, and as 3 Draw-3 fans:
  - A, fingernail flick: a tiny snap plus a puff.
  - **B, turn and lay** (picked): a smooth turning whoosh, then the card laid down.
  - C, paper tick: one small papery tick.
- **Gameplay audition.** Solitaire: a reveal (the 5♥ onto the 6♠ uncovers the 9♥), 8 Draw-1 taps (slow, then fast), then 4 Draw-3 taps. Checked against the frames. Approved.
- **Pick: B, "turn and lay"** (`card-flip-1/2/3.ogg`, 0.10 s).
  - A 27–34 ms whoosh of air (0.6–3.5 kHz, rising then falling) as the card turns, then the card laid down: a soft flap of air with no tonal body.
  - Level: 1 dB under card place (−22.5 dBFS over the loudest 50 ms), the variations within 0.2 dB.
  - **The fan** (`card-fan-1/2/3.ogg`, 0.20 s) is three of those flips, 38 and 36 ms apart, at rising level (0.7, 0.8, 1.0), 1 dB over a single flip.
- **Why it works.**
  - The turning whoosh gives the flip motion that card place doesn't have, so the two read as different events even when they land together.
  - The fan is built from the same flip, so Draw 3 sounds like the same cards, just three of them.
- **Trigger changes.**
  - The engine's stock draw emits `cardFan` when it turns more than one card (Draw 3, also with only 2 left), and `cardFlip` for one card.
  - New keys `solitaire.cardFan` / `2` / `3`.
  - Both play through `useSoundVariants` and are silent during Auto-Complete (the riffle covers it). Recycling the waste stays silent.
- **What stays.** `solitaire-card-flip.ogg` is still Hearts' trick-won sound until "trick gathered" replaces it.

| File                      | Old size                 | New size | Length |
| ------------------------- | ------------------------ | -------- | ------ |
| `solitaire-card-flip.ogg` | 8.8 KB (kept for Hearts) | —        | 0.58 s |
| `card-flip-1/2/3.ogg`     | —                        | 15.1 KB  | 0.10 s |
| `card-fan-1/2/3.ogg`      | —                        | 17.0 KB  | 0.20 s |

New sounds, so they add 32,837 B (32.1 KB). The old flip stays only until Hearts' trick-won sound is replaced, then it goes too (−8.8 KB).
