import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
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
import type { BoardSize } from "../../game/daily_word/layout";

export const FLIP_HALF_MS = 150;
export const TILE_STAGGER_MS = 100;

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
}) {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();
  // scaleX 1→0→1 gives the same visual flip as rotateY without 3D compositing
  // artifacts that cause black-screen flicker on web and some iOS renderers.
  const scale = useSharedValue(1);
  const [visibleStatus, setVisibleStatus] = useState<TileStatus>(isFlipping ? "tbd" : status);

  useEffect(() => {
    if (!isFlipping) {
      setVisibleStatus(status);
      return;
    }
    scale.value = 1;
    scale.value = withDelay(
      flipDelay,
      withSequence(
        withTiming(0, { duration: FLIP_HALF_MS }),
        withTiming(1, { duration: FLIP_HALF_MS })
      )
    );
    const timer = setTimeout(() => setVisibleStatus(status), flipDelay + FLIP_HALF_MS);
    return () => clearTimeout(timer);
    // isFlipping and status are the only meaningful triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlipping, status]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scale.value }],
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
}: {
  readonly state: DailyWordState;
  readonly rowIndex: number;
  readonly wordLength: number;
  readonly isFlipping: boolean;
  readonly size?: BoardSize;
}) {
  const row = state.rows[rowIndex];
  if (!row) return null;

  return (
    <View testID={`daily-word-row-${rowIndex}`} style={[rowStyles.row, { gap: size.gap }]}>
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
        />
      ))}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
});
