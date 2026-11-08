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

## Starting point (`dev`)

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
