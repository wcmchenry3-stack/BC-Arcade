/** #3476: the power-up indicator lives in the top HUD band; #3598: the H1-A timer. */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import PowerUpIndicator from "../PowerUpIndicator";
import { POWER_UP_ICON } from "../hudImages";
import {
  HUD_BAR_WIDTH,
  HUD_LAYOUT,
  HUD_POWER_UP_COLOR,
  HUD_TEXT,
  HUD_TIMER_WIDTH,
  HUD_UNDER_NUMERAL_TOP,
} from "../../../game/starswarm/render/hudStyle";
import { COLLECT_CUE_MIN_TOP } from "../../../game/starswarm/render/pickupCue";
import { typography } from "../../../theme/typography";

describe("PowerUpIndicator", () => {
  it("shows the localized name for each kind, in the power-up's colour", async () => {
    const { rerender } = await render(<PowerUpIndicator kind="shield" />);
    const name = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);
    expect(name("SHIELD").color).toBe(HUD_POWER_UP_COLOR.shield);
    expect(name("SHIELD").fontFamily).toBe(typography.label);
    await rerender(<PowerUpIndicator kind="lightning" />);
    expect(name("LIGHTNING").color).toBe(HUD_POWER_UP_COLOR.lightning);
  });

  it("#3598: shows the power-up's hex chip token (#3595)", async () => {
    const { rerender } = await render(<PowerUpIndicator kind="shield" />);
    const icon = () =>
      screen.getByTestId("starswarm-powerup-icon", { includeHiddenElements: true }).props.source;
    expect(icon()).toBe(POWER_UP_ICON.shield);
    await rerender(<PowerUpIndicator kind="lightning" />);
    expect(icon()).toBe(POWER_UP_ICON.lightning);
  });

  it("#3598: has a 10-segment bar, right-aligned at the timer's shared width", async () => {
    await render(<PowerUpIndicator kind="lightning" />);
    const box = StyleSheet.flatten(screen.getByTestId("starswarm-powerup").props.style);
    expect(box.alignSelf).toBe("flex-end");
    expect(box.width).toBe(HUD_TIMER_WIDTH);
    expect(box.position).toBeUndefined();
    const clip = screen.getByTestId("starswarm-powerup-bar");
    expect(StyleSheet.flatten(clip.props.style).width).toBe(HUD_BAR_WIDTH);
    expect(StyleSheet.flatten(clip.props.style).overflow).toBe("hidden");
    // 10 dim track segments beside the clip, 10 lit ones inside it
    expect(clip.parent!.children).toHaveLength(HUD_LAYOUT.segmentCount + 1);
  });

  it("ignores touches", async () => {
    await render(<PowerUpIndicator kind="shield" />);
    expect(screen.getByTestId("starswarm-powerup").props.pointerEvents).toBe("none");
  });

  it("the right column (lives, then the timer) ends above the collect-power-ups cue", () => {
    const timerTop = HUD_UNDER_NUMERAL_TOP + HUD_LAYOUT.lifeIcon + HUD_LAYOUT.livesToTimerGap;
    const timerHeight =
      HUD_TEXT.powerUpName.lineHeight + HUD_LAYOUT.timerNameToBarGap + HUD_LAYOUT.segmentHeight;
    expect(timerTop + Math.max(timerHeight, HUD_LAYOUT.timerIcon)).toBeLessThan(
      COLLECT_CUE_MIN_TOP
    );
  });
});
