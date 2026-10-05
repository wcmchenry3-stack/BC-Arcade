import React from "react";
import { Platform } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import HeartsDebugPanel from "../HeartsDebugPanel";
import { formatSessionAsMarkdown } from "../../../game/hearts/debugLog";
import type { LatencyRow } from "../../../game/hearts/pimc/benchmark";
import { PLAYER_LABELS, handLog } from "../../../game/hearts/__tests__/helpers/debugLogFixtures";

const mockRunPimcBenchmark = jest.fn();
jest.mock("../../../game/hearts/pimc/benchmark", () => ({
  runPimcBenchmark: (...args: unknown[]) => mockRunPimcBenchmark(...args),
}));

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
        aiDifficulty="mixed"
        onNotesChange={jest.fn()}
        {...overrides}
      />
    </ThemeProvider>
  );
}

function setPlatform(os: "web" | "ios") {
  jest.replaceProperty(Platform, "OS", os);
}

/** A benchmark run the test settles by hand. */
function deferredBenchmark() {
  let resolve!: (rows: LatencyRow[]) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<LatencyRow[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  mockRunPimcBenchmark.mockReturnValueOnce(promise);
  return { resolve, reject };
}

const ROWS: LatencyRow[] = [
  { samples: 16, decisions: 30, p50: 12.4, p95: 30.6, max: 41 },
  { samples: 32, decisions: 30, p50: 25, p95: 60, max: 80.2 },
];

describe("HeartsDebugPanel", () => {
  beforeEach(() => {
    mockRunPimcBenchmark.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks(); // also undoes setPlatform's replaceProperty
  });

  describe("header", () => {
    it("says so when no hand has been logged", async () => {
      await render(panel({ logs: [], notes: [] }));
      expect(screen.getByText("Hearts Debugger")).toBeTruthy();
      expect(
        screen.getByText("No hands logged yet. Play a hand to see debug data here.")
      ).toBeTruthy();
    });

    it("counts the logged hands", async () => {
      await render(panel({ logs: [handLog()], notes: [""] }));
      expect(screen.getByText("Hearts Debugger — 1 hand")).toBeTruthy();
      await screen.rerender(
        panel({ logs: [handLog(), handLog({ handNumber: 2 })], notes: ["", ""] })
      );
      expect(screen.getByText("Hearts Debugger — 2 hands")).toBeTruthy();
    });

    it("lists each AI seat's persona, from the preset", async () => {
      await render(panel({ aiDifficulty: "mixed" }));
      expect(screen.getByText("Ann: cautious  ·  Bo: schemer  ·  Cy: daring")).toBeTruthy();
      await screen.rerender(panel({ aiDifficulty: "daring", playerLabels: ["You", "Ann"] }));
      expect(screen.getByText("Ann: daring  ·  P2: daring  ·  P3: daring")).toBeTruthy();
    });

    it("closes from the close button", async () => {
      const onClose = jest.fn();
      await render(panel({ onClose }));
      await fireEvent.press(screen.getByRole("button", { name: "Close debugger" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders nothing while hidden", async () => {
      await render(panel({ visible: false }));
      expect(screen.queryByText("Hearts Debugger — 1 hand")).toBeNull();
    });
  });

  describe("hand log", () => {
    it("shows the deals, pass selections, final hands, tricks and scores", async () => {
      await render(panel());
      expect(screen.getByText("Hand 1 — Pass Left")).toBeTruthy();
      expect(screen.getByText("Initial Deals")).toBeTruthy();
      expect(screen.getByText("Pass Selections")).toBeTruthy();
      expect(screen.getByText("Final Hands")).toBeTruthy();
      expect(screen.getByText("Tricks (2)")).toBeTruthy();
      // The winner of a trick is bracketed, with the points it took.
      expect(screen.getByText(/You:10♥\s+Ann:J♥\s+Bo:\[K♥\]\s+Cy:2♥/)).toBeTruthy();
      expect(screen.getByText(/→ Bo \+4/)).toBeTruthy();
      expect(screen.getByText("You +0  Ann +0  Bo +4  Cy +22")).toBeTruthy();
      expect(screen.getByText(/Running:\s+You 5\s+Ann 6\s+Bo 9\s+Cy 22/)).toBeTruthy();
    });

    it("shows who passes to whom", async () => {
      await render(panel({ logs: [handLog({ passDirection: "across" })] }));
      expect(screen.getByText("Hand 1 — Pass Across")).toBeTruthy();
      expect(screen.getByText(/You → Bo:\s+A♠/)).toBeTruthy();
      expect(screen.getByText(/Cy → Ann:\s+—/)).toBeTruthy();
    });

    it("leaves out the pass sections on a no-pass hand", async () => {
      await render(panel({ logs: [handLog({ passDirection: "none" })] }));
      expect(screen.getByText("Hand 1 — No Pass")).toBeTruthy();
      expect(screen.queryByText("Pass Selections")).toBeNull();
      expect(screen.queryByText("Final Hands")).toBeNull();
    });

    it("falls back to P<n> for a seat with no label", async () => {
      await render(panel({ playerLabels: [] }));
      expect(screen.getByText(/P0 → P1:/)).toBeTruthy();
    });

    it("shows each hand's own note and reports an edit with that hand's index", async () => {
      const onNotesChange = jest.fn();
      await render(
        panel({
          logs: [handLog(), handLog({ handNumber: 2 })],
          notes: ["first hand note"],
          onNotesChange,
        })
      );
      const inputs = screen.getAllByPlaceholderText("Observations about this hand...");
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toHaveDisplayValue("first hand note");
      expect(inputs[1]).toHaveDisplayValue("");

      await fireEvent.changeText(inputs[1]!, "AI dumped the queen");
      expect(onNotesChange).toHaveBeenCalledWith(1, "AI dumped the queen");
    });
  });

  describe("copy", () => {
    it("is disabled outside the web build", async () => {
      await render(panel());
      const copy = screen.getByRole("button", { name: "Copy (web only)" });
      expect(copy).toBeDisabled();
      expect(screen.getByText("Copy (web)")).toBeTruthy();
    });

    describe("on web", () => {
      const writeText = jest.fn();
      // The jest environment may or may not have a global `navigator` (it depends on
      // the Node version): make one if it is missing, and put back what was there.
      let createdNavigator = false;
      let originalClipboard: PropertyDescriptor | undefined;

      beforeEach(() => {
        setPlatform("web");
        writeText.mockReset().mockResolvedValue(undefined);
        if (typeof globalThis.navigator === "undefined") {
          Object.defineProperty(globalThis, "navigator", {
            value: {},
            configurable: true,
            writable: true,
          });
          createdNavigator = true;
        }
        originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
        Object.defineProperty(globalThis.navigator, "clipboard", {
          value: { writeText },
          configurable: true,
        });
      });

      afterEach(() => {
        if (originalClipboard) {
          Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
        } else {
          delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
        }
        if (createdNavigator) {
          delete (globalThis as { navigator?: unknown }).navigator;
          createdNavigator = false;
        }
      });

      it("copies the session as Markdown, confirms, then reverts", async () => {
        jest.useFakeTimers();
        const logs = [handLog()];
        await render(panel({ logs, notes: ["a note"] }));
        const copy = screen.getByRole("button", { name: "Copy session to clipboard" });
        expect(copy).toBeEnabled();

        await fireEvent.press(copy);

        expect(writeText).toHaveBeenCalledWith(
          formatSessionAsMarkdown(logs, ["a note"], PLAYER_LABELS, "mixed")
        );
        expect(screen.getByText("Copied!")).toBeTruthy();

        await act(async () => {
          jest.advanceTimersByTime(1999);
        });
        expect(screen.getByText("Copied!")).toBeTruthy();
        await act(async () => {
          jest.advanceTimersByTime(1);
        });
        expect(screen.getByText("Copy")).toBeTruthy();
      });

      it("restarts the confirmation when copied again", async () => {
        jest.useFakeTimers();
        await render(panel());
        const copy = screen.getByRole("button", { name: "Copy session to clipboard" });
        await fireEvent.press(copy);
        await act(async () => {
          jest.advanceTimersByTime(1500);
        });
        await fireEvent.press(copy);
        await act(async () => {
          jest.advanceTimersByTime(1500);
        });
        expect(screen.getByText("Copied!")).toBeTruthy();
        await act(async () => {
          jest.advanceTimersByTime(500);
        });
        expect(screen.getByText("Copy")).toBeTruthy();
      });

      it("does not confirm when the clipboard write fails", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        writeText.mockRejectedValue(new Error("denied"));
        await render(panel());
        await fireEvent.press(screen.getByRole("button", { name: "Copy session to clipboard" }));
        expect(screen.queryByText("Copied!")).toBeNull();
        expect(screen.getByText("Copy")).toBeTruthy();
        expect(warn).toHaveBeenCalledWith("[HeartsDebugPanel] clipboard copy failed");
      });

      it("drops a pending confirmation timer on unmount", async () => {
        jest.useFakeTimers();
        const set = jest.spyOn(globalThis, "setTimeout");
        const clear = jest.spyOn(globalThis, "clearTimeout");
        await render(panel());
        await fireEvent.press(screen.getByRole("button", { name: "Copy session to clipboard" }));
        // The confirmation's own timer: the 2 s one the press started.
        const at = set.mock.calls.findIndex(([, ms]) => ms === 2000);
        expect(at).toBeGreaterThanOrEqual(0);
        const confirmationTimer = set.mock.results[at]!.value;

        await screen.unmount();
        expect(clear).toHaveBeenCalledWith(confirmationTimer);
      });
    });
  });

  describe("PIMC timing", () => {
    const runButton = () =>
      screen.getByRole("button", { name: "Run the PIMC engine timing benchmark" });

    it("is idle until run, and names the platform", async () => {
      await render(panel());
      expect(screen.getByText("PIMC engine timing (ios)")).toBeTruthy();
      expect(screen.getByText("Run timing")).toBeTruthy();
      expect(mockRunPimcBenchmark).not.toHaveBeenCalled();
    });

    it("shows progress while running, then median, p95 and worst per sample count", async () => {
      const run = deferredBenchmark();
      await render(panel());
      await fireEvent.press(runButton());
      expect(screen.getByText("Running… 0%")).toBeTruthy();
      expect(runButton()).toBeDisabled();

      const options = mockRunPimcBenchmark.mock.calls[0]![0] as {
        onProgress: (done: number, total: number) => void;
      };
      await act(async () => {
        options.onProgress(45, 90);
      });
      expect(screen.getByText("Running… 50%")).toBeTruthy();

      await act(async () => {
        run.resolve(ROWS);
      });
      expect(screen.getByText("Run timing")).toBeTruthy();
      expect(
        screen.getByText("16 deals: median 12 ms · p95 31 ms · worst 41 ms (30 moves)")
      ).toBeTruthy();
      expect(
        screen.getByText("32 deals: median 25 ms · p95 60 ms · worst 80 ms (30 moves)")
      ).toBeTruthy();
    });

    it("clears the last result when run again", async () => {
      mockRunPimcBenchmark.mockResolvedValueOnce(ROWS);
      await render(panel());
      await fireEvent.press(runButton());
      expect(screen.getByText(/16 deals:/)).toBeTruthy();

      deferredBenchmark();
      await fireEvent.press(runButton());
      expect(screen.queryByText(/16 deals:/)).toBeNull();
    });

    it("shows the failure message, and lets it run again", async () => {
      mockRunPimcBenchmark.mockRejectedValueOnce(new Error("engine blew up"));
      await render(panel());
      await fireEvent.press(runButton());
      expect(screen.getByText("Failed: engine blew up")).toBeTruthy();
      expect(runButton()).toBeEnabled();

      mockRunPimcBenchmark.mockRejectedValueOnce("plain string");
      await fireEvent.press(runButton());
      expect(screen.getByText("Failed: plain string")).toBeTruthy();
    });

    it("stops the run when the panel is closed, and reopens clean", async () => {
      const run = deferredBenchmark();
      await render(panel());
      await fireEvent.press(runButton());
      const options = mockRunPimcBenchmark.mock.calls[0]![0] as {
        cancelled: () => boolean;
        onProgress: (done: number, total: number) => void;
      };
      expect(options.cancelled()).toBe(false);

      await screen.rerender(panel({ visible: false }));
      expect(options.cancelled()).toBe(true);

      await screen.rerender(panel({ visible: true }));
      await act(async () => {
        options.onProgress(10, 90);
        run.resolve(ROWS);
      });
      expect(screen.queryByText(/16 deals:/)).toBeNull();
      expect(screen.queryByText(/Running…/)).toBeNull();
      expect(screen.getByText("Run timing")).toBeTruthy();
    });

    it("stops the run, and shows no failure, when the panel unmounts", async () => {
      const run = deferredBenchmark();
      await render(panel());
      await fireEvent.press(runButton());
      const options = mockRunPimcBenchmark.mock.calls[0]![0] as { cancelled: () => boolean };
      await screen.unmount();
      expect(options.cancelled()).toBe(true);

      // The late failure lands on nothing: no error is raised or logged.
      const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      await act(async () => {
        run.reject(new Error("late"));
      });
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(screen.queryByText(/Failed:/)).toBeNull();
    });
  });
});
