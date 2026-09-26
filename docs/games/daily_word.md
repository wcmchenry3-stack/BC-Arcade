# Daily Word

**Category:** Word
**Tier:** TBD
**Status:** In Development

## How to Play

Daily Word is a once-per-day word-guessing puzzle (Wordle-style). The player has 6 attempts to guess a hidden word. After each guess, tiles reveal how close the guess was to the answer.

### Tile Colors

| Color  | Meaning                          |
| ------ | -------------------------------- |
| Green  | Correct letter, correct position |
| Yellow | Correct letter, wrong position   |
| Gray   | Letter not in the word           |

### Rules

- Guesses must be valid words (validated against a word list)
- One puzzle per day per language — everyone plays the same word
- After 6 incorrect guesses the answer is revealed
- Progress is saved — leaving mid-game and returning continues where you left off
- Results can be shared (emoji grid format)

### Languages

| Code | Language |
| ---- | -------- |
| `en` | English  |
| `hi` | Hindi    |

## Scoring (Persistence)

Daily Word has **no leaderboard**. Its board is declared disabled (`enabled=False`) and only describes the per-game "best" in Stats. There is no numeric score: `final_score` stays `null` on every row.

- **Metric and direction:** `guesses_used` (a result key in `games.metadata`), lower is better, labelled `guesses`, counting **wins only** (`qualifying_outcomes=("win",)`) (`board` in `backend/daily_word/module.py`; `BOARDS.daily_word` in `frontend/src/api/vocab.ts`). A loss uses every guess and is never a best.
- **Tie-break:** none; the board is disabled.
- **Partitions:** none.
- **Recorded, not partitioned:** creation metadata (`DailyWordMetadata`): `puzzle_id` and `language` (`en` | `hi`). Result (`DailyWordResult`): `is_complete`, `won`, `guesses_used`. The server raises a reported `guesses_used` to its own guess count for the puzzle, never lowers it (`reconcile_result`, #2541).
- **Max value:** none (`max_value` unset; `guesses_used` has no upper bound on purpose).
- **Outcomes:** `has_winner = True`. A solved puzzle records `win`, and running out of guesses records `loss`. An abandon (`abandoned`) is a started puzzle left unfinished: leaving the screen (`useGameSync`'s unmount abandon), or the old puzzle's session closed when a new day's puzzle loads (`resetToToday`). It carries the guesses made so far.
- **Duration:** `useGameSync`'s active-play window; Daily Word sends no duration of its own. The window runs from mount, so thinking time before the first guess counts.
- **How it reaches the server:** the `useGameSync("daily_word")` session row, opened at the first accepted guess (`POST /daily-word/guess` checks each guess). `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`, with `finalScore: null`, when the puzzle ends. The screen asks for no rank: `GET /games/{id}/rank` would answer `board_disabled`.
- **Where the player sees it:** the win / loss result card, which shows no leaderboard line, and Stats (`GameStatsScreen`, #2635, in the ⋯ menu): sessions, wins, losses, win rate and streaks, "Best" as the fewest guesses in a won puzzle, and time played. There is no Leaderboard entry point (`openableBoard` in `frontend/src/game/_shared/leaderboardAvailability.ts`). The daily challenge reads the result block (`backend/daily_challenge/definitions.py`).

## Client-Side Engine

- Location: `frontend/src/game/daily_word/engine.ts`
- Key exports: guess validation, tile color computation, win/loss detection
- Puzzle generation: `backend/daily_word/puzzle.py` generates daily puzzles server-side

## Backend

- Module: `backend/daily_word/module.py`
- Endpoints: `backend/daily_word/router.py`
- Puzzle generation: `backend/daily_word/puzzle.py`
- Metadata model: `DailyWordMetadata`
  - `puzzle_id: str` (required — identifies the day's puzzle)
  - `language: Literal["en","hi"] = "en"`
- Result model: `DailyWordResult`: `is_complete`, `won`, `guesses_used`
- Scoring: no `final_score`; see [Scoring](#scoring-persistence)

## Entitlement

Tier TBD. If free: no entitlement check — daily puzzle is always accessible.

## Known Issues / Limitations

- None tracked at this time
