import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
}: {
  readonly letter: string;
  readonly status: TileStatus;
  readonly isFlipping: boolean;
  readonly flipDelay: number;
  readonly testID?: string;
}) {
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
        animStyle,
        {
          backgroundColor: bg,
          borderColor: hasBorder ? borderColor : "transparent",
          borderWidth: hasBorder ? StyleSheet.hairlineWidth * 2 : 0,
        },
      ]}
      accessibilityLabel={
        letter
          ? `${letter}${visibleStatus !== "tbd" && visibleStatus !== "empty" ? ` ${visibleStatus}` : ""}`
          : undefined
      }
    >
      <Text
        style={[
          tileStyles.letter,
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
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  letter: {
    fontFamily: typography.heading,
    fontSize: 22,
    fontWeight: "700",
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
}: {
  readonly state: DailyWordState;
  readonly rowIndex: number;
  readonly wordLength: number;
  readonly isFlipping: boolean;
}) {
  const row = state.rows[rowIndex];
  if (!row) return null;

  return (
    <View testID={`daily-word-row-${rowIndex}`} style={rowStyles.row}>
      {row.tiles.map((tile, tileIndex) => (
        <WordTile
          key={tileIndex}
          letter={tile.letter}
          status={tile.status}
          isFlipping={isFlipping}
          flipDelay={tileIndex * TILE_STAGGER_MS}
          testID={`tile-${rowIndex}-${tileIndex}`}
        />
      ))}
      {/* Pad empty tiles if row is shorter than word_length (shouldn't happen) */}
      {Array.from({ length: Math.max(0, wordLength - row.tiles.length) }, (_, i) => (
        <WordTile key={`pad-${i}`} letter="" status="empty" isFlipping={false} flipDelay={0} />
      ))}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
});
