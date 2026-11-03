import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SettingsScreen from "../SettingsScreen";
import { __forceStoreBuildForTests } from "../../game/_shared/buildFlavour";
import { isDragDebugEnabled, resetDragDebugForTests } from "../../game/_shared/drag/dragDebug";

jest.mock("../../components/LanguageSwitcher", () => ({
  __esModule: true,
  default: "MockLanguageSwitcher",
}));

const ORIGINAL_HOOKS = process.env.EXPO_PUBLIC_TEST_HOOKS;

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <SettingsScreen />
    </ThemeProvider>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  resetDragDebugForTests();
});

afterEach(() => {
  __forceStoreBuildForTests(false);
  if (ORIGINAL_HOOKS === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL_HOOKS;
  resetDragDebugForTests();
});

describe("Settings: Drag debug overlay (#3529)", () => {
  it("is shown in an internal build, off by default, and toggling it persists", async () => {
    await renderScreen();
    const toggle = screen.getByTestId("drag-debug-toggle");
    expect(toggle.props.value).toBe(false);
    await fireEvent(toggle, "valueChange", true);
    expect(isDragDebugEnabled()).toBe(true);
    await waitFor(async () => expect(await AsyncStorage.getItem("drag_debug_overlay")).toBe("1"));
    expect(screen.getByTestId("drag-debug-toggle").props.value).toBe(true);
  });

  it("starts on when test hooks are enabled", async () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    resetDragDebugForTests();
    await renderScreen();
    expect(screen.getByTestId("drag-debug-toggle").props.value).toBe(true);
  });

  it("is hidden in a store build, even with a stale stored 'on'", async () => {
    await AsyncStorage.setItem("drag_debug_overlay", "1");
    __forceStoreBuildForTests(true);
    await renderScreen();
    expect(screen.queryByTestId("drag-debug-toggle")).toBeNull();
    expect(isDragDebugEnabled()).toBe(false);
  });
});
