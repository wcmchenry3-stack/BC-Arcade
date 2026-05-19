import "./src/utils/appTiming"; // must be first — captures JS-side cold-start timestamp
import "./src/i18n/i18n";
import React, { Suspense, useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useFonts } from "expo-font";
import { SpaceGrotesk_400Regular, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, useNavigation } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import * as Sentry from "@sentry/react-native";
import HomeScreen from "./src/screens/HomeScreen";
import LockedGameScreen from "./src/screens/LockedGameScreen";
import GameScreen from "./src/screens/GameScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import BottomTabBar from "./src/components/shared/BottomTabBar";
import { ThemeProvider } from "./src/theme/ThemeContext";
import { useHtmlAttributes } from "./src/i18n/useHtmlAttributes";
import { NetworkProvider } from "./src/game/_shared/NetworkContext";
import { EntitlementProvider, useEntitlements } from "./src/entitlements/EntitlementContext";
import { SoundProvider } from "./src/game/_shared/SoundContext";
import { CardDeckProvider } from "./src/game/_shared/decks/CardDeckContext";
import { BlackjackGameProvider } from "./src/game/blackjack/BlackjackGameContext";
import { HeartsRoundsProvider } from "./src/game/hearts/RoundsContext";
import { YachtScorecardProvider } from "./src/game/yacht/ScorecardContext";
import { Twenty48ScoreboardProvider } from "./src/game/twenty48/Twenty48ScoreboardContext";
import { SolitaireScoreboardProvider } from "./src/game/solitaire/SolitaireScoreboardContext";
import { SudokuScoreboardProvider } from "./src/game/sudoku/SudokuScoreboardContext";
import { CascadeScoreboardProvider } from "./src/game/cascade/CascadeScoreboardContext";
import { MahjongScoreboardProvider } from "./src/game/mahjong/MahjongScoreboardContext";
import { SessionLogger } from "./src/components/FeedbackWidget/SessionLogger";
import { installSentryConsoleErrorCapture } from "./src/utils/sentryConsoleError";
import { LazyScreens } from "./src/utils/lazyScreens";
import type {
  RootStackParamList,
  HomeStackParamList,
  ProfileStackParamList,
} from "./src/types/navigation";
export type { RootStackParamList, HomeStackParamList, ProfileStackParamList };

// Start capturing console.warn / console.error for feedback submissions
SessionLogger.init();

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (!dsn) {
  console.error("[Sentry] EXPO_PUBLIC_SENTRY_DSN is not set — error reporting disabled.");
} else {
  try {
    Sentry.init({
      dsn,
      environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
      sendDefaultPii: true,
    });
    installSentryConsoleErrorCapture();
  } catch (e) {
    console.error("[Sentry] init failed:", e);
  }
}

// Must live inside the Suspense boundary. The outer Wrapped commits immediately
// (Suspense never suspends its own parent), so only an inner child mounts after
// the lazy chunk resolves — that's where we stop the timer.
function SuspenseMountTimer({
  startMs,
  screenName,
  children,
}: {
  startMs: number;
  screenName: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const elapsedMs = performance.now() - startMs;
    try {
      Sentry.metrics.distribution("screen_mount_ms", elapsedMs, {
        unit: "millisecond",
        attributes: { screen: screenName },
      });
    } catch {
      // Instrumentation must never break the screen it's measuring.
    }
    // startMs/screenName are stable for this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

function withSuspense<P extends object>(
  Component: React.ComponentType<P>,
  screenName: string
): React.FC<P> {
  const Wrapped = (props: P) => {
    // Captured at parent render — close enough to "user tapped Play".
    // Stopped by SuspenseMountTimer's useEffect, which only fires after the
    // lazy chunk resolves and the screen commits.
    const startRef = useRef(performance.now());
    return (
      <Suspense
        fallback={
          <View style={{ flex: 1 }}>
            <ActivityIndicator style={{ flex: 1 }} />
          </View>
        }
      >
        <SuspenseMountTimer startMs={startRef.current} screenName={screenName}>
          <Component {...props} />
        </SuspenseMountTimer>
      </Suspense>
    );
  };
  Wrapped.displayName = `WithSuspense(${screenName})`;
  return Wrapped;
}

// Guard wrapper for premium screens: renders LockedGameScreen for unentitled
// sessions without loading the actual game chunk (issue #1055). The check runs
// at navigation time (inside the component) so React context is available.
// Trade-off vs. factory-level guard: the lazy factory is defined at module
// scope where context is absent, so a render-time check is the only way to
// block chunk loading without restructuring the entire lazy/prefetch setup.
function makePremiumScreen<P extends object>(
  slug: string,
  Screen: React.ComponentType<P>
): React.FC<P> {
  const PremiumScreen = (props: P) => {
    const { canPlay, isLoading } = useEntitlements();
    const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
    const wasEntitledRef = useRef<boolean | null>(null);

    useEffect(() => {
      if (isLoading) return;
      const entitled = canPlay(slug);
      if (wasEntitledRef.current === true && !entitled) {
        navigation.navigate("Home");
      }
      wasEntitledRef.current = entitled;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- slug is a factory constant, stable for the component's lifetime
    }, [canPlay, isLoading, navigation]);

    if (isLoading) return <ActivityIndicator style={{ flex: 1 }} />;
    if (!canPlay(slug)) return <LockedGameScreen />;
    return <Screen {...props} />;
  };
  PremiumScreen.displayName = `Premium(${slug})`;
  return PremiumScreen;
}

const GuardedGameScreen = makePremiumScreen("yacht", GameScreen);
const LazyCascadeScreen = makePremiumScreen(
  "cascade",
  withSuspense(LazyScreens.Cascade, "cascade")
);
const LazyStarSwarmScreen = makePremiumScreen(
  "starswarm",
  withSuspense(LazyScreens.StarSwarm, "starswarm")
);
const LazyBlackjackBettingScreen = withSuspense(LazyScreens.BlackjackBetting, "blackjack_betting");
const LazyBlackjackTableScreen = withSuspense(LazyScreens.BlackjackTable, "blackjack_table");
const LazyBlackjackVictoryScreen = withSuspense(LazyScreens.BlackjackVictory, "blackjack_victory");
const LazyBlackjackStatsScreen = withSuspense(LazyScreens.BlackjackStats, "blackjack_stats");
const LazyTwenty48Screen = withSuspense(LazyScreens.Twenty48, "twenty48");
const LazySolitaireScreen = withSuspense(LazyScreens.Solitaire, "solitaire");
const LazyFreeCellScreen = withSuspense(LazyScreens.FreeCell, "freecell");
const LazyHeartsScreen = makePremiumScreen("hearts", withSuspense(LazyScreens.Hearts, "hearts"));
const LazySudokuScreen = makePremiumScreen("sudoku", withSuspense(LazyScreens.Sudoku, "sudoku"));
const LazyMahjongScreen = withSuspense(LazyScreens.Mahjong, "mahjong");
const LazyMahjongLayoutInspectorScreen = withSuspense(
  LazyScreens.MahjongLayoutInspector,
  "mahjong_layout_inspector"
);
const LazyMahjongLayoutDetailScreen = withSuspense(
  LazyScreens.MahjongLayoutDetail,
  "mahjong_layout_detail"
);
const LazySortScreen = makePremiumScreen("sort", withSuspense(LazyScreens.Sort, "sort"));
const LazyDailyWordScreen = withSuspense(LazyScreens.DailyWord, "daily_word");
const LazyLeaderboardScreen = withSuspense(LazyScreens.Leaderboard, "leaderboard");
const LazyGameDetailScreen = withSuspense(LazyScreens.GameDetail, "game_detail");
const LazySettingsScreen = withSuspense(LazyScreens.Settings, "settings");
const LazyScoreboardScreen = withSuspense(LazyScreens.Scoreboard, "scoreboard");

const Stack = createNativeStackNavigator<RootStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const ProfileStackNav = createNativeStackNavigator<ProfileStackParamList>();
const Tab = createBottomTabNavigator();

function LobbyStack() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Home" component={HomeScreen} />
      <HomeStack.Screen name="Game" component={GuardedGameScreen} />
      <HomeStack.Screen name="Cascade" component={LazyCascadeScreen} />
      <HomeStack.Screen name="StarSwarm" component={LazyStarSwarmScreen} />
      <HomeStack.Screen name="BlackjackBetting" component={LazyBlackjackBettingScreen} />
      <HomeStack.Screen name="BlackjackTable" component={LazyBlackjackTableScreen} />
      <HomeStack.Screen name="BlackjackVictory" component={LazyBlackjackVictoryScreen} />
      <HomeStack.Screen name="BlackjackStats" component={LazyBlackjackStatsScreen} />
      <HomeStack.Screen name="Twenty48" component={LazyTwenty48Screen} />
      <HomeStack.Screen name="Solitaire" component={LazySolitaireScreen} />
      <HomeStack.Screen name="FreeCell" component={LazyFreeCellScreen} />
      <HomeStack.Screen name="Hearts" component={LazyHeartsScreen} />
      <HomeStack.Screen name="Sudoku" component={LazySudokuScreen} />
      <HomeStack.Screen name="Mahjong" component={LazyMahjongScreen} />
      <HomeStack.Screen
        name="MahjongLayoutInspector"
        component={LazyMahjongLayoutInspectorScreen}
      />
      <HomeStack.Screen name="MahjongLayoutDetail" component={LazyMahjongLayoutDetailScreen} />
      <HomeStack.Screen name="Sort" component={LazySortScreen} />
      <HomeStack.Screen name="DailyWord" component={LazyDailyWordScreen} />
      <HomeStack.Screen name="Scoreboard" component={LazyScoreboardScreen} />
    </HomeStack.Navigator>
  );
}

function ProfileStack() {
  return (
    <ProfileStackNav.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStackNav.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStackNav.Screen name="GameDetail" component={LazyGameDetailScreen} />
    </ProfileStackNav.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarPosition: "bottom" }}
    >
      <Tab.Screen name="Lobby" component={LobbyStack} />
      <Tab.Screen name="Ranks" component={LazyLeaderboardScreen} />
      <Tab.Screen name="Profile" component={ProfileStack} />
      <Tab.Screen name="Settings" component={LazySettingsScreen} />
    </Tab.Navigator>
  );
}

function AppCrashFallback({ resetError }: { resetError: () => void }) {
  return (
    <View style={styles.crash}>
      <Text style={styles.crashText}>Something went wrong.</Text>
      <Pressable style={styles.retryButton} onPress={resetError}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function AppInner() {
  useHtmlAttributes();
  return (
    <NetworkProvider>
      <EntitlementProvider>
        <SoundProvider>
          <ThemeProvider>
            <CardDeckProvider>
              <BlackjackGameProvider>
                <HeartsRoundsProvider>
                  <YachtScorecardProvider>
                    <Twenty48ScoreboardProvider>
                      <SolitaireScoreboardProvider>
                        <SudokuScoreboardProvider>
                          <CascadeScoreboardProvider>
                            <MahjongScoreboardProvider>
                              <NavigationContainer>
                                <Stack.Navigator screenOptions={{ headerShown: false }}>
                                  <Stack.Screen name="MainTabs" component={MainTabs} />
                                </Stack.Navigator>
                              </NavigationContainer>
                            </MahjongScoreboardProvider>
                          </CascadeScoreboardProvider>
                        </SudokuScoreboardProvider>
                      </SolitaireScoreboardProvider>
                    </Twenty48ScoreboardProvider>
                  </YachtScorecardProvider>
                </HeartsRoundsProvider>
              </BlackjackGameProvider>
            </CardDeckProvider>
          </ThemeProvider>
        </SoundProvider>
      </EntitlementProvider>
    </NetworkProvider>
  );
}

function App() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1 }}>
        <ActivityIndicator style={{ flex: 1 }} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Sentry.ErrorBoundary fallback={(props) => <AppCrashFallback {...props} />}>
          <Suspense
            fallback={
              <View style={{ flex: 1 }}>
                <ActivityIndicator style={{ flex: 1 }} />
              </View>
            }
          >
            <AppInner />
          </Suspense>
        </Sentry.ErrorBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  crash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  crashText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
});

export default Sentry.wrap(App);
