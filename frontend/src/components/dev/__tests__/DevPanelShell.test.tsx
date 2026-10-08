/**
 * DevPanelShell (#2978): the DEV button, the modal and sidebar panels, and the
 * controls the per-game dev panels are built from.
 */
import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { DEV_ACCENT, DEV_ACCENT_MUTED, DEV_SURFACE_SUBTLE } from "../../../theme/theme.constants";
import {
  DevActionButton,
  DevButton,
  DevPanelShell,
  DevRow,
  DevSection,
  DevStepper,
  DevToggle,
  type DevPanelShellProps,
} from "../DevPanelShell";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

/** A shell whose open state is its own, as a screen holds it. */
function Harness(props: Partial<DevPanelShellProps>) {
  const [open, setOpen] = useState(false);
  return (
    <DevPanelShell
      enabled
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      title="Test Panel"
      {...props}
    >
      <Text>panel body</Text>
      <DevActionButton label="Close" onPress={() => setOpen(false)} />
    </DevPanelShell>
  );
}

const press = (el: Parameters<typeof fireEvent.press>[0]) =>
  act(async () => {
    await fireEvent.press(el);
  });

describe("DevPanelShell", () => {
  it.each(["modal", "sidebar"] as const)(
    "%s: opens from the DEV button and closes from its own button",
    async (variant) => {
      await wrap(<Harness variant={variant} />);
      expect(screen.queryByText("Test Panel")).toBeNull();
      expect(screen.queryByText("panel body")).toBeNull();
      await press(screen.getByText("DEV"));
      expect(screen.getByText("Test Panel")).toBeTruthy();
      expect(screen.getByText("panel body")).toBeTruthy();
      await press(screen.getByText("Close"));
      expect(screen.queryByText("Test Panel")).toBeNull();
    }
  );

  it("modal: the back button / Escape request closes it", async () => {
    await wrap(<Harness testID="shell" />);
    await press(screen.getByText("DEV"));
    await act(async () => {
      await fireEvent(screen.getByTestId("shell"), "requestClose");
    });
    expect(screen.queryByText("Test Panel")).toBeNull();
  });

  it("renders nothing when disabled, open or not", async () => {
    const onOpen = jest.fn();
    await wrap(
      <DevPanelShell enabled={false} open onOpen={onOpen} onClose={jest.fn()} title="Hidden">
        <Text>panel body</Text>
      </DevPanelShell>
    );
    expect(screen.queryByText("DEV")).toBeNull();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.queryByText("panel body")).toBeNull();
    await wrap(
      <DevPanelShell
        enabled={false}
        open
        variant="sidebar"
        onClose={jest.fn()}
        title="Hidden sidebar"
      />
    );
    expect(screen.queryByText("Hidden sidebar")).toBeNull();
  });

  it("leaves the DEV button out with showButton={false} or no onOpen", async () => {
    await wrap(<Harness showButton={false} />);
    expect(screen.queryByText("DEV")).toBeNull();
    await wrap(<DevPanelShell enabled open={false} onClose={jest.fn()} title="No opener" />);
    expect(screen.queryByText("DEV")).toBeNull();
  });

  it("sidebar: exposes its accessibility label, and can lay out without a ScrollView", async () => {
    await wrap(
      <DevPanelShell
        enabled
        open
        onClose={jest.fn()}
        variant="sidebar"
        scroll={false}
        title="Side"
        accessibilityLabel="Developer panel"
        accessibilityRole="menu"
      >
        <Text>side body</Text>
      </DevPanelShell>
    );
    expect(screen.getByLabelText("Developer panel")).toBeTruthy();
    expect(screen.getByText("side body")).toBeTruthy();
    expect(screen.getByText("Side")).toBeTruthy();
  });

  it("styles the title with the dev accent, overridable", async () => {
    await wrap(
      <DevPanelShell
        enabled
        open
        onClose={jest.fn()}
        variant="sidebar"
        title="Styled"
        titleStyle={{ fontSize: 11 }}
      />
    );
    const title = StyleSheet.flatten(screen.getByText("Styled").props.style);
    expect(title.color).toBe(DEV_ACCENT);
    expect(title.fontSize).toBe(11);
  });
});

describe("DevButton", () => {
  it("fires onPress, and renders nothing when disabled", async () => {
    const onPress = jest.fn();
    const view = await wrap(<DevButton enabled onPress={onPress} position="bottom-right" />);
    await press(screen.getByText("DEV"));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(
      <ThemeProvider>
        <DevButton enabled={false} onPress={onPress} />
      </ThemeProvider>
    );
    expect(screen.queryByText("DEV")).toBeNull();
  });
});

describe("controls", () => {
  it("DevSection frames its title and keeps its children", async () => {
    await wrap(
      <DevSection title="Sound">
        <Text>child</Text>
      </DevSection>
    );
    const header = screen.getByText("── Sound ──");
    expect(StyleSheet.flatten(header.props.style).color).toBe(DEV_ACCENT_MUTED);
    expect(screen.getByText("child")).toBeTruthy();
    await wrap(<DevSection title="Muted" color="#123456" />);
    expect(StyleSheet.flatten(screen.getByText("── Muted ──").props.style).color).toBe("#123456");
  });

  it("DevRow shows its label and value", async () => {
    await wrap(<DevRow label="Rocks spawned" value={7} />);
    expect(screen.getByText("Rocks spawned")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it.each(["row", "column"] as const)("DevStepper (%s) steps both ways", async (layout) => {
    const onDecrement = jest.fn();
    const onIncrement = jest.fn();
    await wrap(
      <DevStepper
        layout={layout}
        label="Wave"
        value={3}
        onDecrement={onDecrement}
        onIncrement={onIncrement}
        decrementLabel="Decrease wave"
        incrementLabel="Increase wave"
      />
    );
    expect(screen.getByText("3")).toBeTruthy();
    await press(screen.getByLabelText("Increase wave"));
    await press(screen.getByLabelText("Decrease wave"));
    await press(screen.getByLabelText("Decrease wave"));
    expect(onIncrement).toHaveBeenCalledTimes(1);
    expect(onDecrement).toHaveBeenCalledTimes(2);
  });

  it("DevToggle labels its switch and reports changes", async () => {
    const onValueChange = jest.fn();
    await wrap(<DevToggle label="Rout off" value={false} onValueChange={onValueChange} />);
    expect(screen.getByText("Rout off")).toBeTruthy();
    await act(async () => {
      await fireEvent(screen.getByLabelText("Rout off"), "valueChange", true);
    });
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it("DevActionButton fires onPress; primary is solid accent", async () => {
    const onPress = jest.fn();
    const onPrimary = jest.fn();
    await wrap(
      <>
        <DevActionButton label="Kill escorts" onPress={onPress} testID="plain" />
        <DevActionButton
          label="New Game"
          variant="primary"
          onPress={onPrimary}
          accessibilityLabel="Start a dev game"
          testID="primary"
        />
      </>
    );
    await press(screen.getByText("Kill escorts"));
    await press(screen.getByLabelText("Start a dev game"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(screen.getByTestId("plain").props.style).backgroundColor).toBe(
      DEV_SURFACE_SUBTLE
    );
    expect(StyleSheet.flatten(screen.getByTestId("primary").props.style).backgroundColor).toBe(
      DEV_ACCENT
    );
  });
});
