import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useTheme, type Colors } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { LeaderboardSubmitStatus } from "../../game/_shared/useLeaderboardSubmit";
import DisplayNameField from "./DisplayNameField";
import { useIsScreenFocused } from "../../hooks/useIsScreenFocused";

/**
 * The one end-of-game result card every game uses (#2504, epic #2500).
 *
 * Games never build their own result screen: they pass data, and each slot
 * (stats, detail, submission line, second button) appears only when given.
 * Title text, colours, haptics, the scrim, Android back and the screen-reader
 * announcement are fixed here so every game ends the same way.
 */

export type GameOutcome = "win" | "loss" | "draw" | "ended";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export type ResultHero =
  | { kind: "score"; label: string; value: number | string }
  | { kind: "versus"; you: number | string; opponent: number | string; opponentLabel: string };

export interface ResultStat {
  label: string;
  value: number | string;
}

export interface ResultAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shown before the label; a disabled primary defaults to a clock. */
  icon?: IconName;
  accessibilityLabel?: string;
}

export interface ResultSubmission {
  status: LeaderboardSubmitStatus;
  /** The rank of the player's best entry on the board (#2633). */
  rank?: number | null;
  /**
   * Whether this game is that best entry. `false` shows "Your best: #N"
   * instead of this game's placing; omitted means it is.
   */
  isBest?: boolean | null;
  playerName?: string | null;
  /** Saves the name from the one-time prompt and sends the waiting score. */
  onProvideName?: (name: string) => Promise<boolean> | void;
  onRetry?: () => void;
}

export interface GameResultModalProps {
  visible: boolean;
  outcome: GameOutcome;
  /** For a loss against a named opponent: the title becomes "{{name}} Wins". */
  winnerName?: string;
  /** Small caps line above the title, e.g. "SUDOKU · HARD". */
  eyebrow?: string;
  /** The game's own line under the title, e.g. "Solved in 12:48". */
  subtitle?: string;
  hero?: ResultHero;
  /** Up to four; the strip is hidden when empty. */
  stats?: ResultStat[];
  isNewBest?: boolean;
  /** Game-specific content (Hearts standings, Yacht scorecard). */
  detail?: React.ReactNode;
  /** Omit for games without a leaderboard. */
  submission?: ResultSubmission;
  /**
   * Opens the game's leaderboard (#2633): a "View leaderboard" link under
   * the submission line, whatever its status. Pass `useLeaderboardLink`'s
   * result, which is undefined (no link) for a game without an openable board.
   */
  onViewLeaderboard?: (options?: { pendingSync?: boolean }) => void;
  /** Defaults to Play Again when `onPlayAgain` is given. */
  primaryAction?: ResultAction;
  onPlayAgain?: () => void;
  /** Change Difficulty / Mode / Layout / Level, Share … */
  secondaryAction?: ResultAction;
  /** Required: Home is on every card, and Android back goes Home. */
  onHome: () => void;
  /** Screen-reader label for Home when it does more than leave (e.g. cashes out). */
  homeLabel?: string;
  /**
   * A win celebration to play before the card. Render it and call `done` when
   * it ends or is tapped; the card appears then (or after a safety timeout).
   */
  celebration?: (done: () => void) => React.ReactNode;
  testID?: string;
}

/** Submission states where this game's rank isn't known yet (#2633). */
const RANK_PENDING: ReadonlySet<LeaderboardSubmitStatus> = new Set([
  "idle",
  "submitting",
  "offline",
]);

/** Safety net so a celebration that never calls `done` can't hide the card. */
export const CELEBRATION_MAX_MS = 4000;

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

/** Best-effort: a haptic that fails (sync or async) must never break the card. */
function fireHaptic(outcome: GameOutcome) {
  try {
    const run =
      outcome === "win"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : outcome === "loss"
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    run?.catch(() => undefined);
  } catch {
    // No haptics available (or a partial module): the card still shows.
  }
}

function formatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString() : value;
}

/** The card's title for an outcome ("You Win!", "{{name}} Wins", …). */
function useResultTitle(outcome: GameOutcome, winnerName?: string): string {
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
 * The outcome haptic and screen-reader announcement, once each time `active`
 * turns on. `GameResultModal` runs it when its card appears; a screen that
 * renders a `ResultCard` inline (Blackjack's Goal Reached) runs it on mount.
 */
export function useResultFeedback({
  active,
  outcome,
  winnerName,
  subtitle,
  hero,
}: {
  active: boolean;
  outcome: GameOutcome;
  winnerName?: string;
  subtitle?: string;
  hero?: ResultHero;
}) {
  const { t } = useTranslation("result");
  const title = useResultTitle(outcome, winnerName);
  const heroA11y =
    hero?.kind === "score"
      ? t("a11y.heroScore", { label: hero.label, value: formatValue(hero.value) })
      : hero?.kind === "versus"
        ? t("a11y.heroVs", {
            you: formatValue(hero.you),
            opponent: hero.opponentLabel,
            opponentScore: formatValue(hero.opponent),
          })
        : "";

  const announcedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      announcedRef.current = false;
      return;
    }
    if (announcedRef.current) return;
    announcedRef.current = true;
    fireHaptic(outcome);
    const detailText = [subtitle, heroA11y].filter(Boolean).join(". ");
    AccessibilityInfo.announceForAccessibility(
      detailText ? t("a11y.announce", { title, detail: detailText }) : title
    );
  }, [active, outcome, subtitle, heroA11y, title, t]);
}

export default function GameResultModal({
  visible,
  celebration,
  onHome,
  testID = "game-result",
  ...card
}: GameResultModalProps) {
  const { colors } = useTheme();

  // "celebrating" → the celebration plays in the screen, card hidden;
  // "card" → the Modal is shown. The card only mounts after the celebration
  // so a native Modal never covers the animation.
  const [phase, setPhase] = useState<"hidden" | "celebrating" | "card">("hidden");
  useEffect(() => {
    if (!visible) {
      setPhase("hidden");
      return;
    }
    setPhase(celebration ? "celebrating" : "card");
    // Only re-run when visibility flips; a new `celebration` closure each
    // render must not restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (phase !== "celebrating") return;
    const timer = setTimeout(() => setPhase("card"), CELEBRATION_MAX_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Announce + haptic once per appearance of the card.
  useResultFeedback({
    active: phase === "card",
    outcome: card.outcome,
    winnerName: card.winnerName,
    subtitle: card.subtitle,
    hero: card.hero,
  });

  // A native Modal is its own window: hide it while a screen pushed from the
  // card (the leaderboard, #2633) covers the game, and show it again, without
  // a second announcement, when the player comes back.
  const screenFocused = useIsScreenFocused();

  return (
    <>
      {phase === "celebrating" && celebration?.(() => setPhase("card"))}
      <Modal
        visible={phase === "card" && screenFocused}
        transparent
        animationType="fade"
        statusBarTranslucent
        accessibilityViewIsModal
        onRequestClose={onHome}
      >
        <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <ResultCard {...card} onHome={onHome} testID={testID} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

export type ResultCardProps = Omit<GameResultModalProps, "visible" | "celebration">;

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
              <Text style={[styles.statValue, { color: colors.text }]}>{formatValue(s.value)}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {detail ? <View style={styles.detail}>{detail}</View> : null}

      {submission ? (
        <SubmissionLine submission={submission} colors={colors} testID={`${testID}-submission`} />
      ) : null}
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
          <Text style={[styles.retryText, { color: colors.text }]}>
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
  if (hero.kind === "score") {
    return (
      <View style={styles.hero} accessible>
        <Text style={[styles.heroLabel, { color: colors.textMuted }]}>{hero.label}</Text>
        <Text style={[styles.heroValue, { color: colors.text }]}>{formatValue(hero.value)}</Text>
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
        {formatValue(value)}
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

/**
 * The line's testID is `${testID}-${state}`: `saving`, `ranked` (saved, with
 * a "#N" rank), `saved` (saved, no rank), `offline` or `error`. Native E2E
 * flows (Maestro, #2643) wait on a state without matching translated copy.
 */
function SubmissionLine({
  submission,
  colors,
  testID,
}: {
  submission: ResultSubmission;
  colors: Colors;
  testID: string;
}) {
  const { t } = useTranslation("result");
  const { status, rank, isBest, playerName, onProvideName, onRetry } = submission;

  // Nothing submitted yet (or this outcome isn't submitted), or the game is on
  // no board (#2677): no line at all.
  if (status === "idle" || status === "unranked") return null;

  if (status === "needsName") {
    return (
      <View style={[styles.namePrompt, { backgroundColor: colors.surfaceAlt }]}>
        <DisplayNameField
          testID="result-name-prompt"
          label={t("namePrompt.label")}
          helper={t("namePrompt.helper")}
          onSaved={(name) => {
            void onProvideName?.(name);
          }}
        />
      </View>
    );
  }

  let icon: IconName = "check";
  let text: string;
  let color = colors.textMuted;
  let state: string = status;
  switch (status) {
    case "saved":
      if (rank != null) state = "ranked";
      // The rank is always the player's best entry's (#2633): this game's
      // placing when it is that entry, else "Your best: #N".
      text =
        rank == null
          ? t("submission.saved", { name: playerName ?? "" })
          : isBest === false
            ? t("submission.savedBest", { name: playerName ?? "", rank })
            : t("submission.savedRanked", { name: playerName ?? "", rank });
      break;
    case "offline":
      icon = "cloud-off-outline";
      text = t("submission.offline");
      break;
    case "error":
      icon = "alert-circle-outline";
      text = t("submission.error");
      color = colors.error;
      break;
    case "submitting":
      icon = "cloud-upload-outline";
      text = t("submission.saving");
      state = "saving";
      break;
  }

  return (
    <View style={styles.submission}>
      <View
        testID={`${testID}-${state}`}
        style={styles.submissionLine}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole={status === "error" ? "alert" : "text"}
      >
        <MaterialCommunityIcons name={icon} size={16} color={color} />
        <Text style={[styles.submissionText, { color }]}>{text}</Text>
      </View>
      {status === "error" && onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("submission.retry")}
          hitSlop={8}
        >
          <Text style={[styles.retryText, { color: colors.text }]}>{t("submission.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PrimaryButton({ action, colors }: { action: ResultAction; colors: Colors }) {
  const disabled = !!action.disabled;
  const icon = action.icon ?? (disabled ? "clock-outline" : undefined);
  const fgColor = disabled ? colors.textMuted : colors.textOnAccent;
  return (
    <Pressable
      testID="game-result-primary"
      onPress={action.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        disabled
          ? {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
              borderWidth: 1.5,
              borderStyle: "dashed",
            }
          : { backgroundColor: colors.accentBright },
        { transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] },
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={18} color={fgColor} /> : null}
      <Text style={[styles.primaryText, { color: fgColor }]}>{action.label}</Text>
    </Pressable>
  );
}

function OutlineButton({
  action,
  colors,
  grow,
  testID,
}: {
  action: ResultAction;
  colors: Colors;
  grow?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={action.onPress}
      disabled={action.disabled}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ disabled: !!action.disabled }}
      style={({ pressed }) => [
        styles.button,
        styles.outline,
        grow ? styles.grow : styles.homeFixed,
        { borderColor: colors.textMuted, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {action.icon ? (
        <MaterialCommunityIcons name={action.icon} size={18} color={colors.text} />
      ) : null}
      <Text numberOfLines={1} style={[styles.outlineText, { color: colors.text }]}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
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
  namePrompt: { alignSelf: "stretch", padding: 14, borderRadius: 12 },
  submission: { alignItems: "center", gap: 6 },
  submissionLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submissionText: { fontFamily: typography.bodyMedium, fontSize: 13, textAlign: "center" },
  retryText: {
    fontFamily: typography.label,
    fontSize: 14,
    textDecorationLine: "underline",
  },
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
  button: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryText: { fontFamily: typography.label, fontSize: 16 },
  outline: { borderWidth: 1.5, backgroundColor: "transparent" },
  grow: { flex: 1, minWidth: 0 },
  homeFixed: { width: 118 },
  outlineText: { fontFamily: typography.label, fontSize: 16, flexShrink: 1 },
});
