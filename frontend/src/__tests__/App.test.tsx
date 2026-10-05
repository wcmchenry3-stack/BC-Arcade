/**
 * #2956: App.tsx smoke test — the provider tree mounts, every route in types/navigation.ts is
 * registered and its (lazy) screen resolves, and the premium guard (#1055) gates premium routes.
 * Complements releaseBuildConfig.test.ts, which pins the same registry by reading App.tsx as text.
 *
 * Navigators are replaced by recorders that render every registered screen at once, and every
 * screen module by a stub that prints `screen:<route>`, so React.lazy and the Suspense wrappers
 * in App.tsx run for real. Jest cannot execute `import()` here (no --experimental-vm-modules),
 * so the lazy registry is rebuilt from lazyScreens.ts's own factory table: each
 * `Name: () => import("<path>")` entry becomes React.lazy over a require of the same path.
 * Side-effectful providers (network, entitlements, purchases) are pass-throughs; theme, sound,
 * card deck and the game contexts are real.
 */
import * as fs from "fs";
import * as path from "path";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";

import { __forceStoreBuildForTests } from "../entitlements/gameVisibility";
import { PREMIUM_ROUTES } from "../entitlements/premiumRoutes";
import { MAIN_TABS } from "../navigation/mainTabs";

// Premium games are visible in pre-launch builds; jest otherwise runs as a store build.
jest.mock("../game/_shared/envFlags", () => ({
  ...jest.requireActual("../game/_shared/envFlags"),
  isPreLaunchApiBuild: () => true,
}));

// --- every screen module: a stub that names its route ---------------------------------------

const mockThrowIn: { route: string | null } = { route: null };
function mockStub(route: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  function Stub() {
    if (mockThrowIn.route === route) throw new Error(`${route} crashed`);
    return createElement(Text, null, `screen:${route}`);
  }
  return { __esModule: true, default: Stub };
}
jest.mock("../screens/HomeScreen", () => mockStub("Home"));
jest.mock("../screens/GameScreen", () => mockStub("Game"));
jest.mock("../screens/ProfileScreen", () => mockStub("ProfileHome"));
jest.mock("../screens/CascadeScreen", () => mockStub("Cascade"));
jest.mock("../screens/StarSwarmScreen", () => mockStub("StarSwarm"));
jest.mock("../screens/BlackjackBettingScreen", () => mockStub("BlackjackBetting"));
jest.mock("../screens/BlackjackTableScreen", () => mockStub("BlackjackTable"));
jest.mock("../screens/BlackjackVictoryScreen", () => mockStub("BlackjackVictory"));
jest.mock("../screens/BlackjackStatsScreen", () => mockStub("BlackjackStats"));
jest.mock("../screens/Twenty48Screen", () => mockStub("Twenty48"));
jest.mock("../screens/SolitaireScreen", () => mockStub("Solitaire"));
jest.mock("../screens/FreeCellScreen", () => mockStub("FreeCell"));
jest.mock("../screens/HeartsScreen", () => mockStub("Hearts"));
jest.mock("../screens/SudokuScreen", () => mockStub("Sudoku"));
jest.mock("../screens/MahjongScreen", () => mockStub("Mahjong"));
jest.mock("../screens/MahjongLayoutInspectorScreen", () => mockStub("MahjongLayoutInspector"));
jest.mock("../screens/MahjongLayoutDetailScreen", () => mockStub("MahjongLayoutDetail"));
jest.mock("../screens/SortScreen", () => mockStub("Sort"));
jest.mock("../screens/DailyWordScreen", () => mockStub("DailyWord"));
jest.mock("../screens/LeaderboardScreen", () => mockStub("Leaderboard"));
jest.mock("../screens/GameStatsScreen", () => mockStub("GameStats"));
jest.mock("../screens/GameDetailScreen", () => mockStub("GameDetail"));
jest.mock("../screens/SettingsScreen", () => mockStub("Settings"));
jest.mock("../screens/ScorecardScreen", () => mockStub("Scorecard"));
jest.mock("../screens/PaywallScreen", () => mockStub("Paywall"));

// lazyScreens.ts's factory table, replayed through require (see the header).
const mockLazyFactories: Record<string, string> = {};
jest.mock("../utils/lazyScreens", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lazy } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsMod = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathMod = require("path");
  const file = pathMod.resolve(__dirname, "../utils/lazyScreens.ts");
  const src: string = fsMod.readFileSync(file, "utf-8");
  const LazyScreens: Record<string, unknown> = {};
  for (const [, name, rel] of src.matchAll(/^\s+(\w+): \(\) => import\("([^"]+)"\),$/gm)) {
    const target = pathMod.resolve(pathMod.dirname(file), rel!);
    mockLazyFactories[name!] = target;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LazyScreens[name!] = lazy(() => Promise.resolve().then(() => require(target)));
  }
  return { LazyScreens, prefetchLobbyGameScreens: jest.fn() };
});

// --- navigation: recorders that render every screen -------------------------------------------

/** Route names per native-stack navigator, in creation order: Root, Home, Profile. */
const mockStacks: Set<string>[] = [];
const mockTabs = new Set<string>();
function mockRecorder(names: Set<string>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement, Fragment } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    Navigator: ({
      children,
      tabBar,
    }: {
      children: React.ReactNode;
      tabBar?: (p: object) => React.ReactNode;
    }) => createElement(Fragment, null, children, tabBar?.({ tabBarProps: true })),
    Screen: ({ name, component }: { name: string; component: React.ComponentType }) => {
      names.add(name);
      return createElement(View, { testID: `route:${name}` }, createElement(component));
    },
  };
}
jest.mock("@react-navigation/native-stack", () => ({
  createNativeStackNavigator: () => {
    const names = new Set<string>();
    mockStacks.push(names);
    return mockRecorder(names);
  },
}));
jest.mock("@react-navigation/bottom-tabs", () => ({
  createBottomTabNavigator: () => mockRecorder(mockTabs),
}));
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockNavigate, goBack: jest.fn() }), {
    NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  })
);

// --- providers and app-start side effects --------------------------------------------------------

const mockProviders: string[] = [];
function mockPassThrough(name: string) {
  return ({ children }: { children: React.ReactNode }) => {
    mockProviders.push(name);
    return children;
  };
}
const mockEntitlements: { canPlay: jest.Mock; isLoading: boolean } = {
  canPlay: jest.fn(() => true),
  isLoading: false,
};
jest.mock("../entitlements/EntitlementContext", () => ({
  ...jest.requireActual("../entitlements/EntitlementContext"),
  EntitlementProvider: mockPassThrough("Entitlement"),
  useEntitlements: () => ({ ...mockEntitlements }),
}));
jest.mock("../game/_shared/NetworkContext", () => ({
  ...mockScreenDeps().mockNetwork(),
  NetworkProvider: mockPassThrough("Network"),
}));
jest.mock("../purchases/PurchaseProvider", () => ({
  PurchaseProvider: mockPassThrough("Purchase"),
}));
const mockTabBar = jest.fn((_props: object) => null);
jest.mock("../components/shared/BottomTabBar", () => (props: object) => mockTabBar(props));
// The app's own i18n bootstrap would replace jest.setup.ts's English-only instance.
jest.mock("../i18n/i18n", () => ({}));
jest.mock("../components/FeedbackWidget/SessionLogger", () => ({
  SessionLogger: { init: jest.fn() },
}));
const mockFonts = { loaded: true };
jest.mock("expo-font", () => ({ useFonts: () => [mockFonts.loaded] }));
jest.mock("@expo-google-fonts/space-grotesk", () => ({
  SpaceGrotesk_400Regular: 1,
  SpaceGrotesk_700Bold: 2,
}));
jest.mock("@expo-google-fonts/manrope", () => ({
  Manrope_400Regular: 3,
  Manrope_600SemiBold: 4,
  Manrope_700Bold: 5,
}));

// The global Sentry mock has no ErrorBoundary; give it a minimal real one.
type FallbackProps = { error: unknown; resetError: () => void };
class MockErrorBoundary extends React.Component<
  { fallback: (p: FallbackProps) => React.ReactNode; children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return this.props.fallback({
        error: this.state.error,
        resetError: () => this.setState({ error: null }),
      });
    }
    return this.props.children;
  }
}
(Sentry as unknown as Record<string, unknown>).ErrorBoundary = MockErrorBoundary;

// App.tsx creates its navigators at module load, so it is loaded only once the recorders above
// exist. Its load-time Sentry check logs a missing DSN; that path is asserted further down.
const App = (() => {
  const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../App").default as React.ComponentType;
  } finally {
    quiet.mockRestore();
  }
})();

// --- the routes types/navigation.ts declares --------------------------------------------------

const NAV_TYPES = fs.readFileSync(path.resolve(__dirname, "../types/navigation.ts"), "utf-8");
/** Top-level keys of `export type <name> = { ... };` (two-space indent; nested keys are deeper). */
function paramListKeys(name: string): string[] {
  const start = NAV_TYPES.indexOf(`export type ${name} = {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = NAV_TYPES.slice(start, NAV_TYPES.indexOf("\n};", start));
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!).sort();
}
const ROOT_ROUTES = paramListKeys("RootStackParamList");
const HOME_ROUTES = paramListKeys("HomeStackParamList");
const PROFILE_ROUTES = paramListKeys("ProfileStackParamList");
const PREMIUM_ROUTE_NAMES = PREMIUM_ROUTES.map((r) => r.route as string);

const sorted = (s: Set<string>) => [...s].sort();
const [rootStack, homeStack, profileStack] = mockStacks;

async function renderApp() {
  await render(<App />);
}

beforeEach(() => {
  for (const s of mockStacks) s.clear();
  mockTabs.clear();
  mockProviders.length = 0;
  mockFonts.loaded = true;
  mockThrowIn.route = null;
  mockEntitlements.isLoading = false;
  mockEntitlements.canPlay = jest.fn(() => true);
  mockNavigate.mockClear();
  (Sentry.metrics.distribution as jest.Mock).mockReset();
});
afterEach(() => __forceStoreBuildForTests(false));

describe("App — providers and fonts", () => {
  it("shows only a spinner until the fonts load", async () => {
    mockFonts.loaded = false;
    await renderApp();
    expect(mockProviders).toEqual([]);
    expect(screen.queryByTestId("route:MainTabs")).toBeNull();
  });

  it("mounts the provider tree outside-in, then the navigators", async () => {
    await renderApp();
    expect(mockProviders.slice(0, 3)).toEqual(["Network", "Entitlement", "Purchase"]);
    expect(screen.getByTestId("route:MainTabs")).toBeTruthy();
    expect(await screen.findByText("screen:Home")).toBeTruthy();
  });

  it("creates three stacks (root, lobby, profile) and one tab per MAIN_TABS entry", async () => {
    expect(mockStacks).toHaveLength(3);
    await renderApp();
    expect(sorted(mockTabs)).toEqual(MAIN_TABS.map((t) => t.name).sort());
    // The tab bar is the app's own BottomTabBar, handed the navigator's props.
    expect(mockTabBar).toHaveBeenCalledWith({ tabBarProps: true });
  });
});

describe("App — route registry vs types/navigation.ts", () => {
  it("registers exactly the routes each param list declares", async () => {
    await renderApp();
    expect(sorted(rootStack!)).toEqual(ROOT_ROUTES);
    expect(sorted(homeStack!)).toEqual(HOME_ROUTES);
    expect(sorted(profileStack!)).toEqual(PROFILE_ROUTES);
  });

  it("every route except Home, Game and ProfileHome is a lazy chunk with a factory", () => {
    const eager = ["Home", "Game", "ProfileHome", "MainTabs"];
    const lazyRoutes = [...ROOT_ROUTES, ...HOME_ROUTES, ...PROFILE_ROUTES, "Settings"]
      .filter((r) => !eager.includes(r))
      .sort();
    expect(Object.keys(mockLazyFactories).sort()).toEqual(lazyRoutes);
    for (const target of Object.values(mockLazyFactories)) {
      expect(fs.existsSync(`${target}.tsx`)).toBe(true);
    }
  });

  it("every route's screen resolves, through its lazy chunk where it has one", async () => {
    await renderApp();
    const screens = [
      ...HOME_ROUTES,
      ...PROFILE_ROUTES,
      ...ROOT_ROUTES.filter((r) => r !== "MainTabs"),
      "Settings", // a tab, not a stack route
    ];
    for (const route of screens) {
      expect(await screen.findByText(`screen:${route}`)).toBeTruthy();
    }
  });

  it("times each lazy screen's mount for Sentry", async () => {
    await renderApp();
    await screen.findByText("screen:Cascade");
    const screensTimed = (Sentry.metrics.distribution as jest.Mock).mock.calls.map(
      ([metric, ms, opts]) => {
        expect(metric).toBe("screen_mount_ms");
        expect(typeof ms).toBe("number");
        expect(opts.unit).toBe("millisecond");
        return opts.attributes.screen;
      }
    );
    expect(screensTimed).toEqual(
      expect.arrayContaining(["cascade", "blackjack_betting", "settings"])
    );
  });

  it("a failing mount metric never breaks the screen", async () => {
    (Sentry.metrics.distribution as jest.Mock).mockImplementation(() => {
      throw new Error("metrics down");
    });
    await renderApp();
    expect(await screen.findByText("screen:Sudoku")).toBeTruthy();
  });
});

describe("App — premium guard (#1055) and store builds (#2390)", () => {
  it("an entitled session gets the premium screens", async () => {
    await renderApp();
    for (const route of PREMIUM_ROUTE_NAMES) {
      expect(await screen.findByText(`screen:${route}`)).toBeTruthy();
    }
    expect(mockEntitlements.canPlay).toHaveBeenCalledWith("cascade");
    expect(screen.queryByText("Premium Game")).toBeNull();
  });

  it("an unentitled session gets LockedGameScreen on every premium route, never the game", async () => {
    mockEntitlements.canPlay = jest.fn(() => false);
    await renderApp();
    await screen.findByText("screen:Home");
    expect(screen.getAllByText("Premium Game")).toHaveLength(PREMIUM_ROUTE_NAMES.length);
    for (const route of PREMIUM_ROUTE_NAMES) {
      expect(screen.queryByText(`screen:${route}`)).toBeNull();
    }
    // Free games are not gated.
    expect(await screen.findByText("screen:Solitaire")).toBeTruthy();
  });

  it("while entitlements load, premium routes show a spinner, neither locked nor open", async () => {
    mockEntitlements.isLoading = true;
    await renderApp();
    await screen.findByText("screen:Home");
    expect(screen.queryByText("Premium Game")).toBeNull();
    expect(screen.queryByText("screen:Cascade")).toBeNull();
  });

  it("losing an entitlement mid-session sends the player home", async () => {
    await renderApp();
    await screen.findByText("screen:Hearts");
    expect(mockNavigate).not.toHaveBeenCalled();
    mockEntitlements.canPlay = jest.fn(() => false);
    await screen.rerender(<App />);
    expect(mockNavigate).toHaveBeenCalledWith("Home");
  });

  it("a store build registers no premium route and no Paywall", async () => {
    __forceStoreBuildForTests(true);
    await renderApp();
    expect(sorted(rootStack!)).toEqual(["MainTabs"]);
    expect(sorted(homeStack!)).toEqual(HOME_ROUTES.filter((r) => !PREMIUM_ROUTE_NAMES.includes(r)));
    expect(await screen.findByText("screen:Home")).toBeTruthy();
    expect(screen.queryByText("Premium Game")).toBeNull();
  });
});

describe("App — crash fallback", () => {
  it("shows 'Something went wrong' for a render crash, and 'Try again' remounts", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockThrowIn.route = "Home";
    await renderApp();
    expect(await screen.findByText("Something went wrong.")).toBeTruthy();
    mockThrowIn.route = null;
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("screen:Home")).toBeTruthy();
    (console.error as jest.Mock).mockRestore();
  });
});

describe("App — Sentry start-up", () => {
  /** Load App.tsx in a fresh module registry, as at app start, and report what Sentry saw. */
  const loadApp = (env: { dsn?: string; init?: boolean; initThrows?: boolean }) => {
    const install = jest.fn();
    let init: jest.Mock = jest.fn();
    const saved = process.env.EXPO_PUBLIC_SENTRY_DSN;
    if (env.dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    else process.env.EXPO_PUBLIC_SENTRY_DSN = env.dsn;
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      jest.isolateModules(() => {
        jest.doMock("../utils/sentryConfig", () => ({
          ...jest.requireActual("../utils/sentryConfig"),
          shouldInitSentry: () => env.init ?? true,
          resolveSentryEnvironment: () => "test-env",
        }));
        jest.doMock("../utils/sentryConsoleError", () => ({
          installSentryConsoleErrorCapture: install,
        }));
        // Sentry.init as this registry's App sees it, reset so only this load's call counts.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        init = require("@sentry/react-native").init as jest.Mock;
        init.mockReset();
        if (env.initThrows) {
          init.mockImplementation(() => {
            throw new Error("bad dsn");
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../../App");
      });
      return { init, install, error: error.mock.calls.map((c) => String(c[0])) };
    } finally {
      error.mockRestore();
      if (saved === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      else process.env.EXPO_PUBLIC_SENTRY_DSN = saved;
    }
  };

  it("never initialises in a test-hooks (or web) build", () => {
    const { init, error } = loadApp({ init: false, dsn: "https://k@o.ingest.sentry.io/1" });
    expect(init).not.toHaveBeenCalled();
    expect(error).toEqual([]);
  });

  it("complains, without initialising, when no DSN is set", () => {
    const { init, error } = loadApp({});
    expect(init).not.toHaveBeenCalled();
    expect(error).toEqual([
      "[Sentry] EXPO_PUBLIC_SENTRY_DSN is not set — error reporting disabled.",
    ]);
  });

  it("initialises with the DSN, no PII, and installs console capture", () => {
    const { init, install } = loadApp({ dsn: "https://k@o.ingest.sentry.io/1" });
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://k@o.ingest.sentry.io/1",
        environment: "test-env",
        sendDefaultPii: false,
        beforeSend: expect.any(Function),
      })
    );
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("survives an init that throws", () => {
    const { init, install, error } = loadApp({
      dsn: "https://k@o.ingest.sentry.io/1",
      initThrows: true,
    });
    expect(init).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
    expect(error).toEqual(["[Sentry] init failed:"]);
  });
});
