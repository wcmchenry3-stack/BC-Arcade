/**
 * YachtDevPanel (#2978): the dice override for the next human roll.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import YachtDevPanel from "../YachtDevPanel";

function renderPanel(enabled = true, open = true) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  const onOpen = jest.fn();
  const view = render(
    <ThemeProvider>
      <YachtDevPanel
        enabled={enabled}
        open={open}
        onOpen={onOpen}
        onClose={onClose}
        onApply={onApply}
      />
    </ThemeProvider>
  );
  return { view, onApply, onClose, onOpen };
}

const press = (label: string) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });

describe("YachtDevPanel", () => {
  it("renders nothing when disabled", async () => {
    await renderPanel(false).view;
    expect(screen.queryByText("DEV")).toBeNull();
    expect(screen.queryByText("Yacht Dev Panel")).toBeNull();
  });

  it("opens from its DEV button", async () => {
    const { view, onOpen } = renderPanel(true, false);
    await view;
    await act(async () => {
      await fireEvent.press(screen.getByText("DEV"));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("steps each die between 1 and 6 and applies them on the next roll", async () => {
    const { view, onApply, onClose } = renderPanel();
    await view;
    expect(screen.getByText("Yacht Dev Panel")).toBeTruthy();
    for (let i = 0; i < 4; i++) await press("Increase die 1");
    for (let i = 0; i < 4; i++) await press("Decrease die 5");
    await act(async () => {
      await fireEvent.press(screen.getByText("Apply on next roll"));
    });
    expect(onApply).toHaveBeenCalledWith([6, 3, 3, 3, 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("loads a preset", async () => {
    const { view, onApply } = renderPanel();
    await view;
    await act(async () => {
      await fireEvent.press(screen.getByText("Full House [2,2,2,5,5]"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("Apply on next roll"));
    });
    expect(onApply).toHaveBeenCalledWith([2, 2, 2, 5, 5]);
  });

  it("closes without applying", async () => {
    const { view, onApply, onClose } = renderPanel();
    await view;
    await act(async () => {
      await fireEvent.press(screen.getByText("Close"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
