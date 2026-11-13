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
  - Hearts' AI plays a card every 400 ms (450 ms since the card-play motion, #3574).
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
- **What followed.** #3567 removed the rest: Solitaire's sparkle, FreeCell's foundation animation, and the `foundationComplete` engine event in both games.

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

### Card deal (`blackjack.cardDeal`): designed with the deal motion (#3571)

- **Brief.**
  - The Blackjack redesign (#3571) gives cards motion: each card flies from off-screen top-right to its hand in 240 ms, with a small spin that settles.
  - The opening deal sends four cards 180 ms apart (player, dealer hole, player, dealer up), one deal sound each. The dealer's turn plays card by card, ~600 ms apart.
  - The owner wanted to hear the directions against that motion.
- **Constraints.**
  - The sound is played as the card **leaves** and must land with it, so its landing sits at exactly 240 ms (`CARD_DEAL_FLIGHT`).
  - With cards launched 180 ms apart, each sound's travel overlaps the next card's snap, so the parts must stay distinct.
  - The old `blackjack-card-deal.ogg` started ~150 ms late, clipped (+0.5 dBFS), was ~7 dB louder than card place, and had 55% of its energy below 300 Hz.
- **Auditioned.** One recording of the animated table (the approved layout at 390×844), mixed three ways: the opening deal, a hit, stand, the hole-card flip, two dealer draws, a bust and the payout.
  - A, off the shoe: a papery scrape, then the landing.
  - **B, dealer's toss** (picked): a snap, a fading whoosh, then the landing.
  - C, felt slide: one slide for the whole flight.
- **Pick: B, "dealer's toss"** (`card-deal-1/2/3.ogg`, 0.32 s).
  - A ~1 ms snap as the card leaves the deck, a whoosh of air (0.7–4.5 kHz) that fades as it travels, and the landing flap at 240 ms.
  - Level matched to card place (−21.5 dBFS over the loudest 50 ms). The landing is within 2 ms of 240 ms in every variation.
  - Owner: "I like b, the motion looks good too".
- **Why it works.**
  - The snap marks the moment the card is dealt, the whoosh carries the eye across the table, and the landing confirms where it went.
  - It tells a dealt card (snap and travel) apart from a card you place yourself (card place's slide and settle), and from the hole-card flip (a turning whoosh).
- **Wired in #3581,** with the deal motion: each card's sound plays as it is launched and lands with it at 240 ms. The old file is removed (see [Blackjack: card and chip motion](#blackjack-card-and-chip-motion-timed-to-the-sounds-3581)).

| File                      | Old size | New size           | Old length | New length |
| ------------------------- | -------- | ------------------ | ---------- | ---------- |
| `blackjack-card-deal.ogg` | 8.6 KB   | removed with #3581 | 0.60 s     | —          |
| `card-deal-1/2/3.ogg`     | —        | 21.3 KB (21,805 B) | —          | 0.32 s     |

### Blackjack chips and results: designed with the chip and result motion (#3571)

- **Brief.** Blackjack's result moment and its chips. Today only some outcomes make a sound (a plain loss is silent), there are no chip sounds, and the old results borrow other games' files: the 10 s, 314 KB `hearts-moon-shot.mp3` for blackjack, and `blackjack-win.ogg`, `-push.ogg` and `-bust.ogg`.
- **Constraints.**
  - Results play ~300 ms after the last dealer card lands. The player can Rebet at once, so most results finish within ~1 s, and blackjack within ~1.5 s (the jackpot rule: never run over play).
  - Chips are real struck objects, so a short, bright click is a fair chip sound, unlike paper.
- **Auditioned.** Chips: 1 clay clack, **2 felt thud** (picked), 3 stacked rattle, each played as bet taps, payout, sweep and nudge. Results: **A soft chimes** (picked), B table only, C chips plus a touch of tone. Then all of it in context over the animated table: a win, a loss, a push, and a 3-hand split with mixed results.
- **Picks.**
  - **Chips, "felt thud":** a chip set down on felt (a soft, dark puff with a muffled tick).
    - `chip-bet-1/2/3`: a short slide into the circle; three variations, since bets repeat.
    - `chip-payout`: five chips landing on the stake, 2 dB under the win chime so the chime leads.
    - `chip-collect`: the stake swept away.
    - `chip-nudge`: a push.
  - **Results, "soft chimes":** mallet notes.
    - `result-win`: a rising fifth.
    - `result-push`: one neutral note.
    - `result-lose`: a soft falling minor third, for a plain loss (new; silent today).
    - `result-bust`: shorter and duller, raised an octave after the first draft lost 61% of its energy below 300 Hz.
    - `result-blackjack`: a quick sparkle arpeggio, 1.08 s.
  - **Levels:** wins sit 3–4 dB above everyday sounds; losses and pushes stay quiet.
- **Split hands (owner decision).** One chime for the **net** outcome, then each hand's chips in turn, 300 ms apart (payout on a winning hand, sweep on a losing one), with WIN / LOSE / PUSH tags. A chime per hand would turn a 3–4-hand split into noise.
- **Why it works.**
  - The chime says the outcome and the chips show the money, so the two never compete.
  - Felt-thud chips are quieter and warmer than clay clacks, which suits frequent bets.
  - A plain loss now gets a gentle sound, not a "fail" sting.
- **Wired in #3581,** with the chip and result motion (see [Blackjack: card and chip motion](#blackjack-card-and-chip-motion-timed-to-the-sounds-3581)). The old `blackjack-win/push/bust.ogg` are deleted and Blackjack no longer plays `hearts-moon-shot.mp3`.

| File                                                    | Size                   | Length      |
| ------------------------------------------------------- | ---------------------- | ----------- |
| `chip-bet-1/2/3.ogg`                                    | 17.9 KB                | 0.22 s      |
| `chip-payout.ogg`, `chip-collect.ogg`, `chip-nudge.ogg` | 22.2 KB                | 0.20–0.51 s |
| `result-win/push/lose/bust.ogg`                         | 32.8 KB                | 0.52–0.82 s |
| `result-blackjack.ogg`                                  | 11.0 KB                | 1.08 s      |
| **Total (new)**                                         | **83.0 KB** (85,021 B) |             |

Retired with #3581: `blackjack-win.ogg` (8.8 KB; only Blackjack uses it now that foundation-complete is dropped), `blackjack-push.ogg` (9.4 KB) and `blackjack-bust.ogg` (9.7 KB), plus Blackjack's use of the 314 KB `hearts-moon-shot.mp3`. That file stays for the other games until #3578 replaces it.

### Game won / game lost: one pair for the card games

- **Brief.** The end of a game in Solitaire, FreeCell and Hearts.
  - Solitaire borrowed the 10 s, 314 KB `hearts-moon-shot.mp3` fanfare.
  - FreeCell used the 86 KB `freecell-game-win.mp3`, which also carries a CC BY attribution duty.
  - Hearts played Cascade's `cascade-game-over.ogg` whether the player won or lost.
- **Constraints.**
  - After an Auto-Complete, game won plays at the same instant as the riffle's settle. So it starts with 0.25 s of room (`GAME_WON_LEAD`) and rises after the settle lands.
  - Solitaire's win cascade runs 2 s, so game won should finish in about that time.
  - Losing a game of Hearts gets a quiet sound, never a "fail" sting.
- **Auditioned.** Three won + lost pairs, each previewed after 1.5 s of riffle:
  - A, warm flourish: a mallet run up into a C major chord.
  - B, cards take a bow: a flutter of card edges blooming into a bell chord.
  - **C, rising swell** (picked): a soft pad swelling into C major.

  Then C in the real games: Solitaire and FreeCell Auto-Complete finishes, a Hearts win and a Hearts loss.

- **Picks.**
  - `card-game-won`: a pad of three detuned saws per note, through a 2.8 kHz lowpass, swells into C major. A bell sparkle and a mallet C6 come in as it opens.
  - `card-game-lost`: a short pad swell that sinks into A minor, ~4 dB under game won.
  - Both are leveled by short-term loudness: won at -17 dB (loudest 50 ms), with `result-blackjack` the loudest of the card sounds; lost at -21 dB.
  - Neither has energy below 300 Hz.
- **Trigger change (owner approved).** Hearts' single game-over key splits into `hearts.gameWon` and `hearts.gameLost`. A shared lowest score counts as won: the player shares the win.
- **Why it works.**
  - A swell grows out of the riffle instead of interrupting it.
  - One pair across three games makes the end of a card game sound the same everywhere.
  - Win and loss differ by both chord and level, so the player hears the result before reading it.

| File               | Before                                        | After                                                                             | Length        |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------- | ------------- |
| Solitaire game won | `hearts-moon-shot.mp3` (314 KB, 10 s)         | `card-game-won.ogg`                                                               | 2.45 s        |
| FreeCell game won  | `freecell-game-win.mp3` (86 KB)               | `card-game-won.ogg`                                                               | 2.45 s        |
| Hearts game over   | `cascade-game-over.ogg` (6.0 KB), won or lost | won / lost pair                                                                   | 2.45 / 1.40 s |
| **New files**      |                                               | `card-game-won.ogg` 25.7 KB, `card-game-lost.ogg` 16.7 KB: **42.5 KB** (43,479 B) |               |

No file is removed yet: `hearts-moon-shot.mp3` (moon shot, other games), `freecell-game-win.mp3` (Sort) and `cascade-game-over.ogg` (Cascade; 2048 and Mahjong moved off it with #3578) still back other keys. Once Hearts' moon shot (#3574) and #3578 replace them, the card games no longer pull in 400 KB of borrowed audio.

### Hearts: moon shot, trick gathered, hearts broken, queen of spades (#3574)

- **Brief.** Hearts' own moments, and the owner asked for a wolf howl for the moon shot.
  - Shooting the moon borrowed the 10 s, 314 KB orchestral fanfare.
  - Trick won borrowed Solitaire's old Kenney card slide.
  - Hearts broken and the Q♠ were Pixabay stings (a rock break, a surprise hit).
- **Constraints.**
  - Trick gathered plays on every trick (13 times a hand), so it is short and sits under card place, with three variations.
  - The Q♠ sound replaces the card-place sound for that card, so it includes the card landing.
  - The moon shot is rare and the player's big moment, so it can run long and loud.
- **Auditioned.** Three directions each.
  - Moon shot: A lone wolf, **B the pack answers** (picked), C a howl over a moonlit chord.
  - Trick gathered: A sweep, B tap, **C whoosh** (picked).
  - Hearts broken: A crack and chime, **B heartbeat** (picked), C heartstring.
  - Queen of spades: A ominous chord, B "dun-dun", **C dark gong** (picked).
- **How the howl is made.** Additive harmonics of a gliding pitch, shaped by a vowel filter that moves from "oo" to "ah" and back. The pitch rises (380 → 640 Hz), holds with a 5 Hz vibrato and a little drift, then falls. A little breath noise sits under it. A second, darker and quieter howl answers 1.45 s in, and both sit in a synthetic hall (an FFT-convolved noise impulse).
- **Levels.** All measured as the loudest 50 ms of RMS:

  | Sound           | Level                                 |
  | --------------- | ------------------------------------- |
  | Moon shot       | -17 dB                                |
  | Hearts broken   | -19.5 dB                              |
  | Queen of spades | -19.5 dB                              |
  | Trick gathered  | -23 dB, about 1.5 dB under card place |

  The heartbeat keeps about half its energy below 300 Hz: a thump needs it. Its fundamentals sit at 200–230 Hz with an upper partial, so phones still play it.

- **Why it works.**
  - A howl is the "moon" in one sound, and it is unmistakably the player's moment.
  - The whoosh follows the take-away animation, so it moves with the cards.
  - The heartbeat makes "hearts broken" literal.
  - The gong gives the Q♠ weight without a jump-scare.

| File            | Before                                                    | After                                | Length |
| --------------- | --------------------------------------------------------- | ------------------------------------ | ------ |
| Moon shot       | `hearts-moon-shot.mp3` 314 KB (still used by other games) | `hearts-moon-howl.ogg` 37.6 KB       | 3.9 s  |
| Trick gathered  | `solitaire-card-flip.ogg` 8.8 KB (removed)                | `trick-gathered-1/2/3.ogg` 19.7 KB   | 0.32 s |
| Hearts broken   | `hearts-broken.mp3` 107 KB (removed)                      | `hearts-broken-heartbeat.ogg` 9.5 KB | 0.9 s  |
| Queen of spades | `hearts-queen-of-spades.mp3` 36 KB (removed)              | `queen-of-spades-gong.ogg` 13.5 KB   | 1.5 s  |
| **Bundle**      | **−152 KB removed**                                       | **+80.3 KB added**                   |        |

### Hearts: the moments, timed to the sounds (#3588)

- **Brief.** The Queen of Spades, hearts broken and the moon shot get animations designed against the sounds picked in #3574 (owner approved the mockups on 2026-11-08). They replace the old shake and rays, the old burst of crack lines, and the old moon emoji, which also hid behind Hand Complete (#3586).
- **Measured from the files** (10 ms RMS envelope of the shipped ogg):
  - `queen-of-spades-gong.ogg`: a soft swell, then the strike at 220–240 ms (peak 240). The moment's strike is at 230 ms after the play.
  - `hearts-broken-heartbeat.ogg`: "lub" at 0 ms (peak), "dub" at 160 ms, a soft mallet note from 300 ms. The heart pops on the lub and cracks on the dub; the red edge pulse peaks at 30 and 175 ms.
  - `hearts-moon-howl.ogg`: the first howl swells to 840 ms; the answer starts at 1.45 s. The first wolf fades in from 700 ms, the second at 1450 ms; the scene holds to 3.3 s and is gone by 3.7 s, while the howls' reverb tails off.
- **Changes from the mockup.**
  - The edge pulse peaks on the two beats (the mockup's second peak was at 420 ms, after the dub). It is drawn as four edge gradients, a little stronger near the edge than the mockup's inset shadow.
  - The broken heart's halves fall apart symmetrically (out, down and tilting away); in the mockup they turned about the box's corner.
  - The Queen of Spades and hearts-broken captions sit under the whole trick, so the human's card never covers them.
  - Hand Complete opens when the scene is gone (3.7 s), as in the mockup's 3.3 s + 0.4 s.
- **Checked** in recordings of the real screen (web export, 390 × 844) with the game's ogg files mixed in at the logged play times, frame by frame: the Q♠'s lift and first ring start 230–280 ms after it lands, the caption fades in from 580 ms, all is back by 2.3 s; the heart is up by the lub and cracked by 300 ms; the first wolf is in by 0.75 s and the second by 1.75 s, and Hand Complete appears at 3.75 s.

### Hearts: card play and trick motion, timed to the sounds (#3574)

- **Brief.** Hearts already moved its cards; tune that motion and its sounds together, so playing a card and gathering a trick look and sound like one moment.
- **Before.**
  - A played card had no flight: it appeared in its slot, with card place on the state change (in sync, because nothing moved).
  - The sweep to the winner (250 ms settle, 60 ms stagger, 500 ms per card) ran on RN `Animated` on the JS thread and ignored Reduce Motion.
  - Trick gathered played after the sweep had ended, so its whoosh (thump at 193 ms) sounded over an empty table about 200 ms after the cards had gone.
  - The CPU players played every 400 ms.
- **Decided.** The owner picked direction **A. Brisk** in the gameplay audition (2026-11-09; throwaway audition code on `design/3574-hearts-motion`).

  | Parameter                   | Value                                                                                              |
  | --------------------------- | -------------------------------------------------------------------------------------------------- |
  | Flight to the trick         | 280 ms, out-cubic, from the seat's plate                                                           |
  | Card place                  | 40 ms before contact (the file's transient peaks at about 45 ms)                                   |
  | Hold after the last contact | 300 ms                                                                                             |
  | Sweep                       | 200 ms, all four together, in-quad; the fade starts at 60%                                         |
  | Trick gathered              | at the sweep's start (its 193 ms peak lands on arrival)                                            |
  | CPU pace                    | 450 ms (at least a flight plus about 100 ms)                                                       |
  | Reduce Motion               | no flight (card place as the card appears), no sweep: the trick clears at once with trick gathered |
  | Q♠                          | it flies like any card; its moment (scrim and gong) starts on landing                              |

- **How the sound follows the motion.** The cues are timed from the motion's own clock with fixed constants (`SOUND_LEAD_MS` = 40 before the flight's contact; trick gathered at the sweep's start), never from the state change. Trick gathered is cued inside the sweep, so a trick held by a moment (the Q♠, hearts broken) never sounds under its scrim; when the hold lets go, the hold runs again, then the sweep and its sound.
- **Implementation choices.**
  - The sweep moved to Reanimated (UI thread). Its end reaches the AI loop through `runOnJS`, with a JS backstop 250 ms after the sweep's end so a lost callback can never freeze the game (wide enough that a janky first UI frame never lets the backstop win).
  - With Reduce Motion the 300 ms hold is kept before the trick clears (owner confirmed): the trick's last card is seen, and a Q♠ that completes a trick holds it for its moment before the trick could clear.
  - The Q♠ holds the table, and the trick's sweep, from the throw; its moment waits for the landing (or, should the landing never report, starts 400 ms after the throw).
  - A moon shot holds the trick's sweep too, mid-hand or queued behind the queen, so trick gathered never plays under the night scene. Once a sweep has started it runs to its end.
  - A "seen" guard: a card flies only when it is added to the trick on screen, so a restored or remounted trick never flies in again.
  - The flight only translates: the audition code also offered a scale-in and a squash on landing, and the decided parameters name neither (owner confirmed: a move only).
- **Checked.** Jest covers each cue's time against the motion constants and every completion path (normal, Reduce Motion, held then released, remount mid-sweep, unmount). The on-device check on iOS and Android, frame by frame against the sounds, is part of the story's acceptance.

### Solitaire: card motion, timed to the sounds (#3572)

- **Brief.** Make Solitaire's cards move instead of snapping, and retime its sounds to the motion, so each move looks and sounds like one moment.
- **Before** (corrected after the design audition).
  - Every move snapped. A tap-move played card place, or the multi-card move for a tableau run, at the state change.
  - A reveal's flip was in the same event array as the move's sound, so both played at the same instant.
  - A draw snapped onto the waste (the flip for one card, the fan for more). The recycle and Undo snapped in silence.
  - Auto-Complete stepped every 120 ms on a JS timer; the riffle started on the first step, and its settle, the win, the foundation sparkle and the result card all came with the last step's state change.
  - A drop snapped from the finger to the slot, with card place at the drop.
- **Measured peaks** (from each file's start): card place about 43 ms; card flip about 28 ms; the fan's hits at 27 / 66 / 99 ms; the multi-card move's landing at 237 ms; the riffle's settle at 77 ms. The riffle loop has no beat (about 42 clicks a second), so any flight pace sits on it without clashing.
- **Decided.** The owner picked direction **A. Brisk** in the gameplay audition (2026-11-09; throwaway web-only audition code on `design/3572-solitaire-motion`, b905f7b8), and chose the recycle's sound, Undo's flight and sound, and a dropped run's sound.

  | Moment              | Motion                                                                                              | Sound                                                                                                                             |
  | ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
  | Tap-move, 1 card    | 200 ms flight, out-cubic                                                                            | card place 40 ms before contact                                                                                                   |
  | Tap-move, a run     | 220 ms flight per card, 15 ms stagger                                                               | the multi-card move's peak (237 ms) on the last card's contact                                                                    |
  | Drop                | 110 ms settle from the ghost's position (finger − grab − `GHOST_LIFT`); no flight from the old slot | card place on contact. **A dropped run also plays card place** (owner)                                                            |
  | Reveal              | a 140 ms turn as the moved card lands, with no gap                                                  | the flip's peak on the turn's edge-on point                                                                                       |
  | Draw 1              | 200 ms slide and turn, stock to waste                                                               | the flip on the edge-on point                                                                                                     |
  | Draw 3              | the same, the three cards 36 ms apart                                                               | the fan 27 ms before the first card's edge-on point                                                                               |
  | Recycle             | the waste slides back to the stock, 220 ms                                                          | **the riffle's settle** (owner)                                                                                                   |
  | Undo                | **flies back** (owner)                                                                              | **card place on landing** (owner)                                                                                                 |
  | Auto-Complete       | **120 ms steps (unchanged), 220 ms flights**, about two in the air                                  | the riffle held until the last landing, then its settle (77 ms peak) on that contact; the sparkle and the result card wait for it |
  | Input during motion | no lock: a new action re-targets a card in flight from where, and with the face, it is shown        | cues already scheduled still play, except those of an action a card moved again belonged to (review round 1)                      |
  | Reduce Motion       | every flight and turn is 0                                                                          | each cue at the instant                                                                                                           |

- **How the sound follows the motion.** The cues are fixed offsets from the action's start, computed from the same plan as the flights (`cueTimes`, in `solitaireMotion.ts` then; shared with FreeCell in `components/cards/cardMotion.ts` since #3573): card place at the last contact less 40 ms; the multi-card move at the last contact less 237 ms; the flip at the edge-on point less 28 ms; the fan at the first edge-on point less 27 ms; the settle and the win at the last contact less 77 ms. The flights run on the same clock: a flight whose view mounts late (a busy JS thread) starts part-way, so its contact still meets its sound.
- **Implementation choices.**
  - **A flight layer, not in-place transforms.** The cards an action moved are drawn by a layer that is the board's last child, so a card never passes under another pile (an in-place transform from the old slot would pass under every pile drawn after its own, and the tableau keys its card views by index, so they are reused across moves). The layer is board-level rather than at the app root like the drag ghost: in board coordinates every position comes from the table geometry, while a root layer would need the board's window position, a measurement.
  - While a card flies its real view stays in its pile, transparent (its label, testID and touch target stay, so a tap can re-target it). A foundation draws the card under its top meanwhile (the highest one not itself in flight), and the waste its collapsed Draw-3 fan.
  - Each flight is one linear Reanimated timing on the UI thread, eased (out-cubic) and turned in a worklet. Its end comes back through `runOnJS`, with a JS backstop 250 ms after the flight's end; the held result card has its own backstop at the last contact plus 250 ms.
  - The riffle's hold ends on a timer at the last contact less 77 ms (the settle must start before the contact); only a run that riffled is held, so a lone last card keeps its own card place and the win.
  - Every pending cue and hold is cancelled on a new deal, on leaving the game (the clock's pause) and on unmount; a cue due while the player is away is not played, and a riffle hold that ends while away stops without its settle. Flights come only from actions, so a restore never replays one.
  - Review round 1 (from the branch's recording):
    - **Auto-Complete sparkle:** the sparkle for each suit completed mid-run flashed over cards still in flight, and the last one hid the final contact. Every suit's sparkle in a run is now held for one flash on the last landing, with the settle, as in the audition; a king moved by hand sparkles on its own landing.
    - **Undo mid-flight:** moving a card again calls off the action it was flying for. That action's pending cues are cancelled (its card place, the reveal's flip), and a turn it planned is planned again from the face shown: a reveal not yet turned stays face down, with no face-up frame and no flip. Other actions' cues still play.
    - **Win hold:** the board takes no selection, move, draw, drag or Undo while the result card waits for the winning landing (round 2 made it fully still: no lift, no invalid-move sound, no drag).
    - **Touch mid-flight:** only the card's face turns transparent, not the gesture's view, so a card in flight or turning can still be tapped or dragged on iOS and Android.
  - Review round 2:
    - **A turn in progress** is always re-planned from the face it shows, whether or not its action was called off: an Undo while the uncovered card turns lands it face down at once (if it still shows its back), its flip cancelled; past the edge-on point it turns back from its face.
    - **A re-planned reveal or drawn card still flips:** the action that takes over a turn face up owes its flip and plays it on the new edge-on point (the engine's event went with the called-off action).
    - **Cards a call-off does not take over keep their card place:** the called-off action's other cards still in flight get a card place on their last contact.
  - Review round 3: cues are tagged (`place`, `multi`, `flip`, `fan`), and cancelling a called-off action reports which were still pending (`launchMotion`, shared with the motion fuzz test).
    - The called-off action's card place is moved to its remaining cards' last contact only if its own landing sound had not played yet: never twice, and never one it never had (a draw).
    - A turn taken over owes its flip only if the called-off flip or fan had not played yet.
    - A called-off card still sliding (Draw 3's fan when one of its cards is played on) slides on from where it is shown, turning on the way, instead of restarting in its slot.
    - A seeded random walk (`motion.fuzz.test.ts`) checks that no card is left hidden, every flight ends on the state's face, each action plays at most one landing sound, and flips never outnumber the cards seen to turn. Known and accepted: a draw that brings back a card an Undo had not yet turned face down keeps the engine's flip, and a flip cue may play up to 28 ms before a turn that is then called off.
  - The audition's Web Animations FLIP and its `__SOLITAIRE_MOTION__` override were not shipped.
- **Checked.** Jest covers each cue's time against the motion (fake timers, with the flights' end callbacks timed by `timeReanimatedEnds`), Reduce Motion, a restore, New Game and unmount mid-flight, re-targeting, and the backstops when the end callback is lost. The on-device check on iOS and Android, frame by frame against the sounds and including a drag (#3527), is part of the story's acceptance.

### FreeCell: card motion, timed to the sounds (#3573)

- **Brief.** Make FreeCell's cards move instead of snapping, in the same family as Solitaire (#3572), with each sound on its landing.
- **Before** (corrected after the design audition).
  - Every move snapped: tap, supermove, drop, Undo and each Auto-Complete step. Card place played at the state change for every single-card move.
  - The supermove (`card-multi-move.ogg` since #3563) played at the snap, so its landing peak (237 ms) was heard after the cards had arrived. A dropped run played it too.
  - Undo snapped in silence. Auto-Complete started itself 120 ms after the move that made it possible (and on restore), with the board input-locked (#2225); the riffle started with that triggering move, and the settle and the win came with the last step's state change.
  - The foundation effect (rays and a tint) showed on every completed suit at the state change, mid-run included.
  - A drop snapped from the finger to its slot, with card place at the drop.
- **Measured peaks** (from each file's start): card place about 43 ms; the multi-card move's landing at 237 ms (pre-hits at 152 / 182 / 208 ms); the riffle's settle at 77 ms; the game-won peak at 1,202 ms. Solitaire's peaks and its 40 ms card-place lead hold.
- **Decided.** The owner picked direction **A. Match Solitaire** in the gameplay audition (2026-11-11; throwaway audition code on `design/3573-freecell-motion`, 403d8aa6), over B (a 45 ms ripple with a card place per card) and C (the run moving as one block).

  | Moment            | Motion                                                                                                          | Sound                                                                                                                                     |
  | ----------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | Tap, 1 card       | 200 ms out-cubic, to a free cell, a foundation or a column; scales 1 ↔ 0.92 to or from the top row              | card place 40 ms before contact                                                                                                           |
  | Supermove         | 220 ms, 15 ms stagger, landing head first                                                                       | the multi-card move's peak (237 ms) on the last contact                                                                                   |
  | Drop              | 110 ms settle from the ghost (finger − grab − `GHOST_LIFT`)                                                     | card place (a dropped run too, as in Solitaire)                                                                                           |
  | Undo              | flies back; a run uses the run timing                                                                           | one card place on the last landing (as in Solitaire)                                                                                      |
  | Auto-Complete     | 120 ms steps, 220 ms overlapping flights. **The first step waits for the triggering move's landing** (owner)    | the riffle starts with the first automatic card and is held until the last landing; the settle and the win at the last contact less 77 ms |
  | Foundation effect | **held until the landing; within an Auto-Complete run, once, after the last landing** (owner; removed in #3567) | none                                                                                                                                      |
  | Result card       | waits for the last landing (`winHold`, with a backstop)                                                         | none                                                                                                                                      |
  | Input             | no motion lock; a new action re-targets a card in flight. Auto-Complete keeps its #2225 lock                    | the earlier action of a card moved again goes quiet                                                                                       |
  | Reduce Motion     | instant                                                                                                         | cues at the instant                                                                                                                       |
  | Top-row landing   | **the flight card is drawn at the top-row size, so it lands pixel-identical (no pop)** (owner)                  | none                                                                                                                                      |

- **How the sound follows the motion.** As Solitaire's: the cues are fixed offsets from the action's start, from the same plan as the flights (`cueTimes`, now in `components/cards/cardMotion.ts`). Card place at the last contact less 40 ms; the multi-card move at the last contact less 237 ms; the settle and the win at the last contact less 77 ms; the foundation effect on the last contact.
- **Implementation choices.**
  - **Solitaire's stack, shared, not forked.** The flight store and layer, `launchMotion` (the call-offs) and the cue clock moved to `components/cards/`, with the shared timing, peaks and cue table, and the planners' slot-to-flight core (`cardMotion.ts`). Each game keeps its own planner: FreeCell's (`freecellMotion.ts`) is face up only, with no turns. The flight card is game-neutral (`PileCard`), and the flights' testIDs are `card-flight-*`. Solitaire's behaviour and tests are unchanged apart from those renames.
  - **Scale.** A flight carries `fromScale` / `toScale` (a share of the tableau card) and is drawn at its destination's `size`, scaled about its top-left corner from `fromScale / toScale` to 1. A card in flight reports its scale (`Shown.scale`), so a re-target starts at the size it is shown. Rendering the tableau-size card and scaling it down to 0.92 (the audition's way) landed a pixel off the free cell's own card, a visible pop.
  - **Large cards.** The flight layer is the board view's last child, inside the horizontal scroller (verified by the A-large recording), so flights scroll with the board and need no window measurement. A move that flips the Large-cards fallback (`fallbackAt`) is not animated: it lands on the new board at once.
  - **Free cells and foundations.** A free cell's card stays in its `DraggableCard`, transparent (`HiddenWhileFlying`), with the empty cell drawn under it; a foundation uses Solitaire's under-top view (`FoundationUnderTop`), so its top card's touch target stays.
  - **A re-planned card with zero distance does not count toward the contact** (the audition's bug): a card shown already where it now lies (an Undo before it left, a supermove's card still in its stagger) lands where it is, so the landing sound is not late.
  - **Auto-Complete** keeps its JS step timer and the #2225 lock. The first step waits for the trigger's planned landing; the riffle starts on the first step (with Reduce Motion, with the run, as before); the riffle and the result card are held until the last landing, each with a backstop. #3566's button must route through the same `startAutoComplete`.
  - **Drag.** The board's drop handlers pass the drag's `DropOffset` on to `onMove(move, offset)`.
  - Every pending cue and hold is cancelled on New Game, on leaving the game and on unmount; a cue due while away is not played, and a riffle held (or won) while away stops without its settle. A restore replays nothing.
  - Avoided from the start, from #3676's review: board input left live during the win hold; the alpha-0 gesture view; stale flights when Reduce Motion is switched on; away during a hold; re-planning from the shown face and position; per-action cue cancellation that silences cards not re-targeted; duplicate re-scheduled card places.
  - The fuzz test (`components/freecell/__tests__/motion.fuzz.test.ts`) found one more: when a move changed the board's face-up step, a card still landing from an earlier action aimed at its old slot. It now slides on to its new slot, as Solitaire's do (`MIN_SLIDE_MS`, now shared).
  - The audition's `EXPO_PUBLIC_TEST_HOOKS` / `__FREECELL_MOTION__` override and its directions B and C were not shipped.
  - Review round 1 (PR #3712):
    - **A card that slides on stays its own action's**, in both games (`FlightSpec.owner`, `cardFlights.tsx`). It was launched as the sliding action's, so a later move of the card called off the wrong action, and the first action's card place played while the card flew elsewhere. `launchMotion` now re-schedules a called-off action's card place after the launch, so a card it slides on counts. Both fuzz tests now check that a landing sound plays only while one of its own action's cards is landing, and that no flight is shorter than `MIN_SLIDE_MS`.
    - The fuzz test then found an action that moved nothing (a card sent back before it left) playing card place at the instant: an action with no flight has no landing sound now. A run's stagger counts only the cards that fly.
    - **No moves left:** the "stuck" sound plays on the move's landing, cancelled like the other cues; the banner still shows at once (it fits the bottom band, so the board is not re-laid out under the flight).
    - A free cell keeps its "FREE" watermark under a card flying into it.
  - Review round 2:
    - **A turning slide's flip goes with its card** (Solitaire, Draw 3). The slide stays its owner's, but its flip is cued by the action that launched it. A third action that takes the card over (plays it, or recycles the waste) now calls that action's turn off too (`Shown.turnCuedBy`, set while the turn is still ahead), and owes the flip itself if the card still turns face up. In the probe (a draw at 0, its top card played at 40 ms, the slid card taken over at 60 ms) the flip moves from 92 ms to 102 ms when the card is played, and does not play when the waste is recycled: the card never shows its face. The Solitaire fuzz test now checks that a flip plays only while a card in the air is turning face up within the flip's lead.
    - A FreeCell drop always counts as moved, even let go right on its slot, so it keeps its card place.
- **Checked.** Jest covers each moment's cue against the motion (fake timers, the flights' end callbacks timed by `timeReanimatedEnds`), the top-row scale, Undo mid-flight and re-targeting, Auto-Complete's first-step wait, riffle, settle, win hold and single foundation effect, input during the win hold, New Game, unmount and leaving mid-flight and mid-hold, Reduce Motion (also turned on mid-flight), a restore, the backstops, and Large cards with the fallback flip. The on-device check on iOS and Android, frame by frame against the sounds (touch mid-flight and Android's drawing order included), is part of the story's acceptance.

### Blackjack: card and chip motion, timed to the sounds (#3581)

- **Brief.** Give Blackjack's cards and chips motion (#3571, epic #3570), with the sounds designed for it (above) each on its moment. The decisions are in #3575: cards come from **just off the felt's top-right** (no shoe drawn, so no layout cost on small phones), **input stays live** (a tap completes the motion at once), and the dealer plays at **about 600 ms a card** ("a beat of suspense").
- **Before.** Cards appeared at once. The engine's events played the old sounds at the state change: two deal sounds for the four cards of a deal (and none for a split's two cards), the result before the dealer's cards were seen, a plain loss silent, and the 10 s `hearts-moon-shot.mp3` for a natural. The win flash waited 300 ms to suggest suspense.
- **Approved.** The owner approved the animated mockup over the approved layout (recordings of a win, a loss, a push and a 3-hand split; the mockup's cue timings are the timings below). The full table is in [blackjack.md](blackjack.md#motion-and-sound-timing-3581).

  | Moment        | Motion                                                                                                                                                                                                      | Sound                                           |
  | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
  | Tray chip     | into the circle, 100 ms                                                                                                                                                                                     | `chip-bet` at launch (its thud lands at ~90 ms) |
  | Opening deal  | 4 cards 180 ms apart, each 240 ms from off the top-right, −18° → 0°, `cubic-bezier(.15,.75,.25,1)`; the hand re-fans in 240 ms                                                                              | `card-deal` at each launch (it lands at 240 ms) |
  | Split         | the pair slides apart (300 ms), a second stake slides in at 300 ms, then only the hand to play gets its second card (~720 ms); each other hand gets its own when it becomes the hand to play (owner, #3720) | `chip-bet`, then `card-deal`                    |
  | Dealer's turn | the hole card turns (320 ms, rotate Y, 1.08 lift), draws ~600 ms apart                                                                                                                                      | `card-flip` at its start, `card-deal` per draw  |
  | Result        | ~300 ms after the last landing, the banner pops (260 ms)                                                                                                                                                    | `result-*`                                      |
  | Chips         | ~420 ms after the result: payout (360 ms), sweep (380 ms) or nudge (300 ms); the chip count after it                                                                                                        | `chip-payout` / `chip-collect` / `chip-nudge`   |
  | Split result  | one **net** chime with a summary strip under the dealer ("Won: 1 · Lost: 2", the net payout), then each hand's WIN / LOSE / PUSH tag and chips 300 ms apart                                                 | net chime, then each hand's chip sound          |

- **How the sound follows the motion.** The engine stays instant and settles the round at once; the felt replays it from the settled state as a timeline of stages (`blackjackMotion.ts`). The sounds are cues on the same timeline, so each is at its moment by construction: a deal at the card's launch, the flip at the turn's start, the chime with the banner, the chips with their slide.
- **Implementation choices.**
  - **A timeline, not flights.** Solitaire's and FreeCell's planners turn one move into flights of the cards that changed pile. Blackjack's action can be a whole dealer's turn and a payout, so its planner returns stages (what the felt shows from when) and cues; each card view animates itself when a stage first draws it (dealt), moves it (slides, from where it is shown) or turns it (the hole card). The cards are one flat list keyed by card id, so a split's second card slides to its new hand.
  - **Shared code.** The cue clock (`useCueClock`, now grouped: the motion's cues and the tray's chips are cancelled apart), `FLIGHT_BACKSTOP_MS` and a new shared worklet easing, `cubicBezier` (`cardMotion.ts`): the same curve eases on the UI thread and tells JS where a card is shown, with no UI-thread read.
  - **Input stays live.** A tap on the felt, and every action, lands the motion first, so it is never dropped. Sounds still due are dropped, but a result that had not shown yet shows with its chime, once (no flash or celebration), and holds 400 ms before the next action (owner decisions on PR #3720, below).
  - **Reduce Motion:** each sound of the action once, at the instant (four deal sounds at one instant would be noise). Turned on mid-motion, everything lands as for a tap; the setting is read when an action lands, never captured (#3712's Codex finding).
  - **Avoided from the start**, from #3676 and #3712: no hold blocks input or the result (the dock is live throughout; the victory screen and the out-of-chips card wait for the round to settle, but no input waits); no alpha-0 view (no card is ever hidden: a card is drawn when its stage shows it); no stale flight on Reduce Motion (everything lands); no cue while away (`usePauseWhileAway` lands silently), after New Game or after unmount (the clock is cancelled); no duplicate cue (each cue is scheduled once per timeline and a landing cancels the rest; the fuzz tests check the counts).
  - **Events.** The engine's events no longer play sounds (they were incomplete: a split emitted no deal events, a split hand's last bust no result). The motion owns the sounds and the result's flashes and celebration; the milestone and comeback toasts wait for the round to settle; a restored state's events replay nothing.
  - The natural's lift and glint is left for its own story ([#3621, below](#blackjack-the-natural-designed-with-its-sting-3621)); only its sound changed here (`result-blackjack`, 1.08 s, instead of the 10 s moon-shot fanfare).
- **Review round 2 (PR #3720).**
  - The hole card stayed lifted after its flip and covered the dealer's up card through the result: a card is lifted only while it flies or turns.
  - The split result now follows the spec: a summary strip under the dealer ("Won: 1 · Lost: 2", localised in every shipped locale as a label and a number) with the net payout, then each hand's WIN / LOSE / PUSH tag popping with its chips, 300 ms apart.
  - The skip's beat is only for a result not yet shown; Reduce Motion turned on draws a held-back split card; the felt's tap target is hidden from accessibility focus.
  - Tests: motion decks of 78+ cards and a seeded shoe (a next hand no longer deals from a random reshuffle); the Playwright full-game spec waits for an enabled Hit; the fuzz test keeps bounds that do not come from the plan (a round's deal sounds never outnumber its cards; every settled round heard).
- **Final recording (PR #3720).** The split rows jumped 46 px as the summary strip mounted (rows keep no result band while the player plays): the band is now kept free from the dealer's turn on, so the strip appears in place.
- **Owner decisions on PR #3720.**
  - **The dock follows the mockup:** Hit and Stand stay greyed while a result plays out, and the result's dock appears with the banner, so the dock never gives the result away (it showed the engine's phase, which told a natural or the dealer's turn ~1.4 s early).
  - **A skip shows the result, then deals:** a tap that cuts a result short lands the dealer's cards, the banner with its chime (once, never without its banner), the chips and the count, and holds 400 ms (`SKIP_HOLD_MS`) before the next action runs. The player always sees how the hand ended.
  - **Split deal as the mockup:** only the hand to play is dealt its second card (~720 ms); each other hand's is dealt when its turn comes. Display only: the engine already holds the cards; the felt holds them back (`Timeline.held`), with the totals, the labels and the off-table geometry following what is drawn.
- **Review round 1 (PR #3720).**
  - **The out-of-chips card showed for one commit at the Stand**, firing its haptic and announcement ~1.5 s early (and again once settled): "settled" was state the motion set in a layout effect, still true in the render that applied the action. It is now derived in render (nothing moving and the felt showing the current game), for the card, the victory screen and the toasts.
  - A card dealt to hand 1 drew under hand 2's (the cards are one list): a card being dealt, and the turning hole card, are lifted above the later hands.
  - A landing also shows a pop-in still running; chip ids are unique for the app's life; the Reduce Motion setting is read before the motion plans the action that commits with it.
  - From the recordings: a dealt card showed at its place for one frame before flying in (its start pose was set in an effect after mount): each motion is now a view mounted at its start pose. The split's net banner counted up hand by hand: it shows the net from the start, matching the chime. Totals counted a card at its launch and the dealer's showed as the flip began: a card counts on its landing, the dealer's total after the flip.
  - The fuzz test now checks the exact sounds due, from each action's own plan (a chime cut short by a tap: once, at the tap), so a duplicate or missing chime, flip or deal fails it.
- **Size.** The 14 Blackjack files (106,826 B) are now bundled; the four old files (37,404 B) are deleted: **+69,422 B (67.8 KB)** packaged. `hearts-moon-shot.mp3` stays for the other games until #3578.
- **Checked.** Jest on the fake clock: each moment and its sound in `BlackjackTableScreen.motion.test.tsx` (deal order and timings, the flip before the draws, the dealer's pace, the result after the last card, the chips and the chip count after the result, a split's net chime then hands 300 ms apart, input mid-motion, Reduce Motion and toggling it mid-flight, no replay on restore, leaving, unmount and New Game); the card views and their backstops in `FeltCards.test.tsx`; the planner, with a seeded fuzz over random rounds, in `blackjackMotion.test.ts`; random play with taps mid-motion in `BlackjackTableScreen.motionFuzz.test.tsx`. Not yet checked on a device: the timing and smoothness on a mid-tier Android phone and an iPhone, and Android's drawing order of a card in flight over the other hands (the manual checklist in blackjack.md, item 10).

### Blackjack: the natural, designed with its sting (#3621)

- **Brief.** One short moment for a natural blackjack, clearly bigger than an ordinary win, landing **with the cards** rather than with the state change; never locking input; a tap completes it. Built on the #3581 card motion.
- **Before (PR #3720).** The sting played with the result, ~1.4 s after the deal: ~0.8 s after the cards had landed. The old gold "BLACKJACK!" badge and stars overlay **blocked input for ~2 s** (a Rebet tapped at 1.7 s only dismissed it). A dealer's natural was a plain loss; natural against natural a plain push; a natural on a split hand pays 1:1 and never had the moment.
- **Audition.** Three directions recorded from the real game (390×844, with sound), each for a player natural, a dealer natural, natural against natural and Reduce Motion: **A** glint (lift, gold edge, a sheen across each card), **B** glint + one diagonal light sweep across the felt, **C** spotlight (the felt dimmed around the cards, a star burst). Three stings at the same level: **S0** the current `result-blackjack.ogg` (original, #3563; 1.08 s, top note at ~220 ms, 1.5 dB louder than a win but not brighter), and two synthesized from the repo's own blocks, **S1** "glint" (a high bell, then an arpeggio) and **S2** "bloom" (a held bell chord).
- **Owner decisions (#3739).**
  1. **Direction B, glint + sweep.** As the player's second card lands (600 ms): the two cards lift 7 px (up 160 ms ease-out, hold 520 ms, down 240 ms), a 2 px gold edge (`#f5c542`, a token; `#b07a00` on the light theme, for 3:1 on its cream felt, review round 1) with an 8 px glow fades in over 120 ms, a sheen band crosses each card once (380 ms from +60 ms), and one 18° light sweep crosses the felt (560 ms from +60 ms, peak opacity ~0.14). The result shows at the flip's end (~1.1 s; no +300 ms). The banner reads "Blackjack! 3:2" (i18n in every locale) with the payout; the payout chip is 1.4× with a gold rim. About 1.2 s in all (the lift settles by ~1.5 s); a tap completes it.
  2. **Sting S0:** keep `result-blackjack.ogg`, played as the second card lands. It **is** the round's chime: once, even when a tap comes before 600 ms (then it plays at the tap). No new file, so no size change and no new credit.
  3. **The dealer's natural:** a static cool-silver edge on the dealer's two cards once the hole card has turned, with the normal `result-lose` and no new sound. It explains the loss without making it a second moment.
  4. **The gold edge stays** until the next deal.
  5. **The old overlay is deleted** (`BlackjackCelebrationAnimation`): it blocked input. Every part of the new moment is `pointerEvents="none"`.
  6. **House rules unchanged** (no dealer peek; a player's 3-card 21 against a dealer's natural pushes): filed separately as #3741, since decided: standard rules (the dealer peeks; a natural beats any other 21).
  7. **i18n:** the "Blackjack! 3:2" banner key in every locale.
- **Natural against natural** stays modest: the player's cards get only the gold edge (no lift, glint, sweep or sting), the dealer's the silver edge at the flip, then the Push banner, `result-push` and the nudge.
- **Implementation.** The moment is planned with the deal (`planMotion` in `blackjackMotion.ts`): a stage at 600 ms marks the player's natural, one at the flip's end the dealer's; `Timeline.chimeAt` says which cue is the result's chime (the sting, not matched by its name), so a landing plays it once; `Timeline.momentAt` starts the moment. Only a deal that makes a one-hand natural plans it: a split hand's ace and ten are not a natural under the current rules (pinned by a test). The views (`NaturalMoment.tsx`) run on the UI thread from one linear timing of the time since the moment started (a JS-clock time), each part a worklet of it, with a JS backstop; JS runs only at the stage boundaries. Being timed from its start rather than from mount, a view's first frame is already right (the edge at 0, the cards at rest).
- **Bug classes kept out** (from #3676, #3712, #3720): Reduce Motion is read when the motion lands, never captured, and turned on mid-moment lands it to the static edge; no cue while away, after New Game or after unmount (the cue clock); the sting once (a fuzz checks it plays only on a 3:2 deal, once, at 600 ms, and the screen fuzz the exact sounds due); nothing left moving after a landing; no first-frame pop; no replay on restore (a restored natural shows only its static edge, silently).
- **Reduce Motion sounds spaced (#3751, owner decision, 2026-11-12).** Under Reduce Motion everything stays visually instant, but an action's sounds no longer stack at one instant (a natural's deal, sting, flip and payout all started at about 33 ms in the #3746 recording): they play in their timeline order, each distinct sound once, **100 ms apart** (`REDUCE_MOTION_SOUND_GAP_MS`), the first at the instant. This updates #3570's "sounds at the instant" rule for Blackjack under Reduce Motion only. They sit on the cue clock: cancelled on away, New Game and unmount; a tap or the next action drops those not yet played, except a result chime still due, which plays once (as #3720's skip rule); nothing replays on restore. The toasts, victory screen and out-of-chips card gate on the round being settled, which is at once, so they do not wait for the spaced sounds. Reduce Motion turned on mid-motion plays only the chime still due, at once (nothing else plays, so nothing to space). Cost: none (no data, no asset, at most three timers per action).
- **Size and cost.** No new asset; four small views per natural (two edges, two sheens) and one sweep, unmounted when the moment lands. No data collected.
- **Review round 1 (PR #3746).**
  - **Light theme:** the audition's gold and silver fell to 1.48:1 and 1.58:1 on the cream felt, and the cream sweep vanished. The light theme now uses a deeper gold (`#b07a00`), a slate silver (`#66788e`) and a brown sweep (`#8a6100`); both edges are at least 3:1 in both themes (tested). Dark is unchanged.
  - **The lift is tested:** the Jest mock's `withTiming` jumps to its end, so a lift that never showed, or never came down after a tap (a card stuck 7 px up on a device), passed. The lift's tests hold each timing at its start.
  - Only a player's first two cards carry the lift's animated style; the banner is spoken "Blackjack, pays 3 to 2"; the moment's start is the deal's own landing time; a natural is the engine's two-card 21.
  - The screen fuzz has its own 60 s timeout per seed and stops a seed that outlives its test.
- **Checked.** Jest on the fake clock (`BlackjackTableScreen.natural.test.tsx`, `NaturalMoment.test.tsx`, `blackjackMotion.test.ts`, the two fuzz suites). **Not yet checked on a device:** the glow (`boxShadow`) and the sweep's look on iOS and Android, in both themes (blackjack.md, manual checklist item 11).

### Blackjack: a mixed split, the run's cues and the all-in (#3770, #3582)

- **Brief.** Two gaps found while recording #3768 and #3571. **#3770:** a split chose its chime from the net alone, so one win and one loss (net 0) played `result-push`, though no hand pushed. **#3582:** the milestone toast, the comeback banner and the all-in badge were silent.
- **Audition (owner, 2026-11-13).** Real gameplay from a web export of dev (390×844, Playwright), with every `play()` logged and each candidate mixed in where it would play if wired: a chime swap in place of the logged chime, a run cue where its toast first draws (the screen's `whenSettled`), the all-in at the deal. Each option was played over its title card alone, then in context. All candidates are mono Ogg q5 in E (the key of `result-win`), synthesized from the shared blocks only.
  - **#3770, three rounds:** win + loss (net 0); win, loss, win after a resplit (net +); loss, loss, win (net −). Options: A best hand, B1 "up and back", B2 "open dyad", C net chime silent at 0, D net chime with B1 only at net 0 (the audition's recommendation).
  - **#3582:** milestone MS1 "tick up", MS2 "glass ping", MS3 "marker lights"; comeback CB1 "rising run", CB2 "warm swell", CB3 "turnaround"; all-in AI1 "stack shoved", AI2 "held breath", or silent.
- **Picks and why.**
  - **Mixed: B1 everywhere, not D.** A split with at least one winning hand (win or blackjack) and at least one losing hand plays B1 whatever the net; every other split keeps its net chime (a push counts as neither: win + push is a win, an all-push split a push). E5 → A5 → E5, 90 ms apart, 0.77 s, rms50 −21 dB: it keeps the push's home note but the motion keeps it from sounding like a tie, and it has no rising fifth, so it is not a win. The banner still shows the net, and the green win flash stays for a plain win only.
  - **Milestone: MS1.** Two tiny bell ticks, E6 then B6 (the win's fifth an octave up, in miniature), 0.32 s, rms50 −25 dB, 6 dB under the win: the smallest, shortest and highest, so it never competes with the win or the chips.
  - **Comeback: CB3.** Two soft notes of E minor (E5 G5) turning into E major rising (G♯5 B5 E6) with a bell, 1.05 s, rms50 −19.5 dB: the comeback told in sound, unlike the natural's sting (CB1's shape) or game won (CB2's).
  - **All-in: AI2.** A quiet E4 + B4 pad that swells, glides up a semitone and is cut short at 0.55 s, rms50 −24 dB: tonal and centred near 570 Hz, so it sits under the deal's noisy tosses without masking them, tension without a "fail" colour.
- **Wiring rules (owner).**
  1. **The run's cues ride their toast**, not a fixed offset: the toast waits for every hand's chips, ~0.8 s after the chime on one hand and ~1.4–1.7 s on a 3–4 hand split. `useBlackjackMotion.runCue` plays the cue as the motion's last stage settles the round, the same instant `whenSettled` shows the toast.
  2. **Reduce Motion:** the cue joins the spaced queue, 100 ms after the last chip sound (the toast itself shows at once). For the comeback this overlaps the win chime's tail; accepted, as for the push chime under the chips.
  3. **A round cut short drops its cue (the owner asked for hold or drop, with a rule and a test).** A tap before the result plays the chime at once and runs the next action `SKIP_HOLD_MS` (400 ms) later; a Rebet once the banner shows lands the chips and deals at once. The cue's slot, after the chips, is gone either way: held, it would sit on the chime played at once or on the next deal's tosses, and the 1.05 s comeback would always reach the next deal. The toast still shows, so nothing is lost but the garnish. Leaving, New Game and Reduce Motion turned on mid-motion drop it too; a restored round never plays one.
  4. **One cue a round:** comeback over milestone, and two milestones crossed together give one tick. Split settlements emit both events too (#3768).
  5. **All-in:** a timeline cue at 0 on the deal's motion, with the first card, so the cue clock owns it; under Reduce Motion it is spaced after the deal's sound, so leaving, New Game or a tap before then drop it.
- **Size.** `result-mixed.ogg` 8,577 B, `run-milestone.ogg` 5,746 B, `run-comeback.ogg` 11,183 B, `bet-all-in.ogg` 10,724 B: **+36,230 B (35.4 KB)**. Blackjack is a hidden premium game in the store bundle (`metro/storeBundle.js`, #2830), so the store build's packaged assets do not change (3,828,672 B, 3.65 of the 4.0 MiB budget, measured with `scripts/size-report.mjs` on 2026-11-13); the premium all-games build carries the 36,230 B. No data, no network, no telemetry.
- **Reproduced.** The four recipes are in `tools/assets/synth_arcade_sfx.py` (`result-mixed`, `run-milestone`, `run-comeback`, `bet-all-in`); regenerated, each decodes to the same PCM as the audited candidate (the Ogg pages differ only in the random stream serial and its CRC).
- **Checked.** Jest on the fake clock: the planner's mixed rule and the all-in cue in `blackjackMotion.test.ts`; on the screen, each run cue once with its toast after the chips for one hand and a 3-hand split, Reduce Motion's order, one cue a round, the tap / Rebet / leave / New Game drops, the all-in at the deal and its cancellation, the mixed chime with no flash, in `BlackjackTableScreen.motion.test.tsx` and `useBlackjackCues.test.ts` (mute too); the motion fuzz counts the mixed chime as a result chime. **Not yet checked on a device:** the levels on phone speakers.

### Solitaire and FreeCell: invalid move, multi-card move, no moves left (#3572, #3573)

- **Brief.** The last borrowed or missing sounds in the two patience games:
  - **Invalid move:** Kenney `lowDown`, shared with Sudoku.
  - **Multi-card move:** FreeCell's Freesound whoosh, at half volume. Solitaire runs played a single card place.
  - **No moves left:** no sound; FreeCell only showed a banner.
- **Constraints.**
  - Mis-taps are frequent, so the invalid move is short and sits under card place (-24 dB at the loudest 50 ms). It must never sound like a penalty.
  - A run move replaces card place, so it is at card-place level.
  - "No moves left" is a gentle "stuck", not a loss, so it is quieter than game lost.
- **Auditioned.** Each option was heard in context (good moves around it; a 4-card and a 6-card run):
  - **Invalid move:** A tuck back, **B "nope"** (picked), C flick.
  - **Multi-card move:** A cascade, B slide, **C fan sweep** (picked).
  - **No moves left:** **A shrug** (picked), B knock, C question.
- **Trigger changes (owner approved).**
  - Solitaire's engine emits `multiCardMove` for a tableau run of two or more cards. The screen plays the fan sweep instead of card place, and stays silent during Auto-Complete.
  - FreeCell plays `freecell.noMoves` with its "No moves left" banner, both on the engine's `noMovesAvailable` and when Hint finds nothing.
  - FreeCell's invalid move was already played by `FreeCellBoard` and now uses the new file. The supermove plays at full volume; its level is set in the file.
- **Why it works.**
  - "Nope" is a tiny, friendly two-note wobble, readable without being harsh.
  - The fan sweep lifts and lands like the run it follows.
  - The shrug drifts down without resolving, which reads as "stuck", not "lost".

| File            | Before                                                | After                          | Length |
| --------------- | ----------------------------------------------------- | ------------------------------ | ------ |
| Invalid move    | `solitaire-invalid-move.ogg` 5.8 KB (kept for Sudoku) | `card-invalid-move.ogg` 5.9 KB | 0.32 s |
| Multi-card move | `freecell-supermove.mp3` 4.7 KB (removed)             | `card-multi-move.ogg` 7.6 KB   | 0.42 s |
| No moves left   | (none)                                                | `card-no-moves.ogg` 9.1 KB     | 1.0 s  |
