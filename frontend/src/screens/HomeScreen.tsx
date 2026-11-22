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
 *   5. Tile status — Resume, Done today or a personal best replaces a tile's description, read
 *      from local storage after first paint (`useLobbyTileStatus`, #4008).
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
import { isResumable as isYachtResumable } from "../game/yacht/lobbyStatus";
import { useTheme } from "../theme/ThemeContext";
import { useSoundSettings } from "../game/_shared/SoundContext";
import { useReduceMotion } from "../components/shared/useReduceMotion";
import type { GameType } from "../api/vocab";
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
import { useLobbyTileStatus } from "../hooks/useLobbyTileStatus";
import type { TileStatus } from "../game/_shared/lobbyStatus";
import { formatMs } from "../game/_shared/formatMs";
import { formatNumber } from "../api/statsDisplay";
import dailyWordTile from "../../assets/home/daily_word-tile.webp";
import freecellTile from "../../assets/home/freecell-tile.webp";
import solitaireTile from "../../assets/home/solitaire-tile.webp";
import sortTile from "../../assets/home/sort-tile.webp";
import sudokuTile from "../../assets/home/sudoku-tile.webp";
import twenty48Tile from "../../assets/home/twenty48-tile.webp";
import yachtTile from "../../assets/home/yacht-tile.webp";
// Hidden games' tile images: never imported here, or a store build would package them (#4011).
import { HIDDEN_GAME_TILE_ART } from "../components/home/hiddenGameTileArt";
import { tileAccent } from "../components/home/tileAccents";
import { tilePressHaptic } from "../components/home/tileHaptic";
import {
  lobbyColumns,
  lobbyTileTextSizing,
  LOBBY_BUTTON_SIZE,
  LOBBY_DESCRIPTION_LINE_HEIGHT,
  LOBBY_DESCRIPTION_SIZE,
  LOBBY_MAX_FONT_SCALE,
  LOBBY_TITLE_LINE_HEIGHT,
  LOBBY_TITLE_SIZE,
  TILE_ICON_ZONE,
} from "../components/home/lobbyColumns";

// Every tile's icon is a gameplay scene drawn by tools/assets/draw_lobby_tile_art.py (#4011-#4013),
// shown at `cardArt` (64 pt, inside the 68 pt TILE_ICON_ZONE). The hidden games' scenes come
// through `hiddenGameTileArt`, which a store bundle stubs (#4013).
type GameCard = {
  image: ImageSourcePropType;
  key: string;
  slug: GameType;
  title: string;
  /** Accessibility label of the tile, e.g. "Play Yacht". Lives on the entry, never keyed by title. */
  playLabel: string;
  description: string;
  action: () => void;
  /**
   * What a tap does while the tile says Resume, for a game whose plain `action` would not land in
   * the saved game (Sort opens its level grid). Omitted: `action` already resumes (#4008).
   */
  resumeAction?: () => void;
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
  const { colors, theme } = useTheme();
  const { muted } = useSoundSettings();
  // Reduce Motion drops the press scale and keeps the dim (#4007).
  const reduceMotion = useReduceMotion();
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
  const { width, fontScale } = useWindowDimensions();

  const numColumns = lobbyColumns(width);
  // Tile text reserves room that grows with the system font scale instead of fixed points.
  const textSizing = lobbyTileTextSizing(fontScale);

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
    // Resume an unfinished game, including a VS game where only the computer's last turn is
    // left (#2203). The same rule gives the tile its "Resume" (game/yacht/lobbyStatus.ts).
    if (isYachtResumable(saved)) {
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
    // Fixed order (owner, #4009): Daily Word, the game played every day, comes first; every other
    // game keeps its relative slot, so tiles never move under a player's muscle memory.
    {
      key: "daily_word",
      slug: "daily_word",
      image: dailyWordTile, // PIANO, FOCAL, then FINAL solved (answers in the en, es and fr lists)
      title: t("daily_word:game.title"),
      playLabel: t("daily_word:game.playLabel"),
      description: t("daily_word:game.description"),
      action: () => navigation.navigate("DailyWord"),
    },
    {
      key: "yacht",
      slug: "yacht",
      image: yachtTile, // five dice: four landed on fives, one still tumbling
      title: t("yacht:game.title"),
      playLabel: t("yacht:game.playLabel"),
      description: t("yacht:game.description"),
      action: startYacht,
    },
    {
      key: "cascade",
      slug: "cascade",
      image: HIDDEN_GAME_TILE_ART.cascade, // a cherry dropping into the bin onto the watermelon
      title: t("cascade:game.title"),
      playLabel: t("cascade:game.playLabel"),
      description: t("cascade:game.description"),
      action: () => navigation.navigate("Cascade"),
    },
    {
      key: "blackjack",
      slug: "blackjack",
      image: HIDDEN_GAME_TILE_ART.blackjack, // a natural: A♠ K♥, 21, the bet's chips
      title: t("blackjack:game.title"),
      playLabel: t("blackjack:game.playLabel"),
      description: t("blackjack:game.description"),
      action: () => navigation.navigate("BlackjackBetting"),
    },
    {
      key: "twenty48",
      slug: "twenty48",
      image: twenty48Tile, // two 1024 tiles sliding together
      title: t("twenty48:game.title"),
      playLabel: t("twenty48:game.playLabel"),
      description: t("twenty48:game.description"),
      action: () => navigation.navigate("Twenty48"),
    },
    {
      key: "solitaire",
      slug: "solitaire",
      image: solitaireTile, // stock and waste, the waste's 7♠ moving onto an 8♥
      title: t("solitaire:game.title"),
      playLabel: t("solitaire:game.playLabel"),
      description: t("solitaire:game.description"),
      action: () => navigation.navigate("Solitaire"),
    },
    {
      key: "freecell",
      slug: "freecell",
      image: freecellTile, // the deal: eight cascades, every card face up
      title: t("freecell:game.title"),
      playLabel: t("freecell:game.playLabel"),
      description: t("freecell:game.description"),
      action: () => navigation.navigate("FreeCell"),
    },
    {
      key: "hearts",
      slug: "hearts",
      image: HIDDEN_GAME_TILE_ART.hearts, // hearts broken over the A♥ just played
      title: t("hearts:game.title"),
      playLabel: t("hearts:game.playLabel"),
      description: t("hearts:game.description"),
      action: () => navigation.navigate("Hearts"),
    },
    {
      key: "sudoku",
      slug: "sudoku",
      image: sudokuTile, // a 3x3 box with a digit just placed
      title: t("sudoku:game.title"),
      playLabel: t("sudoku:game.playLabel"),
      description: t("sudoku:game.description"),
      action: () => navigation.navigate("Sudoku"),
    },
    {
      key: "starswarm",
      slug: "starswarm",
      image: HIDDEN_GAME_TILE_ART.starswarm, // three Wasp Grunts diving on the Arrow
      title: t("starswarm:game.title"),
      playLabel: t("starswarm:game.playLabel"),
      description: t("starswarm:game.description"),
      action: () => navigation.navigate("StarSwarm"),
    },
    {
      key: "mahjong",
      slug: "mahjong",
      image: HIDDEN_GAME_TILE_ART.mahjong, // two layers, the free pair selected
      title: t("mahjong:game.title"),
      playLabel: t("mahjong:game.playLabel"),
      description: t("mahjong:game.description"),
      action: () => navigation.navigate("Mahjong"),
    },
    {
      key: "sort",
      slug: "sort",
      image: sortTile, // one flask pouring into another
      title: t("sort:game.title"),
      playLabel: t("sort:game.playLabel"),
      description: t("sort:game.description"),
      action: () => navigation.navigate("Sort"),
      // The tile says Resume only for a board the level grid would Continue: land in it.
      resumeAction: () => navigation.navigate("Sort", { resume: true }),
    },
  ];
  // Store builds hide the premium games entirely (#2390) — see gameVisibility.ts.
  const games = allGames.filter((game) => isGameVisible(game.slug));

  // Each tile's status from local saves and bests (#4008). Only the games this build shows are
  // read; the grid never waits on it.
  const tileStatus = useLobbyTileStatus(
    games.map((game) => game.slug),
    navigation
  );

  function statusText(status: TileStatus): string {
    switch (status.kind) {
      case "resume":
        return t("common:home.status.inProgress");
      case "doneToday":
        return t("common:home.status.doneToday");
      case "best":
        if (status.unit === "moves") {
          return t("common:home.status.bestMoves", { value: formatNumber(t, status.value) });
        }
        return t("common:home.status.best", {
          value: status.unit === "time" ? formatMs(status.value) : formatNumber(t, status.value),
        });
    }
  }

  function tileLabel(item: GameCard, isLocked: boolean, status: TileStatus | undefined): string {
    if (isLocked) return t("common:home.locked.cardLabel", { title: item.title });
    if (status?.kind === "resume") {
      return t("common:home.resume.cardLabel", { label: item.playLabel });
    }
    return item.playLabel;
  }

  function statusColor(status: TileStatus): string {
    if (status.kind === "resume") return colors.accentText;
    if (status.kind === "doneToday") return colors.tertiaryText;
    return colors.textMuted;
  }

  function renderCard({ item }: { item: GameCard }) {
    // Fixed per game, never by position (#4007).
    const accent = tileAccent(item.slug, colors, theme);
    const [gradStart, gradEnd] = accent.stops;
    const isLocked = !canPlay(item.slug);
    // A locked tile can't be played, so it shows no status. Otherwise the status takes the
    // description's slot, which keeps its reserved lines, so the rows stay equal (#4008).
    const status = isLocked ? undefined : tileStatus[item.slug];
    const statusLabel = status ? statusText(status) : undefined;

    return (
      <View style={[styles.cardWrapper, numColumns === 1 && styles.cardWrapperFull]}>
        <Pressable
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.surfaceHigh },
            // Resolved by Pressable on the UI side of the press: no state, no animation loop.
            pressed && (reduceMotion ? styles.cardPressedStill : styles.cardPressed),
          ]}
          // The haptic is on tap, not touch-down: a finger that starts a scroll on a tile
          // grants the Pressable the responder first and must not buzz (#4007).
          onPress={() => {
            tilePressHaptic(muted);
            if (isLocked) openPaywall(item.slug);
            else if (status?.kind === "resume" && item.resumeAction) item.resumeAction();
            else item.action();
          }}
          accessibilityRole="button"
          accessibilityLabel={tileLabel(item, isLocked, status)}
          // Resume says its status in the label; Done today and Best are the tile's value.
          accessibilityValue={
            statusLabel && status?.kind !== "resume" ? { text: statusLabel } : undefined
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

          {/* Icon zone: the tile's gameplay scene */}
          <View style={styles.iconZone}>
            <Image
              source={item.image}
              style={styles.cardArt}
              resizeMode="contain"
              accessible={false}
              testID={`game-icon-${item.slug}`}
            />
          </View>

          {/* Title */}
          <Text
            style={[styles.cardTitle, { color: colors.text, minHeight: textSizing.titleMinHeight }]}
            numberOfLines={textSizing.titleLines}
            maxFontSizeMultiplier={LOBBY_MAX_FONT_SCALE}
          >
            {item.title}
          </Text>

          {/* Description, or the status that replaces it (#4008) */}
          <Text
            style={[
              styles.cardDesc,
              {
                color: status ? statusColor(status) : colors.textMuted,
                minHeight: textSizing.descriptionMinHeight,
              },
            ]}
            numberOfLines={textSizing.descriptionLines}
            maxFontSizeMultiplier={LOBBY_MAX_FONT_SCALE}
            testID={status ? `game-status-${item.slug}` : undefined}
          >
            {statusLabel ?? item.description}
          </Text>

          {/* Play / Unlock button */}
          {isLocked ? (
            <View
              style={[styles.playBtn, { borderColor: colors.border }]}
              testID={`game-btn-${item.slug}`}
            >
              <Text
                style={[styles.playBtnText, { color: colors.textMuted }]}
                maxFontSizeMultiplier={LOBBY_MAX_FONT_SCALE}
              >
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
              <Text
                style={[styles.playBtnText, { color: accent.label }]}
                maxFontSizeMultiplier={LOBBY_MAX_FONT_SCALE}
              >
                {status?.kind === "resume" ? t("common:home.resume.buttonLabel") : t("common:play")}
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
          ? games.map((item) => (
              <React.Fragment key={item.key}>{renderCard({ item })}</React.Fragment>
            ))
          : Array.from({ length: Math.ceil(games.length / numColumns) }, (_, rowIndex) => {
              const rowGames = games.slice(rowIndex * numColumns, (rowIndex + 1) * numColumns);
              return (
                <View key={rowIndex} style={styles.row}>
                  {rowGames.map((item) => (
                    <React.Fragment key={item.key}>{renderCard({ item })}</React.Fragment>
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
  // Press feedback (#4007): dim and shrink a little; Reduce Motion keeps the dim only.
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  cardPressedStill: {
    opacity: 0.85,
  },
  gradientBorder: {
    width: "100%",
    height: 3,
  },
  iconZone: {
    height: TILE_ICON_ZONE,
    alignItems: "center",
    justifyContent: "center",
  },
  // The lobby tile art's display size (#4011): the WebPs are drawn at 3x this (192 px) by
  // tools/assets/draw_lobby_tile_art.py (its DISPLAY_PT), sized to sit in the icon zone.
  cardArt: {
    width: 64,
    height: 64,
  },
  cardTitle: {
    fontFamily: typography.heading,
    fontSize: LOBBY_TITLE_SIZE,
    lineHeight: LOBBY_TITLE_LINE_HEIGHT,
    letterSpacing: -0.3,
    paddingHorizontal: 8,
    textAlign: "center",
  },
  cardDesc: {
    fontFamily: typography.body,
    fontSize: LOBBY_DESCRIPTION_SIZE,
    lineHeight: LOBBY_DESCRIPTION_LINE_HEIGHT,
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
    fontSize: LOBBY_BUTTON_SIZE,
    letterSpacing: 0.2,
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
