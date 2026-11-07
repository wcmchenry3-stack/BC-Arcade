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
  - It repeats up to three times a turn, rolls as fast as ~0.7 s apart, so it has three variations. Only the player's rolls play it: the computer opponent's rolls (`useYachtCpuOpponent.ts`) are silent, since only the player's game events reach the sound handlers.
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
- **Trigger change.** New keys `yacht.diceRoll2` and `yacht.diceRoll3`; `GameScreen.tsx` plays `YACHT_DICE_ROLL` through `useSoundVariants`. Nothing else changes.

| File                  | Old size           | New size           | Old length | New length |
| --------------------- | ------------------ | ------------------ | ---------- | ---------- |
| `yacht-dice-roll.ogg` | 18.9 KB            | removed            | 1.48 s     | —          |
| `dice-roll-1.ogg`     | —                  | 10.3 KB            | —          | 0.75 s     |
| `dice-roll-2.ogg`     | —                  | 10.3 KB            | —          | 0.75 s     |
| `dice-roll-3.ogg`     | —                  | 11.0 KB            | —          | 0.75 s     |
| **Total**             | 18.9 KB (19,388 B) | 31.6 KB (32,387 B) |            |            |

Three variations cost about 13 KB more than the one file they replace, and the set drops one third-party file (Kenney Casino Audio, CC0).
