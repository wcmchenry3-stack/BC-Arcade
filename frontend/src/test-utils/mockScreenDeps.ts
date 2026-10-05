// TypeScript 6 no longer auto-includes @types/* (`types` defaults to []), and the
// typecheck program has no test files to pull in @types/jest: reference it here.
/// <reference types="jest" />
/**
 * Shared jest.mock() factories for screen tests (#2954).
 *
 * jest.mock() calls are hoisted above every import, so a factory can't use an
 * imported helper. jest.setup.ts exposes this module as the global
 * `mockScreenDeps()` instead (babel-plugin-jest-hoist lets a factory reference
 * names matching /^mock/i), so a test calls it with no declaration of its own:
 *
 *   jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getLeaderboard: jest.fn() }));
 *
 * The factory runs when the screen's import first loads the mocked module,
 * before the test file's own `const mockX = jest.fn()` lines have run. So pass
 * a `mock*` const through `lazy(() => mockX)` (it forwards every call), or a
 * closure of your own; values built inside the factory (`jest.fn()`, literals)
 * can be passed as they are. Tests then assert on their `mock*` consts, or on
 * the mocked module they import (`statsApi.getGameRank as jest.Mock`).
 *
 * Each factory returns the shape the screen tests used before #2954. Mock
 * shapes define behaviour (what a call returns, which members exist), so a
 * test that needs a different one passes an override or option rather than
 * changing the default.
 *
 * Keep this file free of React Native imports: it is loaded while modules are
 * still being mocked. jest.setup.ts mocks expo-blur, expo-linear-gradient,
 * react-native-safe-area-context and the other universal pass-throughs for
 * every test, so screen tests no longer mock those themselves.
 */

type Members = Record<string, unknown>;

/**
 * A function that forwards every call to the one `get()` returns at call
 * time, for a `mock*` const that doesn't exist yet when the factory runs.
 */
export function lazy<A extends unknown[], R>(get: () => (...args: A) => R) {
  return (...args: A): R => get()(...args);
}

/**
 * `@react-navigation/native`: `useNavigation` returns what `navigation()`
 * builds, on every call (so a fresh object per render, as the screens'
 * effects saw before). `actual: true` keeps the rest of the real package;
 * any other option is an extra export (`useRoute`, `useFocusEffect`, ...).
 */
export function mockNavigation(
  navigation: () => unknown = () => ({ navigate: jest.fn() }),
  { actual = false, ...exports }: { actual?: boolean } & Members = {}
) {
  return {
    ...(actual ? jest.requireActual("@react-navigation/native") : {}),
    useNavigation: navigation,
    ...exports,
  };
}

/** `api/stats`: `statsApi` with exactly the given methods. */
export function mockStatsApi(methods: Members = {}) {
  return { statsApi: { ...methods } };
}

/**
 * `game/_shared/gameEventClient`: the client's core methods as `jest.fn`s
 * (`init` and `clearAll` resolve), plus or replaced by `overrides`
 * (`resumeGame`, `markStarted` and `discardGame` exist only when passed).
 */
export function mockGameEventClient(overrides: Members = {}) {
  return {
    gameEventClient: {
      startGame: jest.fn(),
      enqueueEvent: jest.fn(),
      completeGame: jest.fn(),
      init: jest.fn().mockResolvedValue(undefined),
      reportBug: jest.fn(),
      getQueueStats: jest.fn(),
      clearAll: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  };
}

/** `game/_shared/flushQueuedGames`: resolves at once, as a `jest.fn` by default. */
export function mockFlushQueuedGames(
  flushQueuedGames: () => Promise<void> = jest.fn(() => Promise.resolve())
) {
  return { flushQueuedGames };
}

/**
 * `game/_shared/displayNameSync`: the real module (`actual: false` drops it)
 * with `flushDisplayNameSync` resolving `true`. `joinAs` makes
 * `joinLeaderboards` store that server-generated name at once (#2778).
 */
export function mockDisplayNameSync(
  overrides: Members = {},
  { actual = true, joinAs }: { actual?: boolean; joinAs?: string } = {}
) {
  const join =
    joinAs === undefined
      ? {}
      : {
          joinLeaderboards: async () => {
            await jest
              .requireActual("../game/_shared/displayName")
              .storeAssignedDisplayName(joinAs);
            return true;
          },
        };
  return {
    ...(actual ? jest.requireActual("../game/_shared/displayNameSync") : {}),
    flushDisplayNameSync: jest.fn(() => Promise.resolve(true)),
    ...join,
    ...overrides,
  };
}

/**
 * `game/_shared/NetworkContext`: `useNetwork` reports an initialised
 * connection, online unless `online` is false. `state` returns the hook's
 * whole value instead, for a test that mutates one shared object.
 */
export function mockNetwork({
  online = true,
  state,
}: { online?: boolean; state?: () => unknown } = {}) {
  return { useNetwork: state ?? (() => ({ isOnline: online, isInitialized: true })) };
}

/** A gesture's recorded `on*` callbacks (`onBegin`, `onUpdate`, `onChange`, `onEnd`, ...). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GestureHandlers = Record<string, ((e?: any) => void) | undefined>;

/**
 * `react-native-gesture-handler` whose builders record the callbacks a
 * component registers, so a test can fire a gesture by calling them.
 * `sink()` returns the record to write to (pass a getter: the factory runs
 * before the test file's consts exist); each `Gesture.Pan()` / `Pinch()` /
 * `Tap()` / `LongPress()` build replaces `sink().pan` / `.pinch` / ..., so
 * after a render it holds the handlers of the gesture that render built.
 * Every other builder method (`minDistance`, `runOnJS`, ...) chains.
 * `GestureDetector` and `GestureHandlerRootView` render their children.
 */
export function mockGestureHandler(sink: () => Record<string, GestureHandlers>) {
  const builder = (kind: string) => () => {
    const handlers: GestureHandlers = {};
    sink()[kind] = handlers;
    const chain: object = new Proxy(
      {},
      {
        get: (_target, prop) => {
          // Symbol keys come from pretty-format / React inspecting the object.
          if (typeof prop !== "string") return undefined;
          return (arg?: unknown) => {
            if (prop.startsWith("on")) handlers[prop] = arg as GestureHandlers[string];
            return chain;
          };
        },
      }
    );
    return chain;
  };
  const passThrough = ({ children }: { children?: unknown }) => children;
  return {
    GestureDetector: passThrough,
    GestureHandlerRootView: passThrough,
    Gesture: {
      Pan: builder("pan"),
      Pinch: builder("pinch"),
      Tap: builder("tap"),
      LongPress: builder("longPress"),
      Simultaneous: (...gestures: unknown[]) => gestures[0],
      Exclusive: (...gestures: unknown[]) => gestures[0],
      Race: (...gestures: unknown[]) => gestures[0],
    },
  };
}

declare global {
  /** This module, for jest.mock factories; set in jest.setup.ts. */
  // eslint-disable-next-line no-var
  var mockScreenDeps: () => typeof import("./mockScreenDeps");
}
