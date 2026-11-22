/**
 * AnswerRow (#3664): on a loss, the answer appears as a row of tiles that flip in one by one
 * (top-to-bottom, like the board's reveal), before the result card. Under Reduce Motion, or on a
 * restored board, it just appears.
 */
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import type { BoardSize } from "../../game/daily_word/layout";
import { FLIP_HALF_MS, LOSS_REVEAL_STAGGER_MS } from "../../game/daily_word/motion";
import { DAILYWORD_CORRECT, DAILYWORD_LETTER_TEXT } from "../../theme/theme.dailyword";
import { typography } from "../../theme/typography";

function AnswerTile({
  letter,
  index,
  size,
  reduceMotion,
}: {
  letter: string;
  index: number;
  size: BoardSize;
  reduceMotion: boolean;
}) {
  const turn = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      // Reduce Motion turned on mid-reveal (docs/ACCESSIBILITY.md §3): show the tile at once.
      cancelAnimation(turn);
      turn.value = 1;
      return;
    }
    turn.value = withDelay(
      index * LOSS_REVEAL_STAGGER_MS,
      withTiming(1, { duration: 2 * FLIP_HALF_MS })
    );
    // On mount, and when Reduce Motion turns on (it never turns an instant row back to animating).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: turn.value }] }));
  return (
    <Animated.View
      style={[
        styles.tile,
        { width: size.tile, height: size.tile, backgroundColor: DAILYWORD_CORRECT },
        style,
      ]}
    >
      <Text allowFontScaling={false} style={[styles.letter, { fontSize: size.fontSize }]}>
        {letter}
      </Text>
    </Animated.View>
  );
}

export default function AnswerRow({
  answer,
  size,
  animate,
}: {
  answer: string;
  size: BoardSize;
  /** Flip the tiles in: a loss just played with motion on. A restored board, or Reduce Motion
   *  (no celebration is set), shows them at once. */
  animate: boolean;
}) {
  const { t } = useTranslation("daily_word");
  const reduceMotion = !animate;
  return (
    <View
      style={[styles.row, { gap: size.gap }]}
      accessibilityRole="text"
      accessibilityLabel={t("result.loss.answer", { answer })}
      testID="daily-word-answer-row"
    >
      {[...answer].map((letter, i) => (
        <AnswerTile key={i} letter={letter} index={i} size={size} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  letter: {
    alignSelf: "stretch",
    fontFamily: typography.heading,
    textAlign: "center",
    color: DAILYWORD_LETTER_TEXT,
  },
});
