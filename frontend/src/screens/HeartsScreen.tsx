import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../../App";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import type { Colors } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { OpponentCapturedPile, SelfCapturedPile } from "../components/hearts/CapturedPile";
import OpponentHand from "../components/hearts/OpponentHand";
import PassBanner from "../components/hearts/PassBanner";
import PlayerHand from "../components/hearts/PlayerHand";
import HeartsScoreboard from "../components/scoreboard/HeartsScoreboard";
import TrickArea from "../components/hearts/TrickArea";
import {
  commitPass,
  dealGame,
  dealNextHand,
  detectMoon,
  getValidPlays,
  isQueenOfSpades,
  playCard,
  selectPassCard,
} from "../game/hearts/engine";
import { selectCardToPlay, selectCardsToPass } from "../game/hearts/ai";
import HeartsAiDifficultySelector from "../components/hearts/HeartsAiDifficultySelector";
import { clearGame, loadGame, saveGame } from "../game/hearts/storage";
import {
  DEFAULT_NAMES,
  loadPlayerNames,
  savePlayerNames,
  validateName,
} from "../game/hearts/playerNames";
import { heartsApi } from "../game/hearts/api";
import { useHeartsRounds } from "../game/hearts/RoundsContext";
import { createIntegrityReporter } from "../game/hearts/integrity";
import { useGameSync } from "../game/_shared/useGameSync";
import { useNetwork } from "../game/_shared/NetworkContext";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import { OfflineBanner } from "../components/shared/OfflineBanner";
import { HeartsBrokenAnimation } from "../components/hearts/HeartsBrokenAnimation";
import { HeartsMoonShotAnimation } from "../components/hearts/HeartsMoonShotAnimation";
import { HeartsQueenOfSpadesAnimation } from "../components/hearts/HeartsQueenOfSpadesAnimation";
import type { AiDifficulty, Card, HeartsState, TrickCard } from "../game/hearts/types";

const HUMAN = 0;
const MAX_NAME_LENGTH = 32;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LastTrick = { readonly trick: readonly TrickCard[]; readonly winnerIndex: number } | null;
type SubmitState = "idle" | "submitting" | "done" | "error";

// Side-seat label for narrow slots (West/East). Just the player name; the
// captured pile beneath provides the only seat-level visual weight.
function SideSeatLabel({ label, colors }: { label: string; colors: Colors }) {
  return <Text style={[sideSeatStyles.label, { color: colors.textMuted }]}>{label}</Text>;
}

const sideSeatStyles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "600" },
});

export default function HeartsScreen() {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const { isOnline, isInitialized } = useNetwork();

  const [gameState, setGameState] = useState<HeartsState | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<AiDifficulty>("medium");
  const [lastTrick, setLastTrick] = useState<LastTrick>(null);
  const [showHeartsBroken, setShowHeartsBroken] = useState(false);
  const [showMoonShot, setShowMoonShot] = useState(false);
  const [moonShotLabel, setMoonShotLabel] = useState("");
  const [showQueenOfSpades, setShowQueenOfSpades] = useState(false);
  const [queenOfSpadesLabel, setQueenOfSpadesLabel] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [playerNames, setPlayerNames] = useState<string[]>([...DEFAULT_NAMES]);
  const [draftNames, setDraftNames] = useState<string[]>([...DEFAULT_NAMES]);

  // scoreHistory now lives on HeartsState (engine-authoritative, persisted).
  const scoreHistory = useMemo(() => gameState?.scoreHistory ?? [], [gameState?.scoreHistory]);

  const unmountedRef = useRef(false);
  const loopActiveRef = useRef(false);
  const gameStateRef = useRef<HeartsState | null>(gameState);
  const trickAnimResolverRef = useRef<(() => void) | null>(null);
  const humanJustPlayedQSRef = useRef(false);
  const gameOverFiredRef = useRef(false);
  const reportIntegrity = useMemo(() => createIntegrityReporter(), []);

  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
  } = useGameSync("hearts");

  // Keep ref in sync for use in event listeners.
  useEffect(() => {
    gameStateRef.current = gameState;
  });

  useEffect(
    () => () => {
      unmountedRef.current = true;
      const resolve = trickAnimResolverRef.current;
      trickAnimResolverRef.current = null;
      if (resolve) resolve();
    },
    []
  );

  // ─── Load saved game and player names on mount ────────────────────────────
  useEffect(() => {
    loadGame().then((saved) => {
      if (!unmountedRef.current && saved) {
        setGameState(saved);
        setSelectedDifficulty(saved.aiDifficulty);
      }
    });
    loadPlayerNames().then((names) => {
      if (!unmountedRef.current) {
        setPlayerNames(names);
        setDraftNames(names);
      }
    });
  }, []);

  // ─── Sync snapshot to shared rounds context (read by ScoreboardScreen) ────
  const { setSnapshot: setRoundsSnapshot } = useHeartsRounds();
  useEffect(() => {
    setRoundsSnapshot({
      cumulativeScores: gameState?.cumulativeScores ?? [0, 0, 0, 0],
      scoreHistory,
      playerLabels: playerNames,
    });
  }, [gameState?.cumulativeScores, scoreHistory, playerNames, setRoundsSnapshot]);

  // ─── Run integrity validators (Sentry-warns on impossible state) ──────────
  useEffect(() => {
    if (gameState) reportIntegrity(gameState);
  }, [gameState, reportIntegrity]);

  // ─── Save on blur ─────────────────────────────────────────────────────────
  // Tab switches unmount the Lobby HomeStack; without this, mid-trick or
  // pass-phase state is lost (saveGame elsewhere only fires on trick complete
  // and hand transitions). Persisting on blur keeps full game continuity.
  useFocusEffect(
    useCallback(() => {
      return () => {
        const gs = gameStateRef.current;
        if (!gs || gs.isComplete) return;
        void saveGame(gs);
      };
    }, [])
  );

  // ─── Abandon on back-navigation ───────────────────────────────────────────
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      if (!syncGetGameId()) return;
      if (gameStateRef.current?.isComplete) return;
      syncComplete(
        { outcome: "abandoned", finalScore: 0, durationMs: 0 },
        { outcome: "abandoned" }
      );
    });
    return unsub;
  }, [navigation, syncComplete, syncGetGameId]);

  const { play: playHeartsBroken } = useSound("hearts.heartsBroken");
  const { play: playMoonShot } = useSound("hearts.moonShot");
  const { play: playQueenOfSpades } = useSound("hearts.queenOfSpades");
  const { play: playCardPlay } = useSound("hearts.cardPlay");
  const { play: playTrickWon } = useSound("hearts.trickWon");
  const { play: playGameOver } = useSound("hearts.gameOver");

  useGameEvents(
    gameState?.events,
    {
      heartsBroken: () => {
        playHeartsBroken();
        setShowHeartsBroken(true);
      },
      moonShot: (event) => {
        if (event.shooter === HUMAN) playMoonShot();
        setMoonShotLabel(playerNames[event.shooter] ?? "");
        setShowMoonShot(true);
      },
      queenOfSpadesPlayed: () => {
        if (humanJustPlayedQSRef.current) {
          humanJustPlayedQSRef.current = false;
          return;
        }
        playQueenOfSpades();
      },
      queenOfSpades: (event) => {
        setQueenOfSpadesLabel(playerNames[event.takerSeat] ?? "");
        setShowQueenOfSpades(true);
      },
    },
    () => setGameState((prev) => (prev ? { ...prev, events: [] as HeartsState["events"] } : null))
  );

  const playerLabels = playerNames;

  // ─── Start sync on first card play ────────────────────────────────────────
  function ensureSyncStarted() {
    if (syncGetGameId()) return;
    syncStart({ initial_score: 0 });
    syncMarkStarted();
  }

  // ─── AI turn loop ─────────────────────────────────────────────────────────
  const runAiTurns = useCallback(
    async (initial: HeartsState) => {
      if (loopActiveRef.current) return;
      loopActiveRef.current = true;
      try {
        // Start with a clean events slate; initial events are already in React state
        // and will be processed by useGameEvents independently.
        let s: HeartsState = { ...initial, events: [] };
        while (s.currentPlayerIndex !== HUMAN && s.phase === "playing") {
          const willComplete = s.currentTrick.length === 3;
          await delay(400);
          if (unmountedRef.current) return;

          const card = selectCardToPlay(
            s.playerHands[s.currentPlayerIndex] as Card[],
            s.currentTrick as TrickCard[],
            s,
            s.currentPlayerIndex,
            s.aiDifficulty
          );
          const completedTrick: readonly TrickCard[] | null = willComplete
            ? [...s.currentTrick, { card, playerIndex: s.currentPlayerIndex }]
            : null;

          s = playCard(s, s.currentPlayerIndex, card);
          playCardPlay();

          if (completedTrick) {
            setLastTrick({ trick: completedTrick, winnerIndex: s.currentLeaderIndex });
            void saveGame(s);
          }
          setGameState(s);
          // Clear events so the next playCard call doesn't re-emit them via a new array reference.
          s = { ...s, events: [] };

          if (completedTrick && s.phase === "playing") {
            await new Promise<void>((resolve) => {
              trickAnimResolverRef.current = resolve;
            });
            if (unmountedRef.current) return;
            setLastTrick(null);
          }
        }
      } finally {
        loopActiveRef.current = false;
      }
    },
    [playCardPlay]
  );

  // Trigger AI loop when it's their turn; wait for lastTrick display first.
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase !== "playing") return;
    if (gameState.currentPlayerIndex === HUMAN) return;
    if (lastTrick !== null) return;
    void runAiTurns(gameState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, gameState?.currentPlayerIndex, gameState?.tricksPlayedInHand, lastTrick]);

  // Complete sync when game is over.
  useEffect(() => {
    if (gameState?.phase !== "game_over") return;
    if (!syncGetGameId()) return;
    const humanScore = gameState.cumulativeScores[HUMAN] ?? 0;
    const finalScore = Math.max(0, 100 - humanScore);
    syncComplete({ outcome: "completed", finalScore, durationMs: 0 }, { final_score: finalScore });
  }, [gameState?.phase, gameState?.cumulativeScores, syncComplete, syncGetGameId]);

  useEffect(() => {
    if (gameState?.phase === "game_over" && !gameOverFiredRef.current) {
      gameOverFiredRef.current = true;
      playGameOver();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase]);

  // ─── Human card play ──────────────────────────────────────────────────────
  function handleCardPress(card: Card) {
    if (!gameState || gameState.currentPlayerIndex !== HUMAN || gameState.phase !== "playing")
      return;
    // Don't accept input while the completed-trick animation is still playing.
    // If the human taps during this window and clears lastTrick, the AI loop's
    // pending animation-resolver promise would never be fulfilled, leaving
    // loopActiveRef.current === true and freezing all subsequent AI turns.
    if (lastTrick !== null) return;
    ensureSyncStarted();
    if (isQueenOfSpades(card)) {
      humanJustPlayedQSRef.current = true;
      playQueenOfSpades();
    } else {
      playCardPlay();
    }
    const willComplete = gameState.currentTrick.length === 3;
    const completedTrick: readonly TrickCard[] | null = willComplete
      ? [...gameState.currentTrick, { card, playerIndex: HUMAN }]
      : null;

    const newState = playCard(gameState, HUMAN, card);

    if (completedTrick) {
      void saveGame(newState);
      if (newState.phase === "playing") {
        setLastTrick({ trick: completedTrick, winnerIndex: newState.currentLeaderIndex });
        setGameState(newState);
        return;
      }
    }
    setLastTrick(null);
    setGameState(newState);
  }

  // Called by TrickArea when the trick-take animation completes. Resolves the
  // AI loop's pending await; for human-led tricks (no pending resolver),
  // clears lastTrick directly.
  function handleTrickAnimationComplete() {
    if (unmountedRef.current) return;
    if (gameState?.phase === "playing") playTrickWon();
    const resolve = trickAnimResolverRef.current;
    if (resolve) {
      trickAnimResolverRef.current = null;
      resolve();
    } else if (lastTrick !== null) {
      setLastTrick(null);
    }
  }

  // ─── Passing ──────────────────────────────────────────────────────────────
  function handlePassCardPress(card: Card) {
    if (!gameState) return;
    setGameState(selectPassCard(gameState, HUMAN, card));
  }

  function handlePassConfirm() {
    if (!gameState) return;
    let s = gameState;
    for (let i = 1; i <= 3; i++) {
      const aiCards = selectCardsToPass(
        [...(s.playerHands[i] ?? [])],
        s.passDirection,
        s.aiDifficulty,
        i
      );
      for (const c of aiCards) {
        s = selectPassCard(s, i, c);
      }
    }
    setGameState(commitPass(s));
  }

  // ─── Hand end / next hand ─────────────────────────────────────────────────
  function handleNextHand() {
    if (!gameState) return;
    setLastTrick(null);
    setShowMoonShot(false);
    setShowHeartsBroken(false);
    setShowQueenOfSpades(false);
    const next = dealNextHand(gameState);
    setGameState(next);
    void saveGame(next);
  }

  // ─── Game over / play again ───────────────────────────────────────────────
  async function handleSubmitScore() {
    if (!gameState || !playerName.trim() || submitState === "submitting" || submitState === "done")
      return;
    if (isInitialized && !isOnline) return;
    setSubmitState("submitting");
    const humanScore = gameState.cumulativeScores[HUMAN] ?? 0;
    const score = Math.max(0, 100 - humanScore);
    try {
      await heartsApi.submitScore(playerName.trim(), score);
      setSubmitState("done");
    } catch {
      setSubmitState("error");
    }
  }

  function handleStartGame(difficulty: AiDifficulty) {
    setLastTrick(null);
    setShowMoonShot(false);
    setShowHeartsBroken(false);
    setShowQueenOfSpades(false);
    setSubmitState("idle");
    setPlayerName("");
    loopActiveRef.current = false;
    gameOverFiredRef.current = false;
    clearGame().catch(() => {});
    const fresh = dealGame(difficulty);
    setGameState(fresh);
  }

  function handlePlayAgain() {
    setLastTrick(null);
    setShowMoonShot(false);
    setShowHeartsBroken(false);
    setShowQueenOfSpades(false);
    setSubmitState("idle");
    setPlayerName("");
    loopActiveRef.current = false;
    gameOverFiredRef.current = false;
    clearGame().catch(() => {});
    setGameState(null);
  }

  function handleOpenRename() {
    setDraftNames([...playerNames]);
    setShowRename(true);
  }

  function handleSaveNames() {
    const validated = playerNames.map((def, i) =>
      validateName(draftNames[i] ?? "", DEFAULT_NAMES[i] ?? def)
    );
    setPlayerNames(validated);
    savePlayerNames(validated).catch(() => {});
    setShowRename(false);
  }

  // ─── Derived state ────────────────────────────────────────────────────────
  const humanHand = [...(gameState?.playerHands[HUMAN] ?? [])];
  const isPassing = gameState?.phase === "passing";
  const humanPassSelections = [...(gameState?.passSelections[HUMAN] ?? [])];
  const validCards =
    gameState?.phase === "playing" && gameState.currentPlayerIndex === HUMAN
      ? getValidPlays(gameState, HUMAN)
      : [];
  const displayTrick = lastTrick !== null ? lastTrick.trick : (gameState?.currentTrick ?? []);
  const trickWinnerIndex = lastTrick !== null ? lastTrick.winnerIndex : null;
  const moonShooter = gameState ? detectMoon(gameState.wonCards) : null;

  // ─── Pre-game: show difficulty picker until a game is started ────────────
  if (!gameState) {
    return (
      <GameShell
        title={t("game.title")}
        onBack={() => navigation.goBack()}
        onNewGame={() => handleStartGame(selectedDifficulty)}
        onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "hearts" })}
        onEditPlayerNames={handleOpenRename}
      >
        <View style={styles.preGameContainer}>
          <Text style={[styles.preGameTitle, { color: colors.text }]}>
            {t("difficulty.groupLabel", { defaultValue: "AI Difficulty" })}
          </Text>
          <HeartsAiDifficultySelector value={selectedDifficulty} onChange={setSelectedDifficulty} />
          <Pressable
            style={[styles.btn, { backgroundColor: colors.accent }]}
            onPress={() => handleStartGame(selectedDifficulty)}
            accessibilityRole="button"
            accessibilityLabel={t("game.startGame", { defaultValue: "Start Game" })}
          >
            <Text style={[styles.btnText, { color: colors.textOnAccent }]}>
              {t("game.startGame", { defaultValue: "Start Game" })}
            </Text>
          </Pressable>
        </View>
      </GameShell>
    );
  }

  return (
    <GameShell
      title={t("game.title")}
      onBack={() => navigation.goBack()}
      onNewGame={handlePlayAgain}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "hearts" })}
      onEditPlayerNames={handleOpenRename}
    >
      {/* ── Table ──────────────────────────────────────────────────── */}
      <View style={[styles.table, styles.tablePositioned, { backgroundColor: colors.background }]}>
        {/* Top AI (seat 2) */}
        <View style={styles.topArea}>
          <OpponentHand
            cardCount={gameState.playerHands[2]?.length ?? 0}
            label={playerLabels[2] ?? ""}
          />
          <OpponentCapturedPile
            cards={gameState.wonCards[2] ?? []}
            seatLabel={playerLabels[2] ?? ""}
          />
        </View>

        {/* Middle: Left AI | TrickArea | Right AI */}
        <View style={styles.middleRow}>
          <View style={styles.sideColumn}>
            <SideSeatLabel label={playerLabels[1] ?? ""} colors={colors} />
            <OpponentCapturedPile
              cards={gameState.wonCards[1] ?? []}
              seatLabel={playerLabels[1] ?? ""}
            />
          </View>
          <View style={styles.trickWrapper}>
            <TrickArea
              trick={[...displayTrick]}
              playerIndex={HUMAN}
              playerLabels={playerLabels}
              winnerIndex={trickWinnerIndex}
              onAnimationComplete={handleTrickAnimationComplete}
            />
            <HeartsBrokenAnimation
              visible={showHeartsBroken}
              onAnimationEnd={() => setShowHeartsBroken(false)}
            />
          </View>
          <View style={styles.sideColumn}>
            <SideSeatLabel label={playerLabels[3] ?? ""} colors={colors} />
            <OpponentCapturedPile
              cards={gameState.wonCards[3] ?? []}
              seatLabel={playerLabels[3] ?? ""}
            />
          </View>
        </View>

        {/* Human hand */}
        <View style={styles.bottomArea}>
          <Text style={[styles.humanLabel, { color: colors.textMuted }]}>
            {playerLabels[0] ?? ""}
          </Text>
          {isPassing && (
            <PassBanner
              passDirection={gameState.passDirection}
              selectedCount={humanPassSelections.length}
              onConfirm={handlePassConfirm}
            />
          )}
          <SelfCapturedPile cards={gameState.wonCards[HUMAN] ?? []} />
          <PlayerHand
            hand={humanHand}
            selectedCards={isPassing ? humanPassSelections : undefined}
            validCards={isPassing ? undefined : validCards}
            onCardPress={isPassing ? handlePassCardPress : handleCardPress}
          />
        </View>
        <HeartsMoonShotAnimation
          visible={showMoonShot}
          shooterLabel={moonShotLabel}
          onAnimationEnd={() => setShowMoonShot(false)}
        />
        <HeartsQueenOfSpadesAnimation
          visible={showQueenOfSpades}
          takerLabel={queenOfSpadesLabel}
          onAnimationEnd={() => setShowQueenOfSpades(false)}
        />
      </View>

      {/* ── Hand-end overlay (dealing phase = hand just finished) ──── */}
      {gameState.phase === "dealing" && (
        <Modal visible transparent animationType="fade" accessibilityViewIsModal>
          <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.panel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.panelTitle, { color: colors.text }]}>{t("hand_end.title")}</Text>
              {moonShooter !== null && (
                <Text style={[styles.moonText, { color: colors.accent }]}>
                  {t("hand_end.moon", { label: playerLabels[moonShooter] ?? "" })}
                </Text>
              )}
              <HeartsScoreboard
                playerLabels={playerLabels}
                cumulativeScores={[...gameState.cumulativeScores]}
                scoreHistory={scoreHistory}
                compact
              />
              <Pressable
                style={[styles.btn, { backgroundColor: colors.accent }]}
                onPress={handleNextHand}
                accessibilityRole="button"
                accessibilityLabel={t("hand_end.next")}
              >
                <Text style={[styles.btnText, { color: colors.textOnAccent }]}>
                  {t("hand_end.next")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* ── Game-over overlay ──────────────────────────────────────── */}
      {gameState.phase === "game_over" && (
        <Modal visible transparent animationType="fade" accessibilityViewIsModal>
          <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
            <View
              style={[
                styles.panel,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.panelTitle, { color: colors.text }]}>
                {t("game_over.title")}
              </Text>
              <Text style={[styles.winnerText, { color: colors.accent }]}>
                {gameState.winnerIndex === 0
                  ? t("game_over.you_win")
                  : t("game_over.winner", {
                      label: playerLabels[gameState.winnerIndex ?? 0] ?? "",
                    })}
              </Text>
              <HeartsScoreboard
                playerLabels={playerLabels}
                cumulativeScores={[...gameState.cumulativeScores]}
                scoreHistory={scoreHistory}
                compact
              />

              {submitState !== "done" && (
                <>
                  <TextInput
                    style={[
                      styles.nameInput,
                      {
                        color: colors.text,
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceAlt,
                      },
                    ]}
                    value={playerName}
                    onChangeText={setPlayerName}
                    placeholder={t("game_over.name_placeholder")}
                    placeholderTextColor={colors.textMuted}
                    maxLength={MAX_NAME_LENGTH}
                    accessibilityLabel={t("game_over.name_placeholder")}
                    editable={submitState !== "submitting"}
                  />
                  <Pressable
                    style={[
                      styles.btn,
                      {
                        backgroundColor:
                          playerName.trim() && submitState !== "submitting"
                            ? colors.accent
                            : colors.surfaceAlt,
                      },
                    ]}
                    onPress={() => void handleSubmitScore()}
                    disabled={!playerName.trim() || submitState === "submitting"}
                    accessibilityRole="button"
                    accessibilityLabel={
                      submitState === "submitting"
                        ? t("game_over.submitting")
                        : submitState === "error"
                          ? t("game_over.retry")
                          : t("game_over.submit")
                    }
                    accessibilityState={{
                      disabled: !playerName.trim() || submitState === "submitting",
                    }}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        {
                          color:
                            playerName.trim() && submitState !== "submitting"
                              ? colors.textOnAccent
                              : colors.textMuted,
                        },
                      ]}
                    >
                      {submitState === "submitting"
                        ? t("game_over.submitting")
                        : submitState === "error"
                          ? t("game_over.retry")
                          : t("game_over.submit")}
                    </Text>
                  </Pressable>
                  {isInitialized && !isOnline ? (
                    <OfflineBanner />
                  ) : (
                    submitState === "error" && (
                      <Text style={[styles.errorText, { color: colors.error }]}>
                        {t("game_over.submit_error")}
                      </Text>
                    )
                  )}
                </>
              )}
              {submitState === "done" && (
                <Text style={[styles.successText, { color: colors.accent }]}>
                  {t("game_over.submitted")}
                </Text>
              )}

              <HeartsAiDifficultySelector
                value={selectedDifficulty}
                onChange={setSelectedDifficulty}
              />
              <Pressable
                style={[styles.btn, { backgroundColor: colors.surfaceAlt }]}
                onPress={handlePlayAgain}
                accessibilityRole="button"
                accessibilityLabel={t("game_over.again")}
              >
                <Text style={[styles.btnText, { color: colors.text }]}>{t("game_over.again")}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* ── Rename players modal ───────────────────────────────────── */}
      <Modal
        visible={showRename}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRename(false)}
        accessibilityViewIsModal
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <View
            style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.panelTitle, { color: colors.text }]}>
              {t("settings.rename_title")}
            </Text>
            <ScrollView style={styles.renameScroll} contentContainerStyle={styles.renameContent}>
              {DEFAULT_NAMES.map((def, i) => (
                <View key={i} style={styles.renameRow}>
                  <Text style={[styles.renameLabel, { color: colors.textMuted }]}>
                    {t("settings.player_label", { n: i + 1, default: def })}
                  </Text>
                  <TextInput
                    style={[
                      styles.renameInput,
                      {
                        color: colors.text,
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceAlt,
                      },
                    ]}
                    value={draftNames[i] ?? ""}
                    onChangeText={(v) =>
                      setDraftNames((prev) => {
                        const next = [...prev];
                        next[i] = v;
                        return next;
                      })
                    }
                    placeholder={def}
                    placeholderTextColor={colors.textMuted}
                    maxLength={32}
                    accessibilityLabel={t("settings.player_label", { n: i + 1, default: def })}
                  />
                </View>
              ))}
            </ScrollView>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.accent }]}
              onPress={handleSaveNames}
              accessibilityRole="button"
              accessibilityLabel={t("settings.save")}
            >
              <Text style={[styles.btnText, { color: colors.textOnAccent }]}>
                {t("settings.save")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.surfaceAlt }]}
              onPress={() => setShowRename(false)}
              accessibilityRole="button"
              accessibilityLabel={t("settings.cancel")}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>{t("settings.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  table: {
    flex: 1,
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  tablePositioned: {
    position: "relative",
  },
  topArea: {
    alignItems: "center",
    paddingTop: 4,
  },
  middleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  sideColumn: {
    alignItems: "center",
    gap: 6,
  },
  trickWrapper: {
    position: "relative",
  },
  bottomArea: {
    paddingBottom: 8,
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    width: "90%",
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    gap: 16,
    alignItems: "center",
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  moonText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  winnerText: {
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
  },
  btnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  nameInput: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  errorText: {
    fontSize: 13,
    textAlign: "center",
  },
  successText: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  humanLabel: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  renameScroll: {
    width: "100%",
    maxHeight: 260,
  },
  renameContent: {
    gap: 12,
  },
  renameRow: {
    gap: 4,
  },
  renameLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  preGameContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 20,
  },
  preGameTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
});
