import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  AppStateStatus,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../theme/ThemeContext";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HomeStackParamList } from "../../App";
import { GameShell } from "../components/shared/GameShell";
import GameCanvas from "../components/starswarm/GameCanvas";
import type { GameCanvasHandle, DevOptions } from "../components/starswarm/GameCanvas";
import Controls, {
  hapticPlayerHit,
  hapticPlayerDeath,
  hapticWaveClear,
} from "../components/starswarm/Controls";
import {
  CANVAS_W,
  CANVAS_H,
  DIFFICULTY_TIERS,
  difficultyLabel,
  difficultyMultiplier,
} from "../game/starswarm/engine";
import type { GamePhase, PowerUpType, DifficultyTier } from "../game/starswarm/types";
import { starSwarmApi } from "../game/starswarm/api";
import {
  getSavedPausedState,
  savePausedState,
  clearSavedPausedState,
} from "../game/starswarm/pauseStore";
import { useStarSwarmAudio, DEFAULT_SFX_VOLUMES } from "../hooks/useStarSwarmAudio";
import type { SfxVolumes } from "../hooks/useStarSwarmAudio";

export default function StarSwarmScreen() {
  const { t } = useTranslation("starswarm");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList, "StarSwarm">>();

  const canvasRef = useRef<GameCanvasHandle>(null);

  // Capture saved paused session once at mount — used to restore game state and skip difficulty picker.
  const savedPauseRef = useRef(getSavedPausedState());

  const [highScore, setHighScore] = useState(0);
  const [phase, setPhase] = useState<GamePhase>("SwoopIn");
  const [isPaused, setIsPaused] = useState(savedPauseRef.current !== null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);

  // Dev panel state — stripped from production builds by Metro's __DEV__ dead-code elimination
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [devWave, setDevWave] = useState(1);
  const [devInfiniteLives, setDevInfiniteLives] = useState(false);
  const [devStragglerEnabled, setDevStragglerEnabled] = useState(true);
  const [devPauseStraggler, setDevPauseStraggler] = useState(false);
  const [devDifficulty, setDevDifficulty] = useState<DifficultyTier>("LieutenantJG");
  const [devVolumes, setDevVolumes] = useState<SfxVolumes>(DEFAULT_SFX_VOLUMES);
  const [devPlayerFireOff, setDevPlayerFireOff] = useState(false);
  const [devEnemyFireOff, setDevEnemyFireOff] = useState(false);

  // Pre-game difficulty selector — shown before each new game (skipped when restoring a saved session)
  const [difficulty, setDifficulty] = useState<DifficultyTier>(
    savedPauseRef.current?.difficulty ?? "LieutenantJG"
  );
  const [showDifficultyPicker, setShowDifficultyPicker] = useState(savedPauseRef.current === null);

  const adjustVolume = useCallback((key: keyof SfxVolumes, delta: number) => {
    setDevVolumes((v) => ({
      ...v,
      [key]: Math.round(Math.min(1, Math.max(0, v[key] + delta)) * 10) / 10,
    }));
  }, []);

  const {
    playLaser,
    playPowerUpCollect,
    playExplosion,
    playPlayerHit,
    playWaveClear,
    playGameOver,
    playChallengingStage,
    playBonusLife,
    playPerfect,
  } = useStarSwarmAudio(phase !== "GameOver", devVolumes);

  const scoreRef = useRef(0);
  const highScoreRef = useRef(0);
  // Increments on every new-game request; GameCanvas watches this via useEffect to reset.
  const [resetTick, setResetTick] = useState(0);
  // In dev builds, track the last opts from the panel so every subsequent "New Game"
  // (header, game-over overlay) re-applies them without reopening the dev panel.
  const lastDevOptsRef = useRef<DevOptions | undefined>(undefined);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerW(Math.floor(width));
    setContainerH(Math.floor(height));
  }, []);

  const handleScoreChange = useCallback((s: number) => {
    scoreRef.current = s;
  }, []);

  const handleGameOver = useCallback(
    (finalScore: number, wave: number) => {
      setPhase("GameOver");
      playGameOver();
      hapticPlayerDeath();
      if (finalScore > highScoreRef.current) {
        highScoreRef.current = finalScore;
        setHighScore(finalScore);
      }
      starSwarmApi.submitScore(finalScore, wave, difficulty).catch(() => {});
    },
    [playGameOver, difficulty]
  );

  const handleChallengingPerfect = useCallback(() => {
    playPerfect();
  }, [playPerfect]);

  const handlePlayerHit = useCallback(() => {
    playPlayerHit();
    hapticPlayerHit();
  }, [playPlayerHit]);

  const handleWaveClear = useCallback(() => {
    setPhase("WaveClear");
    playWaveClear();
    hapticWaveClear();
  }, [playWaveClear]);

  const handleBonusLife = useCallback(() => {
    playBonusLife();
  }, [playBonusLife]);

  const handleTriggerPowerUp = useCallback((type: PowerUpType) => {
    canvasRef.current?.triggerPowerUp(type);
  }, []);

  const handleNewGame = useCallback((opts?: DevOptions) => {
    if (__DEV__ && opts !== undefined) lastDevOptsRef.current = opts;
    scoreRef.current = 0;
    setPhase("SwoopIn");
    setIsPaused(false);
    setResetTick((t) => t + 1);
  }, []);

  // Show difficulty picker — triggered by header "New Game" and Controls "New Game"
  const handleRequestNewGame = useCallback(() => {
    setShowDifficultyPicker(true);
  }, []);

  // Confirm difficulty selection and start the game
  const handleConfirmDifficulty = useCallback(() => {
    clearSavedPausedState();
    savedPauseRef.current = null;
    setShowDifficultyPicker(false);
    scoreRef.current = 0;
    setPhase("SwoopIn");
    setIsPaused(false);
    setResetTick((t) => t + 1);
  }, []);

  const handlePause = useCallback(() => {
    setIsPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    setIsPaused(false);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if ((next === "background" || next === "inactive") && phase === "Playing") {
        handlePause();
      }
    });
    return () => sub.remove();
  }, [phase, handlePause]);

  const dynamicStyles = getStyles(colors);

  const scale =
    containerW > 0 && containerH > 0 ? Math.min(containerW / CANVAS_W, containerH / CANVAS_H) : 0;

  const displayW = Math.round(CANVAS_W * scale);
  const displayH = Math.round(CANVAS_H * scale);

  const showPauseBtn = !showDifficultyPicker && phase !== "GameOver" && scale > 0;

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => {
        if (isPaused) {
          const state = canvasRef.current?.getState();
          if (state) savePausedState({ gameState: state, difficulty });
        }
        navigation.popToTop();
      }}
      onNewGame={handleRequestNewGame}
      rightSlot={
        showPauseBtn ? (
          <Pressable
            onPress={isPaused ? handleResume : handlePause}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? t("controls.resumeLabel") : t("controls.pauseLabel")}
            style={({ pressed }) => [
              styles.pauseHeaderBtn,
              pressed && styles.pauseHeaderBtnPressed,
            ]}
            hitSlop={8}
          >
            <MaterialIcons
              name={isPaused ? "play-arrow" : "pause"}
              size={22}
              color={colors.textOnAccent}
            />
          </Pressable>
        ) : undefined
      }
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
        paddingLeft: Math.max(insets.left, 0),
        paddingRight: Math.max(insets.right, 0),
      }}
    >
      <View style={styles.canvasOuter} onLayout={onLayout}>
        {scale > 0 && (
          <View style={{ width: displayW, height: displayH }}>
            <GameCanvas
              ref={canvasRef}
              highScore={highScore}
              onScoreChange={handleScoreChange}
              onGameOver={handleGameOver}
              onPlayerHit={handlePlayerHit}
              onWaveClear={handleWaveClear}
              onLaserFire={playLaser}
              onPowerUpCollect={playPowerUpCollect}
              onExplosion={playExplosion}
              onChallengingStage={playChallengingStage}
              onChallengingPerfect={handleChallengingPerfect}
              onBonusLife={handleBonusLife}
              isPaused={isPaused}
              onPause={handlePause}
              width={CANVAS_W}
              height={CANVAS_H}
              scale={scale}
              difficulty={difficulty}
              resetTick={resetTick}
              initialState={savedPauseRef.current?.gameState}
              // #1311/#1312: spread lastDevOptsRef for new-game options (wave, lives, etc.),
              // then override live-toggleable fields so they propagate mid-game without New Game.
              // pauseStraggler is also overridden here (fixes a pre-existing gap where the toggle
              // only took effect after New Game).
              devOptions={
                __DEV__
                  ? {
                      ...lastDevOptsRef.current,
                      pauseStraggler: devPauseStraggler,
                      playerFireDisabled: devPlayerFireOff,
                      enemyFireDisabled: devEnemyFireOff,
                    }
                  : undefined
              }
            />
            <Controls
              canvasRef={canvasRef}
              scale={scale}
              phase={phase}
              isPaused={isPaused}
              onPause={handlePause}
              onResume={handleResume}
              onNewGame={handleRequestNewGame}
            />
            {__DEV__ && (
              <Pressable style={dynamicStyles.devButton} onPress={() => setDevPanelOpen(true)}>
                <Text style={styles.devButtonText}>DEV</Text>
              </Pressable>
            )}
          </View>
        )}
        {showDifficultyPicker && scale > 0 && (
          <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={handleConfirmDifficulty}
            accessibilityViewIsModal
          >
            <View style={styles.pickerOverlay}>
              <View style={dynamicStyles.pickerPanel}>
                <Text style={dynamicStyles.pickerTitle}>{t("difficulty.selectTitle")}</Text>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.pickerScroll}
                  contentContainerStyle={styles.pickerScrollContent}
                >
                  {DIFFICULTY_TIERS.map((tier) => (
                    <Pressable
                      key={tier}
                      style={[
                        styles.pickerRow,
                        difficulty === tier && dynamicStyles.pickerRowSelected,
                      ]}
                      onPress={() => setDifficulty(tier)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: difficulty === tier }}
                      accessibilityLabel={`${difficultyLabel(tier)} ×${difficultyMultiplier(tier)}`}
                    >
                      <Text
                        style={[
                          styles.pickerTierName,
                          difficulty === tier && dynamicStyles.pickerTierNameSelected,
                        ]}
                      >
                        {difficultyLabel(tier)}
                      </Text>
                      <Text style={styles.pickerTierMult}>{`×${difficultyMultiplier(tier)}`}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable
                  style={[styles.devActionBtn, dynamicStyles.devPrimary, styles.pickerStartBtn]}
                  onPress={handleConfirmDifficulty}
                >
                  <Text style={styles.devPrimaryText}>{t("difficulty.start")}</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )}

        {__DEV__ && devPanelOpen && (
          <View
            style={dynamicStyles.devPanelOverlay}
            accessible
            accessibilityLabel="Developer panel"
            accessibilityRole="menu"
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.devScrollContent}
            >
              <Text style={dynamicStyles.devTitle}>DEV</Text>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Wave</Text>
                <Pressable
                  style={styles.devStepBtn}
                  onPress={() => setDevWave((w) => Math.max(1, w - 1))}
                  accessibilityLabel="Decrease wave"
                >
                  <Text style={styles.devStepText}>−</Text>
                </Pressable>
                <Text style={styles.devValue}>{devWave}</Text>
                <Pressable
                  style={styles.devStepBtn}
                  onPress={() => setDevWave((w) => Math.min(15, w + 1))}
                  accessibilityLabel="Increase wave"
                >
                  <Text style={styles.devStepText}>+</Text>
                </Pressable>
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Infinite lives</Text>
                <Switch value={devInfiniteLives} onValueChange={setDevInfiniteLives} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Straggler AI</Text>
                <Switch value={devStragglerEnabled} onValueChange={setDevStragglerEnabled} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Pause straggler</Text>
                <Switch value={devPauseStraggler} onValueChange={setDevPauseStraggler} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Player missiles off</Text>
                <Switch value={devPlayerFireOff} onValueChange={setDevPlayerFireOff} />
              </View>

              <View style={styles.devRow}>
                <Text style={dynamicStyles.devLabel}>Enemy missiles off</Text>
                <Switch value={devEnemyFireOff} onValueChange={setDevEnemyFireOff} />
              </View>

              <Text style={dynamicStyles.devSectionHeader}>── Difficulty ──</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.devTierScroll}
                contentContainerStyle={styles.devTierScrollContent}
              >
                {DIFFICULTY_TIERS.map((tier) => (
                  <Pressable
                    key={tier}
                    style={[styles.devTierBtn, devDifficulty === tier && styles.devTierBtnActive]}
                    onPress={() => setDevDifficulty(tier)}
                    accessibilityLabel={`Dev difficulty ${difficultyLabel(tier)}`}
                  >
                    <Text
                      style={[
                        styles.devTierText,
                        devDifficulty === tier && styles.devTierTextActive,
                      ]}
                    >
                      {difficultyLabel(tier)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={dynamicStyles.devSectionHeader}>── Power-ups ──</Text>

              <View style={styles.devPowerUpRow}>
                {(["lightning", "shield", "buddy", "bomb"] as PowerUpType[]).map((type) => (
                  <Pressable
                    key={type}
                    style={styles.devPowerUpBtn}
                    onPress={() => handleTriggerPowerUp(type)}
                    accessibilityLabel={`Trigger ${type} power-up`}
                  >
                    <Text style={styles.devPowerUpText}>{type}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={dynamicStyles.devSectionHeader}>── Sound ──</Text>

              {(
                [
                  ["Laser", "laser"],
                  ["PU: Lightning", "poweruplightning"],
                  ["PU: Shield", "powerupshield"],
                  ["PU: Buddy", "powerupbuddy"],
                  ["PU: Bomb", "powerupbomb"],
                  ["Explosion", "explosion"],
                  ["Player hit", "playerhit"],
                  ["Wave clear", "waveclear"],
                  ["Game over", "gameover"],
                  ["Challenging", "challengingstage"],
                  ["Perfect bonus", "perfectbonus"],
                ] as [string, keyof SfxVolumes][]
              ).map(([label, key]) => (
                <View key={key} style={styles.devRow}>
                  <Text style={[dynamicStyles.devLabel, styles.devMixerLabel]}>{label}</Text>
                  <Pressable
                    style={styles.devStepBtn}
                    onPress={() => adjustVolume(key, -0.1)}
                    accessibilityLabel={`Decrease ${label} volume`}
                  >
                    <Text style={styles.devStepText}>−</Text>
                  </Pressable>
                  <Text style={styles.devValue}>{devVolumes[key].toFixed(1)}</Text>
                  <Pressable
                    style={styles.devStepBtn}
                    onPress={() => adjustVolume(key, 0.1)}
                    accessibilityLabel={`Increase ${label} volume`}
                  >
                    <Text style={styles.devStepText}>+</Text>
                  </Pressable>
                </View>
              ))}

              <Pressable
                style={[styles.devActionBtn, dynamicStyles.devPrimary]}
                onPress={() => {
                  setDevPanelOpen(false);
                  handleNewGame({
                    wave: devWave,
                    infiniteLives: devInfiniteLives,
                    stragglerEnabled: devStragglerEnabled,
                    pauseStraggler: devPauseStraggler,
                    difficulty: devDifficulty,
                  });
                }}
              >
                <Text style={styles.devPrimaryText}>New Game</Text>
              </Pressable>

              <Pressable style={styles.devActionBtn} onPress={() => setDevPanelOpen(false)}>
                <Text style={dynamicStyles.devLabel}>Collapse</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
    </GameShell>
  );
}

const baseStyles = StyleSheet.create({
  canvasOuter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pauseHeaderBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00aaff",
  },
  pauseHeaderBtnPressed: {
    opacity: 0.7,
  },
  devButtonText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  devRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  devStepBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  devStepText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 22,
  },
  devValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    minWidth: 28,
    textAlign: "center",
  },
  devScrollContent: {
    gap: 16,
  },
  devMixerLabel: {
    fontSize: 11,
    minWidth: 80,
  },
  devPowerUpRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  devPowerUpBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: "rgba(255,200,0,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,200,0,0.4)",
  },
  devPowerUpText: {
    color: "#ffc800",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  devActionBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  devPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  devTierScroll: {
    marginVertical: 2,
  },
  devTierScrollContent: {
    gap: 6,
    paddingVertical: 2,
  },
  devTierBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  devTierBtnActive: {
    backgroundColor: "rgba(255,128,0,0.3)",
    borderColor: "rgba(255,128,0,0.8)",
  },
  devTierText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 9,
    fontWeight: "700",
  },
  devTierTextActive: {
    color: "#ff8000",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,10,0.88)",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerScroll: {
    maxHeight: 320,
  },
  pickerScrollContent: {
    gap: 6,
    paddingVertical: 4,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  pickerTierName: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: "600",
  },
  pickerTierMult: {
    color: "rgba(255,238,0,0.8)",
    fontSize: 13,
    fontWeight: "700",
  },
  pickerStartBtn: {
    marginTop: 12,
  },
});

// Create dynamic styles based on theme tokens to comply with design-tokens policy
const getStyles = (colors: ReturnType<typeof useTheme>["colors"]) =>
  StyleSheet.create({
    ...baseStyles,
    devButton: {
      position: "absolute",
      top: 6,
      left: 6,
      backgroundColor: "rgba(255,128,0,0.85)",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      zIndex: 100,
    },
    devPanelOverlay: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: 180,
      backgroundColor: "rgba(0,0,0,0.88)",
      borderLeftWidth: 1,
      borderLeftColor: "rgba(255,128,0,0.4)",
      zIndex: 100,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    devTitle: {
      color: "rgba(255,128,0,1)",
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 2,
      textAlign: "center",
      textTransform: "uppercase",
    },
    devLabel: {
      color: colors.textMuted,
      fontSize: 13,
      flex: 1,
    },
    devSectionHeader: {
      color: "rgba(255,128,0,0.7)",
      fontSize: 10,
      letterSpacing: 1,
      textAlign: "center",
      marginTop: 4,
    },
    devPrimary: {
      backgroundColor: "rgba(255,128,0,1)",
    },
    pickerPanel: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 14,
      padding: 24,
      width: 300,
      maxHeight: "80%",
      borderWidth: 1,
      borderColor: "rgba(0,255,200,0.3)",
    },
    pickerTitle: {
      color: "#00ffcc",
      fontSize: 15,
      fontWeight: "700",
      letterSpacing: 1.5,
      textAlign: "center",
      textTransform: "uppercase",
      marginBottom: 14,
    },
    pickerRowSelected: {
      backgroundColor: "rgba(0,255,200,0.12)",
      borderColor: "rgba(0,255,200,0.55)",
    },
    pickerTierNameSelected: {
      color: "#ffffff",
    },
  });

const styles = baseStyles;
