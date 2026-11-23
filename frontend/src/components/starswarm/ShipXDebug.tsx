/**
 * #4079: the ship's engine X as text, for Maestro (which cannot call JS) — test builds only.
 *
 * StarSwarmScreen mounts it only when `EXPO_PUBLIC_TEST_HOOKS=1` (the gate every E2E hook uses),
 * so a production build never renders it, never polls, and does no work for it. It polls the
 * canvas at SHIP_X_DEBUG_POLL_MS (4 Hz, never per frame) and re-renders only this line, and
 * only when the whole-pixel X changes. `e2e/maestro/flows/starswarm/edge-drag.yaml` reads it.
 * Test-only text, never shown to players, so it is not translated.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { STARSWARM_ACCENT, STARSWARM_HUD_CHIP_FILL } from "../../theme/theme.starswarm";

export const SHIP_X_DEBUG_TEST_ID = "starswarm-debug-shipx";
export const SHIP_X_DEBUG_POLL_MS = 250;

/** `ship-x: 343`; `ship-x: -` while there is no engine (or its X is not a finite number). */
export function formatShipX(x: number | null | undefined): string {
  return typeof x === "number" && Number.isFinite(x) ? `ship-x: ${Math.round(x)}` : "ship-x: -";
}

interface Props {
  /** The engine ship's X (`state.player.x`), or null before there is an engine. */
  readonly read: () => number | null | undefined;
}

export default function ShipXDebug({ read }: Props) {
  const [line, setLine] = useState(() => formatShipX(read()));
  useEffect(() => {
    // setState with an unchanged string is a no-op: no commit while the ship holds still.
    const id = setInterval(() => setLine(formatShipX(read())), SHIP_X_DEBUG_POLL_MS);
    return () => clearInterval(id);
  }, [read]);
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Text testID={SHIP_X_DEBUG_TEST_ID} style={styles.text}>
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: STARSWARM_HUD_CHIP_FILL,
    paddingHorizontal: 4,
    zIndex: 100,
  },
  text: {
    color: STARSWARM_ACCENT,
    fontSize: 10,
    lineHeight: 14,
  },
});
