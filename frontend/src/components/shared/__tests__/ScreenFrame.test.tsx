import React from "react";
import { StyleSheet, Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { ScreenFrame } from "../ScreenFrame";
import { APP_HEADER_HEIGHT } from "../AppHeader";

const mockInsets = { top: 44, bottom: 0, left: 0, right: 0 };
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock("../../../theme/ThemeContext", () => ({
  useTheme: () => ({ colors: { background: "#0e0e13" }, theme: "dark" }),
}));

async function frameStyle(props: React.ComponentProps<typeof ScreenFrame> = {}) {
  await render(
    <ScreenFrame {...props}>
      <Text>content</Text>
    </ScreenFrame>
  );
  const root = screen.toJSON() as { props: { style: unknown } };
  return StyleSheet.flatten(root.props.style as never) as Record<string, unknown>;
}

afterEach(() => {
  mockInsets.bottom = 0;
});

describe("ScreenFrame (#2976)", () => {
  it("renders its children in a full-height themed container under the header", async () => {
    const style = await frameStyle();
    expect(screen.getByText("content")).toBeTruthy();
    expect(style.flex).toBe(1);
    expect(style.backgroundColor).toBe("#0e0e13");
    expect(style.paddingTop).toBe(APP_HEADER_HEIGHT + 44);
  });

  it("clears the bottom safe area, at least 16", async () => {
    expect((await frameStyle()).paddingBottom).toBe(16);
    mockInsets.bottom = 34;
    expect((await frameStyle()).paddingBottom).toBe(34);
  });

  it("leaves the bottom to the screen with padBottom={false}", async () => {
    mockInsets.bottom = 34;
    expect((await frameStyle({ padBottom: false })).paddingBottom).toBeUndefined();
  });
});
