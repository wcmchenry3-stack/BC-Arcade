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

| Code | Language | Puzzle id         | Notes                                            |
| ---- | -------- | ----------------- | ------------------------------------------------ |
| `en` | English  | `YYYY-MM-DD:en:2` |                                                  |
| `hi` | Hindi    | `YYYY-MM-DD:hi`   |                                                  |
| `fr` | French   | `YYYY-MM-DD:fr:1` | Backend only until #3241; lists come from #3239. |
| `es` | Spanish  | `YYYY-MM-DD:es:1` | Backend only until #3241; lists come from #3239. |

### French and Spanish: accent folding and `display` (#3240)

The `fr` and `es` word files (`words/answers_<lang>.txt`, `valid_<lang>.txt`) hold one **display-form** word per line (`était`, `niño`), each with a unique fold key. `fold(word, lang)` (`backend/daily_word/normalize.py`) is applied both when the lists are loaded and to every guess: NFC, lowercase, strip combining marks, map `œ`->`oe` and `æ`->`ae`. In `es` the tilde on `n` is kept, so `ñ` is a distinct letter (`niño` is not `nino`). `en` is unaffected on `a-z` input, and Hindi is never folded (NFC only).

Validation, scoring, the stored guess record and the tile letters all use folded keys, so `ÉTAIT`, `était` and `etait` are the same accepted guess and score identically; the tile array is always 5 long. Responses add the list's own spelling:

- `POST /guess` adds `"display"` (the list's display form of the guessed word, not what the user typed) for `fr` and `es` only.
- `GET /answer` returns `{"answer": "<folded>", "display": "<accented>"}` for every language. For `en` and `hi`, `display` equals `answer`.
- `GET /upcoming` still scrambles the folded answer; the client has no display form for offline play yet (#3241).

If a language's list files are missing, it is not loaded and is unsupported: `/today` and `/upcoming` answer 422 `unsupported_language`, and `/guess` and `/answer` answer 422 `invalid_puzzle_id`. Import never fails. Bump `_LIST_VERSION[lang]` in `puzzle.py` whenever a list changes.

**Day offset.** The answer index is `(YYYYMMDD + SALT + _DAY_OFFSET[lang]) % len(answers)`. `en` and `hi` have offset 0, so their answers for existing dates are unchanged (pinned in `tests/test_daily_word_romance.py`); `fr` and `es` have their own offsets so the languages don't share an index pattern.

The puzzle language follows the app language through one function, `getLanguage()` (`todayMeta.ts`): the app language's base code if this build offers a puzzle in it, else `en`. Native (iOS/Android) store builds (#3150, `buildFlavour.ts`) offer only the launched languages (`en` for now), so `hi` falls back to the English puzzle and QWERTY keyboard; web, dev, e2e and pre-launch builds also offer `hi` (#3153), mirroring `availableLocales`. The backend still accepts `hi`. A launched language is added by listing it in `LAUNCHED_DAILY_WORD_LANGUAGES`.

When a native store build falls back to English, any saved Hindi board (in progress or finished, even from the same day) is discarded: its `puzzle_id` ends `:hi`, no longer matches today's English puzzle, so the stale save is cleared (`staleSave` -> `clearState`) and a fresh English board starts. This is the chosen "migrate to `en`" option; finishing the Hindi game is not supported. Server-side stats are keyed by puzzle and are untouched.

## Scoring (Persistence)

Daily Word has **no leaderboard**. Its board is declared disabled (`enabled=False`) and only describes the per-game "best" in Stats. There is no numeric score: `final_score` stays `null` on every row.

- **Metric and direction:** `guesses_used` (a result key in `games.metadata`), lower is better, labelled `guesses`, counting **wins only** (`qualifying_outcomes=("win",)`) (`board` in `backend/daily_word/module.py`; `BOARDS.daily_word` in `frontend/src/api/vocab.ts`). A loss uses every guess and is never a best.
- **Tie-break:** none; the board is disabled.
- **Partitions:** none.
- **Recorded, not partitioned:** creation metadata (`DailyWordMetadata`): `puzzle_id` and `language` (`en` | `hi` | `fr` | `es`). Result (`DailyWordResult`): `is_complete`, `won`, `guesses_used`. The server raises a reported `guesses_used` to its own guess count for the puzzle, never lowers it (`reconcile_result`, #2541).
- **Max value:** none (`max_value` unset; `guesses_used` has no upper bound on purpose).
- **Outcomes:** `has_winner = True`. A solved puzzle records `win`, and running out of guesses records `loss`. An abandon (`abandoned`) is a started puzzle left unfinished: leaving the screen (`useGameSync`'s unmount abandon), or the old puzzle's session closed when a new day's puzzle loads (`resetToToday`). It carries the guesses made so far.
- **Duration:** `useGameSync`'s active-play window; Daily Word sends no duration of its own. The window runs from mount, so thinking time before the first guess counts.
- **How it reaches the server:** the `useGameSync("daily_word")` session row, opened at the first accepted guess (`POST /daily-word/guess` checks each guess). `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`, with `finalScore: null`, when the puzzle ends. The screen asks for no rank: `GET /games/{id}/rank` would answer `board_disabled`.
- **Where the player sees it:** the win / loss result card, which shows no leaderboard line, and Stats (`GameStatsScreen`, #2635, in the ⋯ menu): sessions, wins, losses, win rate and streaks, "Best" as the fewest guesses in a won puzzle, and time played. There is no Leaderboard entry point (`openableBoard` in `frontend/src/game/_shared/leaderboardAvailability.ts`). The daily challenge reads the result block (`backend/daily_challenge/definitions.py`).

## Daily lifecycle and rollover

The puzzle id is `YYYY-MM-DD:hi` for Hindi and `YYYY-MM-DD:en:<list version>` for English (currently `:en:2`), derived from the player's current UTC offset. The English id carries the answers-list version: replacing the list changes every date's answer, so the id changes with it (#3155). A client holding a board under the old `YYYY-MM-DD:en` id has it discarded as a stale save, and a guess sent with the old id is refused with `stale_puzzle_id`, which makes the client load today's puzzle. Old progress rows stay in `daily_word_progress` until retention prunes them; they are only read by id, so reconciling a game finished under the old id still works. Bump `_LIST_VERSION["en"]` in `puzzle.py` whenever `answers_en.txt` changes.

### Loading / resume

On mount the screen fetches today's puzzle metadata and loads any saved board.

- If the saved `puzzle_id` matches today, that board resumes.
- If it belongs to another day/language, the stale save is cleared and a fresh board is created.
- For network failures while loading, cached "today" metadata may be used when available. HTTP errors are not bypassed by cache fallback.
- **Offline with a cold cache (#2925):** a network failure with no cached metadata shows "Daily Word needs a connection" with a Retry button. Retry runs the same single load path as mount. Any other failure (HTTP error, unexpected exception) keeps the generic "Could not load today's puzzle" banner and never falls back to cache.
- **Cache warming (#2925):** Home calls `warmTodayMeta()` (`game/daily_word/todayMeta.ts`) once on mount, when connectivity returns, and when the app returns to the foreground, while online. It stores today's metadata under the same `localDateKey` the screen reads and skips the fetch when already cached, so the screen can open offline later the same day.
- **Decision:** Daily Word stays online-only. Showing a clear message and warming the cache is the whole scope; offline play and local scoring are tracked separately in #3022.
- An unfinished restored board resumes the corresponding shared game session.

### Upcoming puzzles for offline play (#3229)

`GET /daily-word/upcoming?lang=en|hi&tz_offset_minutes=<-840..840>` (no auth, 30/minute per IP) returns a JSON array of three entries for the device's local today, +1 and +2 days, using the same offset and `lang` rules as `/today` (an unsupported `lang` is a 422 `unsupported_language`): `[{"puzzle_id", "word_length", "answer_blob"}]`.

`answer_blob` is a light scramble so the answer is not plaintext in the response. It stops casual spoilers only; it is **not security** (anyone who knows this scheme can decode it, which #3022 accepted). Decode (`scramble_answer` in `backend/daily_word/puzzle.py`):

1. `key = SHA-256(UTF-8 bytes of puzzle_id)` (32 bytes), using the full id, e.g. `2026-10-13:en:2`.
2. `data = base64-decode(answer_blob)` (standard alphabet, padded).
3. `answer_bytes[i] = data[i] XOR key[i % 32]`.
4. `answer = UTF-8 decode(answer_bytes)` (Hindi answers are multi-byte; NFC already).

`word_length` is the answer's code-point count, as in `/today`. `/guess` and `/answer` are unchanged.

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

## Word lists and provenance

Lists live in `backend/daily_word/words/`. English is regenerated, not hand-edited, by `python backend/scripts/gen_english_words.py` (run from the repo root; needs network; sources are pinned by URL and SHA-256 and the script exits on a mismatch):

- `valid_en.txt` (accepted guesses): the 5-letter words of the public-domain ENABLE list.
- `answers_en.txt` (daily answers): common words from SCOWL 2020.12.07 (`english`/`american` word lists at size levels 10, 20, 35; no proper nouns, abbreviations or variants) that are also in ENABLE, minus inflected forms (plurals `-s`/`-es`/`-ies`, past tense `-ed`/`-ied`, `-ing`, and comparatives `-er`/`-ier`/`-est`, detected when stripping the suffix leaves an ENABLE word; ENABLE has no part of speech, so an explicit `INFLECTION_KEEP` list in the script rescues real standalone words such as pants, water, thing, greed) and the words in `answers_blocklist_en.txt` (offensive, bodily, crime/drug and proper-noun-like words; still accepted as guesses). Every answer is also a valid guess.
- Hindi lists: see `scripts/gen_hindi_valid_words.py`.

Licences and notices: [`ATTRIBUTION.md`](../../ATTRIBUTION.md). Changing `answers_en.txt` reshuffles every date's answer, so bump the English list version (see the puzzle id above) in the same change.

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

## Client

- Engine: `frontend/src/game/daily_word/engine.ts`
- Screen: [`frontend/src/screens/DailyWordScreen.tsx`](../../frontend/src/screens/DailyWordScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))

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
