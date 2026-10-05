/**
 * Rendering helpers for the StarSwarmScreen suites (#2957). Not a test file.
 * The canvas and audio stand-ins the screen is rendered against are in
 * starSwarmMocks; they are kept apart because mock factories require those, and
 * this module imports the screen.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import StarSwarmScreen from "../../StarSwarmScreen";
import { ThemeProvider } from "../../../theme/ThemeContext";

/** Renders the screen and gives the canvas container a size, so the canvas mounts. */
export async function renderScreen() {
  const view = await render(
    <ThemeProvider>
      <StarSwarmScreen />
    </ThemeProvider>
  );
  // The game mounts once any run a previous process saved has loaded (#2645).
  const outer = await view.findByTestId("starswarm-canvas-outer");
  await act(async () => {
    await fireEvent(outer, "layout", {
      nativeEvent: { layout: { width: 400, height: 700 } },
    });
  });
  return view;
}

/** Starts a run from the difficulty picker. */
export async function startRun() {
  await act(async () => {
    await fireEvent.press(screen.getByTestId("starswarm-start-game"));
  });
}

/** The screen with a run under way. */
export async function renderRun() {
  const view = await renderScreen();
  await startRun();
  return view;
}
