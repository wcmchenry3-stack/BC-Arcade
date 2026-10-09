import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { OutlineButton, PrimaryButton } from "./resultButtons";
import { SubmissionLine } from "./SubmissionLine";
import {
  formatValue,
  RANK_PENDING,
  type GameOutcome,
  type IconName,
  type ResultAction,
  type ResultCardProps,
  type ResultHero,
} from "./resultTypes";

const OUTCOME_ICON: Record<GameOutcome, IconName> = {
  win: "trophy-outline",
  loss: "minus-circle-outline",
  draw: "equal",
  ended: "flag-outline",
};

function outcomeColors(colors: Colors, outcome: GameOutcome) {
  switch (outcome) {
    case "win":
      return { fg: colors.outcomeWin, tint: colors.outcomeWinTint };
    case "loss":
      return { fg: colors.outcomeLoss, tint: colors.outcomeLossTint };
    case "draw":
      return { fg: colors.outcomeDraw, tint: colors.outcomeDrawTint };
    case "ended":
      return { fg: colors.outcomeEnded, tint: colors.outcomeEndedTint };
  }
}

/** The card's title for an outcome ("You Win!", "{{name}} Wins", …). */
export function useResultTitle(outcome: GameOutcome, winnerName?: string): string {
  const { t } = useTranslation("result");
  return outcome === "win"
    ? t("title.win")
    : outcome === "loss"
      ? winnerName
        ? t("title.lossNamed", { name: winnerName })
        : t("title.loss")
      : outcome === "draw"
        ? t("title.draw")
        : t("title.ended");
}

/**
 * The card itself — outcome stripe, icon, title, hero, stats, detail,
 * submission line and the button row — for a screen that shows a result
 * inline instead of in the modal (Blackjack's Goal Reached, #2507). Pair it
 * with `useResultFeedback` for the haptic and announcement.
 */
export function ResultCard({
  outcome,
  winnerName,
  eyebrow,
  subtitle,
  hero,
  stats,
  isNewBest,
  detail,
  submission,
  onViewLeaderboard,
  primaryAction,
  onPlayAgain,
  secondaryAction,
  onHome,
  homeLabel,
  testID = "game-result",
}: ResultCardProps) {
  const { t } = useTranslation("result");
  const { colors, theme } = useTheme();
  const { fg, tint } = outcomeColors(colors, outcome);
  const title = useResultTitle(outcome, winnerName);

  const primary: ResultAction | undefined =
    primaryAction ??
    (onPlayAgain ? { label: t("action.playAgain"), onPress: onPlayAgain } : undefined);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceHigh,
          borderColor: colors.border,
          borderWidth: theme === "light" ? 1 : 0,
          // After borderWidth: on web a later borderWidth would
          // otherwise zero the outcome stripe.
          borderTopWidth: 5,
          borderTopColor: fg,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconDisc, { backgroundColor: tint }]}>
          <MaterialCommunityIcons name={OUTCOME_ICON[outcome]} size={26} color={fg} />
        </View>
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: colors.textMuted }]}>{eyebrow}</Text>
        ) : null}
        <Text
          testID={`${testID}-title`}
          accessibilityRole="header"
          style={[styles.title, { color: fg }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>

      {hero ? (
        <Hero
          hero={hero}
          outcome={outcome}
          colors={colors}
          youLabel={t("hero.you")}
          vsLabel={t("hero.vs")}
        />
      ) : null}
      {isNewBest ? (
        <View style={[styles.badge, { backgroundColor: colors.outcomeWinTint }]}>
          <Text style={[styles.badgeText, { color: colors.outcomeWin }]}>{t("newBest")}</Text>
        </View>
      ) : null}

      {stats && stats.length > 0 ? (
        <View style={[styles.stats, { backgroundColor: colors.surfaceAlt }]}>
          {stats.slice(0, 4).map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {formatValue(t, s.value)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {detail ? <View style={styles.detail}>{detail}</View> : null}

      {submission ? <SubmissionLine submission={submission} colors={colors} /> : null}
      {onViewLeaderboard ? (
        <Pressable
          testID={`${testID}-leaderboard`}
          // While the rank is still pending the game may not be on the
          // server yet: the board refetches once it has synced.
          onPress={() =>
            onViewLeaderboard({
              pendingSync: submission ? RANK_PENDING.has(submission.status) : false,
            })
          }
          accessibilityRole="link"
          accessibilityLabel={t("action.viewLeaderboard")}
          hitSlop={8}
          style={({ pressed }) => [styles.leaderboardLink, { opacity: pressed ? 0.7 : 1 }]}
        >
          <MaterialCommunityIcons name="podium" size={16} color={colors.text} />
          <Text style={[styles.linkText, { color: colors.text }]}>
            {t("action.viewLeaderboard")}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        {primary ? <PrimaryButton action={primary} colors={colors} /> : null}
        <View style={styles.secondaryRow}>
          {secondaryAction ? <OutlineButton action={secondaryAction} colors={colors} grow /> : null}
          <OutlineButton
            action={{
              label: t("action.home"),
              onPress: onHome,
              icon: "home-outline",
              accessibilityLabel: homeLabel,
            }}
            colors={colors}
            grow={!secondaryAction}
            testID={`${testID}-home`}
          />
        </View>
      </View>
    </View>
  );
}

/** The big number (or you-versus-opponent pair) under the title. */
function Hero({
  hero,
  outcome,
  colors,
  youLabel,
  vsLabel,
}: {
  hero: ResultHero;
  outcome: GameOutcome;
  colors: Colors;
  youLabel: string;
  vsLabel: string;
}) {
  const { t } = useTranslation("result");
  if (hero.kind === "score") {
    return (
      <View style={styles.hero} accessible>
        <Text style={[styles.heroLabel, { color: colors.textMuted }]}>{hero.label}</Text>
        <Text style={[styles.heroValue, { color: colors.text }]}>{formatValue(t, hero.value)}</Text>
      </View>
    );
  }
  const youLead = outcome !== "loss";
  const oppLead = outcome !== "win";
  const side = (label: string, value: number | string, lead: boolean) => (
    <View style={styles.versusSide}>
      <Text style={[styles.heroLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text
        style={[
          styles.versusValue,
          { color: lead ? colors.text : colors.textMuted, opacity: lead ? 1 : 0.85 },
        ]}
      >
        {formatValue(t, value)}
      </Text>
    </View>
  );
  return (
    <View style={styles.versus} accessible>
      {side(youLabel, hero.you, youLead)}
      <Text style={[styles.versusVs, { color: colors.textMuted }]}>{vsLabel}</Text>
      {side(hero.opponentLabel, hero.opponent, oppLead)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    gap: 18,
    paddingTop: 28,
    paddingHorizontal: 22,
    paddingBottom: 20,
    borderRadius: 22,
  },
  header: { alignItems: "center", gap: 10 },
  iconDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontFamily: typography.label,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    textAlign: "center",
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 32,
    lineHeight: 36,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: typography.bodyMedium,
    fontSize: 15,
    textAlign: "center",
  },
  hero: { alignItems: "center", gap: 6 },
  heroLabel: {
    fontFamily: typography.label,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  heroValue: { fontFamily: typography.heading, fontSize: 52, lineHeight: 56 },
  versus: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", gap: 8 },
  versusSide: { flex: 1, alignItems: "center", gap: 4 },
  versusValue: { fontFamily: typography.heading, fontSize: 44, lineHeight: 48 },
  versusVs: { fontFamily: typography.headingLight, fontSize: 18 },
  badge: { marginTop: -8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: {
    fontFamily: typography.label,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stats: { flexDirection: "row", alignSelf: "stretch", borderRadius: 12 },
  stat: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 10, paddingHorizontal: 4 },
  statValue: { fontFamily: typography.heading, fontSize: 18 },
  statLabel: { fontFamily: typography.bodyMedium, fontSize: 12, textAlign: "center" },
  detail: { alignSelf: "stretch" },
  leaderboardLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    marginTop: -8,
    paddingHorizontal: 8,
  },
  actions: { alignSelf: "stretch", gap: 10 },
  secondaryRow: { flexDirection: "row", gap: 10 },
  linkText: {
    fontFamily: typography.label,
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
