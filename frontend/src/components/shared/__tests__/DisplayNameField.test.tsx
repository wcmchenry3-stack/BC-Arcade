import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import DisplayNameField from "../DisplayNameField";
import { loadDisplayName, resetDisplayNameCacheForTests } from "../../../game/_shared/displayName";

async function renderField(onSaved?: (name: string) => void) {
  await render(
    <ThemeProvider>
      <DisplayNameField label="Display name" helper="Shown on leaderboards." onSaved={onSaved} />
    </ThemeProvider>
  );
  await waitFor(() => expect(screen.getByLabelText("Display name")).toBeTruthy());
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
});

describe("DisplayNameField", () => {
  it("pre-fills the stored name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    await renderField();
    await waitFor(() => expect(screen.getByLabelText("Display name").props.value).toBe("Riley"));
  });

  it("keeps typed text when the stored name finishes loading afterwards", async () => {
    // Hold the stored-name read open until after the player has typed.
    let releaseRead: (value: string) => void = () => {};
    const getItem = AsyncStorage.getItem as jest.Mock;
    const realGetItem = getItem.getMockImplementation();
    getItem.mockImplementation((key: string) =>
      key === "player_display_name"
        ? new Promise<string>((resolve) => (releaseRead = resolve))
        : realGetItem?.(key)
    );
    try {
      await renderField();
      await fireEvent.changeText(screen.getByLabelText("Display name"), "Sam");
      await act(async () => releaseRead("Riley"));
      expect(screen.getByLabelText("Display name").props.value).toBe("Sam");
    } finally {
      getItem.mockImplementation(realGetItem);
    }
  });

  it("disables Save while the name is empty or unchanged", async () => {
    await renderField();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText("Display name"), "   ");
    expect(screen.getByRole("button", { name: "Save" }).props.accessibilityState.disabled).toBe(
      true
    );
  });

  it("saves a valid name and reports it", async () => {
    const onSaved = jest.fn();
    await renderField(onSaved);

    await fireEvent.changeText(screen.getByLabelText("Display name"), " Riley ");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));

    expect(onSaved).toHaveBeenCalledWith("Riley");
    await expect(loadDisplayName()).resolves.toBe("Riley");
    expect(screen.getByText("Saved. Your scores will use this name.")).toBeTruthy();
  });

  it("shows an error when storage fails", async () => {
    await renderField();

    await fireEvent.changeText(screen.getByLabelText("Display name"), "Riley");
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Couldn't save your name. Try again.")).toBeTruthy();
  });

  // The Maestro result-submission flow (#2643) types into `-input` and
  // submits with the keyboard's return key, falling back to `-save`.
  it("derives input and Save testIDs from its testID, and saves on submit", async () => {
    const onSaved = jest.fn();
    await render(
      <ThemeProvider>
        <DisplayNameField label="Display name" helper="h" onSaved={onSaved} testID="prompt" />
      </ThemeProvider>
    );
    const input = await screen.findByTestId("prompt-input");
    expect(input).toBe(screen.getByLabelText("Display name"));
    expect(screen.getByTestId("prompt-save")).toBe(screen.getByRole("button", { name: "Save" }));

    await fireEvent.changeText(input, "Maestro12345");
    await fireEvent(input, "submitEditing");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Maestro12345"));
  });

  it("adds no testIDs when it has none", async () => {
    await renderField();
    expect(screen.queryByTestId("undefined-input")).toBeNull();
    expect(screen.getByLabelText("Display name").props.testID).toBeUndefined();
  });
});
