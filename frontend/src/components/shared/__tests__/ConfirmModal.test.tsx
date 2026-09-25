import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { ConfirmModal } from "../ConfirmModal";
import NewGameConfirmModal from "../NewGameConfirmModal";

async function renderConfirm(props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await render(
    <ThemeProvider>
      <ConfirmModal
        visible
        title="Delete?"
        body="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={onConfirm}
        onCancel={onCancel}
        testID="dlg"
        {...props}
      />
    </ThemeProvider>
  );
  return { onConfirm, onCancel };
}

describe("ConfirmModal", () => {
  it("shows title and body and routes each button to its handler", async () => {
    const { onConfirm, onCancel } = await renderConfirm();
    expect(screen.getByText("Delete?")).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("dlg-confirm"));
    await fireEvent.press(screen.getByTestId("dlg-cancel"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  const buttonLabels = () =>
    screen.getAllByRole("button").map((b) => b.props.accessibilityLabel as string);

  it("puts confirm above cancel by default", async () => {
    await renderConfirm();
    expect(buttonLabels()).toEqual(["Delete", "Keep"]);
  });

  it("puts cancel above confirm by default when destructive", async () => {
    await renderConfirm({ destructive: true });
    expect(buttonLabels()).toEqual(["Keep", "Delete"]);
  });

  it("puts cancel above confirm when cancelFirst is set", async () => {
    await renderConfirm({ cancelFirst: true });
    expect(buttonLabels()).toEqual(["Keep", "Delete"]);
  });
});

describe("NewGameConfirmModal", () => {
  it("keeps its default new-game copy", async () => {
    const onConfirm = jest.fn();
    await render(
      <ThemeProvider>
        <NewGameConfirmModal visible onConfirm={onConfirm} onCancel={jest.fn()} />
      </ThemeProvider>
    );
    await fireEvent.press(screen.getByRole("button", { name: "Start new game" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
