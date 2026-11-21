/**
 * HomeScreen — the lobby: one tile per game visible in this build.
 *
 * Concerns:
 *   1. Tiles — store builds hide the premium games (#2390); a locked premium tile opens the
 *      paywall (#841); a tap warms the game's lazy chunk first (#706).
 *   2. Header stats — Arcade level (#2391) and streak (#2457) from one `/stats/me`, refreshed
 *      on foreground and remembered for an offline Stats screen (#2635).
 *   3. Daily — the Daily Challenge card, and today's Daily Word cached for offline (#2925).
 *   4. Resume — Yacht opens its saved game, including a VS game mid computer turn (#2203).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  type ImageSourcePropType,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import * as Sentry from "@sentry/react-native";
import type { HomeStackParamList, RootStackParamList } from "../types/navigation";
import { newGame as newYachtGame } from "../game/yacht/engine";
import { loadGame as loadYachtGame } from "../game/yacht/storage";
import { isAiTurnPending } from "../game/yacht/vsTurn";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { ConnectedOfflineBanner } from "../components/shared/OfflineBanner";
import DailyChallengeCard from "../components/daily_challenge/DailyChallengeCard";
import { APP_START_MS } from "../utils/appTiming";
import { prefetchLobbyGameScreens } from "../utils/lazyScreens";
import { useEntitlementGate } from "../entitlements/EntitlementContext";
import { isGameVisible } from "../entitlements/gameVisibility";
import { statsApi } from "../api/stats";
import { withRetry } from "../game/_shared/withRetry";
import { warmTodayMeta } from "../game/daily_word/todayMeta";
import { useNetwork } from "../game/_shared/NetworkContext";
import { flushQueuedGames } from "../game/_shared/flushQueuedGames";
import { getLastKnownStreak } from "../game/_shared/lastKnownStreak";
import { fetchAndRememberMyStats } from "../hooks/useMyStats";
import sortTile from "../../assets/home/sort-tile.webp";
import sudokuTile from "../../assets/home/sudoku-tile.webp";
import twenty48Tile from "../../assets/home/twenty48-tile.webp";
import yachtTile from "../../assets/home/yacht-tile.webp";
// Hidden games' tile images: never imported here, or a store build would package them (#4011).
import { HIDDEN_GAME_TILE_ART } from "../components/home/hiddenGameTileArt";
import CascadeTileIcon from "../components/cascade/CascadeTileIcon";
import { lobbyColumns, TILE_ICON_ZONE } from "../components/home/lobbyColumns";

// A tile's icon is an emoji, or a generated image, or Cascade's code-drawn piece (#3698), which
// shows the emoji until it is ready (and on web). Images are gameplay scenes drawn by
// tools/assets/draw_lobby_tile_art.py (#4011), shown at `cardArt` (64 pt, inside the 68 pt
// TILE_ICON_ZONE); a `badge` image is Star Swarm's hex badge (#3599), 56 pt until #4013 redraws it.
type GameCardIcon =
  | { emoji: string; image?: undefined; drawn?: boolean; badge?: undefined }
  | { image: ImageSourcePropType; emoji?: undefined; drawn?: undefined; badge?: boolean };

type GameCard = GameCardIcon & {
  key: string;
  slug: string;
  title: string;
  description: string;
  action: () => void;
};

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
  ]);
  const { colors } = useTheme();
  const { canPlay } = useEntitlementGate();
  const insets = useSafeAreaInsets();
  // A locked premium tile opens the paywall modal (#841). It is on the root
  // stack, so navigate() bubbles up from this nested stack. Only visible games
  // have tiles, and the modal is registered only where one is visible.
  const openPaywall = (gameSlug: string) => {
    (navigation as unknown as NavigationProp<RootStackParamList>).navigate("Paywall", {
      gameSlug,
    });
  };
  const { width } = useWindowDimensions();

  const numColumns = lobbyColumns(width);

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
    // Hidden games have no route to land on, so never warm their chunks (#2390).
    const id = setTimeout(
      () => prefetchLobbyGameScreens((slug) => isGameVisible(slug) && canPlay(slug)),
      0
    );
    return () => clearTimeout(id);
  }, [canPlay]);

  // Arcade level pill (#2391) and streak badge (#2457), both fed by one /stats/me
  // call. Purely decorative: they never block or delay the grid, and any failure
  // just leaves them out (or keeps the last known values on a refetch). Refetched
  // on focus so a level-up shows on the way back from a game, when the device
  // comes back online, and when the app returns to the foreground (the streak is
  // a local-day value, so it can lapse while Home sits open overnight). Skipped
  // while known offline — four doomed attempts per Home visit would only add
  // Sentry "network failure" noise (#2430).
  const { isOnline } = useNetwork();
  const [arcadeLevel, setArcadeLevel] = useState<number | null>(null);
  const [streakDays, setStreakDays] = useState<number>(0);
  const statsFetchInFlight = useRef(false);
  const mounted = useRef(true);
  // Set once a server answer lands, so the remembered streak never overwrites it.
  const streakFromServer = useRef(false);
  const refreshStats = useCallback(() => {
    if (!isOnline || statsFetchInFlight.current) return;
    statsFetchInFlight.current = true;
    // Push a just-finished game first or /stats/me answers with the old level.
    // Shared with the daily-challenge card so their concurrent flushes don't
    // let one of them read before the upload lands.
    flushQueuedGames()
      // Remembered for the stats screen opened offline later (#2635).
      .then(() => fetchAndRememberMyStats(() => withRetry(() => statsApi.getMyStats())))
      .then((stats) => {
        if (!mounted.current) return;
        setArcadeLevel(stats.arcade_level);
        // A server that predates the streak omits the field: treat it as no streak.
        streakFromServer.current = true;
        setStreakDays(typeof stats.streak_days === "number" ? stats.streak_days : 0);
      })
      .catch(() => {
        // httpClient already reports what is worth reporting.
      })
      .finally(() => {
        statsFetchInFlight.current = false;
      });
  }, [isOnline]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The last streak the server reported, shown until a fresh one lands, so an
  // offline launch isn't empty (#3226).
  useEffect(() => {
    void getLastKnownStreak().then((days) => {
      if (days !== null && mounted.current && !streakFromServer.current) setStreakDays(days);
    });
  }, []);

  // On mount, and again whenever connectivity returns.
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => navigation.addListener("focus", refreshStats), [navigation, refreshStats]);

  // Cache today's Daily Word metadata so the screen can open offline later the
  // same day (#2925). Once per mount / return to connectivity / foreground —
  // not per focus. warmTodayMeta skips the fetch when already cached.
  useEffect(() => {
    if (!isOnline) return;
    void warmTodayMeta();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void warmTodayMeta();
    });
    return () => sub.remove();
  }, [isOnline]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshStats();
    });
    return () => sub.remove();
  }, [refreshStats]);

  async function startYacht() {
    const saved = await loadYachtGame();
    // Resume an unfinished game, including a VS game where only the
    // computer's last turn is left (#2203).
    const resumable =
      saved &&
      (!saved.state.game_over ||
        (!!saved.aiDifficulty && !!saved.aiState && isAiTurnPending(saved.state, saved.aiState)));
    if (saved && resumable) {
      navigation.navigate("Game", {
        initialState: saved.state,
        aiDifficulty: saved.aiDifficulty ?? undefined,
        aiState: saved.aiState ?? undefined,
        finishedGameId: saved.finishedGameId,
      });
    } else {
      navigation.navigate("Game", { initialState: newYachtGame() });
    }
  }

  const allGames: GameCard[] = [
    {
      key: "yacht",
      slug: "yacht",
      image: yachtTile, // five dice: four landed on fives, one still tumbling
      title: t("yacht:game.title"),
      description: t("yacht:game.description"),
      action: startYacht,
    },
    {
      key: "cascade",
      slug: "cascade",
      emoji: "🍉",
      drawn: true,
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
      image: twenty48Tile, // two 1024 tiles sliding together
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
      image: sudokuTile, // a 3x3 box with a digit just placed
      title: t("sudoku:game.title"),
      description: t("sudoku:game.description"),
      action: () => navigation.navigate("Sudoku"),
    },
    {
      key: "starswarm",
      slug: "starswarm",
      // The Wasp Grunt in a hex badge (#3599), drawn by tools/assets/draw_starswarm_art.py. It
      // carries its own dark face, so it reads on the light and the dark theme.
      image: HIDDEN_GAME_TILE_ART.starswarm,
      badge: true,
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
      image: sortTile, // one flask pouring into another
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
  // Store builds hide the premium games entirely (#2390) — see gameVisibility.ts.
  const games = allGames.filter((game) => isGameVisible(game.slug));

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
          onPress={isLocked ? () => openPaywall(item.slug) : item.action}
          accessibilityRole="button"
          accessibilityLabel={
            isLocked
              ? t("common:home.locked.cardLabel", { title: item.title })
              : (playLabels[item.title] ?? item.title)
          }
          accessibilityHint={item.description}
          testID={`game-tile-${item.slug}`}
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
            {/* Not every icon is a colour emoji: "♠", "♥" and "🂡" are text-presentation
                glyphs that take the Text colour, which defaults to black — invisible on
                the dark theme. Colour emoji ignore `color`, so this is safe for the rest. */}
            {item.image ? (
              <Image
                source={item.image}
                style={item.badge ? styles.cardImage : styles.cardArt}
                resizeMode="contain"
                accessible={false}
                testID={`game-icon-${item.slug}`}
              />
            ) : item.drawn ? (
              <CascadeTileIcon
                size={styles.cardImage.width}
                testID={`game-art-${item.slug}`}
                fallback={
                  <Text
                    style={[styles.cardEmoji, { color: colors.text }]}
                    testID={`game-icon-${item.slug}`}
                  >
                    {item.emoji}
                  </Text>
                }
              />
            ) : (
              <Text
                style={[styles.cardEmoji, { color: colors.text }]}
                testID={`game-icon-${item.slug}`}
              >
                {item.emoji}
              </Text>
            )}
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
            <View
              style={[styles.playBtn, { borderColor: colors.border }]}
              testID={`game-btn-${item.slug}`}
            >
              <Text style={[styles.playBtnText, { color: colors.textMuted }]}>
                {t("common:home.locked.buttonLabel")}
              </Text>
            </View>
          ) : (
            <LinearGradient
              colors={[gradStart, gradEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.playBtn, styles.playBtnUnlocked]}
              testID={`game-btn-${item.slug}`}
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
      <AppHeader
        title={t("common:app.title")}
        rightSlot={
          arcadeLevel != null || streakDays > 0 ? (
            <View style={styles.headerBadges}>
              {streakDays > 0 ? (
                <Text
                  style={[styles.streakText, { color: colors.text }]}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={t("common:streak.pillA11y", { count: streakDays })}
                  maxFontSizeMultiplier={1.2}
                >
                  {t("common:streak.pill", { count: streakDays })}
                </Text>
              ) : null}
              {arcadeLevel != null ? (
                <View
                  style={[styles.levelPill, { backgroundColor: colors.accent }]}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={t("common:level.pillA11y", { level: arcadeLevel })}
                >
                  <Text style={[styles.levelPillText, { color: colors.textOnAccent }]}>
                    {t("common:level.pill", { level: arcadeLevel })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null
        }
      />

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
        <ConnectedOfflineBanner />
        <DailyChallengeCard />
        {numColumns === 1
          ? games.map((item, index) => (
              <React.Fragment key={item.key}>{renderCard({ item, index })}</React.Fragment>
            ))
          : Array.from({ length: Math.ceil(games.length / numColumns) }, (_, rowIndex) => {
              const rowGames = games.slice(rowIndex * numColumns, (rowIndex + 1) * numColumns);
              return (
                <View key={rowIndex} style={styles.row}>
                  {rowGames.map((item, colIndex) => (
                    <React.Fragment key={item.key}>
                      {renderCard({ item, index: rowIndex * numColumns + colIndex })}
                    </React.Fragment>
                  ))}
                  {/* Pad a short last row so every tile keeps the column width (#4005). */}
                  {Array.from({ length: numColumns - rowGames.length }, (_, i) => (
                    <View
                      key={`spacer-${i}`}
                      testID="lobby-spacer"
                      style={styles.cardWrapper}
                      accessible={false}
                      importantForAccessibility="no-hide-descendants"
                      accessibilityElementsHidden
                      pointerEvents="none"
                    />
                  ))}
                </View>
              );
            })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // The header's right slot reserves 80pt and the title is flex:1, so the badges must
  // stay near that width: the streak is plain text, not a second pill.
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  streakText: {
    fontFamily: typography.label,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  levelPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  levelPillText: {
    fontFamily: typography.label,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  screen: {
    flex: 1,
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
    height: TILE_ICON_ZONE,
    alignItems: "center",
    justifyContent: "center",
  },
  cardEmoji: {
    fontSize: 44,
  },
  // Fits inside the 68 pt TILE_ICON_ZONE with a 6 pt margin each side
  cardImage: {
    width: 56,
    height: 56,
  },
  // The lobby tile art's display size (#4011): the WebPs are drawn at 3x this (192 px) by
  // tools/assets/draw_lobby_tile_art.py (its DISPLAY_PT), sized to sit in the icon zone.
  cardArt: {
    width: 64,
    height: 64,
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
    borderWidth: 1,
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
  // Both buttons carry a 1 pt border so locked and unlocked tiles measure the same (#4005).
  playBtnUnlocked: {
    borderColor: "transparent",
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
