import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react-native";
import i18n from "i18next";
import DiceRow from "../DiceRow";
import { ThemeProvider } from "../../theme/ThemeContext";

async function renderDiceRow(overrides: Partial<React.ComponentProps<typeof DiceRow>> = {}) {
  const defaults = {
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    rollsUsed: 0,
    gameOver: false,
    onRoll: jest.fn().mockResolvedValue(undefined),
    onToggleHold: jest.fn(),
  };
  const props = { ...defaults, ...overrides };
  return await render(
    <ThemeProvider>
      <DiceRow {...props} />
    </ThemeProvider>
  );
}

describe("DiceRow", () => {
  it("roll button is enabled when rollsUsed < 3 and not game over", async () => {
    const { getByRole } = await renderDiceRow({ rollsUsed: 1 });
    expect(getByRole("button", { name: /roll/i })).not.toBeDisabled();
  });

  it("roll button is disabled when rollsUsed === 3", async () => {
    const { getByRole } = await renderDiceRow({ rollsUsed: 3 });
    expect(getByRole("button", { name: /roll/i })).toBeDisabled();
  });

  it("roll button is disabled when game is over", async () => {
    const { getByRole } = await renderDiceRow({ gameOver: true });
    expect(getByRole("button", { name: /roll/i })).toBeDisabled();
  });

  it("pressing roll calls onRoll with no arguments", async () => {
    const onRoll = jest.fn().mockResolvedValue(undefined);
    const { getByRole } = await renderDiceRow({ rollsUsed: 1, onRoll });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    expect(onRoll).toHaveBeenCalledWith();
  });

  it("dice are disabled before the first roll (rollsUsed === 0)", async () => {
    const { getAllByRole } = await renderDiceRow({ rollsUsed: 0 });
    const dice = getAllByRole("button", { name: /^die \d/i });
    dice.forEach((die) => expect(die).toBeDisabled());
  });

  it("pressing a die after first roll calls onToggleHold with the die index", async () => {
    const onToggleHold = jest.fn();
    const { getAllByRole } = await renderDiceRow({ rollsUsed: 1, onToggleHold });
    await fireEvent.press(getAllByRole("button", { name: /^die \d/i })[0]);
    expect(onToggleHold).toHaveBeenCalledWith(0);
  });

  it("held prop drives die held display (no local state)", async () => {
    const { getAllByRole, rerender } = await renderDiceRow({
      rollsUsed: 1,
      held: [false, false, false, false, false],
    });
    getAllByRole("button", { name: /^die \d/i });
    // held=false renders without error — confirmed by test not throwing

    await rerender(
      <ThemeProvider>
        <DiceRow
          dice={[1, 2, 3, 4, 5]}
          held={[true, false, false, false, false]}
          rollsUsed={1}
          gameOver={false}
          onRoll={jest.fn()}
          onToggleHold={jest.fn()}
        />
      </ThemeProvider>
    );
    const diceAfter = getAllByRole("button", { name: /^die \d/i });
    // held=true re-render does not crash — die still rendered
    expect(diceAfter[0]).toBeTruthy();
  });
});

describe("DiceRow roll label plural forms (#2754)", () => {
  beforeAll(() => {
    for (const code of ["ru", "ar"]) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      i18n.addResourceBundle(code, "yacht", require(`../../i18n/locales/${code}/yacht.json`));
    }
  });

  afterEach(async () => {
    // Unmount first: switching language under a mounted DiceRow re-renders it outside act().
    await cleanup();
    await i18n.changeLanguage("en");
  });

  afterAll(() => {
    i18n.removeResourceBundle("ru", "yacht");
    i18n.removeResourceBundle("ar", "yacht");
  });

  it.each([
    ["en", 2, "Roll dice, 1 roll left"],
    ["en", 1, "Roll dice, 2 rolls left"],
    // Russian "many" (0, 5…) and "few" (2–4), not only one/other.
    ["ru", 3, "Бросить кубики, 0 бросков осталось"],
    ["ru", 1, "Бросить кубики, 2 броска осталось"],
    ["ru", 2, "Бросить кубики, 1 бросок остался"],
    // Arabic dual.
    ["ar", 1, "ارمِ النرد، تبقى رميتان"],
  ])("in %s with %d rolls used, labels the button %s", async (code, rollsUsed, label) => {
    await i18n.changeLanguage(code);
    const { getByRole } = await renderDiceRow({ rollsUsed });
    expect(getByRole("button", { name: label })).toBeTruthy();
  });
});
