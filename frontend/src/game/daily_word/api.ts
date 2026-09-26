import { createGameClient } from "../_shared/httpClient";
import type { TileStatus } from "./types";

const request = createGameClient({ apiTag: "daily_word" });

export interface TodayResponse {
  readonly puzzle_id: string;
  readonly word_length: number;
}

export interface TileResult {
  readonly letter: string;
  readonly status: TileStatus;
}

export interface GuessResponse {
  readonly tiles: readonly TileResult[];
  /** Groupings of code-point indices into visual grapheme clusters. Present for Hindi only. */
  readonly grapheme_clusters?: readonly (readonly number[])[];
  /**
   * Server-side guess count for this session and puzzle (#2197). The server,
   * not the board, is the authority on how many guesses have been spent — a
   * recorded guess whose response was lost leaves the board one behind. The
   * screen stores `guesses_used` on the state (#2541). `guesses_remaining` is
   * not used to end the game: a 200 can be a replay, and carries no `solved`
   * flag. Both are absent when the server's record was unreachable (it
   * degrades open, #2542), and from an older API.
   */
  readonly guesses_used?: number;
  readonly guesses_remaining?: number;
}

export interface AnswerResponse {
  readonly answer: string;
}

export const dailyWordApi = {
  getToday: (tz_offset_minutes: number, lang: string) =>
    request<TodayResponse>(
      `/daily-word/today?tz_offset_minutes=${tz_offset_minutes}&lang=${encodeURIComponent(lang)}`
    ),
  submitGuess: (puzzle_id: string, guess: string, tz_offset_minutes: number) =>
    request<GuessResponse>("/daily-word/guess", {
      method: "POST",
      body: JSON.stringify({ puzzle_id, guess, tz_offset_minutes }),
    }),
  getAnswer: (puzzle_id: string) =>
    request<AnswerResponse>(`/daily-word/answer?puzzle_id=${encodeURIComponent(puzzle_id)}`),
};
