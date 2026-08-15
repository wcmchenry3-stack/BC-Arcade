import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Theme = "dark" | "light";
export type ThemeMode = "system" | "light" | "dark";

export interface Colors {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceHigh: string;
  /** Subtle peer highlight — same row, column, or 3×3 box as the selected Sudoku cell. */
  surfacePeer: string;
  border: string;
  text: string;
  textMuted: string;
  textFilled: string;
  textOnAccent: string;
  /** Error-state text sitting on the accent color (e.g. a wrong Sudoku digit in a selected cell). */
  errorOnAccent: string;
  accent: string;
  accentBright: string;
  secondary: string;
  tertiary: string;
  potential: string;
  heldBg: string;
  heldBorder: string;
  dieBg: string;
  dieBorder: string;
  headerBg: string;
  sectionHeaderBg: string;
  bonusBg: string;
  totalBg: string;
  modalBg: string;
  overlay: string;
  /** Translucent panel colour for blurred header + tabbar chrome. */
  chromeBg: string;
  /** CSS-shorthand shadow spec for the header/tabbar glow (`offsetX offsetY blur rgba`). */
  chromeShadow: string;
  /** Base colour for React Native's native `shadowColor` on header/tabbar. */
  chromeShadowColor: string;
  /** Native `shadowOpacity` value to pair with `chromeShadowColor`. */
  chromeShadowOpacity: number;
  error: string;
  bonus: string;
  fruitContainer: string;
  fruitBackground: string;
}

// --- BC Arcade design tokens (see docs/BRANDING.md, issue #709) ---
// Dark values mirror colors_and_type.css; light values mirror the cream
// SharedComponents.jsx palette (cream supersedes the gray light variant).
const TOKENS = {
  // Dark backgrounds
  darkBg: "#0e0e13",
  darkSurface: "#19191f",
  darkSurfacePeer: "#1c1c23",
  darkSurfaceAlt: "#1f1f26",
  darkSurfaceHigh: "#25252c",
  // Light backgrounds (cream)
  lightBg: "#f5ecd7",
  lightSurface: "#fbf4e2",
  lightSurfacePeer: "#f4ebd0",
  lightSurfaceAlt: "#eddfbf",
  lightSurfaceHigh: "#fff8e8",
  // Accents — light variants desaturated so they don't vibrate on cream
  accentDark: "#8ff5ff",
  accentLight: "#1bc5d4",
  accentBrightDark: "#00eefc",
  accentBrightLight: "#00a8b8",
  secondaryDark: "#d674ff",
  secondaryLight: "#a34fc4",
  tertiaryDark: "#cafd00",
  tertiaryLight: "#8fa800",
  // Semantic
  errorDark: "#ff716c",
  errorLight: "#d94a42",
  bonusDark: "#4ade80",
  bonusLight: "#2da557",
  white: "#ffffff",
} as const;

export const dark: Colors = {
  background: TOKENS.darkBg,
  surface: TOKENS.darkSurface,
  surfacePeer: TOKENS.darkSurfacePeer,
  surfaceAlt: TOKENS.darkSurfaceAlt,
  surfaceHigh: TOKENS.darkSurfaceHigh,
  border: "#2e2e38",
  text: "#e8e8f0",
  // WCAG AA: 5.83:1 on #25252c, 5.05:1 on #303034, 7.45:1 on #0e0e13
  textMuted: "#a0a0ac",
  textFilled: "#4a4a56",
  textOnAccent: "#0e0e13",
  // WCAG AA: 4.79:1 on the selected-cell background (accent "AA" over surface)
  errorOnAccent: "#631b18",
  accent: TOKENS.accentDark,
  accentBright: TOKENS.accentBrightDark,
  secondary: TOKENS.secondaryDark,
  tertiary: TOKENS.tertiaryDark,
  potential: TOKENS.accentDark, // cyan on dark surface — high contrast
  heldBg: "#1a2e3a",
  heldBorder: TOKENS.accentDark,
  dieBg: TOKENS.darkSurface,
  dieBorder: "#3a3a46",
  headerBg: TOKENS.darkBg,
  sectionHeaderBg: TOKENS.darkSurface,
  bonusBg: TOKENS.darkSurfaceAlt,
  totalBg: TOKENS.darkBg,
  modalBg: TOKENS.darkSurfaceHigh,
  overlay: "rgba(0,0,0,0.75)",
  chromeBg: "rgba(14,14,19,0.7)",
  chromeShadow: "0 4px 20px rgba(143,245,255,0.08)",
  chromeShadowColor: TOKENS.accentDark,
  chromeShadowOpacity: 0.08,
  error: TOKENS.errorDark,
  bonus: TOKENS.bonusDark,
  fruitContainer: TOKENS.darkSurface,
  fruitBackground: TOKENS.darkBg,
};

export const light: Colors = {
  background: TOKENS.lightBg,
  surface: TOKENS.lightSurface,
  surfacePeer: TOKENS.lightSurfacePeer,
  surfaceAlt: TOKENS.lightSurfaceAlt,
  surfaceHigh: TOKENS.lightSurfaceHigh,
  border: "#d8c9a6",
  text: "#1a1412",
  textMuted: "#6b5e4a",
  textFilled: "#b5a684",
  textOnAccent: "#0e0e13", // dark text on teal accent (readable on cream variant)
  // WCAG AA: 7.11:1 on the selected-cell background (accent "AA" over surface)
  errorOnAccent: "#631b18",
  accent: TOKENS.accentLight,
  accentBright: TOKENS.accentBrightLight,
  secondary: TOKENS.secondaryLight,
  tertiary: TOKENS.tertiaryLight,
  potential: TOKENS.accentLight, // desaturated teal on cream
  heldBg: "#d7eff2", // cream-compatible light teal tint for highlighted dice
  heldBorder: TOKENS.accentLight,
  dieBg: TOKENS.lightSurface,
  dieBorder: "#d8c9a6",
  headerBg: "#1a1412", // dark header over cream body — existing screen contract
  sectionHeaderBg: "#25252c",
  bonusBg: TOKENS.lightSurfaceAlt,
  totalBg: "#25252c",
  modalBg: TOKENS.lightSurface,
  overlay: "rgba(0,0,0,0.75)",
  chromeBg: "rgba(245,236,215,0.82)",
  chromeShadow: "0 4px 20px rgba(0,0,0,0.06)",
  chromeShadowColor: "#000000",
  chromeShadowOpacity: 0.06,
  error: TOKENS.errorLight,
  bonus: TOKENS.bonusLight,
  fruitContainer: TOKENS.lightSurfaceAlt,
  fruitBackground: TOKENS.lightSurfaceHigh,
};

const PALETTES = { dark, light };
const STORAGE_KEY_MODE = "gaming_app_theme_mode";
// Legacy key written by pre-#710 builds — stored a resolved Theme ("dark"|"light").
// On first launch after upgrade we migrate it into the new themeMode slot.
const STORAGE_KEY_LEGACY = "gaming_app_theme";

interface ThemeContextValue {
  /** Resolved theme actually applied to the UI. */
  theme: Theme;
  /** User preference — may be `"system"`, in which case `theme` follows the OS. */
  themeMode: ThemeMode;
  colors: Colors;
  /** Back-compat convenience: flips between light and dark (sets explicit mode). */
  toggle: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  themeMode: "dark",
  colors: dark,
  toggle: () => {},
  setThemeMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    (async () => {
      const storedMode = await AsyncStorage.getItem(STORAGE_KEY_MODE);
      if (storedMode === "system" || storedMode === "light" || storedMode === "dark") {
        setThemeModeState(storedMode);
        return;
      }
      const legacy = await AsyncStorage.getItem(STORAGE_KEY_LEGACY);
      if (legacy === "dark" || legacy === "light") {
        setThemeModeState(legacy);
        AsyncStorage.setItem(STORAGE_KEY_MODE, legacy);
      }
    })();
  }, []);

  const theme: Theme =
    themeMode === "system" ? (systemScheme === "light" ? "light" : "dark") : themeMode;

  function setThemeMode(mode: ThemeMode) {
    setThemeModeState(mode);
    AsyncStorage.setItem(STORAGE_KEY_MODE, mode);
  }

  function toggle() {
    setThemeMode(theme === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider
      value={{ theme, themeMode, colors: PALETTES[theme], toggle, setThemeMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
