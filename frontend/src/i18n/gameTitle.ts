import type { TFunction } from "i18next";
import { GAME_TYPES } from "../api/vocab";

/**
 * Every game namespace carries a `game.title` key. Screens that label games by
 * their backend `game_type` (Profile, Game detail) pass these to
 * `useTranslation` alongside their own namespace.
 */
export const GAME_TITLE_NAMESPACES: readonly string[] = GAME_TYPES;

/** Localised display name for a backend `game_type`; unknown types fall back to the raw value. */
export function gameTitle(t: TFunction, gameType: string): string {
  return GAME_TITLE_NAMESPACES.includes(gameType) ? t(`${gameType}:game.title`) : gameType;
}
