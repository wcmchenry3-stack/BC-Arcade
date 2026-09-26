export type TileStatus = "correct" | "present" | "absent" | "empty" | "tbd";
export type LetterStatus = "correct" | "present" | "absent" | "unused";

export interface TileState {
  letter: string;
  status: TileStatus;
}

export interface RowState {
  tiles: TileState[];
  submitted: boolean;
}

export interface DailyWordState {
  _v: 1;
  puzzle_id: string;
  word_length: number;
  language: string;
  rows: RowState[];
  current_row: number;
  keyboard_state: Record<string, LetterStatus>;
  is_complete: boolean;
  won: boolean;
  completed_at: string | null;
  /**
   * The server's count of guesses spent on this puzzle, when it has told us
   * (#2541). The board can fall behind the server — a recorded guess whose
   * response was lost never gets a row — so the board's own count is too low
   * exactly when it matters. Read it through `guessCount`, never directly.
   * Optional: saves from before #2541, and guesses scored while the server's
   * record was unreachable, carry no count.
   */
  guesses_used?: number;
}
