import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../../theme/ThemeContext";
import { formatMetric } from "../../api/outcomeDisplay";
import { formatNumber } from "../../api/statsDisplay";
import { DetailCard } from "./DetailCard";
import { splitSource, type StarSwarmBreakdown, type StarSwarmRow } from "./breakdowns";

/**
 * Localised names for the ledger's source keys (scoreLedger.ts). The source
 * set is open: the key is the engine's tier id, so a renamed or new tier
 * (Boss → Guardian) or modifier this build doesn't know shows its raw id.
 */
const KNOWN_BASES = new Set(["Grunt", "Elite", "Boss", "Guardian", "Carrier", "clear"]);
const KNOWN_MODS = new Set(["dive", "rout", "bomb", "ram"]);

export function starSwarmSourceLabel(t: TFunction, key: string): string {
  const { base, mod } = splitSource(key);
  const source = KNOWN_BASES.has(base) ? t(`profile:detail.starswarm.source.${base}`) : base;
  if (mod == null) return source;
  const modLabel = KNOWN_MODS.has(mod) ? t(`profile:detail.starswarm.mod.${mod}`) : mod;
  return t("profile:detail.starswarm.sourceWithMod", { source, mod: modLabel });
}

function rowLabel(t: TFunction, row: StarSwarmRow): string {
  return row.first === row.last
    ? t("profile:detail.starswarm.wave", { wave: formatNumber(t, row.first) })
    : t("profile:detail.starswarm.waves", {
        first: formatNumber(t, row.first),
        last: formatNumber(t, row.last),
      });
}

/**
 * Star Swarm's saved per-wave score (#2837): one row per scoring wave, with
 * its points and where they came from; waves folded into `earlier` are one
 * "Waves X–Y" row.
 */
export function StarSwarmSection({ breakdown }: { breakdown: StarSwarmBreakdown }) {
  const { t } = useTranslation(["profile", "stats"]);
  const { colors } = useTheme();

  const renderRow = (
    key: string,
    label: string,
    total: number,
    sources: StarSwarmRow["sources"],
    isLast: boolean
  ) => {
    const points = formatMetric(t, "score", total);
    const sourceTexts = sources.map((s) => ({
      key: s.key,
      label: starSwarmSourceLabel(t, s.key),
      value: formatNumber(t, s.points),
    }));
    const a11y = [
      t("profile:detail.cellA11y", { label, value: points }),
      ...sourceTexts.map((s) => t("profile:detail.cellA11y", { label: s.label, value: s.value })),
    ].join(", ");
    return (
      <View
        key={key}
        testID={`starswarm-row-${key}`}
        accessible
        accessibilityLabel={a11y}
        style={[
          styles.row,
          !isLast && {
            borderBottomColor: colors.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.rowHead}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
          <Text style={[styles.rowPoints, { color: colors.text }]}>{points}</Text>
        </View>
        {sourceTexts.length > 0 && (
          <View style={styles.chips}>
            {sourceTexts.map((s) => (
              <View
                key={s.key}
                style={[
                  styles.chip,
                  { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.chipText, { color: colors.textMuted }]}>
                  {`${s.label} ${s.value}`}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const rows = breakdown.rows.map((row, i) =>
    renderRow(
      row.first === row.last ? `${row.first}` : `${row.first}-${row.last}`,
      rowLabel(t, row),
      row.total,
      row.sources,
      i === breakdown.rows.length - 1 && breakdown.unattributed === 0
    )
  );

  return (
    <DetailCard
      title={t("profile:detail.starswarm.title")}
      note={breakdown.reconciled ? null : t("profile:detail.unreconciled")}
      testID="detail-starswarm"
    >
      {rows}
      {breakdown.unattributed !== 0 &&
        renderRow(
          "other",
          t("profile:detail.starswarm.unattributed"),
          breakdown.unattributed,
          [],
          true
        )}
    </DetailCard>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, paddingHorizontal: 4 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: 14, fontWeight: "700", flexShrink: 1, paddingRight: 8 },
  rowPoints: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, gap: 6 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 12, fontVariant: ["tabular-nums"] },
});
