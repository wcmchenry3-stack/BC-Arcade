/**
 * SeatPlate (#3587): the card table's name plate. Its contents, its turn glow and its
 * one accessibility label (name, score, this hand's points, their turn).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider, useTheme } from "../../../theme/ThemeContext";
import SeatPlate from "../SeatPlate";
import { computeHeartsGeometry } from "../../../game/hearts/layout";
import EsHearts from "../../../i18n/locales/es/hearts.json";

const GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 });

function Probe({ onColors }: { onColors: (c: { accent: string; border: string }) => void }) {
  const { colors } = useTheme();
  onColors({ accent: colors.accent, border: colors.border });
  return null;
}

async function plate(props: Partial<React.ComponentProps<typeof SeatPlate>> = {}) {
  const colors = { accent: "", border: "" };
  const api = await render(
    <ThemeProvider>
      <Probe onColors={(c) => Object.assign(colors, c)} />
      <SeatPlate
        name="West"
        score={52}
        handPoints={0}
        isTurn={false}
        plate={GEOMETRY.plates.left}
        height={GEOMETRY.plateHeight}
        onPress={jest.fn()}
        testID="plate"
        {...props}
      />
    </ThemeProvider>
  );
  return { ...api, colors };
}

afterEach(async () => {
  await cleanup();
  await i18n.changeLanguage("en");
});

describe("SeatPlate contents", () => {
  it("shows the name and the game score", async () => {
    const { getByText } = await plate();
    expect(getByText("West")).toBeTruthy();
    expect(getByText("52")).toBeTruthy();
  });

  it("shows no hand points while there are none", async () => {
    const { queryByText } = await plate({ handPoints: 0 });
    expect(queryByText(/^\+\d+♥$/)).toBeNull();
  });

  it("shows +N♥ once the hand's points are above 0", async () => {
    const { getByText, rerender } = await plate({ handPoints: 4 });
    expect(getByText("+4♥")).toBeTruthy();
    await rerender(
      <ThemeProvider>
        <SeatPlate
          name="West"
          score={52}
          handPoints={17}
          isTurn={false}
          plate={GEOMETRY.plates.left}
          height={GEOMETRY.plateHeight}
          onPress={jest.fn()}
          testID="plate"
        />
      </ThemeProvider>
    );
    expect(getByText("+17♥")).toBeTruthy();
  });

  it("keeps a long name on one line", async () => {
    const { getByText } = await plate({ name: "A very long player name indeed ok" });
    expect(getByText("A very long player name indeed ok").props.numberOfLines).toBe(1);
  });

  it("opens the seat's cards when pressed", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await plate({ onPress });
    await fireEvent.press(getByTestId("plate"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("SeatPlate turn glow", () => {
  it("has the accent border and glow only on the player whose turn it is", async () => {
    const turn = await plate({ isTurn: true });
    const glow = StyleSheet.flatten(turn.getByTestId("plate").props.style);
    expect(glow.borderColor).toBe(turn.colors.accent);
    expect(glow.shadowColor).toBe(turn.colors.accent);
    expect(glow.shadowOpacity).toBeGreaterThan(0);
    await cleanup();

    const idle = await plate({ isTurn: false });
    const flat = StyleSheet.flatten(idle.getByTestId("plate").props.style);
    expect(flat.borderColor).toBe(idle.colors.border);
    expect(flat.borderColor).not.toBe(idle.colors.accent);
    expect(flat.shadowOpacity).toBeUndefined();
  });
});

describe("SeatPlate accessibility label", () => {
  it("says the name and score", async () => {
    const { getByLabelText } = await plate();
    expect(getByLabelText("West, score 52")).toBeTruthy();
  });

  it("adds this hand's points when there are some", async () => {
    const { getByLabelText } = await plate({ handPoints: 4 });
    expect(getByLabelText("West, score 52, 4 points this hand")).toBeTruthy();
  });

  it("adds their turn", async () => {
    const { getByLabelText } = await plate({ isTurn: true });
    expect(getByLabelText("West, score 52, their turn")).toBeTruthy();
  });

  it("says all of it together", async () => {
    const { getByLabelText } = await plate({ handPoints: 13, isTurn: true });
    expect(getByLabelText("West, score 52, 13 points this hand, their turn")).toBeTruthy();
  });

  it("is a button that says what pressing does", async () => {
    const { getByRole } = await plate();
    const button = getByRole("button", { name: /^West/ });
    expect(button.props.accessibilityHint).toBe("Shows the cards taken");
  });

  it("is localized", async () => {
    i18n.addResourceBundle("es", "hearts", EsHearts, true, true);
    await i18n.changeLanguage("es");
    const { getByLabelText } = await plate({ name: "Oeste", handPoints: 4, isTurn: true });
    expect(getByLabelText("Oeste, puntuación 52, 4 puntos en esta mano, su turno")).toBeTruthy();
  });
});
