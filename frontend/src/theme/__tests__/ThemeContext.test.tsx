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

describe("ThemeContext — render stability (#2964)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUseColorScheme.mockReturnValue("dark");
  });

  const onRender = jest.fn();
  const Consumer = React.memo(function Consumer() {
    onRender(useTheme());
    return null;
  });
  const consumer = <Consumer />;

  it("does not re-render consumers when the provider re-renders with the same state", async () => {
    onRender.mockClear();
    const api = await renderAndSettle(<ThemeProvider>{consumer}</ThemeProvider>);
    const rendersAfterLoad = onRender.mock.calls.length;
    const first = onRender.mock.calls.at(-1)![0];

    // The provider renders again (its parent did); nothing it holds changed.
    await api.rerender(<ThemeProvider>{consumer}</ThemeProvider>);
    await api.rerender(<ThemeProvider>{consumer}</ThemeProvider>);

    expect(onRender).toHaveBeenCalledTimes(rendersAfterLoad);
    expect(onRender.mock.calls.at(-1)![0]).toBe(first);
  });

  it("keeps the setters' identity across renders and re-renders once when the mode changes", async () => {
    onRender.mockClear();
    const api = await renderAndSettle(<ThemeProvider>{consumer}</ThemeProvider>);
    const before = onRender.mock.calls.at(-1)![0];
    const rendersBefore = onRender.mock.calls.length;

    await act(async () => {
      before.setThemeMode("light");
    });
    expect(onRender).toHaveBeenCalledTimes(rendersBefore + 1);
    const after = onRender.mock.calls.at(-1)![0];
    expect(after.theme).toBe("light");
    expect(after.setThemeMode).toBe(before.setThemeMode);

    await api.rerender(<ThemeProvider>{consumer}</ThemeProvider>);
    expect(onRender).toHaveBeenCalledTimes(rendersBefore + 1);
    expect(onRender.mock.calls.at(-1)![0].toggle).toBe(after.toggle);
  });
});
