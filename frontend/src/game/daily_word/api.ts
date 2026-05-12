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
