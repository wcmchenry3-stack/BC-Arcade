/**
 * MahjongScreen — Mahjong Solitaire with full lifecycle wiring (#874).
 *
 * Concerns:
 *   1. Game logic — dispatches engine functions (selectTile, shuffleBoard,
 *      undoMove) in response to GameCanvas callbacks; engine is pure and
 *      replaces state wholesale on every transition.
 *   2. Persistence — AsyncStorage save/resume on every mutation.
 *   3. Instrumentation — useGameSync session started on first tile tap,
 *      completed on win, abandoned on back-navigation.
 *   4. Score submission — scoreQueue.enqueue("mahjong", …) on win; never
 *      calls mahjongApi.submitScore directly.
 *   5. Audio + animations (#914) — SFX on every game event, lo-fi bg music,
 *      MatchBurst / DeadlockShake / ShufflePulse / WinModal spring.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { loadTileAssets } from "../components/mahjong/tileAssetLoader";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import { OfflineBanner } from "../components/shared/OfflineBanner";
import GameCanvas from "../components/mahjong/GameCanvas";
import { useMahjongCamera } from "../game/mahjong/layout";
import type { BoardCamera } from "../game/mahjong/layout";
import {
  createGame,
  elapsedMs,
  getAllFreePairs,
  getAnyFreePair,
  selectTile,
  shuffleBoard,
  undoMove,
} from "../game/mahjong/engine";
import { getLayout, LAYOUTS } from "../game/mahjong/layouts/registry";
import type { MahjongState, SlotTile } from "../game/mahjong/types";
import {
  clearGame,
  loadGame,
  loadProgress,
  loadStats,
  saveGame,
  saveProgress,
  saveStats,
  unlockNextLayout,
  DEFAULT_PROGRESS,
  type MahjongProgress,
  type MahjongStats,
} from "../game/mahjong/storage";
import LayoutSelectScreen from "../game/mahjong/LayoutSelectScreen";
import { useMahjongScoreboard } from "../game/mahjong/MahjongScoreboardContext";
import { useMahjongAudio } from "../game/mahjong/useMahjongAudio";
import { scoreQueue } from "../game/_shared/scoreQueue";
import { useGameSync } from "../game/_shared/useGameSync";
import { useNetwork } from "../game/_shared/NetworkContext";
import { clamp, computeZoomBounds, computePanBounds } from "../game/mahjong/zoom";

const MAX_NAME_LENGTH = 32;

// ---------------------------------------------------------------------------
// FlyingPair — two matched tiles slide toward each other then burst and fade
// ---------------------------------------------------------------------------

interface FlyingPairData {
  id: string;
  tile1: SlotTile;
  tile2: SlotTile;
}

// Colors that match the canvas tile rendering.
const FP_FACE = "#f5f0e8";
const FP_BORDER = "#ffd700";
const FP_SIDE_R = "#a89070";
const FP_SIDE_B = "#987860";
// Border inset between the gold frame and the ivory face, in logical pixels.
const FACE_INSET = 2;

function FlyingTileGlyph({
  faceWidth: fw,
  faceHeight: fh,
  sideWidth: sw,
  imgUri,
}: {
  faceWidth: number;
  faceHeight: number;
  sideWidth: number;
  imgUri: string | null;
}) {
  return (
    // overflow: "visible" is intentional so the 3-D side panels render outside
    // the face bounds. Note: Android clips overflow in deeply nested Views by
    // default, so the side shadows won't appear on native until the parent
    // Animated.View chain also carries overflow: "visible".
    <View style={{ width: fw, height: fh, overflow: "visible" }}>
      {/* 3-D right side */}
      <View
        style={{
          position: "absolute",
          left: fw,
          top: sw,
          width: sw,
          height: fh,
          backgroundColor: FP_SIDE_R,
        }}
      />
      {/* 3-D bottom side */}
      <View
        style={{
          position: "absolute",
          left: sw,
          top: fh,
          width: fw,
          height: sw,
          backgroundColor: FP_SIDE_B,
        }}
      />
      {/* Gold border (selected-tile look) */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: fw,
          height: fh,
          backgroundColor: FP_BORDER,
          borderRadius: 2,
        }}
      />
      {/* Ivory face */}
      <View
        style={{
          position: "absolute",
          left: FACE_INSET,
          top: FACE_INSET,
          width: fw - FACE_INSET * 2,
          height: fh - FACE_INSET * 2,
          backgroundColor: FP_FACE,
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {/* SVG art — only on web where RN Image renders SVG via <img> */}
        {Platform.OS === "web" && imgUri !== null && (
          <Image
            source={{ uri: imgUri }}
            style={{
              position: "absolute",
              left: FACE_INSET,
              top: FACE_INSET,
              right: FACE_INSET,
              bottom: FACE_INSET,
            }}
            resizeMode="contain"
          />
        )}
      </View>
    </View>
  );
}

function FlyingPair({
  tile1,
  tile2,
  camera,
  tileUris,
  onDone,
}: FlyingPairData & {
  camera: BoardCamera;
  tileUris: readonly (string | null)[];
  onDone: () => void;
}) {
  const { x: x1, y: y1 } = camera.tileToScreen(tile1.col, tile1.row, tile1.layer);
  const { x: x2, y: y2 } = camera.tileToScreen(tile2.col, tile2.row, tile2.layer);
  const { faceWidth: fw, faceHeight: fh, sideWidth: sw } = camera;

  // Face-center coords so the overlay aligns exactly with the canvas tile face.
  const c1x = x1 + fw / 2;
  const c1y = y1 + fh / 2;
  const c2x = x2 + fw / 2;
  const c2y = y2 + fh / 2;
  const midX = (c1x + c2x) / 2;
  const midY = (c1y + c2y) / 2;
  const burstR = Math.round(fw * 0.65);

  const t1cx = useSharedValue(c1x);
  const t1cy = useSharedValue(c1y);
  const t2cx = useSharedValue(c2x);
  const t2cy = useSharedValue(c2y);
  const pairOpacity = useSharedValue(1);
  const burstScaleVal = useSharedValue(0);
  const burstOpacity = useSharedValue(0);

  useEffect(() => {
    const moveCfg = { duration: 220, easing: Easing.out(Easing.quad) };
    t1cx.value = withTiming(midX, moveCfg);
    t1cy.value = withTiming(midY, moveCfg);
    t2cx.value = withTiming(midX, moveCfg);
    t2cy.value = withTiming(midY, moveCfg);
    // Hold fully visible through the slide, then snap-fade after meeting.
    pairOpacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withTiming(0, { duration: 70 }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
    burstScaleVal.value = withDelay(220, withSpring(1.8, { damping: 7, stiffness: 100 }));
    burstOpacity.value = withSequence(
      withDelay(220, withTiming(0.9, { duration: 25 })),
      withTiming(0, { duration: 85 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tile1Style = useAnimatedStyle(() => ({
    position: "absolute",
    left: t1cx.value - fw / 2,
    top: t1cy.value - fh / 2,
    opacity: pairOpacity.value,
  }));

  const tile2Style = useAnimatedStyle(() => ({
    position: "absolute",
    left: t2cx.value - fw / 2,
    top: t2cy.value - fh / 2,
    opacity: pairOpacity.value,
  }));

  const burstStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: midX - burstR,
    top: midY - burstR,
    width: burstR * 2,
    height: burstR * 2,
    borderRadius: burstR,
    backgroundColor: FP_BORDER,
    transform: [{ scale: burstScaleVal.value }],
    opacity: burstOpacity.value,
  }));

  const img1 = tileUris[tile1.faceId - 1] ?? null;
  const img2 = tileUris[tile2.faceId - 1] ?? null;

  return (
    <>
      <Animated.View pointerEvents="none" style={tile1Style}>
        <FlyingTileGlyph faceWidth={fw} faceHeight={fh} sideWidth={sw} imgUri={img1} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={tile2Style}>
        <FlyingTileGlyph faceWidth={fw} faceHeight={fh} sideWidth={sw} imgUri={img2} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={burstStyle} />
    </>
  );
}

// ---------------------------------------------------------------------------
// MahjongScreen
// ---------------------------------------------------------------------------

export default function MahjongScreen() {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [view, setView] = useState<"loading" | "select" | "play">("loading");
  const [state, setState] = useState<MahjongState | null>(null);
  const camera = useMahjongCamera(getLayout(state?.currentLayoutId ?? "turtle"));
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<MahjongProgress>(DEFAULT_PROGRESS);
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const progressRef = useRef<MahjongProgress>(DEFAULT_PROGRESS);
  const [stats, setStats] = useState<MahjongStats>({
    bestScore: 0,
    bestTimeMs: 0,
    gamesPlayed: 0,
    gamesWon: 0,
  });

  // Hint state — IDs of the pair currently being highlighted; auto-clears after 2 s.
  const [hintIds, setHintIds] = useState<ReadonlySet<number>>(new Set());
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noHintVisible, setNoHintVisible] = useState(false);
  const noHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dev panel state — __DEV__ only; toggled via Shift+D (web) or long-press score (native).
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [debugShowFree, setDebugShowFree] = useState(false);
  const freePairs = useMemo<[SlotTile, SlotTile][]>(
    () => (__DEV__ && devPanelOpen && state ? getAllFreePairs(state.tiles) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devPanelOpen, state?.tiles]
  );

  // Tile image URIs for the flying-pair overlay (web: loaded via expo-asset; native: stays null[]).
  const [tileUris, setTileUris] = useState<(string | null)[]>(Array(42).fill(null));

  // Animation state
  const [flyingPairs, setFlyingPairs] = useState<FlyingPairData[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const boardShakeX = useSharedValue(0);
  const boardOpacity = useSharedValue(1);
  const boardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
    opacity: boardOpacity.value,
  }));

  // Gesture zoom/pan shared values.
  // minZoom = fit-to-screen scale; maxZoom = tile just reaches MIN_READABLE_TILE_PX.
  const { minZoom: initMin, maxZoom: initMax } = computeZoomBounds(camera.scale, camera.tileWidth);
  const minZoom = useSharedValue(initMin);
  const maxZoom = useSharedValue(initMax);
  const zoomScale = useSharedValue(initMin);
  const baseScale = useSharedValue(initMin);
  const translateX = useSharedValue(0);
  const baseTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);
  // Board/viewport dimensions as shared values so pan-boundary worklets can
  // read them on the UI thread without capturing stale JS-side camera values.
  const boardWidthSV = useSharedValue(camera.boardWidth);
  const boardHeightSV = useSharedValue(camera.boardHeight);
  const viewportWidthSV = useSharedValue(camera.viewportWidth);
  const viewportHeightSV = useSharedValue(camera.viewportHeight);

  // Reset gesture state when layout changes (orientation / resize).
  useEffect(() => {
    const bounds = computeZoomBounds(camera.scale, camera.tileWidth);
    minZoom.value = bounds.minZoom;
    maxZoom.value = bounds.maxZoom;
    zoomScale.value = bounds.minZoom;
    baseScale.value = bounds.minZoom;
    translateX.value = 0;
    baseTranslateX.value = 0;
    translateY.value = 0;
    baseTranslateY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.scale, camera.tileWidth]);

  useEffect(() => {
    boardWidthSV.value = camera.boardWidth;
    boardHeightSV.value = camera.boardHeight;
    viewportWidthSV.value = camera.viewportWidth;
    viewportHeightSV.value = camera.viewportHeight;
  }, [camera.boardWidth, camera.boardHeight, camera.viewportWidth, camera.viewportHeight]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      zoomScale.value = clamp(baseScale.value * e.scale, minZoom.value, maxZoom.value);
    })
    .onEnd(() => {
      baseScale.value = zoomScale.value;
      // Clamp pan position to the new (smaller) bounds when zooming out.
      const { maxTranslateX, maxTranslateY } = computePanBounds(
        boardWidthSV.value,
        boardHeightSV.value,
        viewportWidthSV.value,
        viewportHeightSV.value,
        zoomScale.value
      );
      translateX.value = clamp(translateX.value, -maxTranslateX, maxTranslateX);
      translateY.value = clamp(translateY.value, -maxTranslateY, maxTranslateY);
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    // Only activate after an intentional drag so simple taps on overlay buttons
    // (CTA shuffle, deadlock new-game, win new-game) are not intercepted by the
    // gesture recognizer before Pressable.onPress can fire.
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      const { maxTranslateX, maxTranslateY } = computePanBounds(
        boardWidthSV.value,
        boardHeightSV.value,
        viewportWidthSV.value,
        viewportHeightSV.value,
        zoomScale.value
      );
      translateX.value = clamp(
        baseTranslateX.value + e.translationX,
        -maxTranslateX,
        maxTranslateX
      );
      translateY.value = clamp(
        baseTranslateY.value + e.translationY,
        -maxTranslateY,
        maxTranslateY
      );
    })
    .onEnd(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  const boardGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const gestureAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoomScale.value },
    ],
  }));

  const hasLoadedRef = useRef(false);
  const stateRef = useRef<MahjongState | null>(null);
  const winRecordedRef = useRef(false);
  const prevCompleteRef = useRef(false);
  // Tracks previous state for audio/animation event detection.
  const prevAudioStateRef = useRef<MahjongState | null>(null);
  // Stable refs to audio callbacks — avoids re-running the detection effect when
  // play functions change reference (they're recreated each render by useSound).
  const audioCallbacksRef = useRef({
    playTileSelect: () => {},
    playTileMatch: () => {},
    playShuffle: () => {},
    playWin: () => {},
    playDeadlock: () => {},
  });

  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
  } = useGameSync("mahjong");

  const { setSnapshot: setScoreboardSnapshot } = useMahjongScoreboard();

  // Audio
  const musicActive = state !== null && !state.isComplete && !state.isDeadlocked;
  const { playTileSelect, playTileMatch, playShuffle, playWin, playDeadlock } =
    useMahjongAudio(musicActive);

  // Keep audio callback refs up-to-date each render.
  useEffect(() => {
    audioCallbacksRef.current = {
      playTileSelect,
      playTileMatch,
      playShuffle,
      playWin,
      playDeadlock,
    };
  });

  // Reduce motion preference.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Load SVG asset URIs for the flying-pair tile overlay (web only — native SVG
  // display requires Skia and can't run inside Animated.View).
  // Reuses the singleton promise from loadTileAssets() so no duplicate
  // network requests are made when GameCanvas also calls it on mount.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    loadTileAssets().then((uris) => {
      if (!cancelled) setTileUris([...uris]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Dev panel: Shift+D keyboard shortcut on web.
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "web") return;
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && e.key === "D") setDevPanelOpen((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scoreboard snapshot — updated on every state change.
  useEffect(() => {
    if (!state) return;
    const elapsed = elapsedMs(state, Date.now());
    setScoreboardSnapshot({
      score: state.score,
      pairsRemoved: state.pairsRemoved,
      shufflesLeft: state.shufflesLeft,
      elapsedMs: elapsed,
      hasGame: true,
      bestScore: stats.bestScore,
      bestTimeMs: stats.bestTimeMs,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
    });
  }, [state, stats, setScoreboardSnapshot]);

  // Mount: restore saved game or show layout select.
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats(), loadProgress()]).then(
      ([saved, savedStats, savedProgress]) => {
        if (!alive) return;
        hasLoadedRef.current = true;
        progressRef.current = savedProgress;
        setProgress(savedProgress);
        if (saved !== null) {
          setState(saved);
          setHasSavedGame(!saved.isComplete);
          if (saved.isComplete) winRecordedRef.current = true;
          setView("play");
        } else {
          setView("select");
        }
        setStats(savedStats);
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  // Persist on every state change after mount load resolves.
  useEffect(() => {
    stateRef.current = state;
    if (!hasLoadedRef.current || state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

  // Audio + animation event detection — compare previous vs current state.
  useEffect(() => {
    const prev = prevAudioStateRef.current;
    prevAudioStateRef.current = state;
    if (!prev || !state) return;

    const {
      playTileSelect: pSelect,
      playTileMatch: pMatch,
      playShuffle: pShuffle,
      playWin: pWin,
      playDeadlock: pDead,
    } = audioCallbacksRef.current;

    if (state.tiles.length < prev.tiles.length) {
      pMatch();
      if (!reduceMotion) {
        const removed = prev.tiles.filter((t) => !state.tiles.some((nt) => nt.id === t.id));
        if (removed.length >= 2) {
          setFlyingPairs((existing) => [
            ...existing,
            { id: `${Date.now()}`, tile1: removed[0]!, tile2: removed[1]! },
          ]);
        }
      }
    } else if (state.selected !== null) {
      pSelect();
    }

    if (state.shufflesLeft < prev.shufflesLeft) {
      pShuffle();
      if (!reduceMotion) {
        boardOpacity.value = withSequence(
          withTiming(0.35, { duration: 180 }),
          withTiming(1, { duration: 180 })
        );
      }
    }

    if (state.isComplete && !prev.isComplete) {
      pWin();
    }

    if (state.isDeadlocked && !prev.isDeadlocked) {
      pDead();
      if (!reduceMotion) {
        boardShakeX.value = withSequence(
          withTiming(8, { duration: 60 }),
          withTiming(-8, { duration: 60 }),
          withTiming(6, { duration: 60 }),
          withTiming(-6, { duration: 60 }),
          withTiming(4, { duration: 60 }),
          withTiming(-4, { duration: 60 }),
          withTiming(0, { duration: 60 })
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Win lifecycle: complete sync session, record stats, unlock next layout.
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      syncComplete(
        { finalScore: state.score, outcome: "completed", durationMs: state.accumulatedMs },
        { final_score: state.score, outcome: "completed", pairs: state.pairsRemoved }
      );
      clearGame().catch(() => {});
      if (!winRecordedRef.current) {
        winRecordedRef.current = true;
        const finalMs = state.accumulatedMs;
        const finalScore = state.score;
        setStats((prev) => {
          const updated: MahjongStats = {
            ...prev,
            gamesWon: prev.gamesWon + 1,
            bestScore: finalScore > prev.bestScore ? finalScore : prev.bestScore,
            bestTimeMs:
              prev.bestTimeMs === 0 || finalMs < prev.bestTimeMs ? finalMs : prev.bestTimeMs,
          };
          saveStats(updated).catch(() => {});
          return updated;
        });
      }
      // Unlock the next layout in registry order, then clear the active layout
      // from progress regardless of whether a new layout was unlocked.
      const completedId = state.currentLayoutId ?? "turtle";
      const newUnlocked = unlockNextLayout(
        completedId,
        LAYOUTS,
        progressRef.current.unlockedLayouts
      );
      const newProgress: MahjongProgress = {
        ...progressRef.current,
        unlockedLayouts: newUnlocked,
        currentLayoutId: null,
        currentState: null,
      };
      progressRef.current = newProgress;
      setProgress(newProgress);
      saveProgress(newProgress).catch(() => {});
      setHasSavedGame(false);
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete]);

  // Disable native swipe-back (iOS edge gesture) while the game is open so that
  // a left-pan on the board doesn't accidentally exit to the lobby.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    return () => navigation.setOptions({ gestureEnabled: true });
  }, [navigation]);

  // Abandon on back-navigation.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      if (!syncGetGameId()) return;
      const s = stateRef.current;
      if (s?.isComplete) return;
      syncComplete(
        { outcome: "abandoned", finalScore: s?.score ?? 0, durationMs: 0 },
        { outcome: "abandoned" }
      );
    });
    return unsub;
  }, [navigation, syncComplete, syncGetGameId]);

  const ensureSyncStarted = useCallback(
    (s: MahjongState) => {
      if (syncGetGameId()) return;
      syncStart({ layout: s.currentLayoutId ?? "turtle" });
      syncMarkStarted();
      if (s.pairsRemoved === 0 && !hasLoadedRef.current) return;
    },
    [syncGetGameId, syncStart, syncMarkStarted]
  );

  const handleTilePress = useCallback(
    (tileId: number) => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      setHintIds(new Set());
      setState((prev) => {
        if (!prev) return prev;
        const next = selectTile(prev, tileId);
        if (next === prev) return prev;
        ensureSyncStarted(next);
        return next;
      });
    },
    [ensureSyncStarted]
  );

  const handleHint = useCallback(() => {
    if (!state) return;
    const pair = getAnyFreePair(state.tiles);
    if (!pair) {
      if (noHintTimerRef.current) clearTimeout(noHintTimerRef.current);
      setNoHintVisible(true);
      noHintTimerRef.current = setTimeout(() => setNoHintVisible(false), 2000);
      return;
    }
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setHintIds(new Set(pair));
    hintTimerRef.current = setTimeout(() => setHintIds(new Set()), 2000);
  }, [state]);

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      if (noHintTimerRef.current) clearTimeout(noHintTimerRef.current);
    },
    []
  );

  const handleShuffle = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const next = shuffleBoard(prev);
      if (next === prev) return prev;
      ensureSyncStarted(next);
      return next;
    });
  }, [ensureSyncStarted]);

  const handleUndo = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      return undoMove(prev);
    });
  }, []);

  const startNewGame = useCallback(() => {
    if (syncGetGameId()) {
      syncComplete(
        { outcome: "abandoned", finalScore: 0, durationMs: 0 },
        { outcome: "abandoned" }
      );
    }
    winRecordedRef.current = false;
    prevCompleteRef.current = false;
    const s = stateRef.current;
    setHasSavedGame(s !== null && !s.isComplete);
    setState(null);
    setView("select");
  }, [syncGetGameId, syncComplete]);

  // Navigates directly to level select without an abandon confirmation or server
  // abandon event — the in-progress game is preserved locally so CONTINUE works.
  const goToLevelSelect = useCallback(() => {
    const s = stateRef.current;
    setHasSavedGame(s !== null && !s.isComplete);
    setView("select");
  }, []);

  const handleSelectLayout = useCallback((layoutId: string) => {
    winRecordedRef.current = false;
    prevCompleteRef.current = false;
    const fresh = { ...createGame(getLayout(layoutId)), currentLayoutId: layoutId };
    setState(fresh);
    setView("play");
    setHasSavedGame(false);
    setStats((prev) => {
      const updated = { ...prev, gamesPlayed: prev.gamesPlayed + 1 };
      saveStats(updated).catch(() => {});
      return updated;
    });
    const newProgress: MahjongProgress = {
      ...progressRef.current,
      currentLayoutId: layoutId,
      currentState: null,
    };
    progressRef.current = newProgress;
    setProgress(newProgress);
    saveProgress(newProgress).catch(() => {});
    // Sync session starts on first tile tap via ensureSyncStarted, not here.
  }, []);

  const handleContinue = useCallback(() => {
    loadGame()
      .then((saved) => {
        if (!saved) {
          // Storage was cleared or corrupt — dismiss the continue button and stay on select.
          setHasSavedGame(false);
          return;
        }
        setState(saved);
        setHasSavedGame(false);
        setView("play");
      })
      .catch(() => {
        setHasSavedGame(false);
      });
  }, []);

  const undoDisabled = !state || state.undoStack.length === 0 || state.isComplete;

  if (!loading && view === "select") {
    return (
      <GameShell
        title={t("game.title")}
        requireBack
        loading={false}
        onBack={() => navigation.popToTop()}
        style={{
          paddingBottom: Math.max(insets.bottom, 16),
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
        }}
      >
        <LayoutSelectScreen
          layouts={LAYOUTS}
          progress={progress}
          hasContinue={hasSavedGame}
          onSelectLayout={handleSelectLayout}
          onContinue={handleContinue}
        />
      </GameShell>
    );
  }

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      loading={loading}
      onBack={() => navigation.popToTop()}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 12),
        paddingRight: Math.max(insets.right, 12),
      }}
      onNewGame={startNewGame}
      onLevelSelect={goToLevelSelect}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "mahjong" })}
      rightSlot={
        <Pressable
          onPress={handleUndo}
          disabled={undoDisabled}
          style={[
            styles.headerBtn,
            { borderColor: colors.accent, opacity: undoDisabled ? 0.4 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t("action.undoLabel")}
          accessibilityState={{ disabled: undoDisabled }}
        >
          <Text style={[styles.headerBtnText, { color: colors.accent }]}>{t("action.undo")}</Text>
        </Pressable>
      }
    >
      {state !== null && (
        <View style={{ flex: 1, alignItems: "center" }}>
          <View style={styles.hudRow} accessibilityRole="summary">
            {__DEV__ ? (
              <Pressable onLongPress={() => setDevPanelOpen((o) => !o)} accessibilityRole="none">
                <Text style={[styles.hudText, { color: colors.text }]}>
                  {t("hud.score")} {state.score}
                </Text>
              </Pressable>
            ) : (
              <Text style={[styles.hudText, { color: colors.text }]}>
                {t("hud.score")} {state.score}
              </Text>
            )}
            <Text style={[styles.hudText, { color: colors.textMuted }]}>
              {t("hud.pairs")} {state.pairsRemoved}/72
            </Text>
            <Pressable
              onPress={handleShuffle}
              disabled={state.shufflesLeft === 0 || state.isComplete || state.isDeadlocked}
              style={[
                styles.headerBtn,
                {
                  borderColor: "#ffd700",
                  opacity:
                    state.shufflesLeft > 0 && !state.isComplete && !state.isDeadlocked ? 1 : 0.3,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("action.shuffleLabel")}
              accessibilityState={{
                disabled: state.shufflesLeft === 0 || state.isComplete || state.isDeadlocked,
              }}
            >
              <Text style={[styles.headerBtnText, { color: "#ffd700" }]}>
                {t("action.shuffle")} {state.shufflesLeft}
              </Text>
            </Pressable>
            <Text style={[styles.hudText, styles.dealIdText, { color: colors.textMuted }]}>
              {t("hud.deal")} #{state.dealId}
            </Text>
            <Pressable
              onPress={handleHint}
              disabled={state.isComplete || state.isDeadlocked}
              style={[
                styles.headerBtn,
                {
                  borderColor: "#5dbcd2",
                  opacity: state.isComplete || state.isDeadlocked ? 0.3 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("action.hintLabel")}
              accessibilityState={{ disabled: state.isComplete || state.isDeadlocked }}
            >
              <Text style={[styles.headerBtnText, { color: "#5dbcd2" }]}>{t("action.hint")}</Text>
            </Pressable>
            {__DEV__ && (
              <Pressable
                onPress={() => setDevPanelOpen((o) => !o)}
                style={[styles.headerBtn, { borderColor: "rgba(255,128,0,0.8)" }]}
                accessibilityRole="button"
                accessibilityLabel="Toggle dev panel"
              >
                <Text style={[styles.headerBtnText, { color: "rgba(255,128,0,1)" }]}>DEV</Text>
              </Pressable>
            )}
          </View>

          {noHintVisible && (
            <Text
              style={styles.noHintToast}
              accessibilityLiveRegion="polite"
              testID="no-hint-toast"
            >
              {t("action.noHint")}
            </Text>
          )}

          {/* Viewport container — clips the board during zoom/pan */}
          <View
            style={{
              width: camera.viewportWidth,
              height: camera.viewportHeight,
              overflow: "hidden",
              alignSelf: "center",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GestureDetector gesture={boardGesture}>
              {/* Gesture layer — pinch-to-zoom + two-finger pan */}
              <Animated.View
                style={[{ width: camera.boardWidth, height: camera.boardHeight }, gestureAnimStyle]}
              >
                <Animated.View style={boardAnimStyle}>
                  <GameCanvas
                    state={state}
                    camera={camera}
                    hintIds={hintIds}
                    debugShowFree={__DEV__ && debugShowFree}
                    onTilePress={handleTilePress}
                    onShufflePress={handleShuffle}
                    onNewGamePress={startNewGame}
                  />
                </Animated.View>
                {flyingPairs.map((pair) => (
                  <FlyingPair
                    key={pair.id}
                    {...pair}
                    camera={camera}
                    tileUris={tileUris}
                    onDone={() => setFlyingPairs((prev) => prev.filter((p) => p.id !== pair.id))}
                  />
                ))}
              </Animated.View>
            </GestureDetector>
          </View>
        </View>
      )}

      {__DEV__ && devPanelOpen && state && (
        <View style={styles.devPanel} pointerEvents="box-none">
          <Text style={styles.devPanelTitle}>DEV — Mahjong</Text>
          <Text style={styles.devPanelText}>
            tiles: {state.tiles.length} / pairs removed: {state.pairsRemoved}
          </Text>
          <Text style={styles.devPanelText}>
            free tiles:{" "}
            {new Set(freePairs.flatMap(([a, b]: [SlotTile, SlotTile]) => [a.id, b.id])).size} / free
            pairs: {freePairs.length}
          </Text>
          <Text style={styles.devPanelText}>
            shuffles left: {state.shufflesLeft} / score: {state.score}
          </Text>
          <Text style={styles.devPanelText}>
            deal #{state.dealId} / undo depth: {state.undoStack.length}
          </Text>
          <Pressable
            onPress={() => setDebugShowFree((v) => !v)}
            style={[styles.devToggleBtn, debugShowFree && styles.devToggleBtnActive]}
          >
            <Text style={styles.devToggleText}>
              {debugShowFree ? "overlay: ON" : "overlay: off"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("MahjongLayoutInspector")}
            style={styles.devToggleBtn}
          >
            <Text style={styles.devToggleText}>Layout Inspector →</Text>
          </Pressable>
          {freePairs.length > 0 && (
            <>
              <Text style={[styles.devPanelTitle, { marginTop: 8 }]}>free pairs</Text>
              <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
                {freePairs.map(([a, b]: [SlotTile, SlotTile], i: number) => (
                  <Text key={i} style={styles.devPairText}>
                    {a.suit[0]}
                    {a.rank} ↔ {b.suit[0]}
                    {b.rank} (ids {a.id},{b.id})
                  </Text>
                ))}
              </ScrollView>
            </>
          )}
          {freePairs.length === 0 && (
            <Text style={[styles.devPanelText, { color: "#ff6644", marginTop: 4 }]}>
              no free pairs
            </Text>
          )}
        </View>
      )}

      {state?.isComplete && (
        <WinModal
          score={state.score}
          pairsRemoved={state.pairsRemoved}
          reduceMotion={reduceMotion}
          onNewGame={startNewGame}
        />
      )}
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// Win modal — name entry + ScoreQueue submission
// ---------------------------------------------------------------------------

function WinModal({
  score,
  pairsRemoved,
  reduceMotion,
  onNewGame,
}: {
  readonly score: number;
  readonly pairsRemoved: number;
  readonly reduceMotion: boolean;
  readonly onNewGame: () => void;
}) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  const { isOnline, isInitialized } = useNetwork();

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spring entrance on the card (skipped when reduceMotion is on).
  const cardScale = useSharedValue(reduceMotion ? 1 : 0.82);
  useEffect(() => {
    if (!reduceMotion) {
      cardScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cardAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }] }));

  const offline = isInitialized && !isOnline;
  const trimmed = name.trim();
  const canSubmit = !submitting && !offline && trimmed.length > 0;

  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await scoreQueue.enqueue("mahjong", { player_name: trimmed, score });
      setSubmitted(true);
      scoreQueue.flush().catch(() => undefined);
    } catch {
      setError(t("error.submitFailed", { defaultValue: "Couldn't save score. Tap to retry." }));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = error
    ? t("error.submitRetry", { defaultValue: "Retry" })
    : t("action.submitScore", { defaultValue: "Submit Score" });

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal>
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
            cardAnimStyle,
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">
            {t("overlay.youWon")}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t("overlay.youWonDetail", { count: pairsRemoved })}
          </Text>
          <Text style={[styles.modalScore, { color: colors.text }]}>
            {t("score.display", { score })}
          </Text>

          {!submitted ? (
            <>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder={t("win.namePlaceholder", { defaultValue: "Your name" })}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                maxLength={MAX_NAME_LENGTH}
                editable={!submitting}
                accessibilityLabel={t("win.nameLabel", { defaultValue: "Enter your name" })}
              />
              {offline ? (
                <OfflineBanner />
              ) : (
                error !== null && (
                  <Text
                    style={[styles.errorText, { color: colors.error }]}
                    accessibilityLiveRegion="assertive"
                    accessibilityRole="alert"
                  >
                    {error}
                  </Text>
                )
              )}
              <Pressable
                style={[styles.modalPrimary, gradient, !canSubmit && styles.modalPrimaryDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.textOnAccent} />
                ) : (
                  <Text style={[styles.modalPrimaryText, { color: colors.textOnAccent }]}>
                    {submitLabel}
                  </Text>
                )}
              </Pressable>
            </>
          ) : (
            <Text
              style={[styles.submittedText, { color: colors.bonus }]}
              accessibilityLiveRegion="polite"
            >
              {t("win.submitted", { defaultValue: "Score saved! 🎉" })}
            </Text>
          )}

          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onNewGame}
            accessibilityRole="button"
            accessibilityLabel={t("action.newGameLabel")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("action.newGame")}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
  },
  headerBtnText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  hudRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignSelf: "stretch",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  noHintToast: {
    fontFamily: typography.heading,
    fontSize: 12,
    letterSpacing: 0.5,
    paddingBottom: 4,
    color: "#5dbcd2",
  },
  hudText: {
    fontFamily: typography.heading,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  dealIdText: {
    fontSize: 10,
  },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000bf",
  },
  modalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    width: "86%",
    maxWidth: 360,
  },
  modalTitle: {
    fontFamily: typography.heading,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 6,
    textAlign: "center",
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
    textAlign: "center",
  },
  modalScore: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
    fontVariant: ["tabular-nums"],
  },
  nameInput: {
    width: "100%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
  },
  submittedText: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalPrimary: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    marginBottom: 10,
    alignItems: "center",
    minWidth: 180,
  },
  modalPrimaryDisabled: {
    opacity: 0.5,
  },
  modalPrimaryText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  modalSecondary: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  devPanel: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 220,
    backgroundColor: "rgba(0,0,0,0.82)",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,128,0,0.5)",
    padding: 10,
  },
  devPanelTitle: {
    color: "rgba(255,128,0,1)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  devPanelText: {
    color: "#cccccc",
    fontSize: 10,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
  devPairText: {
    color: "#aaccaa",
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ["tabular-nums"],
  },
  devToggleBtn: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,128,0,0.5)",
    alignSelf: "flex-start",
  },
  devToggleBtnActive: {
    backgroundColor: "rgba(255,128,0,0.2)",
    borderColor: "rgba(255,128,0,1)",
  },
  devToggleText: {
    color: "rgba(255,128,0,1)",
    fontSize: 10,
    fontWeight: "700",
  },
});
