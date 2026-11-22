import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
} from "react-native-reanimated";

import { useTheme } from "../../theme/ThemeContext";
import {
  DAILYWORD_ABSENT,
  DAILYWORD_CORRECT,
  DAILYWORD_LETTER_TEXT,
  DAILYWORD_PRESENT,
} from "../../theme/theme.dailyword";
import { typography } from "../../theme/typography";
import type { DailyWordState, TileStatus } from "../../game/daily_word/types";
import { tileDisplayLetter } from "../../game/daily_word/engine";
import { DEFAULT_BOARD } from "../../game/daily_word/layout";
import {
  DELETE_PULSE_MS,
  FLIP_HALF_MS,
  SHAKE_MS,
  TILE_STAGGER_MS,
  TYPE_POP_MS,
  TYPE_POP_SCALE,
  WIN_HOP_MS,
  WIN_HOP_STAGGER_MS,
} from "../../game/daily_word/motion";
import type { BoardSize } from "../../game/daily_word/layout";

// ---------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------

const TILE_STATUS_COLORS: Record<TileStatus, string> = {
  correct: DAILYWORD_CORRECT,
  present: DAILYWORD_PRESENT,
  absent: DAILYWORD_ABSENT,
  tbd: "transparent",
  empty: "transparent",
};

function WordTile({
  letter,
  status,
  isFlipping,
  flipDelay,
  testID,
  row,
  col,
  size = DEFAULT_BOARD,
  hopDelay = null,
  reduceMotion = false,
}: {
  readonly letter: string;
  readonly status: TileStatus;
  readonly isFlipping: boolean;
  readonly flipDelay: number;
  readonly testID?: string;
  /** 1-based board position, announced to screen readers. */
  readonly row: number;
  readonly col: number;
  /** The tile's side and letter size (#3663: the board fills its space). */
  readonly size?: BoardSize;
  /** The win dance (#3664): when set, the tile hops after this many ms. */
  readonly hopDelay?: number | null;
  /** Read once by the screen and passed down, not subscribed per tile (#3664 review). */
  readonly reduceMotion?: boolean;
}) {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();
  // The flip turns the tile top-to-bottom (#3664): scaleY 1→0→1, like a tile turning over, keeps
  // the letter's width (the old scaleX squashed it sideways) without the 3D compositing
  // artifacts rotateX/rotateY cause on web and some iOS renderers.
  const scale = useSharedValue(1);
  // A typed letter pops; a deleted one pulses inward (#3664).
  const pop = useSharedValue(1);
  // The win dance: the tile hops up and lands (#3664).
  const hop = useSharedValue(0);
  const [visibleStatus, setVisibleStatus] = useState<TileStatus>(isFlipping ? "tbd" : status);

  useEffect(() => {
    if (!isFlipping) {
      setVisibleStatus(status);
      return;
    }
    scale.value = 1;
    // Under Reduce Motion the colour still changes tile by tile, without the turn.
    if (!reduceMotion) {
      scale.value = withDelay(
        flipDelay,
        withSequence(
          withTiming(0, { duration: FLIP_HALF_MS }),
          withTiming(1, { duration: FLIP_HALF_MS })
        )
      );
    }
    const timer = setTimeout(() => setVisibleStatus(status), flipDelay + FLIP_HALF_MS);
    return () => clearTimeout(timer);
    // isFlipping and status are the only meaningful triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlipping, status]);

  // The pop follows typing, not the first render (a restored board) or a scored tile.
  const prevLetter = useRef(letter);
  useEffect(() => {
    const before = prevLetter.current;
    prevLetter.current = letter;
    if (reduceMotion || isFlipping || before === letter) return;
    if (status !== "tbd" && status !== "empty") return;
    pop.value = letter
      ? withSequence(
          withTiming(TYPE_POP_SCALE, { duration: TYPE_POP_MS / 2 }),
          withTiming(1, { duration: TYPE_POP_MS / 2 })
        )
      : withSequence(
          withTiming(0.92, { duration: DELETE_PULSE_MS / 2 }),
          withTiming(1, { duration: DELETE_PULSE_MS / 2 })
        );
    // Only a change of letter starts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter]);

  useEffect(() => {
    if (hopDelay === null || reduceMotion) {
      // The dance was cancelled (Reduce Motion turned on, or a new board): land the tile.
      cancelAnimation(hop);
      hop.value = 0;
      return;
    }
    const lift = -size.tile * 0.35;
    hop.value = withDelay(
      hopDelay,
      withSequence(
        withTiming(lift, { duration: WIN_HOP_MS * 0.45 }),
        withTiming(0, { duration: WIN_HOP_MS * 0.55 })
      )
    );
    // The dance starts once, when the tile is given a delay; it stops if Reduce Motion turns on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopDelay, reduceMotion]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hop.value }, { scaleY: scale.value }, { scale: pop.value }],
  }));

  const bg =
    visibleStatus === "tbd" || visibleStatus === "empty"
      ? colors.surface
      : TILE_STATUS_COLORS[visibleStatus];
  const hasBorder = visibleStatus === "empty" || visibleStatus === "tbd";
  const borderColor = letter ? colors.textMuted : colors.border;

  return (
    <Animated.View
      testID={testID}
      style={[
        tileStyles.tile,
        { width: size.tile, height: size.tile },
        animStyle,
        {
          backgroundColor: bg,
          borderColor: hasBorder ? borderColor : "transparent",
          borderWidth: hasBorder ? StyleSheet.hairlineWidth * 2 : 0,
        },
      ]}
      accessibilityLabel={
        letter
          ? visibleStatus === "correct" || visibleStatus === "present" || visibleStatus === "absent"
            ? t("a11y.tileStatus", {
                row,
                col,
                letter: letter.toUpperCase(),
                status: t(`a11y.status.${visibleStatus}`),
              })
            : t("a11y.tile", { row, col, letter: letter.toUpperCase() })
          : undefined
      }
    >
      <Text
        numberOfLines={1}
        // The letter is sized with its tile (#3663), which already grows with the screen; system
        // text scaling on top would clip it.
        allowFontScaling={false}
        style={[
          tileStyles.letter,
          { fontSize: size.fontSize },
          {
            color:
              visibleStatus === "correct" ||
              visibleStatus === "present" ||
              visibleStatus === "absent"
                ? DAILYWORD_LETTER_TEXT
                : colors.text,
          },
        ]}
      >
        {letter.toUpperCase()}
      </Text>
    </Animated.View>
  );
}

const tileStyles = StyleSheet.create({
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  // The letter spans the full tile width rather than shrink-wrapping its
  // glyph: a shrink-wrapped narrow glyph ("I") measured a hair under its
  // advance wraps onto a clipped second line on iOS and paints nothing (#3149).
  // No fontWeight — the family is already the bold face.
  letter: {
    alignSelf: "stretch",
    fontFamily: typography.heading,
    textAlign: "center",
  },
});

// ---------------------------------------------------------------------------
// Tile row
// ---------------------------------------------------------------------------

export function TileRow({
  state,
  rowIndex,
  wordLength,
  isFlipping,
  size = DEFAULT_BOARD,
  shakeKey = 0,
  dancing = false,
  reduceMotion = false,
}: {
  readonly state: DailyWordState;
  readonly rowIndex: number;
  readonly wordLength: number;
  readonly isFlipping: boolean;
  readonly size?: BoardSize;
  /** A refused guess (#3664): each new value shakes the row being typed "no". Pass the same
   *  counter to every row: only the current one moves. */
  readonly shakeKey?: number;
  /** The win dance (#3664): the solved row's tiles hop in a wave. */
  readonly dancing?: boolean;
  /** Reduce Motion, read once by the screen (#3664 review). */
  readonly reduceMotion?: boolean;
}) {
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const lastShake = useRef(shakeKey);
  useEffect(() => {
    if (shakeKey === lastShake.current) return;
    lastShake.current = shakeKey;
    if (reduceMotion || rowIndex !== state.current_row) return;
    const a = size.tile * 0.16;
    const step = SHAKE_MS / 6;
    shake.value = withSequence(
      withTiming(-a, { duration: step }),
      withTiming(a, { duration: step }),
      withTiming(-a * 0.7, { duration: step }),
      withTiming(a * 0.7, { duration: step }),
      withTiming(-a * 0.35, { duration: step }),
      withTiming(0, { duration: step })
    );
    // Only a new refusal starts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeKey]);

  const row = state.rows[rowIndex];
  if (!row) return null;

  return (
    <Animated.View
      testID={`daily-word-row-${rowIndex}`}
      style={[rowStyles.row, { gap: size.gap }, shakeStyle]}
    >
      {row.tiles.map((tile, tileIndex) => (
        <WordTile
          key={tileIndex}
          letter={tileDisplayLetter(tile)}
          status={tile.status}
          isFlipping={isFlipping}
          flipDelay={tileIndex * TILE_STAGGER_MS}
          testID={`tile-${rowIndex}-${tileIndex}`}
          row={rowIndex + 1}
          col={tileIndex + 1}
          size={size}
          hopDelay={dancing ? tileIndex * WIN_HOP_STAGGER_MS : null}
          reduceMotion={reduceMotion}
        />
      ))}
      {/* Pad empty tiles if row is shorter than word_length (shouldn't happen) */}
      {Array.from({ length: Math.max(0, wordLength - row.tiles.length) }, (_, i) => (
        <WordTile
          key={`pad-${i}`}
          letter=""
          status="empty"
          isFlipping={false}
          flipDelay={0}
          row={rowIndex + 1}
          col={row.tiles.length + i + 1}
          size={size}
          reduceMotion={reduceMotion}
        />
      ))}
    </Animated.View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
});
