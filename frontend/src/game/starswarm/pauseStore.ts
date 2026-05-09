import type { StarSwarmState } from "./types";
import type { DifficultyTier } from "./types";

interface SavedPauseState {
  gameState: StarSwarmState;
  difficulty: DifficultyTier;
}

let _saved: SavedPauseState | null = null;

export function savePausedState(state: SavedPauseState): void {
  _saved = state;
}

export function getSavedPausedState(): SavedPauseState | null {
  return _saved;
}

export function clearSavedPausedState(): void {
  _saved = null;
}
