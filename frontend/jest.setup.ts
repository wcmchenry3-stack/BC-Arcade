// Gesture handler requires native setup in Jest
import "react-native-gesture-handler/jestSetup";

// react-native-gesture-handler v3: GestureDetector enforces a GestureHandlerRootView
// ancestor in DEV and removed the isTestEnv() bypass. Replace the main export so
// GestureDetector passes through children and Gesture builders are no-ops.
// (Internal sub-module mocks for native bindings are still handled by ./jestSetup above.)
jest.mock("react-native-gesture-handler", () => {
  // Proxy intercepts any method call and returns self — no fixed method list needed.
  const chainable = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy: any = new Proxy(
      {},
      {
        get:
          () =>
          (..._args: unknown[]) =>
            proxy,
      }
    );
    return proxy;
  };
  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
    Gesture: {
      Pan: chainable,
      Tap: chainable,
      Pinch: chainable,
      Exclusive: (...args: unknown[]) => args[0],
      Simultaneous: (...args: unknown[]) => args[0],
    },
  };
});

// react-native-screens ships native modules that don't exist in Jest's jsdom
// environment. Without this mock createScreenFactory (and other internals)
// throw at import time, crashing every test suite that uses navigation.
jest.mock("react-native-screens", () => ({
  __esModule: true,
  Screen: jest.fn(({ children }: { children: React.ReactNode }) => children),
  ScreenContainer: jest.fn(({ children }: { children: React.ReactNode }) => children),
  ScreenStack: jest.fn(({ children }: { children: React.ReactNode }) => children),
  ScreenStackItem: jest.fn(({ children }: { children: React.ReactNode }) => children),
  ScreenStackHeaderConfig: jest.fn(() => null),
  ScreenFooter: jest.fn(() => null),
  ScreenContentWrapper: jest.fn(({ children }: { children: React.ReactNode }) => children),
  enableScreens: jest.fn(),
  enableFreeze: jest.fn(),
  screensEnabled: jest.fn(() => true),
  freezeEnabled: jest.fn(() => true),
  isSearchBarAvailableForCurrentPlatform: jest.fn(() => false),
  executeNativeBackPress: jest.fn(),
  useTransitionProgress: jest.fn(() => ({ closing: 0, goingForward: 0 })),
}));

// Reanimated v4 — the official mock still imports worklets which require a
// native runtime. Instead we supply a minimal stub covering the hooks used
// in AnimatedTile.tsx (useSharedValue, useAnimatedStyle, withTiming, etc.).
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Text } = require("react-native");

  // Stable for the component's lifetime, like the real hook: a write from a gesture handler or a
  // UI-thread callback captured in one render is still there on the next (#2956).
  const useStableSharedValue = (init: unknown) => React.useState(() => ({ value: init }))[0];
  const noopAnim = (v: unknown) => v;

  const createAnimatedComponent = (Component: React.ComponentType) => {
    const Wrapped = React.forwardRef((props: object, ref: unknown) =>
      React.createElement(Component, { ...props, ref })
    );
    Wrapped.displayName = "AnimatedComponent";
    return Wrapped;
  };

  const AnimatedView = createAnimatedComponent(View);
  const AnimatedText = createAnimatedComponent(Text);

  return {
    __esModule: true,
    default: {
      View: AnimatedView,
      Text: AnimatedText,
      createAnimatedComponent,
    },
    // Named exports used directly in AnimatedTile.tsx
    useSharedValue: useStableSharedValue,
    useAnimatedStyle: (fn: () => object) => fn(),
    useAnimatedProps: (fn: () => object) => fn(),
    withTiming: noopAnim,
    withSpring: noopAnim,
    withSequence: (...args: unknown[]) => args[args.length - 1],
    withRepeat: (v: unknown) => v,
    withDelay: (_ms: number, v: unknown) => v,
    Easing: {
      out: () => () => 0,
      in: () => () => 0,
      quad: () => 0,
    },
    cancelAnimation: () => {},
    // Tests flip this with `(useReducedMotion as jest.Mock).mockReturnValue(true)`.
    useReducedMotion: jest.fn(() => false),
    runOnJS: (fn: unknown) => fn,
    createAnimatedComponent,
    // Used internally by react-native-gesture-handler
    useEvent: () => () => {},
    useHandler: (_handlers: unknown, deps: unknown[]) => [() => {}, deps],
    useAnimatedRef: () => ({ current: null }),
    measure: () => null,
    useAnimatedReaction: () => {},
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useWorkletCallback: (fn: unknown) => fn,
    makeRemote: (obj: unknown) => obj,
    makeShareable: (obj: unknown) => obj,
    startMapper: () => 0,
    stopMapper: () => {},
  };
});

// expo-audio mock — native audio APIs are unavailable in Jest
jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
  })),
  AudioPlayer: jest.fn(),
}));

// bottom-tabs v7.18.2 calls createScreenFactory() at module level; mocking the
// entire package prevents it from importing @react-navigation/native and
// failing when individual test files supply a partial native mock.
jest.mock("@react-navigation/bottom-tabs", () => ({
  createBottomTabNavigator: jest.fn(() => ({
    Navigator: jest.fn(({ children }: { children: React.ReactNode }) => children),
    Screen: jest.fn(() => null),
    Group: jest.fn(({ children }: { children: React.ReactNode }) => children),
  })),
  createBottomTabScreen: jest.fn((config: unknown) => config),
  useBottomTabBarHeight: jest.fn(() => 0),
  BottomTabBar: jest.fn(() => null),
  BottomTabView: jest.fn(() => null),
  BottomTabBarHeightCallbackContext: {
    Provider: jest.fn(({ children }: { children: React.ReactNode }) => children),
  },
  BottomTabBarHeightContext: {
    Provider: jest.fn(({ children }: { children: React.ReactNode }) => children),
  },
}));

// Safe area context mock — returns zero insets in tests
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: jest.fn(({ children }: { children: unknown }) => children),
  SafeAreaProvider: jest.fn(({ children }: { children: unknown }) => children),
}));

// expo-blur and expo-linear-gradient — pass-throughs that render only their
// children (#2954), so no test sees native blur/gradient views. A test that
// needs another shape mocks the package itself; its jest.mock wins.
jest.mock("expo-blur", () => {
  const { createElement, Fragment } = jest.requireActual<typeof import("react")>("react");
  return {
    BlurView: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
  };
});
jest.mock("expo-linear-gradient", () => {
  const { createElement, Fragment } = jest.requireActual<typeof import("react")>("react");
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
  };
});

// Shared screen-test mock factories (#2954), as a global so hoisted jest.mock
// factories can call it: babel-plugin-jest-hoist lets a factory reference a
// name matching /^mock/i. Usage: src/test-utils/mockScreenDeps.ts.
globalThis.mockScreenDeps = () => jest.requireActual("./src/test-utils/mockScreenDeps");

// Sentry mock — @sentry/react-native ships ESM that Jest can't transform
jest.mock("@sentry/react-native", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureFeedback: jest.fn(() => "mock-feedback-event-id"),
  getClient: jest.fn(() => ({})),
  init: jest.fn(),
  wrap: (c: unknown) => c,
  ReactNavigationInstrumentation: jest.fn(),
  ReactNativeTracing: jest.fn(),
  metrics: {
    distribution: jest.fn(),
    increment: jest.fn(),
    gauge: jest.fn(),
    set: jest.fn(),
  },
}));

// AsyncStorage mock — self-contained in-memory store, no dependency on the
// package's own jest helper (removed in v3). Each method is a jest.fn() so
// tests can spy on calls or override with mockResolvedValue.
jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    getMany: jest.fn((keys: string[]) =>
      Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k] ?? null])))
    ),
    setMany: jest.fn((entries: Record<string, string>) => {
      Object.assign(store, entries);
      return Promise.resolve();
    }),
    removeMany: jest.fn((keys: string[]) => {
      keys.forEach((k) => delete store[k]);
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
    clear: jest.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
      return Promise.resolve();
    }),
  };
});

// useGameSync's foreground clock (#2684) is pinned for every test file to the
// shared manual mock (src/game/_shared/__mocks__/foregroundClock.ts, #2710), so
// its active-play window only moves when a test moves it and an exact
// completion summary can't pick up real test time. Tests of the real clock opt
// out with jest.unmock().
jest.mock("./src/game/_shared/foregroundClock");

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { NAMESPACES } from "./src/i18n/localeLoaders";

// English resources for every namespace, from the same list the app loads
// (#2678), so a new namespace can't be missing here.
const englishResources = Object.fromEntries(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NAMESPACES.map((ns) => [ns, require(`./src/i18n/locales/en/${ns}.json`)])
);

i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: [...NAMESPACES],
  defaultNS: "common",
  resources: { en: englishResources },
  interpolation: { escapeValue: false },
});

export default i18n;
