/**
 * TableDock — the bottom of the Blackjack table (#3580): one control set at a time.
 *
 *   - betting: the chip tray, Clear and Deal;
 *   - playing: Hit, Stand, Double, Split (ActionButtons, "dock" variant);
 *   - after the result: the chip tray, Change, Rebet and 2×.
 *
 * Every button is live only when the engine would accept what it does: the
 * bet rules are in game/blackjack/betRules.ts. The dock owns no game state;
 * the screen passes the bet being built and the handlers.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import ChipButton from "./ChipButton";
import { labelOnFill } from "./tableAccentText";
import { DOCK_BUTTON_HEIGHT, DOCK_CHIP_SIZE, DOCK_GAP } from "../../game/blackjack/layout";

interface TrayProps {
  chips: readonly number[];
  /** True when this chip can be added (the bet stays legal). */
  canAdd: (chip: number) => boolean;
  onChip: (chip: number) => void;
}

export function ChipTray({ chips, canAdd, onChip }: TrayProps) {
  const { colors } = useTheme();
  const palette = [colors.accent, colors.secondary, colors.tertiary, colors.error] as const;
  return (
    <View style={styles.tray}>
      {chips.map((chip, i) => (
        <ChipButton
          key={chip}
          amount={chip}
          size={DOCK_CHIP_SIZE}
          onPress={() => onChip(chip)}
          disabled={!canAdd(chip)}
          chipColor={palette[i % palette.length]!}
          textColor={colors.textOnAccent}
        />
      ))}
    </View>
  );
}

interface DockButtonProps {
  label: string;
  amount?: number;
  onPress: () => void;
  disabled?: boolean;
  kind: "primary" | "secondary" | "plain" | "danger";
  accessibilityLabel: string;
  flex: number;
  testID?: string;
  accentColor: string;
}

export function DockButton({
  label,
  amount,
  onPress,
  disabled = false,
  kind,
  accessibilityLabel,
  flex,
  testID,
  accentColor,
}: DockButtonProps) {
  const { colors, theme } = useTheme();
  const bg = disabled ? colors.surface : kind === "primary" ? accentColor : colors.surface;
  const border = disabled
    ? colors.border
    : kind === "primary"
      ? accentColor
      : kind === "secondary"
        ? colors.secondary
        : kind === "danger"
          ? colors.error
          : colors.border;
  const fg = disabled
    ? colors.textMuted
    : kind === "primary"
      ? labelOnFill(colors, theme, accentColor)
      : kind === "secondary"
        ? colors.secondaryText
        : kind === "danger"
          ? colors.error
          : colors.text;
  return (
    <Pressable
      testID={testID}
      style={[
        styles.button,
        { flex, backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : 1 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.buttonText, { color: fg, fontFamily: typography.label }]}>{label}</Text>
      {amount !== undefined && (
        <Text style={[styles.buttonText, { color: fg, fontFamily: typography.label }]}>
          {amount}
        </Text>
      )}
    </Pressable>
  );
}

interface BettingDockProps {
  chips: readonly number[];
  bet: number;
  canAdd: (chip: number) => boolean;
  onChip: (chip: number) => void;
  canDeal: boolean;
  onClear: () => void;
  onDeal: () => void;
  accentColor: string;
}

export function BettingDock({
  chips,
  bet,
  canAdd,
  onChip,
  canDeal,
  onClear,
  onDeal,
  accentColor,
}: BettingDockProps) {
  const { t } = useTranslation("blackjack");
  return (
    <View style={styles.dock}>
      <ChipTray chips={chips} canAdd={canAdd} onChip={onChip} />
      <View style={styles.row}>
        <DockButton
          label={t("betting.clearBet")}
          kind="danger"
          flex={0.7}
          onPress={onClear}
          disabled={bet === 0}
          accessibilityLabel={t("betting.clearBetLabel")}
          accentColor={accentColor}
        />
        <DockButton
          testID="blackjack-deal-button"
          label={t("actions.deal")}
          amount={bet > 0 ? bet : undefined}
          kind="primary"
          flex={1.6}
          onPress={onDeal}
          disabled={!canDeal}
          accessibilityLabel={t("actions.dealLabel", { amount: bet })}
          accentColor={accentColor}
        />
      </View>
    </View>
  );
}

interface ResultDockProps {
  chips: readonly number[];
  canAdd: (chip: number) => boolean;
  onChip: (chip: number) => void;
  onChange: () => void;
  rebet: number;
  rebetAllowed: boolean;
  onRebet: () => void;
  double: number;
  doubleAllowed: boolean;
  onDouble: () => void;
  /** False when no next hand can be dealt (out of chips). */
  canContinue: boolean;
  accentColor: string;
}

export function ResultDock({
  chips,
  canAdd,
  onChip,
  onChange,
  rebet,
  rebetAllowed,
  onRebet,
  double,
  doubleAllowed,
  onDouble,
  canContinue,
  accentColor,
}: ResultDockProps) {
  const { t } = useTranslation("blackjack");
  return (
    <View style={styles.dock}>
      <ChipTray chips={chips} canAdd={(c) => canContinue && canAdd(c)} onChip={onChip} />
      <View style={styles.row}>
        <DockButton
          testID="blackjack-change-button"
          label={t("actions.change")}
          kind="plain"
          flex={0.9}
          onPress={onChange}
          disabled={!canContinue}
          accessibilityLabel={t("actions.changeLabel")}
          accentColor={accentColor}
        />
        <DockButton
          testID="blackjack-rebet-button"
          label={t("actions.rebet")}
          amount={rebet}
          kind="primary"
          flex={1.3}
          onPress={onRebet}
          disabled={!canContinue || !rebetAllowed}
          accessibilityLabel={t("actions.rebetLabel", { amount: rebet })}
          accentColor={accentColor}
        />
        <DockButton
          testID="blackjack-double-bet-button"
          label={t("actions.doubleBet")}
          amount={double}
          kind="secondary"
          flex={0.9}
          onPress={onDouble}
          disabled={!canContinue || !doubleAllowed}
          accessibilityLabel={t("actions.doubleBetLabel", { amount: double })}
          accentColor={accentColor}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    width: "100%",
    gap: DOCK_GAP,
    alignItems: "center",
  },
  tray: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  button: {
    height: DOCK_BUTTON_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
