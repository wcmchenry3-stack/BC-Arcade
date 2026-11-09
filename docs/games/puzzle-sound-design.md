# Puzzle, tile and dice games sound design log (#3578)

This log explains why each sound effect in Sort, 2048, Yacht, Daily Word, Sudoku and Mahjong sounds the way it does: the owner's brief, the options auditioned, what was picked and why, and the feedback that shaped it. The card games (Blackjack, Solitaire, FreeCell, Hearts) have their own log, [`arcade-sound-design.md`](arcade-sound-design.md) (#3563), and Star Swarm has [`starswarm-sound-design.md`](starswarm-sound-design.md) (#3560). Cascade and Mahjong's background music are out of scope.

The **recipes** live in `tools/assets/synth_puzzle_sfx.py`, with the shared building blocks in `tools/assets/synth_common.py`. Each file's credit and one-line recipe is in `frontend/assets/sounds/SOUND_CREDITS.md`. This log keeps the **reasoning**. Add an entry for every sound you change.

Each game's key → file → trigger → volume table is in the Sound section of its doc: [Sort](sort.md#sound), [2048](twenty48.md#sound), [Yacht](yacht.md#sound), [Daily Word](daily_word.md#sound), [Sudoku](sudoku.md#sound), [Mahjong](mahjong.md#sound).

## Direction for the whole set

The house rules are the card games' (see [arcade-sound-design.md](arcade-sound-design.md#direction-for-the-whole-set)):

- **Shared sounds, per-game keys.** One file can back several games' keys (e.g. one "select" sound for a Mahjong tile, a held die and a Sudoku digit). Every game keeps its own key, so volume and triggers stay per game.
- **Original and synthesized**, from oscillators, noise, envelopes and filters with fixed seeds. No samples.
- **Smooth over gritty**; **main energy above ~100 Hz** (phone speakers; iOS and Android are primary).
- **Frequent sounds are short and soft-edged.** Fast repeats get variations (`useSoundVariants`) or a run sound (`useRunSound`).
- **Physical sounds are built from what makes them** (air, friction, clacks). A pitched "body" makes a die, tile or pour read as something being struck (lesson from #3563's card place).
- **Variations are matched by short-term loudness** (`level_rms`, the loudest 50 ms), not by peak. The card games' card place sits at −21.5 dBFS.
- **Small files**: mono Ogg Vorbis q5; loops ~2 s and seamless.

## Starting point (`dev`, before #3578)

A snapshot of what the six games played before this story; each game's current table is in its doc.

The six games' effects on `dev` total about 525 KB, but 321 KB of that is one file, `hearts-moon-shot.mp3` (10 s), shared by four games' wins and Yacht's jackpots, and 88 KB is `freecell-game-win.mp3` (Sort's win). Both are shared with the card games, so they are only deleted once no registry uses them.

| File                         | Size      | Length  | Used by                                                     |
| ---------------------------- | --------- | ------- | ----------------------------------------------------------- |
| `yacht-dice-roll.ogg`        | 19,388 B  | 1.48 s  | `yacht.diceRoll`                                            |
| `yacht-die-hold.ogg`         | 5,720 B   | 0.17 s  | `yacht.dieHold` (and die release)                           |
| `yacht-straight.ogg`         | 6,135 B   | 0.55 s  | `yacht.straight`                                            |
| `yacht-upper-bonus.ogg`      | 5,590 B   | 0.44 s  | `yacht.upperBonus`                                          |
| `twenty48-tile-merge.ogg`    | 5,859 B   | 0.11 s  | `twenty48.tileMerge`                                        |
| `twenty48-tile-spawn.ogg`    | 6,634 B   | 0.66 s  | `twenty48.tileSpawn`                                        |
| `sudoku-digit-place.ogg`     | 6,019 B   | 0.52 s  | `sudoku.digitPlace` (not played)                            |
| `sudoku-unit-complete.ogg`   | 7,390 B   | 0.50 s  | `sudoku.unitComplete` (not played)                          |
| `mahjong-tile-select.ogg`    | 5,827 B   | 0.14 s  | `mahjong.tileSelect`                                        |
| `mahjong-tile-match.ogg`     | 13,915 B  | 1.48 s  | `mahjong.tileMatch`                                         |
| `mahjong-shuffle.ogg`        | 30,002 B  | 3.06 s  | `mahjong.shuffle`                                           |
| `hearts-moon-shot.mp3`       | 321,024 B | 10.03 s | Yacht jackpots, 2048 / Sudoku / Mahjong / Daily Word wins   |
| `freecell-game-win.mp3`      | 87,960 B  | 10.56 s | `sort.win`                                                  |
| `cascade-game-over.ogg`      | 6,093 B   | 0.31 s  | `twenty48.gameOver`, `mahjong.deadlock` (and Cascade)       |
| `cascade-fruit-merge.ogg`    | 5,910 B   | 0.55 s  | `sort.pour` (and Cascade)                                   |
| `solitaire-invalid-move.ogg` | 5,956 B   | 0.78 s  | `sudoku.errorEntered` (not played; and Solitaire, FreeCell) |

## Sounds

Each approved sound gets an entry here: the brief, the constraints, the options, the feedback rounds, the pick, why it works, and a size table against the files it replaced.

### Dice roll (`yacht.diceRoll`)

- **Brief.** The owner asked to hear all three directions before choosing a feel.
- **Constraints.**
  - The sound fires as the dice start their tumble (`diceRoll` event, `GameScreen.tsx`), and the tumble lasts **500 ms** (`components/Die.tsx`). The last bounce should land by about 0.5 s.
  - It repeats up to three times a turn, rolls as fast as ~0.7 s apart, so it has three variations. It used to play only for the player's rolls: the computer opponent's rolls (`useYachtCpuOpponent.ts`) were silent, since only the player's game events reach the sound handlers.
  - The old file (Kenney's dice shake) ran 1.48 s and peaked 0.43 s in, so it ran on well past the animation.
- **Round 1: three directions**, each previewed as its 3 variations, 1.2 s apart. Every impact is built from noise (a click plus noise-driven resonances, no sine body: the #3563 lesson that a pitched body reads as striking something). Five dice bounce to rest with shrinking gaps.
  - **A, cup shake and spill**: a ~150 ms muffled rattle in a cup, then the dice spill onto wood.
  - B, tumble on felt: soft rounded clacks with a little rolling friction.
  - C, wooden tray clatter: crisp clicks on hardwood with a few die-on-die knocks.
  - Feedback: "Let's try A with less cup".
- **Round 2: less cup**, three steps: A2 a ~90 ms quieter rattle, A3 a ~60 ms hint, A4 a 2–3 click flick.
- **Pick: A2, "short cup and spill"** (`dice-roll-1/2/3.ogg`, 0.75 s).
  - The owner chose one sound for every roll: a re-roll of fewer dice does not sound lighter.
  - A ~90 ms rattle (7–8 muffled clicks, swelling a little as the cup tips), then five dice spill onto a wooden tray at 0.10 s and bounce to rest by ~0.42 s. A third of the bounces carry a quieter die-on-die knock.
  - Level: −20 dBFS over the loudest 50 ms (about 1.5 dB over card place, since a roll is a bigger event than a card), peaks −5.5 to −7 dBFS, about −25 to −26 LUFS. 0.3–1.0% of the energy is below 100 Hz, 5–6% below 300 Hz.
- **Gameplay audition.** Yacht solo: a roll, two holds, two re-rolls ~1.5 s apart, then a turn of three rolls as fast as the button allows (~0.7 s apart). Each sound starts within a frame (40 ms) of the tumble, the last bounce lands just before the dice stop, and the fast rolls never overlap. Approved: "those look good".
- **Why it works.**
  - The short rattle says "dice in a cup" without spending the animation on it, so most of the sound is the spill, which lines up with the tumble.
  - The bounces are noise rung at wood-like resonances, so they read as dice landing, not as a mallet or a tone.
  - Three variations keep repeated rolls from sounding like a loop.
- **Trigger changes.**
  - New keys `yacht.diceRoll2` and `yacht.diceRoll3`; `GameScreen.tsx` plays `YACHT_DICE_ROLL` through `useSoundVariants`.
  - **The computer's rolls play it too** (owner request after the first commit). It fires when the computer's dice start to tumble (its `rollingIndices` turn non-empty), not on its engine events, so a computer turn restored from a save doesn't replay a roll and the computer's scoring stays silent. Audition: VS Computer (Easy), one player roll then the computer's three rolls ~2.6 s apart, each sound on the frame its dice start spinning. Approved: "cpu works". The computer's holds stay silent (owner decision).
  - A computer re-roll of one or two dice plays the full five-dice spill: one sound for every roll, as chosen.

| File                  | Old size           | New size           | Old length | New length |
| --------------------- | ------------------ | ------------------ | ---------- | ---------- |
| `yacht-dice-roll.ogg` | 18.9 KB            | removed            | 1.48 s     | —          |
| `dice-roll-1.ogg`     | —                  | 10.3 KB            | —          | 0.75 s     |
| `dice-roll-2.ogg`     | —                  | 10.3 KB            | —          | 0.75 s     |
| `dice-roll-3.ogg`     | —                  | 11.0 KB            | —          | 0.75 s     |
| **Total**             | 18.9 KB (19,388 B) | 31.6 KB (32,387 B) |            |            |

Three variations cost about 13 KB more than the one file they replace, and the set drops one third-party file (Kenney Casino Audio, CC0).

### Die hold and release (`yacht.dieHold`, `yacht.dieRelease`)

- **Brief.** Yacht gets its own sound (not the shared "select" family with Mahjong and Sudoku: a die and a tile are different objects), release gets its own sound instead of repeating the hold, both have three variations, and the computer's holds stay silent. The owner asked to hear all three directions.
- **Constraints.**
  - A hold pops the die to 1.12× on a spring and a release springs it back, settling in ~250–300 ms (`components/Die.tsx`). The sound plays at once on the tap.
  - Players tap across the dice quickly (~4 a second), so each sound is short and has variations.
  - It sits under the dice roll: the hold ~1.5 dB under it, the release 1 dB under the hold.
  - The old file (Kenney's "chip lay", 0.17 s, −21 dBFS over the loudest 50 ms) played for both hold and release.
- **Options**, each previewed as a roll, three holds and three releases, built from the dice-roll material (clicks rung at wood resonances, air, felt friction; no tonal body):
  - **A, pick up / set down** (picked): hold a fingertip click plus a small rising puff of air as the die lifts; release a soft tap on wood plus a tiny settle bounce.
  - B, lock / unlock: hold a firm clack plus a knock against the rail; release one duller tick.
  - C, slide aside / back: ~70 ms of felt friction into a soft stop; release a shorter, quieter slide.
- **Pick: A** (`die-hold-1/2/3.ogg`, `die-release-1/2/3.ogg`, 0.12 s each, ~50–60 ms of sound).
  - Hold: −21.5 dBFS over the loudest 50 ms, almost all click and air (0.2% of the energy below 300 Hz).
  - Release: −22.5 dBFS, a darker wooden tap (4–16% below 300 Hz, under 2% below 100 Hz).
- **Gameplay audition.** Yacht solo: a roll, three holds and three releases at a relaxed pace, then a roll and fast taps across all five dice and back (~4 a second). Each sound lands on the frame the die pops or drops back (within one frame on the fast taps). Approved: "like it - approved".
- **Why it works.**
  - Hold and release are different motions (lifting off vs putting down), so they read as opposite actions even without looking.
  - They share the roll's wood, so the whole turn sounds like one set of dice on one tray.
  - Release is quieter, so a run of taps leans on the hold, the action that matters.
- **Trigger changes.** New keys `yacht.dieHold2/3` and `yacht.dieRelease`, `yacht.dieRelease2/3`. `GameScreen.tsx` plays `YACHT_DIE_HOLD` and `YACHT_DIE_RELEASE` through `useSoundVariants`; `dieRelease` no longer plays the hold sound. The computer's holds stay silent.

| File                    | Old size         | New size           | Old length | New length |
| ----------------------- | ---------------- | ------------------ | ---------- | ---------- |
| `yacht-die-hold.ogg`    | 5.6 KB           | removed            | 0.17 s     | —          |
| `die-hold-1/2/3.ogg`    | —                | 13.9 KB            | —          | 0.12 s     |
| `die-release-1/2/3.ogg` | —                | 15.0 KB            | —          | 0.12 s     |
| **Total**               | 5.6 KB (5,720 B) | 28.9 KB (29,598 B) |            |            |

Six short files where there was one: about 24 KB more, the cost of a separate release and three variations of each. The set drops another Kenney Casino Audio file (CC0).

### Scoring ladder (`yacht.scoreCommit`, `scoreZero`, `smallStraight`, `largeStraight`, `fullHouse`, `upperBonus`, and the computer's `cpu*` set)

- **Brief.** Score commit, the straights and the upper bonus designed together as one ladder, the jackpot as its top step (next). Owner decisions:
  - a milestone **replaces** the commit (one sound per score);
  - small and large straights get **their own keys**;
  - a **full house** gets a milestone too (it is a named, fixed-value combo; three and four of a kind and chance are sums and stay on the commit);
  - a 0 plays a **duller "scratch"** variant;
  - the computer's scores get **the opposite tone** of the player's: if yours is triumphant, its is the "rival" version, and always quick;
  - the **upper bonus** needed a better tone than the old one: an achievement moment.
- **Constraints.**
  - There is no scoring animation: the dice blank and the round advances at once, so the sound is the feedback and starts at once.
  - In VS the computer's first roll starts within ~30 ms of your score, so your score sound always plays over its dice roll. The commit (~50 ms) is over before the roll gets loud.
  - The commit plays 13 times a game but only once a turn (10+ s apart), so it has no variations: each would cost another audio player on the screen.
  - The old straight and bonus sat about 17 dB over card place (−4.4 and −4.9 dBFS over the loudest 50 ms).
- **Options.** Three directions, each a player set (rising, major) and a computer set (falling, minor, darker, 2.5 dB quieter, ≤0.5 s):
  - **A, wood and mallet** (picked): a pencil tap on a wooden scorepad; marimba-like mallet runs (4 notes for a small straight, 5 for a large, "three and two" for a full house); the bonus a run into a held mallet roll with a glass sparkle.
  - B, scorepad and bells: a pencil mark on paper; glass-bell runs and a shimmering bell chord.
  - C, arcade coins: a soft blip; rising blips and a coin cascade into a trill.
- **Pick: A.** Loudness ladder over the loudest 50 ms: commit −22, zero −23.5, small straight −20.5, large straight and full house −20, upper bonus −18 dBFS; the computer's set 2.5 dB under each. Nothing has energy below 100 Hz; the computer's set reaches down to C4 (262 Hz), which is what makes it darker.
- **Gameplay audition.** VS Computer, six turns from injected states: a large straight, a full house, a small straight, a 0 (Yacht), a commit (Threes) and the upper bonus (Sixes reaching 63), each followed by the computer's turn (it scored three small straights and three commits). Each sound lands on the frame its score appears. Approved: "I like what you chose".
- **Why it works.**
  - The commit is the same wood as the dice, so a plain score sounds like a pencil mark on the pad, not a reward; the rewards are the only tonal sounds in the game, so they stand out.
  - The straights mirror the dice (4 or 5 notes in a row), and the full house is literally three and two.
  - The computer's set is the same instrument turned over: you hear what it scored, and that it's bad news for you, without it competing with your own sounds.
- **Trigger changes.**
  - The engine emits a `scored` event (category and points) first on every score, and a new `fullHouse` event.
  - `game/yacht/useScoreSound.ts` picks one sound per score (yacht or joker, then upper bonus, large straight, full house, small straight, else commit or zero). It plays once per new events array and skips the events the screen mounts with, so a restored save doesn't replay a score. Yours play from your state, the computer's from its state.
  - `yacht.straight` is split into `yacht.smallStraight` and `yacht.largeStraight`; 12 keys in all.
  - Your yacht and joker still play the old fanfare, and the computer's play its upper bonus, until the jackpot sounds land.
  - The computer's roll trigger now plays strictly once per roll array (a re-render with a new `play` function could have replayed it).

| File                     | Old size           | New size           |
| ------------------------ | ------------------ | ------------------ |
| `yacht-straight.ogg`     | 6.0 KB             | removed            |
| `yacht-upper-bonus.ogg`  | 5.5 KB             | removed            |
| `score-commit.ogg`       | —                  | 4.6 KB             |
| `score-zero.ogg`         | —                  | 5.4 KB             |
| `small-straight.ogg`     | —                  | 7.6 KB             |
| `large-straight.ogg`     | —                  | 8.7 KB             |
| `full-house.ogg`         | —                  | 8.3 KB             |
| `upper-bonus.ogg`        | —                  | 11.8 KB            |
| `cpu-score-commit.ogg`   | —                  | 4.6 KB             |
| `cpu-score-zero.ogg`     | —                  | 5.4 KB             |
| `cpu-small-straight.ogg` | —                  | 6.9 KB             |
| `cpu-large-straight.ogg` | —                  | 7.3 KB             |
| `cpu-full-house.ogg`     | —                  | 6.8 KB             |
| `cpu-upper-bonus.ogg`    | —                  | 7.0 KB             |
| **Total**                | 11.4 KB (11,725 B) | 84.5 KB (86,543 B) |

Ten sounds where there were two, half of them the computer's new set: about 73.1 KB more. The set drops two Kenney Digital Audio files (CC0).

### Jackpot (`yacht.yacht`, `yacht.joker`, `yacht.cpuYacht`, `yacht.cpuJoker`)

- **Brief.** The top of the scoring ladder: a yacht and a joker for you and for the computer. Owner: "for the player we can take a minute to celebrate but for the cpu it should be quick like the rest", in the opposite tone.
- **Constraints.**
  - Yours plays with the YACHT! / JOKER! celebration, which leaves at 2.2 s (`YachtCelebrationAnimation.tsx`), so it rings out by ~1.5 s in a 1.9 s file.
  - In VS the computer starts rolling right after you score, so its dice roll plays under your fanfare.
  - The old sound was the 10 s, 321 KB Pixabay `hearts-moon-shot.mp3`, which ran far past the celebration.
- **Options**, all in the approved wood and mallet palette, each with your yacht and joker and the computer's:
  - **1, mallet fanfare** (picked): a two-octave mallet run into a big rolled chord, glass sparkles falling; the joker a step higher with a double "again!" bell; the computer's a fast falling minor run into a low minor chord.
  - 2, dice slam and motif: the five dice slapped down, then a "ta-da-DAA" mallet motif.
  - 3, bells and roll: a glass-bell carillon over a swelling mallet roll.
  - The owner liked all three and asked which matches the other scorecard sounds best: 1, the same mallet runs as the straights stretched to two octaves, ending like the upper bonus (a held roll and a sparkle), only bigger; 2 adds new material and 3 leads with bells (the palette not picked).
- **Pick: 1.** Yours at −16 dBFS over the loudest 50 ms (2 dB over the upper bonus), the computer's at −19. Nothing below 100 Hz; the computer's low minor chords put ~19% of their energy under 300 Hz.
- **Gameplay audition.** VS Computer from injected states: your yacht, the computer's yacht, your joker (a second yacht into Fives), the computer's joker. The computer was made to roll five sixes by a local patch built into the audition only (reverted, never committed). Each sound starts on the frame its score appears; yours climbs as the badge flies in. Approved: "approved - commit it".
- **Why it works.** It is the ladder's own material at its largest, so a yacht sounds like the best score of the same game rather than a different game's fanfare; the joker is the same moment again, a step higher. The computer's is short and falls, so it registers as bad news without competing.
- **Trigger changes.** `yacht.yacht` / `yacht.joker` point at the new files (still played by the event handlers with the celebration). New keys `yacht.cpuYacht` / `yacht.cpuJoker`; the score picker now tells a yacht from a joker, and the computer's no longer borrow its upper bonus.
- **Cleanup.** `yacht-yacht.mp3`'s stale `SOUND_CREDITS.md` entry (a file that never shipped) is deleted. `hearts-moon-shot.mp3` stays for 2048, Sudoku, Mahjong, Daily Word and the card games.

| File                                 | Old size                | New size           |
| ------------------------------------ | ----------------------- | ------------------ |
| `hearts-moon-shot.mp3` (Yacht's use) | 313.5 KB, shared, stays | —                  |
| `jackpot-yacht.ogg`                  | —                       | 16.4 KB            |
| `jackpot-joker.ogg`                  | —                       | 16.5 KB            |
| `cpu-jackpot-yacht.ogg`              | —                       | 8.4 KB             |
| `cpu-jackpot-joker.ogg`              | —                       | 8.5 KB             |
| **Total**                            | —                       | 49.8 KB (51,027 B) |

Adds 51,027 B now. The fanfare can only go once 2048, Sudoku, Mahjong and Daily Word (and the card games, #3563) stop using it; dropping it then saves 321 KB, far more than every Yacht sound together.

### 2048 merge and spawn (`twenty48.tileMerge`, `twenty48.tileSpawn`)

- **Brief.** The owner wanted merge and spawn designed together, since they play on nearly every swipe, and asked to hear samples.
- **Constraints.**
  - A slide takes 100 ms, the merge pop starts at 90 ms (1.15×, 150 ms), and a new tile scales in from 60 ms (`AnimatedTile.tsx`). Both sounds fire at the swipe, so each file puts its accent on its animation: the merge at 90 ms, the spawn at 60 ms.
  - Swipes come up to ~4–5 a second, and merge and spawn usually play together, so both are short with three variations each.
  - The old spawn rang 0.68 s on every swipe with 91% of its energy under 300 Hz (mostly lost on phone speakers); the old merge sat at about −27.5 dBFS after its 0.3 volume.
- **Options**, each previewed as 8 swipes ~0.4 s apart and a fast burst of 6 at 0.22 s:
  - **A, wooden tiles** (picked): a faint slide, then two wooden tiles clacking on the pop; the spawn a small tile set down.
  - B, bubbles: a rounded "bloop" gliding up into the pop; the spawn a little water droplet.
  - C, mallet chime: a soft marimba note; the spawn a tiny glass tick.
- **Pick: A.** Merge −22 and spawn −26 dBFS over the loudest 50 ms (the spawn, on every swipe, is the quietest sound in the game), set in the files, so the code's 0.3 / 0.2 volumes are gone (1.0). Under 9% of the energy below 300 Hz, nothing below 100 Hz.
- **Gameplay audition.** A board injected with pairs, then 8 swipes ~0.45 s apart and 8 at 0.22 s: 21 sounds, variations never repeating; each sound sits on its animation (the clack as the pop starts, its peak ~75 ms later; the spawn as the tile scales in). Approved.
- **Why it works.** The same wood as Yacht's dice and scorepad, so the arcade's tile and dice games sound like one set of pieces; dry and short, so a fast run of swipes stays a run of separate clicks instead of a wash.
- **Trigger changes.** New keys `twenty48.tileMerge2/3` and `twenty48.tileSpawn2/3`, played by `useSoundVariants`; volumes 0.3 and 0.2 → 1.0 (levels in the files).

| File                      | Old size           | New size           | Old length | New length |
| ------------------------- | ------------------ | ------------------ | ---------- | ---------- |
| `twenty48-tile-merge.ogg` | 5.7 KB             | removed            | 0.11 s     | —          |
| `twenty48-tile-spawn.ogg` | 6.5 KB             | removed            | 0.66 s     | —          |
| `tile-merge-1/2/3.ogg`    | —                  | 16.8 KB            | —          | 0.22 s     |
| `tile-spawn-1/2/3.ogg`    | —                  | 13.4 KB            | —          | 0.16 s     |
| **Total**                 | 12.2 KB (12,493 B) | 30.2 KB (30,930 B) |            |            |

Six files where there were two: 18,437 B more, for variations on the two sounds that play most. The set drops two Kenney files (CC0).

### 2048 win and game over (`twenty48.win2048`, `twenty48.gameOver`)

- **Brief.** Designed as a pair. The owner asked to hear all the directions.
- **Constraints.** Both come with a result card that stops play, so neither has to clear the way for the next move: the win can celebrate ~2–2.5 s, the game over should be gentle and short (a long game ending, not a mistake). Today the win was the 10 s, 321 KB shared fanfare and the game over Cascade's sound.
- **Options**, each a win then a game over:
  - **A, wood and mallet** (picked): the Yacht jackpot's run and roll, then a final "ta-da" chord with a high bell; the game over a last tile clack, a gentle falling mallet line and a soft low chord.
  - B, the climb to 2048: 11 rising notes, one per doubling, into a big chord; the game over tiles sliding to a stop.
  - C, glass and chimes: a bell carillon over a shimmering chord; the game over falling glass bells.
  - D, reuse Yacht's jackpot for the win (+0 KB), with A's game over.
- **Pick: A.** Win −16 dBFS over the loudest 50 ms (the top of the ladder, like Yacht's jackpot), game over −21. Nothing below 300 Hz.
- **Gameplay audition.** Two injected boards: a swipe left merging 1024 + 1024 into 2048 (the fanfare starts with the merge; the win card is up within ~0.3 s, under the rolling chord), and a swipe right leaving no moves whichever tile spawns (the falling line with the result card). Approved.
- **Why it works.** The free games now share one ending vocabulary: Yacht's jackpot and 2048's win are the same mallet fanfare at different lengths, and the game over is the same instrument falling gently instead of a harsh "fail" sound.
- **Found in the audition: a reopen bug (fixed).** Reopening a saved game replayed its last swipe's merge and spawn, on `dev` too: a save keeps the tiles' `isMerge`/`isNew` flags (only the events are cleared), and the tile-sound effect also ran when the screen opened. The screen now remembers the tiles a restored game opens with and skips them; a fresh deal still plays its spawn. Owner-approved; `Twenty48Screen.sound.test.tsx` covers both cases.
- **Cleanup.** Deleted the stale `twenty48-win.mp3` and `twenty48-game-over.ogg` credit entries (files that never shipped).

| File                                 | Old                      | New size           | Length               |
| ------------------------------------ | ------------------------ | ------------------ | -------------------- |
| `hearts-moon-shot.mp3` (2048's use)  | 313.5 KB, shared, stays  | —                  | 10.0 s               |
| `cascade-game-over.ogg` (2048's use) | 6.0 KB, Cascade's, stays | —                  | 0.31 s               |
| `win-2048.ogg`                       | —                        | 26.4 KB            | 3.1 s (rings ~2.7 s) |
| `game-over-2048.ogg`                 | —                        | 17.3 KB            | 2.0 s (rings ~1.5 s) |
| **Total**                            | —                        | 43.7 KB (44,757 B) |                      |

Adds 44,757 B now; nothing is deleted, since both old files are shared. 2048 no longer uses the 321 KB fanfare; it goes once Sudoku, Mahjong, Daily Word and the card games stop using it.

### Mahjong select and match (`mahjong.tileSelect`, `mahjong.tileMatch`)

- **Brief.** The owner chose the material for the whole Mahjong set: **real tiles**, bone-and-bamboo tiles on a felt table, the sound of the actual game, over the Yacht/2048 wood and mallet or "jade and bells". Select is Mahjong's own, not shared with Sudoku's digit placement. Select and match were designed first, as a pair, since they play constantly.
- **Constraints.**
  - The motions (#3613, `motion.ts`): select lifts the tile over 180 ms; a match lifts the pair, flies it together to meet face to face at 264 ms (0.6 of 440 ms), then bursts in sparks. Both sounds fire at the tap, so the match puts its clack on the meeting.
  - A board is 72 pairs: select plays ~150 times a game and match 72, often in quick runs (a tap during a burst is taken at once). So both are short with three variations, and select sits 3 dB under match.
  - The old match was a 1.5 s bell (Kenney) ringing under the next taps; the old select a generic impact.
- **Options**, each previewed as three calm select → match pairs, two quick pairs and a run of three selects:
  - **A, crisp clack** (picked): a bright fingertip tick on a dense tile; the match a tap, the pair flying, a sharp clack and its double as they meet, two tiny high sparks.
  - B, felt table: a soft scuff on the cloth and a muffled tap; the match a rounder, deeper knock with the felt under it.
  - C, ivory with a chime: a tick with a faint pitched ring; the match's clack followed by a two-note pentatonic chime.
- **Pick: A.** Select −23 and match −20 dBFS over the loudest 50 ms; nothing below 300 Hz (under 0.6% of the energy).
- **Gameplay audition.** A Turtle deal (select, a wrong pair, a deselect, select, match) and a four-tile board (select, match, a select during the burst, the winning match), with every `play()` logged and laid over the video: each sound within ~30 ms of its tap, variations never repeating, and the clack on the frame where the pair meets. Approved.
- **Why it works.** It is the sound the game makes in real life, so it needs no learning; dry and short, so a fast run of matches stays a run of distinct clacks; and the match's accent lands on what the eye sees (the tiles touching), not on the tap.
- **Trigger changes.** New keys `mahjong.tileSelect2/3` and `mahjong.tileMatch2/3`, played by `useSoundVariants` (`useMahjongAudio.ts`). The deselect stays silent.

| File                       | Old size           | New size           | Old length | New length |
| -------------------------- | ------------------ | ------------------ | ---------- | ---------- |
| `mahjong-tile-select.ogg`  | 5.7 KB             | removed            | 0.14 s     | —          |
| `mahjong-tile-match.ogg`   | 13.6 KB            | removed            | 1.48 s     | —          |
| `mahjong-select-1/2/3.ogg` | —                  | 14.0 KB            | —          | 0.12 s     |
| `mahjong-match-1/2/3.ogg`  | —                  | 24.7 KB            | —          | 0.5 s      |
| **Total**                  | 19.3 KB (19,742 B) | 38.7 KB (39,652 B) |            |            |

Six files where there were two: 19,910 B more, for variations on the two sounds that play most. The set drops two Kenney files (CC0), the last uses of Kenney Impact Sounds.

### Mahjong shuffle (`mahjong.shuffle`)

- **Brief.** The same "real tiles" material as select and match. The owner heard three options after select and match were approved.
- **Constraints.** The shuffle motion (#3613, `motion.ts`) swirls every tile to its new place over 880 ms in a left-to-right wave: each tile lifts within the first 308 ms and lands 572 ms later, so the landings run from 572 to 880 ms. Shuffles are rare (three a game at most), so one file, no variations. The old file was Kenney's 3.1 s card shuffle, longer than the motion and the wrong material.
- **Options**, each previewed after a select and before a select and match:
  - **A, washing the tiles** (picked): the sound of mixing mahjong tiles, a dense clatter of tiles pushed around on the felt over a soft felt rumble, swelling with the swirl, then the wave of tiles settling into place.
  - B, sweep and settle: a broad sweep of hands over the felt with a few clicks, then a crisp left-to-right settle.
  - C, riffle: an orderly run of clicks racing left to right as the wave lifts, the wave landing, a final double clack.
- **Pick: A.** −20 dBFS over the loudest 50 ms (level with the match: a rare, bigger event); 1.2% of the energy below 300 Hz.
- **Gameplay audition.** A Turtle deal, a select, then two shuffles from the action bar: each sound within ~30 ms of the press; the clatter swells while the tiles swirl, and the landing clicks run left to right as the left side lands (~0.6 s) and then the right (~0.8 s), settled by ~0.9 s. Approved.
- **Why it works.** "Washing" the tiles is how a real game reshuffles, so the sound says what happened without a label; the landings put the end of the sound on the end of the motion, so the board is ready when the sound stops.

| File                       | Old size           | New size           | Old length | New length |
| -------------------------- | ------------------ | ------------------ | ---------- | ---------- |
| `mahjong-shuffle.ogg`      | 29.3 KB            | removed            | 3.06 s     | —          |
| `mahjong-shuffle-wash.ogg` | —                  | 14.6 KB            | —          | 1.05 s     |
| **Total**                  | 29.3 KB (30,002 B) | 14.6 KB (14,986 B) |            |            |

15,016 B smaller. The set drops Mahjong's last Kenney file (Casino Audio, CC0).

### Mahjong win and deadlock (`mahjong.win`, `mahjong.deadlock`)

- **Brief.** The last pair of the Mahjong set. The owner was keen to lose the 10 s fanfare and picked from three directions without a separate brief.
- **Constraints.**
  - The win fires at the winning tap, together with the match (whose clack lands at 264 ms). The spark cascade (#3613, `WIN_CASCADE_MS`) holds the result card back until 1.45 s, so the win can build under the sparks and land its accent as the card shows, then ring under it.
  - The deadlock fires with the 420 ms board shake, and its card shows at 500 ms (`DEADLOCK_OVERLAY_DELAY_MS`): a long game ending, so gentle, not a punishment.
  - Before: the win was the shared 10 s, 321 KB fanfare; the deadlock Cascade's 0.31 s phaser tone.
- **Options**, each previewed as the winning tap (match plus win) and a last match into a deadlock:
  - A, tiles and chimes: the burst growing into a rush of tiles tumbling across the felt under a rising pentatonic chime run, a warm rolled chord; the deadlock two dull knocks and a falling chime.
  - B, wood and mallet: Yacht and 2048's mallet fanfare at Mahjong's length; the deadlock 2048's gentle ending opened by tile knocks.
  - **C, gong and bells** (picked): a small gong swelling under the sparks while bells ring a pentatonic carillon, then a bright gong stroke and a bell chord; the deadlock a muted gong and one falling bell.
- **Pick: C.** Win −16 dBFS over the loudest 50 ms (the top of the ladder, like 2048's win), deadlock −21. Both gongs sit at F4 (349 Hz) or higher: an earlier draft's deadlock gong at G3 had 80% of its energy under 300 Hz, lost on phone speakers. Nothing below 300 Hz now.
- **Gameplay audition.** A four-tile board cleared in two matches (bells over the sparks, the stroke at 1.45 s as the "You Win!" card appears), then a board with no shuffles left where the last match leaves no free pair (the muted gong with the shake, the bell as "You Lose" appears at 0.5 s). Approved.
- **Why it works.** The "real tiles" set gets one ceremonial voice for its two endings: the same gong, bright and with bells for a win, muted with a single falling bell when stuck. Mahjong now sounds like itself rather than borrowing the card games' fanfare.

| File                                    | Old                      | New size           | Length |
| --------------------------------------- | ------------------------ | ------------------ | ------ |
| `hearts-moon-shot.mp3` (Mahjong's use)  | 313.5 KB, shared, stays  | —                  | 10.0 s |
| `cascade-game-over.ogg` (Mahjong's use) | 6.0 KB, Cascade's, stays | —                  | 0.31 s |
| `mahjong-win.ogg`                       | —                        | 27.0 KB            | 3.4 s  |
| `mahjong-deadlock.ogg`                  | —                        | 16.2 KB            | 1.9 s  |
| **Total**                               | —                        | 43.2 KB (44,222 B) |        |

Adds 44,222 B now; nothing is deleted, since both old files are shared. Mahjong no longer uses the fanfare; it goes once Sudoku, Daily Word and the card games stop using it.
