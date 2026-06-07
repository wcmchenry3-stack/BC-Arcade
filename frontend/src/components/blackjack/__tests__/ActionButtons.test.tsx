import React from "react";
import { render } from "@testing-library/react-native";
import ActionButtons from "../ActionButtons";
import { ThemeProvider } from "../../../theme/ThemeContext";

// ---------------------------------------------------------------------------
// Mock icon libraries — string mocks are the safest approach for Expo
// vector-icons in Jest: no require(), no ESLint violations, and the
// component renders as a plain native view so other assertions still work.
// ---------------------------------------------------------------------------
jest.mock("@expo/vector-icons/MaterialIcons", () => "MockMaterialIcons");
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => "MockMaterialCommunityIcons");

async function renderButtons(
  opts: {
    doubleDownAvailable?: boolean;
    splitAvailable?: boolean;
  } = {}
) {
  const { doubleDownAvailable = true, splitAvailable = false } = opts;
  return await render(
    <ThemeProvider>
      <ActionButtons
        onHit={jest.fn()}
        onStand={jest.fn()}
        onDoubleDown={jest.fn()}
        onSplit={jest.fn()}
        doubleDownAvailable={doubleDownAvailable}
        splitAvailable={splitAvailable}
        loading={false}
      />
    </ThemeProvider>
  );
}

describe("ActionButtons", () => {
  it("renders Hit, Stand, Double Down, and Split button labels", async () => {
    const { getByText } = await renderButtons();
    expect(getByText("Hit")).toBeTruthy();
    expect(getByText("Stand")).toBeTruthy();
    expect(getByText("Double Down")).toBeTruthy();
    expect(getByText("Split")).toBeTruthy();
  });

  it("Double Down has disabled accessibility label when doubleDownAvailable is false", async () => {
    const { getByLabelText } = await renderButtons({ doubleDownAvailable: false });
    expect(getByLabelText("Double down not available")).toBeTruthy();
  });

  it("Double Down has enabled accessibility label when doubleDownAvailable is true", async () => {
    const { getByLabelText } = await renderButtons({ doubleDownAvailable: true });
    expect(getByLabelText("Double down — double bet and take one card")).toBeTruthy();
  });

  it("Double Down button has accessibilityState disabled=true when unavailable", async () => {
    const { getByLabelText } = await renderButtons({ doubleDownAvailable: false });
    const btn = getByLabelText("Double down not available");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it("Double Down button has accessibilityState disabled=false when available", async () => {
    const { getByLabelText } = await renderButtons({ doubleDownAvailable: true });
    const btn = getByLabelText("Double down — double bet and take one card");
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  it("Split has disabled accessibility label when splitAvailable is false", async () => {
    const { getByLabelText } = await renderButtons({ splitAvailable: false });
    expect(getByLabelText("Split not available")).toBeTruthy();
  });

  it("Split has enabled accessibility label when splitAvailable is true", async () => {
    const { getByLabelText } = await renderButtons({ splitAvailable: true });
    expect(getByLabelText("Split — split pair into two hands")).toBeTruthy();
  });

  it("Split button has accessibilityState disabled=true when unavailable", async () => {
    const { getByLabelText } = await renderButtons({ splitAvailable: false });
    const btn = getByLabelText("Split not available");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it("Split button has accessibilityState disabled=false when available", async () => {
    const { getByLabelText } = await renderButtons({ splitAvailable: true });
    const btn = getByLabelText("Split — split pair into two hands");
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });
});
