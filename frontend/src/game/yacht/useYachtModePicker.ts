/**
 * The Yacht pre-game mode picker's selection (#1129, #2981): Solo or VS, and
 * the VS difficulty, opened on the ones last played.
 *
 * The difficulty runs on the shared `useLastDifficulty`, like Sudoku, Hearts
 * and Star Swarm. Yacht's is stored with the last mode in its own preference
 * (`saveLastMode` / `loadLastMode`, key `yacht_pref_v1`), so that preference
 * is passed as the hook's store: a player's saved mode and difficulty keep
 * loading, and nothing moves to the shared `yacht.difficulty` slot.
 *
 * The stored difficulty is the one the last VS game started at, never one
 * merely tapped: Solo keeps it, so the next VS game still opens on it.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useLastDifficulty, type LastDifficultyStore } from "../_shared/lastDifficulty";
import { saveLastMode, loadLastMode } from "./storage";
import { AI_DIFFICULTIES } from "./types";
import type { AiDifficulty } from "./types";

export type YachtMode = "solo" | "vs";

export interface YachtModePicker {
  /** The mode the picker highlights: the one last played. */
  mode: YachtMode;
  /** The VS difficulty the picker shows. */
  difficulty: AiDifficulty;
  /** A difficulty tapped in the picker; stored only if VS is then played. */
  setDifficulty: (level: AiDifficulty) => void;
  /** Solo was chosen: stores it, keeping the last VS difficulty played. */
  chooseSolo: () => void;
  /** VS was chosen: stores it at the picker's difficulty, which it returns. */
  chooseVs: () => AiDifficulty;
  /** Re-opens the picker on what is stored, for the next game. */
  reload: () => Promise<void>;
}

const DEFAULT_DIFFICULTY: AiDifficulty = "medium";

export function useYachtModePicker(): YachtModePicker {
  const [mode, setMode] = useState<YachtMode>("solo");
  // The difficulty the last VS game started at, not one merely tapped.
  const lastVsRef = useRef<AiDifficulty>(DEFAULT_DIFFICULTY);

  const store = useMemo<LastDifficultyStore<AiDifficulty>>(
    () => ({
      // The mode comes back in the same read as the difficulty.
      load: async () => {
        const pref = await loadLastMode();
        if (!pref) return null;
        setMode(pref.mode);
        lastVsRef.current = pref.difficulty;
        return pref.difficulty;
      },
      save: (level) => saveLastMode("vs", level),
    }),
    []
  );

  const { difficulty, setDifficulty, rememberDifficulty } = useLastDifficulty<AiDifficulty>(
    "yacht",
    AI_DIFFICULTIES,
    DEFAULT_DIFFICULTY,
    { store }
  );

  const chooseSolo = useCallback(() => {
    void saveLastMode("solo", lastVsRef.current);
  }, []);

  const chooseVs = useCallback(() => {
    const started = rememberDifficulty(difficulty);
    lastVsRef.current = started;
    return started;
  }, [difficulty, rememberDifficulty]);

  const reload = useCallback(async () => {
    const pref = await loadLastMode();
    setMode(pref?.mode ?? "solo");
    setDifficulty(pref?.difficulty ?? DEFAULT_DIFFICULTY);
    lastVsRef.current = pref?.difficulty ?? DEFAULT_DIFFICULTY;
  }, [setDifficulty]);

  return { mode, difficulty, setDifficulty, chooseSolo, chooseVs, reload };
}
