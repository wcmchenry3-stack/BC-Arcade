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

`final_score` = number of guesses used (1–6), or 0 for a failed puzzle. Lower is better. The puzzle is identified by `puzzle_id` in the metadata.

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
- Scoring: `final_score` = guess count at completion

## Entitlement

Tier TBD. If free: no entitlement check — daily puzzle is always accessible.

## Known Issues / Limitations

- None tracked at this time
