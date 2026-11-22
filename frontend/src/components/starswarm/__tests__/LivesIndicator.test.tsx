/** #2150: the lives row lives in the top HUD band; #3598: mini ships, right-aligned under the wave. */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import LivesIndicator from "../LivesIndicator";
import { SHIP_BASE_IMAGE } from "../hudImages";
import { HUD_LAYOUT } from "../../../game/starswarm/render/hudStyle";

describe("LivesIndicator", () => {
  it("renders one mini ship per life", async () => {
    await render(<LivesIndicator lives={3} />);
    expect(screen.getAllByTestId("starswarm-life", { includeHiddenElements: true })).toHaveLength(
      3
    );
  });

  it("renders no ships at zero lives", async () => {
    await render(<LivesIndicator lives={0} />);
    expect(screen.queryAllByTestId("starswarm-life", { includeHiddenElements: true })).toHaveLength(
      0
    );
  });

  it("#3598: draws the default ship (P1) unless the player chose another (#3600)", async () => {
    const { rerender } = await render(<LivesIndicator lives={2} />);
    const src = () =>
      screen.getAllByTestId("starswarm-life", { includeHiddenElements: true })[0]!.props.source;
    expect(src()).toBe(SHIP_BASE_IMAGE.p1);
    await rerender(<LivesIndicator lives={2} ship="p3" />);
    expect(src()).toBe(SHIP_BASE_IMAGE.p3);
  });

  it("#3598: is a right-aligned row in the column's flow, icons sized from the shared layout", async () => {
    await render(<LivesIndicator lives={2} />);
    const row = StyleSheet.flatten(screen.getByTestId("starswarm-lives").props.style);
    expect(row.position).toBeUndefined();
    expect(row.bottom).toBeUndefined();
    expect(row.flexDirection).toBe("row");
    expect(row.justifyContent).toBe("flex-end");
    expect(row.alignSelf).toBe("flex-end");
    expect(row.gap).toBe(HUD_LAYOUT.lifeGap);
    const icon = StyleSheet.flatten(
      screen.getAllByTestId("starswarm-life", { includeHiddenElements: true })[0]!.props.style
    );
    expect(icon.width).toBe(HUD_LAYOUT.lifeIcon);
    expect(icon.height).toBe(HUD_LAYOUT.lifeIcon);
  });

  it("ignores touches and exposes the count to screen readers", async () => {
    await render(<LivesIndicator lives={4} />);
    const row = screen.getByTestId("starswarm-lives");
    expect(row.props.pointerEvents).toBe("none");
    expect(row.props.accessibilityLabel).toBe("Lives: 4");
  });
});
