// Expo SDK 56: winter/fetch/FetchResponse extends Response, which jest-expo's
// test environment doesn't expose even though Node 20 has it on globalThis.
if (!global.Response && typeof globalThis.Response !== "undefined") {
  (global as typeof globalThis).Response = globalThis.Response;
  (global as typeof globalThis).Request = globalThis.Request;
  (global as typeof globalThis).Headers = globalThis.Headers;
}

// Gesture handler requires native setup in Jest
import "react-native-gesture-handler/jestSetup";

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

// AsyncStorage mock (replaces localStorage in ThemeContext / FruitSetContext)
import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";
jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

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
