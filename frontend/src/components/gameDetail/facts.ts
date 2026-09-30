/**
 * The compact "facts" of a finished game (#2840): a per-game whitelist of the
 * numbers its saved result already carries (Sort's moves and undos, 2048's
 * highest tile, Cascade's drops and merges, …). Keys not listed here are never
 * shown, so a result field added later never leaks onto the screen as raw
 * data, and no per-action history is invented.
 */

import type { TFunction } from "i18next";
import type { GameRow } from "../../api/types";
import { formatMetric } from "../../api/outcomeDisplay";
import { formatNumber } from "../../api/statsDisplay";

export interface FactDef {
  /** The `metadata` key the saved result stores it under. */
  readonly key: string;
  /** Full i18n key (with namespace) of its label. */
  readonly labelKey: string;
  /** "chips" formats with the chips unit; default is a bare number. */
  readonly unit?: "chips";
}

export const GAME_FACTS: Readonly<Record<string, readonly FactDef[]>> = {
  // Hidden while the scorecard shows them (the section's `covers`).
  yacht: [
    { key: "upper_bonus", labelKey: "yacht:score.bonusLabel" },
    { key: "yacht_bonus_total", labelKey: "yacht:bonus.yachtLabel" },
    { key: "opponent_score", labelKey: "profile:detail.fact.opponentScore" },
  ],
  hearts: [{ key: "hands_played", labelKey: "profile:detail.fact.handsPlayed" }],
  starswarm: [{ key: "wave_reached", labelKey: "profile:detail.fact.waveReached" }],
  sort: [
    { key: "moves", labelKey: "profile:detail.fact.moves" },
    { key: "undos", labelKey: "profile:detail.fact.undos" },
  ],
  twenty48: [
    { key: "highest_tile", labelKey: "twenty48:stats.highestTile" },
    { key: "move_count", labelKey: "profile:detail.fact.moves" },
  ],
  cascade: [
    { key: "total_drops", labelKey: "profile:detail.fact.drops" },
    { key: "total_merges", labelKey: "profile:detail.fact.merges" },
  ],
  blackjack: [
    { key: "hands_played", labelKey: "profile:detail.fact.handsPlayed" },
    { key: "hands_won", labelKey: "profile:detail.fact.handsWon" },
    { key: "starting_chips", labelKey: "profile:detail.fact.startingChips", unit: "chips" },
    { key: "final_chips", labelKey: "profile:detail.fact.finalChips", unit: "chips" },
  ],
  solitaire: [{ key: "moves", labelKey: "profile:detail.fact.moves" }],
  freecell: [{ key: "moves", labelKey: "profile:detail.fact.moves" }],
  sudoku: [{ key: "errors", labelKey: "profile:detail.fact.errors" }],
  mahjong: [{ key: "pairs", labelKey: "profile:detail.fact.pairs" }],
};

export interface Fact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/**
 * The whitelisted facts `game` carries, labelled and formatted. A value that
 * isn't a finite number is skipped, never shown as 0. `covered` holds the
 * keys the game's breakdown section already shows (Yacht's bonuses on its card).
 */
export function gameFacts(
  t: TFunction,
  game: Pick<GameRow, "game_type" | "metadata">,
  covered: ReadonlySet<string> = new Set()
): Fact[] {
  const defs = GAME_FACTS[game.game_type] ?? [];
  const facts: Fact[] = [];
  for (const def of defs) {
    if (covered.has(def.key)) continue;
    const raw = game.metadata?.[def.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    facts.push({
      key: def.key,
      label: t(def.labelKey),
      value: def.unit === "chips" ? formatMetric(t, "chips", raw) : formatNumber(t, raw),
    });
  }
  return facts;
}
