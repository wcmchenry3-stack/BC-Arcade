import React, { useEffect } from "react";
import {
  Alert,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import * as Sentry from "@sentry/react-native";
import { HomeStackParamList } from "../../App";
import { newGame as newYachtGame } from "../game/yacht/engine";
import { loadGame as loadYachtGame } from "../game/yacht/storage";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import OfflineBanner from "../components/OfflineBanner";
import { APP_START_MS } from "../utils/appTiming";
import { prefetchLobbyGameScreens } from "../utils/lazyScreens";
import { useEntitlements } from "../entitlements/EntitlementContext";

/** Below this viewport width the grid collapses to a single column. */
const SINGLE_COL_BREAKPOINT = 360;

interface GameCard {
  key: string;
  slug: string;
  emoji: string;
  title: string;
  description: string;
  action: () => void;
}

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "Home">>();
  const { t } = useTranslation([
    "common",
    "yacht",
    "cascade",
    "blackjack",
    "twenty48",
    "solitaire",
    "freecell",
    "hearts",
    "sudoku",
    "starswarm",
    "mahjong",
    "sort",
    "daily_word",
    "errors",
  ]);
  const { colors } = useTheme();
  const { canPlay } = useEntitlements();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const numColumns = width < SINGLE_COL_BREAKPOINT ? 1 : 2;

  useEffect(() => {
    if (APP_START_MS > 0) {
      const coldStartMs = performance.now() - APP_START_MS;
      Sentry.metrics.distribution("cold_start_ms", coldStartMs, { unit: "millisecond" });
    }
  }, []);

  // Warm lobby game chunks once Home has painted so nav doesn't show a
  // Suspense fallback on tap (issue #706). setTimeout(0) defers past the
  // current frame without the InteractionManager deprecation in RN 0.83.
  // canPlay is stable until entitlements change, so re-running on change
  // ensures premium chunks are prefetched as soon as a session is entitled.
  useEffect(() => {
    const id = setTimeout(() => prefetchLobbyGameScreens(canPlay), 0);
    return () => clearTimeout(id);
  }, [canPlay]);

  async function startYacht() {
    const saved = await loadYachtGame();
    const state = saved && !saved.game_over ? saved : newYachtGame();
    navigation.navigate("Game", { initialState: state });
  }

  const games: GameCard[] = [
    {
      key: "yacht",
      slug: "yacht",
      emoji: "🎲",
      title: t("yacht:game.title"),
      description: t("yacht:game.description"),
      action: startYacht,
    },
    {
      key: "cascade",
      slug: "cascade",
      emoji: "🍉",
      title: t("cascade:game.title"),
      description: t("cascade:game.description"),
      action: () => navigation.navigate("Cascade"),
    },
    {
      key: "blackjack",
      slug: "blackjack",
      emoji: "🃏",
      title: t("blackjack:game.title"),
      description: t("blackjack:game.description"),
      action: () => navigation.navigate("BlackjackBetting"),
    },
    {
      key: "twenty48",
      slug: "twenty48",
      emoji: "🔢",
      title: t("twenty48:game.title"),
      description: t("twenty48:game.description"),
      action: () => navigation.navigate("Twenty48"),
    },
    {
      key: "solitaire",
      slug: "solitaire",
      emoji: "♠",
      title: t("solitaire:game.title"),
      description: t("solitaire:game.description"),
      action: () => navigation.navigate("Solitaire"),
    },
    {
      key: "freecell",
      slug: "freecell",
      emoji: "🂡",
      title: t("freecell:game.title"),
      description: t("freecell:game.description"),
      action: () => navigation.navigate("FreeCell"),
    },
    {
      key: "hearts",
      slug: "hearts",
      emoji: "♥",
      title: t("hearts:game.title"),
      description: t("hearts:game.description"),
      action: () => navigation.navigate("Hearts"),
    },
    {
      key: "sudoku",
      slug: "sudoku",
      // twenty48 already owns 🔢 in the lobby; the puzzle-piece glyph
      // keeps Sudoku visually distinct while staying puzzle-coded.
      emoji: "🧩",
      title: t("sudoku:game.title"),
      description: t("sudoku:game.description"),
      action: () => navigation.navigate("Sudoku"),
    },
    {
      key: "starswarm",
      slug: "starswarm",
      emoji: "👾",
      title: t("starswarm:game.title"),
      description: t("starswarm:game.description"),
      action: () => navigation.navigate("StarSwarm"),
    },
    {
      key: "mahjong",
      slug: "mahjong",
      emoji: "🀄",
      title: t("mahjong:game.title"),
      description: t("mahjong:game.description"),
      action: () => navigation.navigate("Mahjong"),
    },
    {
      key: "sort",
      slug: "sort",
      emoji: "🍾",
      title: t("sort:game.title"),
      description: t("sort:game.description"),
      action: () => navigation.navigate("Sort"),
    },
    {
      key: "daily_word",
      slug: "daily_word",
      emoji: "📝",
      title: t("daily_word:game.title"),
      description: t("daily_word:game.description"),
      action: () => navigation.navigate("DailyWord"),
    },
  ];

  const playLabels: Record<string, string> = {
    [t("yacht:game.title")]: t("yacht:game.playLabel"),
    [t("cascade:game.title")]: t("cascade:game.playLabel"),
    [t("blackjack:game.title")]: t("blackjack:game.playLabel"),
    [t("twenty48:game.title")]: t("twenty48:game.playLabel"),
    [t("solitaire:game.title")]: t("solitaire:game.playLabel"),
    [t("freecell:game.title")]: t("freecell:game.playLabel"),
    [t("hearts:game.title")]: t("hearts:game.playLabel"),
    [t("sudoku:game.title")]: t("sudoku:game.playLabel"),
    [t("starswarm:game.title")]: t("starswarm:game.playLabel"),
    [t("mahjong:game.title")]: t("mahjong:game.playLabel"),
    [t("sort:game.title")]: t("sort:game.playLabel"),
    [t("daily_word:game.title")]: t("daily_word:game.playLabel"),
  };

  // Cycle through BC Arcade accent colors for the gradient top border on each card.
  const cardGradients: [string, string][] = [
    [colors.tertiary, colors.secondary],
    [colors.secondary, colors.accent],
    [colors.accent, colors.accentBright],
    [colors.accentBright, colors.tertiary],
  ];

  function renderCard({ item, index }: { item: GameCard; index: number }) {
    const gradient = cardGradients[index % cardGradients.length] ?? [
      colors.secondary,
      colors.accent,
    ];
    const [gradStart, gradEnd] = gradient;
    const isLocked = !canPlay(item.slug);

    return (
      <View style={[styles.cardWrapper, numColumns === 1 && styles.cardWrapperFull]}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.surfaceHigh }]}
          onPress={isLocked ? () => Alert.alert(t("common:home.locked.comingSoon")) : item.action}
          accessibilityRole="button"
          accessibilityLabel={
            isLocked
              ? t("common:home.locked.cardLabel", { title: item.title })
              : (playLabels[item.title] ?? item.title)
          }
          accessibilityHint={item.description}
        >
          {/* Gradient top border */}
          <LinearGradient
            colors={[gradStart, gradEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientBorder}
          />

          {/* Emoji icon zone */}
          <View style={styles.emojiZone}>
            <Text style={styles.cardEmoji}>{item.emoji}</Text>
          </View>

          {/* Title */}
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>

          {/* Description */}
          <Text style={[styles.cardDesc, { color: colors.textMuted }]} numberOfLines={2}>
            {item.description}
          </Text>

          {/* Play / Unlock button */}
          {isLocked ? (
            <View style={[styles.playBtn, styles.playBtnLocked, { borderColor: colors.border }]}>
              <Text style={[styles.playBtnText, { color: colors.textMuted }]}>
                {t("common:home.locked.buttonLabel")}
              </Text>
            </View>
          ) : (
            <LinearGradient
              colors={[gradStart, gradEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.playBtn}
            >
              <Text style={[styles.playBtnText, { color: colors.textOnAccent }]}>
                {playLabels[item.title] ?? t("common:play", "Play")}
              </Text>
            </LinearGradient>
          )}
        </Pressable>

        {/* Lock badge — outside Pressable to avoid overflow:hidden clipping */}
        {isLocked && (
          <View style={styles.lockBadge} pointerEvents="none">
            <Text style={styles.lockEmoji}>🔒</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader title={t("common:app.title")} />

      <View style={styles.offlineBannerWrap}>
        <OfflineBanner />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.grid,
          {
            paddingTop: APP_HEADER_HEIGHT + insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: 16,
          },
        ]}
      >
        {numColumns === 1
          ? games.map((item, index) => (
              <React.Fragment key={item.key}>{renderCard({ item, index })}</React.Fragment>
            ))
          : Array.from({ length: Math.ceil(games.length / numColumns) }, (_, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {games
                  .slice(rowIndex * numColumns, rowIndex * numColumns + numColumns)
                  .map((item, colIndex) => (
                    <React.Fragment key={item.key}>
                      {renderCard({ item, index: rowIndex * numColumns + colIndex })}
                    </React.Fragment>
                  ))}
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  offlineBannerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 100,
  },
  grid: {
    gap: 16,
  },
  row: {
    flexDirection: "row",
    gap: 16,
  },
  cardWrapper: {
    flex: 1,
  },
  cardWrapperFull: {
    flex: undefined,
    width: "100%",
  },
  card: {
    borderRadius: 24,
    overflow: "hidden",
    alignItems: "center",
    paddingBottom: 12,
    gap: 8,
  },
  gradientBorder: {
    width: "100%",
    height: 3,
  },
  emojiZone: {
    height: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  cardEmoji: {
    fontSize: 48,
  },
  cardTitle: {
    fontFamily: typography.heading,
    fontSize: 14,
    lineHeight: 18,
    height: 18,
    letterSpacing: -0.3,
    paddingHorizontal: 8,
    textAlign: "center",
  },
  cardDesc: {
    fontFamily: typography.body,
    fontSize: 10,
    lineHeight: 14,
    height: 28,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  playBtn: {
    marginTop: 4,
    marginHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: "stretch",
    alignItems: "center",
  },
  playBtnText: {
    fontFamily: typography.label,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  playBtnLocked: {
    borderWidth: 1,
  },
  lockBadge: {
    position: "absolute",
    top: 6,
    right: 6,
  },
  lockEmoji: {
    fontSize: 18,
  },
});
