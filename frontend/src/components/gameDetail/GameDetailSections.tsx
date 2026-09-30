import React from "react";
import { useTranslation } from "react-i18next";
import type { GameDetailResponse } from "../../api/types";
import { DetailCard, TableRow } from "./DetailCard";
import { gameFacts } from "./facts";
import { parseHeartsBreakdown, parseStarSwarmBreakdown, parseYachtBreakdown } from "./breakdowns";
import { HeartsSection } from "./HeartsSection";
import { StarSwarmSection } from "./StarSwarmSection";
import { YachtSection } from "./YachtSection";

type SectionRenderer = (detail: GameDetailResponse) => React.ReactElement | null;

/**
 * Games whose saved result can explain their score (#2840), keyed by
 * `game_type`. Each renders null when the game has no usable breakdown (a
 * result from before it was saved, or one the server dropped).
 */
export const BREAKDOWN_SECTIONS: Readonly<Record<string, SectionRenderer>> = {
  hearts: (d) => {
    const b = parseHeartsBreakdown(d.metadata ?? {});
    return b ? <HeartsSection breakdown={b} /> : null;
  },
  yacht: (d) => {
    const b = parseYachtBreakdown(d.metadata ?? {}, d.final_score);
    return b ? <YachtSection breakdown={b} /> : null;
  },
  starswarm: (d) => {
    const b = parseStarSwarmBreakdown(d.metadata ?? {}, d.final_score);
    return b ? <StarSwarmSection breakdown={b} /> : null;
  },
};

/**
 * The game-specific part of the detail screen, under the shared summary card:
 * the saved breakdown where the game has one (or a note that none was saved,
 * never a zeroed one), then the game's whitelisted facts.
 */
export function GameDetailSections({ detail }: { detail: GameDetailResponse }) {
  const { t } = useTranslation(["profile"]);
  const renderSection = BREAKDOWN_SECTIONS[detail.game_type];
  const section = renderSection ? renderSection(detail) : null;
  const facts = gameFacts(t, detail, { hasBreakdown: section != null });

  return (
    <>
      {section}
      {renderSection && section == null && (
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
