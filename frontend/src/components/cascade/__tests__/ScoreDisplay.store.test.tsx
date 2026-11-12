/** #2960: ScoreDisplay reads the live score from the screen's store, and is memoized. */
import React, { Profiler } from "react";
import { act, render, screen } from "@testing-library/react-native";
import ScoreDisplay from "../ScoreDisplay";
import ThemeSelector from "../ThemeSelector";
import NextFruitPreview from "../NextFruitPreview";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { createScoreStore } from "../../../game/cascade/scoreStore";

describe("ScoreDisplay with a ScoreStore", () => {
  it("shows the store's score and updates once per new integer", async () => {
    const store = createScoreStore(3);
    let renders = 0;
    await render(
      <ThemeProvider>
        <Profiler
          id="score"
          onRender={() => {
            renders++;
          }}
        >
          <ScoreDisplay store={store} />
        </Profiler>
      </ThemeProvider>
    );
    expect(screen.getByText("3")).toBeTruthy();
    renders = 0;
    await act(async () => {
      store.set(3);
      store.set(3.2);
    });
    expect(renders).toBe(0);
    await act(async () => {
      store.set(40);
    });
    expect(screen.getByText("40")).toBeTruthy();
    expect(renders).toBe(1);
  });

  it("still takes a plain score prop", async () => {
    await render(
      <ThemeProvider>
        <ScoreDisplay score={12} />
      </ThemeProvider>
    );
    expect(screen.getByText("12")).toBeTruthy();
  });
});

describe("memoized Cascade header components (#2960)", () => {
  it.each([
    ["ScoreDisplay", ScoreDisplay],
    ["ThemeSelector", ThemeSelector],
    ["NextFruitPreview", NextFruitPreview],
  ])("%s is wrapped in React.memo", (_name, component) => {
    expect((component as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });
});
