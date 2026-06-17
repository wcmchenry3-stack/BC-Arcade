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

  const sharedValue = (init: unknown) => ({ value: init });
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
    useSharedValue: sharedValue,
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

// Sentry mock — @sentry/react-native ships ESM that Jest can't transform
jest.mock("@sentry/react-native", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
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

// AsyncStorage mock — v3 ships an in-memory implementation under the /jest export.
// We wrap each method in jest.fn() so tests can override with mockResolvedValue,
// while the default implementation is the real in-memory store (needed by eventStore).
jest.mock("@react-native-async-storage/async-storage", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const inMemory = require("@react-native-async-storage/async-storage/jest").default;
  return {
    getItem: jest.fn((key: string) => inMemory.getItem(key)),
    setItem: jest.fn((key: string, value: string) => inMemory.setItem(key, value)),
    removeItem: jest.fn((key: string) => inMemory.removeItem(key)),
    getMany: jest.fn((keys: string[]) => inMemory.getMany(keys)),
    setMany: jest.fn((entries: Record<string, string>) => inMemory.setMany(entries)),
    removeMany: jest.fn((keys: string[]) => inMemory.removeMany(keys)),
    getAllKeys: jest.fn(() => inMemory.getAllKeys()),
    clear: jest.fn(() => inMemory.clear()),
  };
});

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// English namespace fixtures for testing
import common from "./src/i18n/locales/en/common.json";
import yacht from "./src/i18n/locales/en/yacht.json";
import cascade from "./src/i18n/locales/en/cascade.json";
import errors from "./src/i18n/locales/en/errors.json";
import blackjack from "./src/i18n/locales/en/blackjack.json";
import twenty48 from "./src/i18n/locales/en/twenty48.json";
import freecell from "./src/i18n/locales/en/freecell.json";
import solitaire from "./src/i18n/locales/en/solitaire.json";
import hearts from "./src/i18n/locales/en/hearts.json";
import sudoku from "./src/i18n/locales/en/sudoku.json";
import feedback from "./src/i18n/locales/en/feedback.json";
import profile from "./src/i18n/locales/en/profile.json";
import sort from "./src/i18n/locales/en/sort.json";
import daily_word from "./src/i18n/locales/en/daily_word.json";

i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: [
    "common",
    "yacht",
    "cascade",
    "errors",
    "blackjack",
    "twenty48",
    "freecell",
    "solitaire",
    "hearts",
    "sudoku",
    "feedback",
    "profile",
    "sort",
    "daily_word",
  ],
  defaultNS: "common",
  resources: {
    en: {
      common,
      yacht,
      cascade,
      errors,
      blackjack,
      twenty48,
      freecell,
      solitaire,
      hearts,
      sudoku,
      feedback,
      profile,
      sort,
      daily_word,
    },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
