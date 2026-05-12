import React, { Suspense } from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";

// The HomeScreen wiring around prefetch is covered by HomeScreen.test.tsx.
// This file exercises lazyScreens.ts in isolation and the mount-timer path
// in App.tsx's withSuspense helper (issue #706).

// Replace the real screen factories with tiny stubs so we don't pull a whole
// game screen (and its dependencies) into this test.
jest.mock("../../screens/CascadeScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/StarSwarmScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/BlackjackBettingScreen", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../screens/BlackjackTableScreen", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../screens/Twenty48Screen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/SolitaireScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/HeartsScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/SudokuScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/LeaderboardScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/GameDetailScreen", () => ({ __esModule: true, default: () => null }));
jest.mock("../../screens/SettingsScreen", () => ({ __esModule: true, default: () => null }));

describe("prefetchLobbyGameScreens", () => {
  it("resolves without throwing when called repeatedly", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prefetchLobbyGameScreens } = require("../lazyScreens");
    const canPlay = jest.fn().mockReturnValue(true);
    expect(() => {
      prefetchLobbyGameScreens(canPlay);
      prefetchLobbyGameScreens(canPlay);
    }).not.toThrow();
  });

  it("queries canPlay for each of the four premium slugs", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prefetchLobbyGameScreens } = require("../lazyScreens");
    const canPlay = jest.fn().mockReturnValue(false);
    prefetchLobbyGameScreens(canPlay);
    expect(canPlay).toHaveBeenCalledWith("cascade");
    expect(canPlay).toHaveBeenCalledWith("starswarm");
    expect(canPlay).toHaveBeenCalledWith("hearts");
    expect(canPlay).toHaveBeenCalledWith("sudoku");
  });

  it("does not query canPlay for free game slugs", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prefetchLobbyGameScreens } = require("../lazyScreens");
    const canPlay = jest.fn().mockReturnValue(false);
    prefetchLobbyGameScreens(canPlay);
    expect(canPlay).not.toHaveBeenCalledWith("blackjack");
    expect(canPlay).not.toHaveBeenCalledWith("twenty48");
    expect(canPlay).not.toHaveBeenCalledWith("solitaire");
    expect(canPlay).not.toHaveBeenCalledWith("freecell");
    expect(canPlay).not.toHaveBeenCalledWith("mahjong");
  });
});

// ---------------------------------------------------------------------------
// screen_mount_ms — verifies the timer pattern used by withSuspense in App.tsx.
// We replicate the shape inline so this test doesn't require booting App.tsx
// (which transitively requires navigation, i18n, fonts, etc.).
// ---------------------------------------------------------------------------

function SuspenseMountTimer({
  startMs,
  screenName,
  children,
}: {
  startMs: number;
  screenName: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const elapsedMs = performance.now() - startMs;
    Sentry.metrics.distribution("screen_mount_ms", elapsedMs, {
      unit: "millisecond",
      attributes: { screen: screenName },
    });
    // startMs/screenName are stable per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

describe("screen_mount_ms timer (withSuspense pattern)", () => {
  beforeEach(() => {
    (Sentry.metrics.distribution as jest.Mock).mockClear();
  });

  it("emits once after the lazy child resolves, tagged with the screen name", async () => {
    let resolveFactory: (mod: { default: React.ComponentType }) => void = () => undefined;
    const LazyChild = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType }>((resolve) => {
          resolveFactory = resolve;
        })
    );

    const startMs = performance.now();

    render(
      <Suspense fallback={<Text>loading</Text>}>
        <SuspenseMountTimer startMs={startMs} screenName="hearts">
          <LazyChild />
        </SuspenseMountTimer>
      </Suspense>
    );

    // Nothing emitted while the chunk is still pending.
    expect(Sentry.metrics.distribution).not.toHaveBeenCalled();

    await act(async () => {
      resolveFactory({ default: () => <Text>hearts-mounted</Text> });
    });

    await waitFor(() => {
      expect(Sentry.metrics.distribution).toHaveBeenCalledTimes(1);
    });

    const [metricName, value, options] = (Sentry.metrics.distribution as jest.Mock).mock.calls[0];
    expect(metricName).toBe("screen_mount_ms");
    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThanOrEqual(0);
    expect(options).toEqual({
      unit: "millisecond",
      attributes: { screen: "hearts" },
    });
  });
});
