/** #2150: the lives row lives in the top HUD band, never the ship's bottom band. */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import LivesIndicator from "../LivesIndicator";

describe("LivesIndicator", () => {
  it("renders one block per life", async () => {
    await render(<LivesIndicator lives={3} />);
    expect(screen.getAllByTestId("starswarm-life")).toHaveLength(3);
  });

  it("renders no blocks at zero lives", async () => {
    await render(<LivesIndicator lives={0} />);
    expect(screen.queryAllByTestId("starswarm-life")).toHaveLength(0);
  });

  it("is anchored from the top, not the bottom (clear of the ship)", async () => {
    await render(<LivesIndicator lives={2} />);
    const style = StyleSheet.flatten(screen.getByTestId("starswarm-lives").props.style);
    expect(style.top).toBeGreaterThan(0);
    expect(style.bottom).toBeUndefined();
  });

  it("ignores touches and exposes the count to screen readers", async () => {
    await render(<LivesIndicator lives={4} />);
    const row = screen.getByTestId("starswarm-lives");
    expect(row.props.pointerEvents).toBe("none");
    expect(row.props.accessibilityLabel).toBe("Lives: 4");
  });
});
