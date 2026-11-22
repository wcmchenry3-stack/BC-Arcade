import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import {
  HUD_BAR_WIDTH,
  HUD_LAYOUT,
  HUD_MAX_FONT_SCALE,
  HUD_POWER_UP_COLOR,
  HUD_TEXT,
  HUD_TIMER_WIDTH,
} from "../../game/starswarm/render/hudStyle";
import { hudTextStyle } from "./hudTextStyle";
import { POWER_UP_ICON } from "./hudImages";

type AnimatedStyle = React.ComponentProps<typeof Animated.View>["style"];

const SEGMENTS = Array.from({ length: HUD_LAYOUT.segmentCount }, (_, k) => k);

/**
 * The active duration power-up (SHIELD / LIGHTNING): #3476 moved it to the top HUD band; #3598
 * makes it the H1-A timer, right-aligned under the lives in the top-right column — the
 * power-up's hex chip token (#3595), its localized name, and a 10-segment bar that goes out
 * segment by segment.
 *
 * The bar drains on the UI thread (#2566): `clipStyle` slides a clipping window left and
 * `contentStyle` slides the lit segments back by the same amount, so the window shows exactly
 * the lit segments without a layout change. GameCanvas builds both from the power-up shared value
 * with `litBarWidth`, the same function the web canvas draws with.
 */
export default function PowerUpIndicator({
  kind,
  clipStyle,
  contentStyle,
}: {
  kind: "shield" | "lightning";
  clipStyle?: AnimatedStyle;
  contentStyle?: AnimatedStyle;
}) {
  const { t } = useTranslation("starswarm");
  const color = HUD_POWER_UP_COLOR[kind];
  const name = t(kind === "shield" ? "hud.powerUpShield" : "hud.powerUpLightning");
  return (
    <View style={styles.container} pointerEvents="none" testID="starswarm-powerup">
      <Image
        source={POWER_UP_ICON[kind]}
        style={styles.icon}
        resizeMode="contain"
        accessible={false}
        testID="starswarm-powerup-icon"
      />
      <View style={styles.right}>
        <Text
          style={[styles.name, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          maxFontSizeMultiplier={HUD_MAX_FONT_SCALE}
        >
          {name}
        </Text>
        <View style={styles.bar}>
          {SEGMENTS.map((k) => (
            <View key={k} style={[styles.segment, styles.segmentDim, { backgroundColor: color }]} />
          ))}
          <Animated.View style={[styles.clip, clipStyle]} testID="starswarm-powerup-bar">
            <Animated.View style={[styles.litRow, contentStyle]}>
              {SEGMENTS.map((k) => (
                <View key={k} style={[styles.segment, { backgroundColor: color }]} />
              ))}
            </Animated.View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const SEGMENT_PITCH = HUD_LAYOUT.segmentWidth + HUD_LAYOUT.segmentGap;

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    width: HUD_TIMER_WIDTH,
    marginTop: HUD_LAYOUT.livesToTimerGap,
  },
  icon: {
    width: HUD_LAYOUT.timerIcon,
    height: HUD_LAYOUT.timerIcon,
    marginRight: HUD_LAYOUT.timerIconGap,
  },
  right: {
    width: HUD_BAR_WIDTH,
  },
  name: {
    ...hudTextStyle(HUD_TEXT.powerUpName),
    marginBottom: HUD_LAYOUT.timerNameToBarGap,
  },
  bar: {
    width: HUD_BAR_WIDTH,
    height: HUD_LAYOUT.segmentHeight,
    flexDirection: "row",
    gap: HUD_LAYOUT.segmentGap,
  },
  segment: {
    width: HUD_LAYOUT.segmentWidth,
    height: HUD_LAYOUT.segmentHeight,
  },
  segmentDim: {
    opacity: HUD_LAYOUT.segmentDimOpacity,
  },
  clip: {
    position: "absolute",
    left: 0,
    top: 0,
    width: HUD_BAR_WIDTH,
    height: HUD_LAYOUT.segmentHeight,
    overflow: "hidden",
  },
  litRow: {
    width: HUD_BAR_WIDTH,
    height: HUD_LAYOUT.segmentHeight,
    flexDirection: "row",
    gap: SEGMENT_PITCH - HUD_LAYOUT.segmentWidth,
  },
});
