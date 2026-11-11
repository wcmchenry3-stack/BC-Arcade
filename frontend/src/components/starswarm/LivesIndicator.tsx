import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { HUD_LAYOUT } from "../../game/starswarm/render/hudStyle";
import { DEFAULT_SHIP_ID } from "../../game/starswarm/render/ship";
import type { ShipId } from "../../game/starswarm/render/ship";
import { SHIP_BASE_IMAGE } from "./hudImages";

/**
 * Remaining lives (#2150), since #3598 one mini player ship each — the ship the player chose
 * (#3600) — right-aligned under the wave number in the top-right HUD column, clear of the ship's
 * bottom movement band. The row sits in the column's flow, so a larger font scale above it moves
 * it down with the text; nothing is measured.
 */
export default function LivesIndicator({
  lives,
  ship = DEFAULT_SHIP_ID,
}: {
  lives: number;
  ship?: ShipId;
}) {
  const { t } = useTranslation("starswarm");
  const source = SHIP_BASE_IMAGE[ship];
  return (
    <View
      style={styles.row}
      pointerEvents="none"
      accessible
      accessibilityLabel={t("hud.livesValue", { lives })}
      testID="starswarm-lives"
    >
      {Array.from({ length: lives }, (_, i) => (
        <Image
          key={i}
          source={source}
          style={styles.life}
          resizeMode="contain"
          accessible={false}
          testID="starswarm-life"
        />
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignSelf: "flex-end",
    gap: HUD_LAYOUT.lifeGap,
    minHeight: HUD_LAYOUT.lifeIcon,
  },
  life: {
    width: HUD_LAYOUT.lifeIcon,
    height: HUD_LAYOUT.lifeIcon,
  },
});
