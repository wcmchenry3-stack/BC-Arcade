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

No entries yet. Each approved sound gets an entry here: the brief, the constraints, the options, the feedback rounds, the pick, why it works, and a size table against the files it replaced.
