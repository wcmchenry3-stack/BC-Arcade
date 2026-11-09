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
- **Not wired yet.** In today's game cards appear instantly, so a landing at 240 ms would trail the card. `blackjack.cardDeal` switches to these files together with the deal motion in #3571. The old file is removed then.

| File                      | Old size | New size           | Old length | New length |
| ------------------------- | -------- | ------------------ | ---------- | ---------- |
| `blackjack-card-deal.ogg` | 8.6 KB   | removed with #3571 | 0.60 s     | —          |
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
- **Not wired yet.** The chips need the chip motion, and plain loss is a new trigger, so they go live together in #3581. The old `blackjack-win/push/bust.ogg` and Blackjack's use of `hearts-moon-shot.mp3` are retired then.

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
  | Input during motion | no lock: a new action re-targets a card in flight from where it is shown                            | cues already scheduled still play                                                                                                 |
  | Reduce Motion       | every flight and turn is 0                                                                          | each cue at the instant                                                                                                           |

- **How the sound follows the motion.** The cues are fixed offsets from the action's start, computed from the same plan as the flights (`cueTimes` in `solitaireMotion.ts`): card place at the last contact less 40 ms; the multi-card move at the last contact less 237 ms; the flip at the edge-on point less 28 ms; the fan at the first edge-on point less 27 ms; the settle and the win at the last contact less 77 ms. The flights run on the same clock: a flight whose view mounts late (a busy JS thread) starts part-way, so its contact still meets its sound.
- **Implementation choices.**
  - **A flight layer, not in-place transforms.** The cards an action moved are drawn by a layer that is the board's last child, so a card never passes under another pile (an in-place transform from the old slot would pass under every pile drawn after its own, and the tableau keys its card views by index, so they are reused across moves). The layer is board-level rather than at the app root like the drag ghost: in board coordinates every position comes from the table geometry, while a root layer would need the board's window position, a measurement.
  - While a card flies its real view stays in its pile, transparent (its label, testID and touch target stay, so a tap can re-target it). A foundation draws the card under its top meanwhile (the highest one not itself in flight), and the waste its collapsed Draw-3 fan.
  - Each flight is one linear Reanimated timing on the UI thread, eased (out-cubic) and turned in a worklet. Its end comes back through `runOnJS`, with a JS backstop 250 ms after the flight's end; the held result card has its own backstop at the last contact plus 250 ms.
  - The riffle's hold ends on a timer at the last contact less 77 ms (the settle must start before the contact); only a run that riffled is held, so a lone last card keeps its own card place and the win.
  - Every pending cue and hold is cancelled on a new deal, on leaving the game (the clock's pause) and on unmount; a cue due while the player is away is not played. Flights come only from actions, so a restore never replays one.
  - The audition's Web Animations FLIP and its `__SOLITAIRE_MOTION__` override were not shipped.
- **Checked.** Jest covers each cue's time against the motion (fake timers, with the flights' end callbacks timed by `timeReanimatedEnds`), Reduce Motion, a restore, New Game and unmount mid-flight, re-targeting, and the backstops when the end callback is lost. The on-device check on iOS and Android, frame by frame against the sounds and including a drag (#3527), is part of the story's acceptance.

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
