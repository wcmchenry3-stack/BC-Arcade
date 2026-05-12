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
}
