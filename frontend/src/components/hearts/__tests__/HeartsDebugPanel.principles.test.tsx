/** The debug panel's CPU principle display (#3163). */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import HeartsDebugPanel from "../HeartsDebugPanel";
import type { HandDebugLog, LiveDecisions } from "../../../game/hearts/debugLog";
import { PLAYER_LABELS, handLog } from "../../../game/hearts/__tests__/helpers/debugLogFixtures";

jest.mock("../../../game/hearts/pimc/benchmark", () => ({ runPimcBenchmark: jest.fn() }));

type PanelProps = React.ComponentProps<typeof HeartsDebugPanel>;

function panel(overrides: Partial<PanelProps> = {}) {
  return (
    <ThemeProvider>
      <HeartsDebugPanel
        visible
        onClose={jest.fn()}
        logs={[handLog()]}
        notes={[""]}
        playerLabels={PLAYER_LABELS}
        aiDifficulty="conservative"
        onNotesChange={jest.fn()}
        {...overrides}
      />
    </ThemeProvider>
  );
}

const withPrinciples = (): HandDebugLog => {
  const base = handLog();
  return {
    ...base,
    passDecisions: [
      [],
      [{ card: { suit: "clubs", rank: 2 }, principle: "P4-DANGER", reason: "next." }],
      [],
      [],
    ],
    tricks: [
      {
        ...base.tricks[0]!,
        plays: [
          { playerIndex: 0, card: { suit: "hearts", rank: 10 } },
          {
            playerIndex: 1,
            card: { suit: "hearts", rank: 11 },
            principle: "P3-DUCK",
            reason: "J♥: stays under the lead.",
          },
          { playerIndex: 2, card: { suit: "hearts", rank: 13 }, principle: null, reason: "forced" },
          { playerIndex: 3, card: { suit: "hearts", rank: 2 } },
        ],
      },
    ],
  };
};

describe("HeartsDebugPanel CPU principles", () => {
  it("shows the last trick's plays with their principle IDs, and the reasons in the log", async () => {
    await render(panel({ logs: [withPrinciples()] }));
    const section = screen.getByTestId("cpu-principles-0");
    expect(section).toBeTruthy();
    expect(section).toHaveTextContent(
      /Last trick \(T1\) You:10♥ —\s+Ann:J♥ P3-DUCK\s+Bo:K♥ —\s+Cy:2♥ —/
    );
    expect(screen.getByText("P3-DUCK")).toBeTruthy();
    expect(screen.getByText(/J♥: stays under the lead\./)).toBeTruthy();
    // A forced play has no principle: shown as a dash, still listed.
    expect(screen.getByText(/T1 Bo K♥/)).toBeTruthy();
    expect(screen.getByLabelText("CPU decision log")).toBeTruthy();
  });

  it("shows a CPU pass card's principle in the pass selections", async () => {
    await render(panel({ logs: [withPrinciples()] }));
    expect(screen.getByText(/2♣ \(P4-DANGER\)/)).toBeTruthy();
  });

  it("shows no principle section for a log without principles (older logs, legacy personas)", async () => {
    await render(panel());
    expect(screen.queryByTestId("cpu-principles-0")).toBeNull();
    expect(screen.queryByText("CPU principles")).toBeNull();
    // The existing trick rows still render.
    expect(screen.getByText("Tricks (2)")).toBeTruthy();
  });

  it("shows the hand in progress while the panel is open", async () => {
    const live: LiveDecisions = {
      handNumber: 3,
      tricks: [],
      pending: [
        {
          playerIndex: 2,
          card: { suit: "spades", rank: 12 },
          principle: "P5-QUEEN",
          reason: "Q♠: first discard.",
        },
      ],
    };
    await render(panel({ logs: [], notes: [], getLive: () => live }));
    expect(screen.getByText("Hand 3 — in progress")).toBeTruthy();
    expect(screen.getByTestId("cpu-principles-live")).toBeTruthy();
    expect(screen.getByText("P5-QUEEN")).toBeTruthy();
  });

  it("does not read the live hand while closed", async () => {
    const getLive = jest.fn(() => null);
    await render(panel({ visible: false, getLive }));
    expect(getLive).not.toHaveBeenCalled();
  });
});
