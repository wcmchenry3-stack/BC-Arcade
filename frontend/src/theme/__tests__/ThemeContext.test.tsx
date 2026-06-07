import React from "react";
import { Text, Pressable } from "react-native";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider, useTheme } from "../ThemeContext";

// ThemeProvider runs an AsyncStorage read in a useEffect; flush the microtask
// queue so the resulting state update lands inside act() and doesn't warn.
async function renderAndSettle(ui: React.ReactElement) {
  const result = await render(ui);
  await act(async () => {});
  return result;
}

const mockUseColorScheme = jest.fn<"light" | "dark" | null, []>(() => "dark");
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockUseColorScheme(),
}));

function Probe() {
  const { theme, themeMode, setThemeMode, toggle } = useTheme();
  return (
    <>
      <Text testID="theme">{theme}</Text>
      <Text testID="mode">{themeMode}</Text>
      <Pressable testID="set-light" onPress={() => setThemeMode("light")}>
        <Text>set-light</Text>
      </Pressable>
      <Pressable testID="set-system" onPress={() => setThemeMode("system")}>
        <Text>set-system</Text>
      </Pressable>
      <Pressable testID="toggle" onPress={() => toggle()}>
        <Text>toggle</Text>
      </Pressable>
    </>
  );
}

describe("ThemeContext", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUseColorScheme.mockReturnValue("dark");
  });

  it("defaults to dark when no prior selection exists", async () => {
    await renderAndSettle(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId("theme").props.children).toBe("dark");
    expect(screen.getByTestId("mode").props.children).toBe("dark");
  });

  it("persists an explicit mode selection via AsyncStorage", async () => {
    await renderAndSettle(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await fireEvent.press(screen.getByTestId("set-light"));
    expect(screen.getByTestId("mode").props.children).toBe("light");
    expect(screen.getByTestId("theme").props.children).toBe("light");
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("gaming_app_theme_mode")).toBe("light");
    });
  });

  it("resolves 'system' mode against the OS colour scheme", async () => {
    mockUseColorScheme.mockReturnValue("light");
    await renderAndSettle(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await fireEvent.press(screen.getByTestId("set-system"));
    expect(screen.getByTestId("mode").props.children).toBe("system");
    expect(screen.getByTestId("theme").props.children).toBe("light");
  });

  it("migrates the legacy 'gaming_app_theme' key into the new mode slot", async () => {
    await AsyncStorage.setItem("gaming_app_theme", "light");
    await renderAndSettle(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("mode").props.children).toBe("light");
    });
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("gaming_app_theme_mode")).toBe("light");
    });
  });

  it("toggle() flips between light and dark, leaving system as an explicit choice", async () => {
    await renderAndSettle(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    // Starts dark → toggle → light
    await act(async () => {
      await fireEvent.press(screen.getByTestId("toggle"));
    });
    expect(screen.getByTestId("theme").props.children).toBe("light");
    expect(screen.getByTestId("mode").props.children).toBe("light");
    // Toggle again → dark
    await act(async () => {
      await fireEvent.press(screen.getByTestId("toggle"));
    });
    expect(screen.getByTestId("theme").props.children).toBe("dark");
    expect(screen.getByTestId("mode").props.children).toBe("dark");
  });
});
