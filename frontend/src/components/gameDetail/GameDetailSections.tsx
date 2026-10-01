import React from "react";
import { useTranslation } from "react-i18next";
import type { GameDetailResponse } from "../../api/types";
import { DetailCard, TableRow } from "./DetailCard";
import { gameFacts } from "./facts";
import { parseHeartsBreakdown, parseStarSwarmBreakdown, parseYachtBreakdown } from "./breakdowns";
import { HeartsSection } from "./HeartsSection";
import { StarSwarmSection } from "./StarSwarmSection";
import { YachtSection } from "./YachtSection";

/** A rendered breakdown and the fact keys it already shows (so the facts list skips them). */
interface RenderedSection {
  readonly node: React.ReactElement;
  readonly covers: readonly string[];
}

type SectionRenderer = (detail: GameDetailResponse) => RenderedSection | null;

/**
 * Games whose saved result can explain their score (#2840), keyed by
 * `game_type`. Each renders null when the game has no usable breakdown (a
 * result from before it was saved, or one the server dropped).
 */
export const BREAKDOWN_SECTIONS: Readonly<Record<string, SectionRenderer>> = {
  hearts: (d) => {
    const b = parseHeartsBreakdown(d.metadata ?? {});
    return b ? { node: <HeartsSection breakdown={b} />, covers: [] } : null;
  },
  yacht: (d) => {
    const b = parseYachtBreakdown(d.metadata ?? {}, d.final_score);
    if (!b) return null;
    // The computer's score stays a fact when its card wasn't saved.
    const covers = ["upper_bonus", "yacht_bonus_total", ...(b.opponent ? ["opponent_score"] : [])];
    return { node: <YachtSection breakdown={b} />, covers };
  },
  starswarm: (d) => {
    const b = parseStarSwarmBreakdown(d.metadata ?? {}, d.final_score);
    return b ? { node: <StarSwarmSection breakdown={b} />, covers: [] } : null;
  },
};

/**
 * The game-specific part of the detail screen, under the shared summary card:
 * the saved breakdown where the game has one (or, for a finished game, a note
 * that none was saved, never a zeroed one), then the game's whitelisted facts.
 */
export function GameDetailSections({ detail }: { detail: GameDetailResponse }) {
  const { t } = useTranslation(["profile"]);
  const renderSection = BREAKDOWN_SECTIONS[detail.game_type];
  const section = renderSection ? renderSection(detail) : null;
  const facts = gameFacts(t, detail, new Set(section?.covers ?? []));
  // An unfinished game has no result yet, so nothing "wasn't saved".
  const showNoBreakdown = renderSection != null && section == null && detail.completed_at != null;

  return (
    <>
      {section?.node}
      {showNoBreakdown && (
        <DetailCard note={t("profile:detail.noBreakdown")} testID="detail-no-breakdown" />
      )}
      {facts.length > 0 && (
        <DetailCard title={t("profile:detail.factsTitle")} testID="detail-facts">
          {facts.map((f, i) => (
            <TableRow
              key={f.key}
              testID={`fact-${f.key}`}
              isLast={i === facts.length - 1}
              a11yLabel={t("profile:detail.cellA11y", { label: f.label, value: f.value })}
              cells={[f.label, f.value]}
            />
          ))}
        </DetailCard>
      )}
    </>
  );
}
