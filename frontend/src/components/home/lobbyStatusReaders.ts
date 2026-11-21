/**
 * Which lobby tiles have a status, and how each is read (#4008).
 *
 * Only games that ship in every build are listed. The games in HIDDEN_GAMES
 * (`entitlements/gameVisibility.ts`) are never listed, so a store bundle holds none of their
 * storage code and the lobby never reads their keys. Each game's `lobbyStatus.ts` imports only
 * light code (its keys, shape check and the shared best), never an engine or a puzzle bank.
 *
 * Adding a game: give it a `lobbyStatus.ts` beside its storage and list it here.
 */
import type { TileStatus } from "../../game/_shared/lobbyStatus";

import { getLobbyStatus as yacht } from "../../game/yacht/lobbyStatus";
import { getLobbyStatus as twenty48 } from "../../game/twenty48/lobbyStatus";
import { getLobbyStatus as solitaire } from "../../game/solitaire/lobbyStatus";
import { getLobbyStatus as freecell } from "../../game/freecell/lobbyStatus";
import { getLobbyStatus as sudoku } from "../../game/sudoku/lobbyStatus";
import { getLobbyStatus as dailyWord } from "../../game/daily_word/lobbyStatus";

export type LobbyStatusReader = () => Promise<TileStatus | undefined>;

export const LOBBY_STATUS_READERS: Readonly<Record<string, LobbyStatusReader>> = {
  yacht,
  twenty48,
  solitaire,
  freecell,
  sudoku,
  daily_word: dailyWord,
  // Sort has none: its mid-level save is opened from the level grid's Continue, not by the tile,
  // and its bests are one per level (see docs/ARCHITECTURE.md, lobby tile status).
};
