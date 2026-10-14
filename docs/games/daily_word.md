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

| Code | Language | Puzzle id         | Notes                                                                                            |
| ---- | -------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `en` | English  | `YYYY-MM-DD:en:2` |                                                                                                  |
| `hi` | Hindi    | `YYYY-MM-DD:hi`   |                                                                                                  |
| `fr` | French   | `YYYY-MM-DD:fr:1` | Backend only until #3241; lists come from #3239.                                                 |
| `es` | Spanish  | `YYYY-MM-DD:es:1` | Playable in the app since #3241 (internal and web builds; see "Keyboards and accented display"). |

### French and Spanish: accent folding and `display` (#3240)

The `fr` and `es` word files (`words/answers_<lang>.txt`, `valid_<lang>.txt`) hold one **display-form** word per line (`était`, `niño`), each with a unique fold key. `fold(word, lang)` (`backend/daily_word/normalize.py`) is applied both when the lists are loaded and to every guess: NFC, lowercase, strip combining marks, map `œ`->`oe` and `æ`->`ae`. In `es` the tilde on `n` is kept, so `ñ` is a distinct letter (`niño` is not `nino`). `en` is unaffected on `a-z` input, and Hindi is never folded (NFC only).

Validation, scoring, the stored guess record and the tile letters all use folded keys, so `ÉTAIT`, `était` and `etait` are the same accepted guess and score identically; the tile array is always 5 long. Responses add the list's own spelling:

- `POST /guess` adds `"display"` (the list's display form of the guessed word, not what the user typed) for `fr` and `es` only.
- `GET /answer` returns `{"answer": "<folded>", "display": "<accented>"}` for every language. For `en` and `hi`, `display` equals `answer`.
- `GET /upcoming` entries for `fr` and `es` add `display_blob`: the accented display form, scrambled exactly like `answer_blob` (same key, so the client decodes both the same way). `en` and `hi` entries have no `display_blob`.

If a language's list files are missing, it is not loaded and is unsupported: `/today` and `/upcoming` answer 422 `unsupported_language`, and `/guess` and `/answer` answer 422 `invalid_puzzle_id`. Import never fails. Bump `_LIST_VERSION[lang]` in `puzzle.py` whenever a list changes.

**Day offset.** The answer index is `(YYYYMMDD + SALT + _DAY_OFFSET[lang]) % len(answers)`. `en` and `hi` have offset 0, so their answers for existing dates are unchanged (pinned in `tests/test_daily_word_romance.py`); `fr` and `es` have their own offsets so the languages don't share an index pattern.

### Keyboards and accented display (#3241)

The puzzle language follows the app language through one function, `getLanguage()` (`todayMeta.ts`): the app language's base code if this build offers a puzzle in it, else `en`. So the `fr-CA` app language plays the `fr` puzzle and `es` plays `es`. Native (iOS/Android) store builds (#3150, `buildFlavour.ts`) offer only the launched languages (`en` for now), so `hi`, `fr` and `es` fall back to the English puzzle and QWERTY keyboard there; web, dev, e2e and pre-launch builds also offer them (#3153, #3241), mirroring `availableLocales`. `fr` and `es` stay out of `LAUNCHED_DAILY_WORD_LANGUAGES` until native sign-off (#3201).

**Keyboards** (`WordKeyboard.tsx`, `KEYBOARD_LAYOUTS`, one layout per puzzle language):

| Language   | Layout                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| `en`, `fr` | QWERTY (players in Canada use QWERTY, so French has no AZERTY)                  |
| `es`       | QWERTY plus an **Ñ** key after L on the middle row (ten keys, like the top row) |
| `hi`       | Devanagari, unchanged                                                           |

There are no accent keys and no long-press: players type plain letters (`a`-`z`, plus `ñ` for `es`) and the server folds the accents, so `etait` is a valid guess for `était`. Keys share a row's width by flex weight rather than a fixed size, so a ten-key row fits a 320 px phone; Enter/Delete shrink to fit on iOS/Android, and the fr and es labels use smaller type (10-11 px; en and hi stay 13 px). The keyboard colours keys on the folded letter (`keyboard_state` keys are the server's tile letters), so scoring `é` as correct colours the `E` key.

**Accented display.** The tile array from `/guess` is folded, and the tile colours come from it. After a guess is accepted, `tilesWithDisplay` (`engine.ts`) stores the response's `display` letter by letter on each tile as `TileState.display` (kept only when it differs from `letter`), and the row renders `É T A I T`. `letter` stays the folded form, so the "already guessed" check, the keyboard, scoring and the share grid are unaffected. If `display` does not have one letter per tile (a ligature such as `œ` folds to two letters), the row shows the folded letters. Saved boards store `display` with each tile, so a restored board shows accents (a board saved before #3241 has none and shows folded letters; `looksValid` does not inspect tiles). The loss card ("Le mot était ÉTAIT") reveals `display` from `GET /answer` (`revealWord`), upper-cased, falling back to `answer`. The share text is a letter-free emoji grid, so only its header changes: fr and es use the translated game title (`game.title`: "Mot du jour", "Palabra Diaria"); other languages keep "Daily Word". French and Spanish are not offline-playable (`OFFLINE_LANGUAGES` is `en`), but the offline cache already decodes `display_blob` like `answer_blob` (`offlinePuzzles.ts`: `display` on `OfflinePuzzle`, `offlineDisplayFor`) so the reveal is accented once they are.

Existing notes on language selection: The backend still accepts `hi`. A launched language is added by listing it in `LAUNCHED_DAILY_WORD_LANGUAGES`.

When a native store build falls back to English, any saved Hindi board (in progress or finished, even from the same day) is discarded: its `puzzle_id` ends `:hi`, no longer matches today's English puzzle, so a fresh English board starts and the Hindi board is pruned (`pruneStates`, #3230). This is the chosen "migrate to `en`" option; finishing the Hindi game is not supported. Server-side stats are keyed by puzzle and are untouched.

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
- Otherwise a fresh board is created, and boards saved for other days/languages are pruned (one board per puzzle since #3230).
- For network failures while loading, cached "today" metadata may be used when available. HTTP errors are not bypassed by cache fallback.
- **Offline with a cold cache (#2925):** a network failure with no cached metadata shows "Daily Word needs a connection" with a Retry button. Retry runs the same single load path as mount. Any other failure (HTTP error, unexpected exception) keeps the generic "Could not load today's puzzle" banner and never falls back to cache.
- **Cache warming (#2925):** Home calls `warmTodayMeta()` (`game/daily_word/todayMeta.ts`) once on mount, when connectivity returns, and when the app returns to the foreground, while online. It stores today's metadata under the same `localDateKey` the screen reads and skips the fetch when already cached, so the screen can open offline later the same day. The same call also stores the puzzles fetched ahead (`warmUpcoming`, see [Offline play](#offline-play-3230)).
- **Decision (superseded by #3230):** Daily Word was online-only until #3022 / #3230; English is now playable offline for up to 3 days (below). Hindi stays online-only.
- An unfinished restored board resumes the corresponding shared game session.
- **Saved boards (#3230):** one board per puzzle, under `daily_word_board_<puzzle_id>` (`storage.ts`; same payload as before). The load reads today's puzzle's board; the restore handler prunes every other puzzle's board (`pruneStates`), so another day's or another language's board never resumes. A board saved by an older build in the single `daily_word_state_v1` slot is moved to its puzzle's key on the first load and the old slot removed.

### Offline play (#3230)

Owner decisions: #3022 (answers may sit on the device if lightly scrambled) and #3043 (up to 3 days offline, no catch-up of past days, a day solved offline on that day counts toward the streak, the shared reconnect message after 3 days).

- **Fetch ahead.** While online, `warmTodayMeta` → `warmUpcoming` (`game/daily_word/offlinePuzzles.ts`) stores `GET /daily-word/upcoming` (today, +1, +2) under `daily_word_upcoming_<lang>`, skipping the fetch once the cache already reaches two days ahead. Only offline-playable languages are fetched (`OFFLINE_LANGUAGES` in `localScoring.ts`: `en`). The answers stay scrambled in storage and are decoded (`decodeAnswerBlob`, the scheme below; SHA-256 is plain TypeScript in `sha256.ts`, no native package) only for the puzzle being played.
- **Which puzzle.** When `/today` fails with a network error, the screen asks `resolveOfflinePuzzle` for the cached puzzle whose date is the device's local day. There is no catch-up: a past day's puzzle is never offered. If none is cached for today, or `offlineWindowExhausted()` (3 local days since the last 2xx, `lastConnected.ts`), the screen shows the shared message `common:offline.windowExhausted`, plus `common:offline.windowExhaustedStreak` when the last known streak (`lastKnownStreak.ts`) is above 0, with a Retry button. If nothing was ever fetched ahead and the window is not used up, the earlier behaviour applies (cached today metadata, else "Daily Word needs a connection"). HTTP errors never fall back to the cache.
- **Scoring on the device.** Every guess on a puzzle loaded offline is checked and scored in `useDailyWordSubmit` against the decoded answer: the same length and dictionary checks as `/guess` (the 422 toasts), then `scoreGuess` (`localScoring.ts`), which mirrors the server's `_score_guess` exactly, duplicate letters included. Valid guesses come from `validWordsEn.generated.ts`, the server's `valid_en.txt` ∪ `answers_en.txt` packed into one sorted string and binary-searched (about 43 KB of source; regenerate with `npx --prefix frontend tsx tools/generators/pack-daily-word-valid-en.ts`, and `__tests__/parity.test.ts` fails until you do). Hindi's list is 434 KB, so Hindi stays online-only. When online, guesses are still scored on the server; a guess whose request fails for want of a connection is scored on the device if its puzzle was fetched ahead, so a dropped connection mid-puzzle does not stall the board. A loss shows the decoded answer; `/answer` is not called.
- **Parity.** `backend/tests/fixtures/daily_word_parity.json` holds scoring cases (duplicate letters, a Hindi code-point case) and answer blobs. `backend/tests/test_daily_word_parity.py` checks the server's `_score_guess` and `scramble_answer` against it; `frontend/src/game/daily_word/__tests__/parity.test.ts` checks `scoreGuess` and `decodeAnswerBlob`.
- **Results and streaks.** An offline finish closes the `useGameSync("daily_word")` session exactly as an online one does (`win` / `loss` with `is_complete`, `won`, `guesses_used`), so it sits in `pending_games_v1` until `SyncWorker` sends it. The server has no guess record for an offline puzzle, so `reconcile_result` keeps the reported `guesses_used`. Streaks place a game on the local day of its device `completed_at` (`backend/daily_challenge/streak.py`), so a puzzle solved offline on its own day counts once it syncs (within the 7-day sync queue).
- **Rollover.** Play Again at local midnight takes the next day's cached puzzle when `/today` fails with a network error, or shows the reconnect message once the window is used up. Back online, Retry and Play Again load from the server as before.

### Upcoming puzzles for offline play (#3229)

`GET /daily-word/upcoming?lang=en|hi|fr|es&tz_offset_minutes=<-840..840>` (no auth, 30/minute per IP) returns a JSON array of three entries for the device's local today, +1 and +2 days, using the same offset and `lang` rules as `/today` (an unsupported `lang` is a 422 `unsupported_language`): `[{"puzzle_id", "word_length", "answer_blob"}]`; `fr`/`es` entries also carry `"display_blob"`.

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
2. if that succeeds, clear the old puzzle's saved board;
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

### French and Spanish word lists (#3239)

`answers_fr.txt`, `valid_fr.txt`, `answers_es.txt` and `valid_es.txt` are generated, not hand-edited, by:

```sh
python backend/scripts/gen_romance_words.py            # both languages
python backend/scripts/gen_romance_words.py --lang fr  # one language
```

Run it from the repo root; it needs network. Every source is pinned by URL and SHA-256 and the script exits on a mismatch. Sources were decided in #3198 (option 1):

- **French lemmas:** Littré headwords from Debian `stardict-xmlittre` 1:1.0-2 (public domain).
- **Spanish lemmas:** Debian `wspanish` 1.0.30 (public domain).
- **Ranking and attestation:** the full Google Books Ngram v3 (20200217) French and Spanish 1-gram shards (CC BY 3.0), counted over 1950-2019.

The Debian source tarballs are fetched from the `archive.ubuntu.com` pool, whose files match the Checksums-Sha256 in Debian's `.dsc` (signature not verified); `deb.debian.org` is not reachable from the build container. The Ngram shards are about 8 GB. They are streamed and hashed, and reduced to a small table of 5-letter words, which is cached outside the repo in `~/.cache/bc-arcade/ngram` (`--cache-dir`, or `--no-cache` to always stream). The local cache is trusted and not re-verified: it is only written after a verified download, so delete it if in doubt. Nothing is downloaded into the repo. The output is deterministic.

**File format (the contract for #3240 and #3241).** One word per line in its display form: lowercase NFC, with accents and `ñ` kept (`était`, `árbol`, `niño`). The generator imports the runtime's own `fold(word, lang)` from `backend/daily_word/normalize.py` (see above), so the lists and the game cannot disagree on a key. Every key is exactly 5 letters of `a`–`z`, plus `ñ` for `es`. Keys are unique in each file, and the files are sorted by key. Every answer is in the valid list with the same display form.

- **Valid guesses:** every 5-letter Littré or wspanish lemma, plus inflections that Ngram attests (at least `MIN_ATTEST` lowercase occurrences, written in lowercase more often than not, and not tagged mostly as foreign). The inflections are made by the script's own rules: plurals, French feminines (from Littré's `FRÉQUENT, ENTE` headwords or by rule), regular conjugations, the conjugations Littré's verb articles list, and a short table of Spanish irregular verbs.
- **Collisions:** when display forms share a key (`pêche`/`péché`), the one Ngram counts more often wins. Ties go to the form with more accents, then to code-point order. French also lets the later spelling of a Littré word compete, so `poème` beats Littré's `poëme`, and `cœur` beats `coeur`. `--show-collisions` prints every resolved collision.
- **Answers:** lemmas whose key is in the Ngram top 5,000 keys for the language, minus:
  - inflected forms (participles, plurals and feminines of another lemma, and verb forms that Ngram tags mostly as verbs);
  - proper-noun-like words (capitalized in most Ngram occurrences);
  - foreign words (tagged mostly `X` by Ngram);
  - archaisms that Littré labels;
  - the hand-curated quality exclusions in `backend/scripts/_romance_curation.py`;
  - the blocklists `answers_blocklist_fr.txt` and `answers_blocklist_es.txt`.
- **Blocklists:** hand-written folded keys, covering profanity and slurs, sexual and bodily words, drugs and alcohol, crime and violence, religion, and words that read as proper nouns. The generator reads them but never writes them. Blocklisted words stay valid guesses.

Sizes at #3239: French 1,254 answers and 5,532 valid guesses; Spanish 1,486 answers and 7,739 valid guesses. The French guesses are the tighter list, because Littré predates modern loanwords such as `radio`, `photo` and `vidéo`. The native-speaker review in #3201 checks both answer lists and both blocklists. The game serves them since #3240.

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
- the share text includes the emoji result grid and Daily Word deep link; its header is "Daily Word #n — x/6", with the translated game title for fr and es (#3241). The grid has no letters, so no answer or accent appears in it.

The UI only says "Copied" when a clipboard copy actually happened.

## Client

- Engine: `frontend/src/game/daily_word/engine.ts`
- Offline play (#3230): `offlinePuzzles.ts` (fetch-ahead cache, blob decoding, today's offline puzzle), `localScoring.ts` (`scoreGuess`, the bundled English list), `sha256.ts`, `validWordsEn.generated.ts`
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
