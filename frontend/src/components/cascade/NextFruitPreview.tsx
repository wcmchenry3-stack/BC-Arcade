import React, { memo, useEffect, useRef } from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { FruitDefinition } from "../../theme/fruitSets";
import { useTheme } from "../../theme/ThemeContext";
import { useReduceMotion } from "../shared/useReduceMotion";
import { chipAnimationMs, dropChipPose, nextChipPose } from "../../game/cascade/motion";
import FruitGlyph from "./FruitGlyph";

interface Props {
  current: FruitDefinition;
  next: FruitDefinition;
  /** Drops so far (the screen's count): each new drop plays the hop, nothing else does. */
  drops?: number;
}

const DROP_SIZE = 22;
const NEXT_SIZE = 16;

/**
 * The DROP / NEXT chips. #3701 (owner pick B): after each drop the piece that was NEXT hops over
 * into DROP in an arc with an overshoot, and the new NEXT pops in; under Reduce Motion both fade in
 * (`motion.ts`). Runs on the UI thread (Reanimated). Driven by the drop count, not by comparing
 * tiers: a drop of the same tier as the next one still plays, a reset or a restore does not.
 */
function NextFruitPreview({ current, next, drops = 0 }: Props) {
  const { t } = useTranslation("cascade");
  const pieceName = (f: FruitDefinition) => t(`pieces.${f.i18nKey}`, { defaultValue: f.name });
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Ms since the queue last moved on (past the end: at rest).
  const ms = useSharedValue(chipAnimationMs(false));
  const hopFrom = useSharedValue(0);
  const calm = useSharedValue(reduceMotion);
  const seenDrops = useRef(drops);
  const dropX = useRef(0);

  useEffect(() => {
    calm.set(reduceMotion);
  }, [calm, reduceMotion]);

  useEffect(() => {
    if (drops === seenDrops.current) return;
    seenDrops.current = drops;
    const total = chipAnimationMs(reduceMotion);
    ms.set(0);
    ms.set(withTiming(total, { duration: total, easing: Easing.linear }));
  }, [drops, ms, reduceMotion]);

  const dropStyle = useAnimatedStyle(() => {
    const p = dropChipPose(ms.get(), hopFrom.get(), NEXT_SIZE / DROP_SIZE, calm.get());
    return {
      opacity: p.opacity,
      transform: [{ translateX: p.translateX }, { translateY: p.translateY }, { scale: p.scale }],
    };
  });
  const nextStyle = useAnimatedStyle(() => {
    const p = nextChipPose(ms.get(), calm.get());
    return { opacity: p.opacity, transform: [{ scale: p.scale }] };
  });

  const onDropLayout = (e: LayoutChangeEvent) => {
    dropX.current = e.nativeEvent.layout.x;
  };
  // The hop starts where the NEXT glyph sits: the chips' offset, less the glyphs' size difference.
  const onNextLayout = (e: LayoutChangeEvent) => {
    hopFrom.set(e.nativeEvent.layout.x - dropX.current - (DROP_SIZE - NEXT_SIZE) / 2);
  };

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.chip,
          styles.dropChip,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        accessible
        accessibilityLabel={t("preview.droppingNext", { name: pieceName(current) })}
        onLayout={onDropLayout}
      >
        <Animated.View style={[styles.drop, dropStyle]}>
          <FruitGlyph fruit={current} size={DROP_SIZE} />
        </Animated.View>
        <Text style={[styles.label, { color: colors.textMuted }]} importantForAccessibility="no">
          {t("preview.dropLabel")}
        </Text>
      </View>
      <View
        style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        accessible
        accessibilityLabel={t("preview.comingUp", { name: pieceName(next) })}
        onLayout={onNextLayout}
      >
        <Animated.View style={[styles.next, nextStyle]}>
          <FruitGlyph fruit={next} size={NEXT_SIZE} />
        </Animated.View>
        <Text style={[styles.label, { color: colors.textMuted }]} importantForAccessibility="no">
          {t("preview.nextLabel")}
        </Text>
      </View>
    </View>
  );
}

// Memoized (#2960): it re-renders only when the queue's pieces change.
export default memo(NextFruitPreview);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    // The DROP glyph hops in from the NEXT chip, over the chips' edges.
    overflow: "visible",
  },
  // Above the NEXT chip, so the hopping glyph is not hidden under it.
  dropChip: {
    zIndex: 1,
  },
  drop: {
    width: DROP_SIZE,
    height: DROP_SIZE,
  },
  next: {
    width: NEXT_SIZE,
    height: NEXT_SIZE,
  },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: "600",
  },
});
