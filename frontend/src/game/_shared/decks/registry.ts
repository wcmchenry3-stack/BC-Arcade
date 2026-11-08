import type { DeckTheme } from "./types";

/**
 * Dynamic imports — only the active deck's chunk ever loads.
 * Adding a new deck: add an entry here and register it in availableDecks.
 * No game code changes required.
 */
export const DECK_REGISTRY: Record<string, () => Promise<{ default: DeckTheme }>> = {
  minimal: () => import("./minimal"),
  classic: () => import("./classic"),
  neon: () => import("./neon"),
  // Flag-gated (deckFlag.ts, #3577): original in-house decks.
  arcade: () => import("./arcade"),
  parlor: () => import("./parlor"),
  synthwave: () => import("./synthwave"),
};

export const DEFAULT_DECK_ID = "classic";

/** Every registered deck. Callers filter with `isDeckSelectable` (deckFlag.ts) before listing or loading. */
export const AVAILABLE_DECK_IDS = Object.keys(DECK_REGISTRY);
