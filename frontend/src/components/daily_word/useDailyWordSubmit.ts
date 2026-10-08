/**
 * useDailyWordSubmit — the Daily Word guess submission state machine (#2981).
 *
 * Owns one Enter press end to end: the local checks (too short, already
 * guessed), POST /daily-word/guess, applying the server's tiles, the flip
 * animation timer, closing the game session on a finish, and the recovery
 * branches for a refused guess:
 *   - 422 `not_a_word` / `wrong_guess_length` / other → a toast
 *   - 422 `stale_puzzle_id` → reload today's puzzle, then a toast
 *   - 429 → the rate-limit toast
 *   - 403 `no_guesses_remaining` / `already_solved` → trust the server and
 *     close the board out as a loss / win (#2197)
 *
 * The screen keeps the board, the flipping row and the result card; it hands
 * the hook setters for them. `setRevealPending` holds the card back while a
 * finished board is still flipping or fetching its answer, since the card's
 * visibility is derived from `state.is_complete`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import {
  applyServerResult,
  markComplete,
  sessionResult,
  withServerGuessCount,
} from "../../game/daily_word/engine";
import type { DailyWordState } from "../../game/daily_word/types";
import { dailyWordApi, type GuessResponse } from "../../game/daily_word/api";
import { saveState } from "../../game/daily_word/storage";
import { devLog } from "../../game/daily_word/devLog";
import { ApiError } from "../../game/_shared/httpClient";
import { recordedOutcome } from "../../game/_shared/recordedOutcome";
import type { UseGameSyncReturn } from "../../game/_shared/useGameSync";
import { FLIP_HALF_MS, TILE_STAGGER_MS } from "./WordTile";

/** Rapid double-taps inside this window are dropped (one rate-limit slot each). */
const SUBMIT_DEBOUNCE_MS = 500;
const MAX_ROWS = 6;
const GUESS_PATH = "/daily-word/guess";

/** The useGameSync calls a submission makes. */
export type DailyWordSubmitSync = Pick<
  UseGameSyncReturn,
  "start" | "markStarted" | "complete" | "getGameId"
>;

export interface DailyWordSubmitHandlers {
  /** The player's UTC offset, sent with each guess. */
  tzOffset: number;
  setState: (next: DailyWordState) => void;
  showToast: (message: string) => void;
  /** The row whose tiles are flipping, or null when the flip is over. */
  setFlippingRowIndex: (row: number | null) => void;
  /** True while a finished board must not show its result card yet. */
  setRevealPending: (pending: boolean) => void;
  /** The answer, upper-cased, for the loss card. */
  setAnswer: (answer: string) => void;
  /** Start the next-puzzle countdown once a result is revealed. */
  startCountdown: () => void;
  /** The win fanfare. */
  playWin: () => void;
  /** Load today's puzzle in place of the current one (stale_puzzle_id). */
  resetToToday: () => Promise<"ok" | "same" | "failed">;
}

export interface DailyWordSubmit {
  submit: () => Promise<void>;
  submitting: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A finished puzzle is a win or a loss on the games row (#2517), not just "completed". */
function finishedOutcome(state: { won: boolean }) {
  return recordedOutcome(state.won ? "win" : "loss");
}

function rowWord(row: DailyWordState["rows"][number]): string {
  return row.tiles.map((tile) => tile.letter).join("");
}

function heavyHaptic(): Promise<void> {
  return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

/** Opens the puzzle's session if none is open, and marks it started. */
function ensureSession(sync: DailyWordSubmitSync, s: DailyWordState): void {
  if (!sync.getGameId()) {
    sync.start({ puzzle_id: s.puzzle_id }, { puzzle_id: s.puzzle_id, language: s.language });
  }
  sync.markStarted();
}

/**
 * Closes the session for a finished board. Daily Word has no numeric score:
 * final_score stays null and the challenge reads the result block instead.
 */
function completeSession(sync: DailyWordSubmitSync, finished: DailyWordState): void {
  const summary = sessionResult(finished);
  sync.complete({ finalScore: null, outcome: finishedOutcome(finished), result: summary }, summary);
}

/** The guess in the current row, or the i18n key of the local check it fails. */
function checkGuess(s: DailyWordState): { guess: string } | { refusal: string } | null {
  const row = s.rows[s.current_row];
  if (!row) return null;
  const guess = rowWord(row);
  const filled = row.tiles.filter((tile) => tile.letter !== "").length;
  if (filled < s.word_length) return { refusal: "error.tooShort" };

  // #2197 — a word already on the board must not be submitted again. The
  // server treats a repeat of a recorded guess as a replay (so a re-send
  // after a lost response cannot rob a turn), which means a *deliberate*
  // repeat would advance the board without spending a server-side guess.
  // Six rows and five recorded guesses would then leave the player short of
  // the answer they earned.
  const alreadyGuessed = s.rows
    .slice(0, s.current_row)
    .some((r) => r.submitted && rowWord(r) === guess);
  if (alreadyGuessed) return { refusal: "error.alreadyGuessed" };
  return { guess };
}

/** A 403 saying the server has this puzzle finished (#2197). */
function isServerFinished(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.message === "no_guesses_remaining" || err.message === "already_solved")
  );
}

/** The toast for a refusal that only needs one (not stale_puzzle_id, not a finished 403). */
function refusalToastKey(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) {
    if (err.message === "not_a_word") return "error.notAWord";
    if (err.message === "wrong_guess_length") return "error.wrongLength";
  }
  if (err instanceof ApiError && err.status === 429) return "error.rateLimited";
  return "error.couldNotSubmit";
}

function logGuess(
  ts: number,
  body: Record<string, unknown> | undefined,
  outcome: { response: GuessResponse } | { err: unknown }
): void {
  if (!__DEV__) return;
  if ("response" in outcome) {
    devLog.push({
      ts,
      method: "POST",
      path: GUESS_PATH,
      body,
      status: 200,
      response: outcome.response,
    });
    return;
  }
  const { err } = outcome;
  devLog.push({
    ts,
    method: "POST",
    path: GUESS_PATH,
    body,
    status: err instanceof ApiError ? err.status : undefined,
    error: err instanceof ApiError ? err.message : String(err),
  });
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** What applying a guess outcome needs from the hook and the screen. */
interface OutcomeContext {
  sync: DailyWordSubmitSync;
  setState: (next: DailyWordState) => void;
  setFlippingRowIndex: (row: number | null) => void;
  setRevealPending: (pending: boolean) => void;
  setAnswer: (answer: string) => void;
  startCountdown: () => void;
  playWin: () => void;
  isMounted: () => boolean;
}

/**
 * A 200: apply the tiles, close a finished game out, flip the row, then
 * reveal the result. Returns the flip timer.
 */
function applyAccepted(
  ctx: OutcomeContext,
  s: DailyWordState,
  result: GuessResponse
): ReturnType<typeof setTimeout> {
  const tileStates = result.tiles.map((tile) => ({ letter: tile.letter, status: tile.status }));

  // #2541 — keep the server's count on the state; `guessCount` reads it.
  const afterApply = withServerGuessCount(applyServerResult(s, tileStates), result.guesses_used);
  const won = tileStates.every((tile) => tile.status === "correct");
  // Deliberately the board's rows, not the server's `guesses_remaining`
  // (#2541 review). A 200 can be a replay of a recorded guess — on a
  // puzzle the server has as solved, or on a wiped board — and the 200
  // carries no `solved` flag, so ending the game here would record a
  // loss for a win, or a fresh completion for a finished puzzle. A board
  // that is behind reaches its next guess, which the server refuses with
  // a 403 that closeOutFromServer handles, guards included.
  const outOfGuesses = !won && afterApply.current_row >= MAX_ROWS;

  ensureSession(ctx.sync, s);

  const finalState = won || outOfGuesses ? markComplete(afterApply, won) : afterApply;
  if (finalState.is_complete) {
    completeSession(ctx.sync, finalState);
    // The card waits for the flip (and, on a loss, the answer).
    ctx.setRevealPending(true);
  }

  ctx.setState(finalState);

  // Trigger flip animation for the submitted row
  ctx.setFlippingRowIndex(s.current_row);

  const totalFlipMs = s.word_length * TILE_STAGGER_MS + FLIP_HALF_MS * 2;
  return setTimeout(async () => {
    ctx.setFlippingRowIndex(null);
    if (!finalState.is_complete) return;
    if (finalState.won) {
      ctx.playWin();
    } else {
      try {
        const answerData = await dailyWordApi.getAnswer(s.puzzle_id);
        ctx.setAnswer(answerData.answer.toUpperCase());
      } catch {
        // show modal without answer
      }
    }
    ctx.setRevealPending(false);
    ctx.startCountdown();
  }, totalFlipMs);
}

/**
 * #2197 — the server says this puzzle is finished and the local board
 * disagrees, which happens when a guess was recorded but its response
 * never arrived. Trust the server: close the game out and reveal the
 * answer it will now release, rather than stranding the player on a
 * board that can never complete. Resolves false when the player left
 * before the loss card could open.
 */
async function closeOutFromServer(
  ctx: OutcomeContext,
  current: DailyWordState | null,
  err: ApiError
): Promise<boolean> {
  // Same guard as the success path: the player may have left while the
  // guess was in flight, in which case useGameSync's unmount cleanup has
  // already run and there is nothing left to close out.
  if (!ctx.isMounted()) return false;
  if (!current) return true;
  // `already_solved` means the server recorded a winning guess — the
  // player won, and only the response was lost. Marking that a loss
  // would persist won:false and show them the word they had already
  // found.
  const wonIt = err.message === "already_solved";
  // The board is behind the server here by definition — that is why
  // this 403 happened — so its row count is too low. Take the
  // server's count from the refusal (#2541); `guessCount` falls back
  // to the board if an older API sent none.
  const finished = markComplete(withServerGuessCount(current, err.body?.guesses_used), wonIt);

  // Only report a session this visit actually played. `already_solved`
  // is returned for *any* guess on a puzzle this session finished at
  // any earlier time, and the board can be missing independently of
  // the session id — they are separate AsyncStorage keys
  // (`daily_word_state_v1` vs `game_session_id`), and loadState drops
  // only the board on a corrupt payload. Without this guard, opening a
  // wiped board and typing one word would fabricate a completed game
  // for a puzzle finished hours ago, with a guesses_used taken from an
  // empty board — free XP and a free "win in N guesses" goal credit.
  const playedThisVisit = current.rows.some((r) => r.submitted);
  if (playedThisVisit) {
    // The session must be completed, or the unmount cleanup reports
    // outcome:"abandoned" — and abandoned games earn no
    // daily-challenge credit, no streak day and no XP (#2468/#2472).
    ensureSession(ctx.sync, current);
    completeSession(ctx.sync, finished);
  }

  // A loss holds its card back until the answer fetch settles; a win
  // shows it at once.
  if (!wonIt) ctx.setRevealPending(true);
  ctx.setState(finished);
  saveState(finished).catch(() => {});

  if (wonIt) {
    // A wiped board reopening a puzzle finished earlier is a restore,
    // not a solve this visit revealed: no fanfare.
    if (playedThisVisit) ctx.playWin();
  } else {
    try {
      const answerData = await dailyWordApi.getAnswer(finished.puzzle_id);
      if (ctx.isMounted()) ctx.setAnswer(answerData.answer.toUpperCase());
    } catch {
      // Modal still opens; it just won't reveal the word.
    }
    if (!ctx.isMounted()) return false;
    ctx.setRevealPending(false);
  }
  ctx.startCountdown();
  return true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDailyWordSubmit(
  stateRef: MutableRefObject<DailyWordState | null>,
  sync: DailyWordSubmitSync,
  handlers: DailyWordSubmitHandlers
): DailyWordSubmit {
  const { t } = useTranslation("daily_word");
  const [submitting, setSubmitting] = useState(false);
  const lastSubmitMsRef = useRef(0);
  const mountedRef = useRef(true);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { start, markStarted, complete, getGameId } = sync;
  const { tzOffset, showToast, resetToToday } = handlers;
  const { setState, setFlippingRowIndex, setRevealPending } = handlers;
  const { setAnswer, startCountdown, playWin } = handlers;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    };
  }, []);

  const ctx = useMemo<OutcomeContext>(
    () => ({
      sync: { start, markStarted, complete, getGameId },
      setState,
      setFlippingRowIndex,
      setRevealPending,
      setAnswer,
      startCountdown,
      playWin,
      isMounted: () => mountedRef.current,
    }),
    [
      start,
      markStarted,
      complete,
      getGameId,
      setState,
      setFlippingRowIndex,
      setRevealPending,
      setAnswer,
      startCountdown,
      playWin,
    ]
  );

  /** A refused guess: the 403/422/429 recovery branches. */
  const recover = useCallback(
    async (err: unknown) => {
      if (err instanceof ApiError && err.status === 422 && err.message === "stale_puzzle_id") {
        const recovered = (await resetToToday()) === "ok";
        showToast(recovered ? t("error.stalePuzzle") : t("error.couldNotLoad"));
      } else if (isServerFinished(err)) {
        if (!(await closeOutFromServer(ctx, stateRef.current, err))) return;
      } else {
        showToast(t(refusalToastKey(err)));
      }
      await heavyHaptic();
    },
    [resetToToday, showToast, t, ctx, stateRef]
  );

  const submit = useCallback(async () => {
    const s = stateRef.current;
    if (!s || submitting || s.is_complete) return;

    // Debounce rapid double-taps (e.g. two Enter presses within 500 ms) so they
    // don't consume a rate-limit slot without advancing the game.
    const now = Date.now();
    if (now - lastSubmitMsRef.current < SUBMIT_DEBOUNCE_MS) return;
    lastSubmitMsRef.current = now;

    const checked = checkGuess(s);
    if (!checked) return;
    if ("refusal" in checked) {
      showToast(t(checked.refusal));
      await heavyHaptic();
      return;
    }
    const { guess } = checked;

    const devTs = __DEV__ ? Date.now() : 0;
    const devBody = __DEV__
      ? { puzzle_id: s.puzzle_id, guess, tz_offset_minutes: tzOffset }
      : undefined;

    setSubmitting(true);
    try {
      const result = await dailyWordApi.submitGuess(s.puzzle_id, guess, tzOffset);
      logGuess(devTs, devBody, { response: result });
      // The player left while the guess was in flight. useGameSync's unmount
      // cleanup has already run, so opening a session now would leave one that
      // nothing ever completes or abandons.
      if (!mountedRef.current) return;
      flipTimerRef.current = applyAccepted(ctx, s, result);
    } catch (err) {
      logGuess(devTs, devBody, { err });
      await recover(err);
    } finally {
      setSubmitting(false);
    }
  }, [stateRef, submitting, showToast, t, tzOffset, ctx, recover]);

  return { submit, submitting };
}
