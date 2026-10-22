/** #3476: the power-up indicator lives in the top HUD band, never the ship's bottom band. */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import PowerUpIndicator, { LIVES_ROW_HEIGHT, powerUpTopBelow } from "../PowerUpIndicator";
import { LIVES_TOP_FALLBACK } from "../LivesIndicator";
import { COLLECT_CUE_MIN_TOP } from "../../../game/starswarm/render/pickupCue";

// label (8pt + 2 margin, with line-height slack) + 6pt bar
const INDICATOR_MAX_HEIGHT = 24;

describe("PowerUpIndicator", () => {
  it("shows the label for each kind", async () => {
    const { rerender } = await render(<PowerUpIndicator kind="shield" top={46} />);
    expect(screen.getByText("SHIELD")).toBeTruthy();
    await rerender(<PowerUpIndicator kind="lightning" top={46} />);
    expect(screen.getByText("LIGHTNING")).toBeTruthy();
  });

  it("is anchored from the top, not the bottom (clear of the ship)", async () => {
    await render(<PowerUpIndicator kind="shield" top={46} />);
    const style = StyleSheet.flatten(screen.getByTestId("starswarm-powerup").props.style);
    expect(style.top).toBe(46);
    expect(style.bottom).toBeUndefined();
  });

  it("ignores touches", async () => {
    await render(<PowerUpIndicator kind="shield" top={46} />);
    expect(screen.getByTestId("starswarm-powerup").props.pointerEvents).toBe("none");
  });

  it("stacks directly under the lives row", () => {
    expect(powerUpTopBelow(LIVES_TOP_FALLBACK)).toBeGreaterThanOrEqual(
      LIVES_TOP_FALLBACK + LIVES_ROW_HEIGHT
    );
  });

  it("ends above the collect-power-ups cue's minimum top", () => {
    expect(powerUpTopBelow(LIVES_TOP_FALLBACK) + INDICATOR_MAX_HEIGHT).toBeLessThan(
      COLLECT_CUE_MIN_TOP
    );
  });
});
