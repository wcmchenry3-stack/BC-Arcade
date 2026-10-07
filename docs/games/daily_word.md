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

- One puzzle per local day per language — everyone in the same day/language gets the same answer.
- The player has at most 6 scored guesses.
- Guesses must have the puzzle's visible length and be valid words.
- Invalid words and wrong-length guesses do not spend a scored guess.
- A retried duplicate guess request does not spend the same turn twice.
- After six unsuccessful scored guesses, the puzzle is lost; the answer is available only to a session that has earned it by solving or exhausting its guesses.
- Progress is saved locally so leaving and returning resumes the board.
- Results can be shared as an emoji-grid summary.

### Repeated letters

Tile evaluation is frequency-aware:

1. exact-position matches are marked first;
2. remaining answer-letter inventory is then consumed for wrong-position matches;
3. any additional duplicate letters in the guess are gray/absent once the answer's remaining copies are exhausted.

This prevents one answer letter from incorrectly marking multiple duplicate guess letters yellow.

### English and Hindi

English uses ordinary code-point letter length.

Hindi input is NFC-normalized and uses Devanagari grapheme clusters for visible puzzle length, so combining marks/conjuncts render as one visual tile where appropriate. The backend returns grapheme-cluster information for Hindi guesses so the client can render the scored result consistently.

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

## Daily lifecycle and rollover

The puzzle id is `YYYY-MM-DD:<language>`, derived from the player's current UTC offset.

### Loading / resume

On mount the screen fetches today's puzzle metadata and loads any saved board.

- If the saved `puzzle_id` matches today, that board resumes.
- If it belongs to another day/language, the stale save is cleared and a fresh board is created.
- For network failures while loading, cached "today" metadata may be used when available. HTTP errors are not bypassed by cache fallback.
- **Offline with a cold cache (#2925):** a network failure with no cached metadata shows "Daily Word needs a connection" with a Retry button. Retry runs the same single load path as mount. Any other failure (HTTP error, unexpected exception) keeps the generic "Could not load today's puzzle" banner and never falls back to cache.
- **Cache warming (#2925):** Home calls `warmTodayMeta()` (`game/daily_word/todayMeta.ts`) once on mount, when connectivity returns, and when the app returns to the foreground, while online. It stores today's metadata under the same `localDateKey` the screen reads and skips the fetch when already cached, so the screen can open offline later the same day.
- **Decision:** Daily Word stays online-only. Showing a clear message and warming the cache is the whole scope; offline play and local scoring are tracked separately in #3022.
- An unfinished restored board resumes the corresponding shared game session.

### Midnight / stale-puzzle recovery

The backend rejects a guess for an old puzzle id (with a one-minute clock-drift grace around midnight). When the client receives `stale_puzzle_id`, it tries to replace the board with today's puzzle.

**The replacement is fetch-first and atomic from the player's perspective:**
1. fetch today's puzzle;
2. if that succeeds, clear the old local state;
3. abandon the old open session if necessary;
4. install the fresh board.

If the fetch fails, the old saved board and its open session are left intact. This fixes the data-loss scenario formerly tracked by #2473.

For a completed puzzle, the result card counts down to the next local midnight. When it reaches zero, the primary action becomes Play Again:
- if the server still serves the same puzzle (for example device/server clock skew), the completed result remains and the client retries after a short countdown;
- if loading the new puzzle fails, the finished board remains saved and Play Again stays retryable;
- only a successfully fetched different puzzle replaces it.

### Current timezone model

Daily Word currently sends `tz_offset_minutes`, not an IANA timezone id. The current offset determines the local date/puzzle id. This is the same broad offset-based day model used by Daily Challenge today; timezone/DST improvements should be kept consistent across the two systems.

- Location: `frontend/src/game/daily_word/engine.ts`
- Key exports: guess validation, tile color computation, win/loss detection
- Puzzle generation: `backend/daily_word/puzzle.py` generates daily puzzles server-side

## Guess validation and server-side progress

The answer is deterministic, but scored-guess state is also tracked server-side so a caller cannot obtain unlimited scored attempts simply by resetting local state.

- `POST /guess` validates puzzle id, language, visible length and dictionary membership before spending a guess.
- The scored-guess cap is 6.
- Repeated/retried guesses are idempotent with respect to the guess count.
- The server can reconcile the client's `guesses_used` upward from its recorded count.
- `GET /answer` is gated: the session must have solved the puzzle or exhausted its guesses.
- If the guess-state database is temporarily unavailable, guess scoring degrades open so the free puzzle remains playable; answer release remains closed because entitlement to the answer cannot be proven.

## Sound

- Registry: `frontend/src/game/daily_word/sounds.ts` (`DAILY_WORD_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting (muted means silent).
- Win: `dailyWord.win` plays the shared fanfare `assets/sounds/hearts-moon-shot.mp3` (Pixabay Content License, no attribution required; the same file Sudoku, Hearts, Yacht, Solitaire, Mahjong, Blackjack and 2048 use for a win), once, when the solved row finishes flipping and the win card opens. A solve the server reports as `already_solved` (the response to an earlier guess was lost) plays it once as the win card opens, but only if this visit submitted a guess; a wiped board reopening a puzzle finished earlier is a restore and stays silent.
- It does not play when a finished board is restored on mount, on re-render or on a countdown tick. A loss has no sound.

## Sharing

After a win/loss:
- iOS/Android use the native system share sheet;
- web copies the generated share text to the clipboard when available;
- the share text includes the emoji result grid and Daily Word deep link.

The UI only says "Copied" when a clipboard copy actually happened.

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

## Open behavior dependencies

The former rollover data-loss issue #2473 is already resolved in current code and tests and should not remain a documentation dependency.

Active future timezone/day-boundary work should be documented here only when it changes the shipped behavior; do not mirror the general GitHub backlog into this file.
