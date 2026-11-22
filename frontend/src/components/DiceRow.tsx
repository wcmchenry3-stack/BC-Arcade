/**
 * The thumb tray (#3748): the card under the scorecard that holds everything a turn needs in
 * thumb reach — the turn hint, the five dice, and a row with Roll and (the screen's) action bar.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  Platform,
  ViewStyle,
  LayoutChangeEvent,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import Die, { DIE_LIFT, tumbleRise } from "./Die";
import { useTheme } from "../theme/ThemeContext";
import { useReduceMotion } from "./shared/useReduceMotion";

/** The gap (pt) between dice. */
const DIE_GAP = 8;
const MAX_DIE = 60;
const MIN_DIE = 36;
/** Side gutter of the screen (16) and the tray's padding (12), each side: the dice row's width is the window's less these. */
const TRAY_SIDE_INSET = 28;

/** The largest die (pt) that fits five in a row `rowWidth` wide. */
export function dieSizeFor(rowWidth: number): number {
  return Math.max(MIN_DIE, Math.min(MAX_DIE, Math.floor((rowWidth - 4 * DIE_GAP) / 5)));
}

interface DiceRowProps {
  dice: number[];
  held: boolean[];
  rollsUsed: number;
  gameOver: boolean;
  onRoll: () => void | Promise<void>;
  onToggleHold: (index: number) => void;
  /** Indices of dice that are currently animating a roll, left to right (their tumbles are staggered in this order). */
  rollingIndices?: readonly number[];
  /** How fast the tumble plays: 2 for the computer's fast last turn (#3749). */
  tumbleSpeed?: number;
  /**
   * Your dice are still tumbling (#3749): Roll and the dice take no press until they land. They
   * keep their look (no grey flash on every roll); only the press and the disabled state change.
   */
  inputLocked?: boolean;
  /** A rolled die has landed (its index): the screen's input lock waits for every one. */
  onTumbleEnd?: (index: number) => void;
  /** The computer's turn: the dice shown are its dice, Roll reads "Computer's turn" and nothing is tappable. */
  locked?: boolean;
  /** The computer's rolls so far this turn (shown as "Roll n / 3" while it plays). */
  computerRolls?: number;
  /** "Your Turn" in a game against the computer; none in solo. */
  turnLabel?: string | null;
  /** The Hint's message (or its "no hint" one): replaces the turn hint while it is up. */
  hintMessage?: { text: string; none: boolean } | null;
  /** The dice the Hint suggests keeping. */
  hintHold?: readonly boolean[] | null;
  /** Rendered beside Roll: the shared action bar. */
  actions?: React.ReactNode;
}

export default function DiceRow({
  dice,
  held,
  rollsUsed,
  gameOver,
  onRoll,
  onToggleHold,
  rollingIndices,
  tumbleSpeed = 1,
  inputLocked = false,
  onTumbleEnd,
  locked = false,
  computerRolls = 0,
  turnLabel = null,
  hintMessage = null,
  hintHold = null,
  actions,
}: DiceRowProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  // The dice are sized from the width the row actually has: measured, with the window's less the
  // screen gutter and tray padding until the first layout.
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const size = dieSizeFor(rowWidth ?? windowWidth - 2 * TRAY_SIDE_INSET);
  // Room above the dice for a held die's lift and a tumbling die's rise (#3749).
  const roomAbove = useMemo(() => Math.max(DIE_LIFT, tumbleRise(size)) + 2, [size]);
  const onRowLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setRowWidth((prev) => (prev === w ? prev : w));
  };

  const canRoll = rollsUsed < 3 && !gameOver && !locked;
  // A finished game has no rolls left: in the end beat the tray shows its final dice, not a turn.
  const rollsLeft = gameOver ? 0 : 3 - rollsUsed;

  // Web gradient for roll button; native falls back to flat accentBright
  const rollButtonBg: ViewStyle =
    canRoll && Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: canRoll ? colors.accentBright : colors.surfaceHigh };

  const rollText = locked ? t("vsMode.computerTurn") : t("roll.button", { count: rollsLeft });

  let hintLine: React.ReactNode;
  if (gameOver && !locked) {
    // The pause before the result card (#3749, owner): "Game over", over the final dice.
    hintLine = (
      <Text
        style={[styles.hint, styles.hintStrong, { color: colors.text }]}
        testID="yacht-game-over-hint"
      >
        {t("dice.hintGameOver")}
      </Text>
    );
  } else if (locked) {
    hintLine = (
      <>
        <Text style={[styles.hint, { color: colors.textMuted }]}>{t("dice.hintComputer")}</Text>
        {computerRolls > 0 && (
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {t("vsMode.rollCounter", { n: computerRolls })}
          </Text>
        )}
      </>
    );
  } else if (hintMessage) {
    hintLine = (
      <Text
        style={[styles.hint, styles.hintStrong, { color: colors.accentText }]}
        testID={hintMessage.none ? "yacht-no-hint-toast" : "yacht-hint-message"}
      >
        {hintMessage.text}
      </Text>
    );
  } else {
    hintLine = (
      <>
        {turnLabel ? (
          <>
            <Text style={[styles.hint, styles.hintStrong, { color: colors.accentText }]}>
              {turnLabel}
            </Text>
            <Text
              style={[styles.hint, { color: colors.textMuted }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              ·
            </Text>
          </>
        ) : null}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {rollsUsed > 0
            ? t("dice.hintAfterRoll")
            : turnLabel
              ? t("dice.hintRollToStart")
              : t("dice.hintBeforeRoll")}
        </Text>
      </>
    );
  }

  return (
    <View
      style={[styles.tray, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      testID="yacht-tray"
    >
      <View style={styles.hintRow} testID="yacht-hint-line">
        {hintLine}
      </View>
      <View
        style={[styles.diceRow, { paddingTop: roomAbove }]}
        onLayout={onRowLayout}
        testID="yacht-dice-row"
      >
        {dice.map((val, i) => (
          <Die
            key={i}
            index={i}
            size={size}
            value={val}
            held={held[i] ?? false}
            onPress={() => onToggleHold(i)}
            disabled={locked || inputLocked || rollsUsed === 0 || gameOver}
            rolling={rollingIndices?.includes(i) ?? false}
            rollOrder={Math.max(0, rollingIndices?.indexOf(i) ?? 0)}
            tumbleSpeed={tumbleSpeed}
            onTumbleEnd={onTumbleEnd}
            reduceMotion={reduceMotion}
            hinted={!locked && hintHold?.[i] === true}
            dimmed={gameOver}
          />
        ))}
      </View>
      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [
            styles.rollButton,
            rollButtonBg,
            // Always emit a transform (identity when not pressed) so it never
            // goes undefined → null between renders. RN's ReactNativeAttributePayload
            // coerces undefined props to null, and processTransform(null) crashes
            // in _validateTransforms (__DEV__ only) with "forEach of null".
            { transform: [{ scale: pressed && canRoll ? 0.95 : 1 }] },
          ]}
          onPress={() => void onRoll()}
          disabled={!canRoll || inputLocked}
          accessibilityRole="button"
          testID="yacht-roll-button"
          accessibilityLabel={
            // i18next picks the plural form (ar has six, ru four) from count.
            locked ? t("vsMode.computerTurn") : t("roll.label", { count: rollsLeft })
          }
          accessibilityState={{ disabled: !canRoll || inputLocked }}
        >
          <Text
            numberOfLines={2}
            style={[
              styles.rollButtonText,
              { color: canRoll ? colors.textOnAccent : colors.textMuted },
            ]}
          >
            {rollText}
          </Text>
        </Pressable>
        {actions}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    alignSelf: "stretch",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  hintRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    columnGap: 6,
    minHeight: 20,
  },
  hint: {
    fontSize: 13,
    textAlign: "center",
  },
  hintStrong: {
    fontWeight: "700",
  },
  diceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    // Room above the dice (set in the render from the die size): a held die's lift and a tumbling
    // die's rise both stay below the hint line (#3749).
    paddingBottom: 6,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  rollButton: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  rollButtonText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
  },
});
