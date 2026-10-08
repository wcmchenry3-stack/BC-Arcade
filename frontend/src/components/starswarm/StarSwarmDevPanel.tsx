/**
 * Star Swarm's developer panel (#2978, from StarSwarmScreen): sets up a run
 * (wave, lives, straggler, difficulty), flips the switches that reach the live
 * run, pokes the engine (power-ups, asteroid, escorts), reads its run counters
 * (#2491) and mixes the sound. Dev and internal pre-launch builds only (#2567).
 */
import React, { useCallback, useEffect, useState, type RefObject } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  DevActionButton,
  DevPanelShell,
  DevRow,
  DevSection,
  DevStepper,
  DevToggle,
} from "../dev/DevPanelShell";
import type { DevOptions, GameCanvasHandle } from "./GameCanvas";
import { DIFFICULTY_TIERS, difficultyLabel, dodgeRateByTier } from "../../game/starswarm/engine";
import type { TierDodgeRow } from "../../game/starswarm/engine";
import type {
  DifficultyTier,
  PowerUpType,
  RunStats,
  StarSwarmState,
} from "../../game/starswarm/types";
import { DEFAULT_SFX_VOLUMES, type SfxVolumes } from "../../hooks/useStarSwarmAudio";
import {
  DEV_ACCENT,
  DEV_ACCENT_BORDER_SOFT,
  DEV_ACCENT_SELECTED_BG,
  DEV_ACCENT_SELECTED_BORDER,
  DEV_GOLD_BG,
  DEV_GOLD_BORDER,
  DEV_SURFACE_BORDER,
  DEV_SURFACE_FAINT,
  DEV_TEXT_DIM,
} from "../../theme/theme.constants";

/** Everything the panel sets, in one object the screen owns. */
export interface StarSwarmDevOptions {
  /** New-game options: applied by the panel's New Game. */
  readonly wave: number;
  readonly infiniteLives: boolean;
  readonly stragglerEnabled: boolean;
  readonly difficulty: DifficultyTier;
  /** Live switches: reach the running game at once. */
  readonly pauseStraggler: boolean;
  readonly playerFireDisabled: boolean;
  readonly enemyFireDisabled: boolean;
  readonly asteroidsDisabled: boolean; // #2486
  readonly dodgeDisabled: boolean; // #2491
  readonly flakDisabled: boolean; // #2491
  readonly routDisabled: boolean; // #2489
  /** Screen-side: the frame-time readout over the game (#2567), and the sound mix. */
  readonly frameReadout: boolean;
  readonly volumes: SfxVolumes;
}

export const DEFAULT_STARSWARM_DEV_OPTIONS: StarSwarmDevOptions = {
  wave: 1,
  infiniteLives: false,
  stragglerEnabled: true,
  difficulty: "LieutenantJG",
  pauseStraggler: false,
  playerFireDisabled: false,
  enemyFireDisabled: false,
  asteroidsDisabled: false,
  dodgeDisabled: false,
  flakDisabled: false,
  routDisabled: false,
  frameReadout: false,
  volumes: DEFAULT_SFX_VOLUMES,
};

/**
 * The canvas's dev options (#1311/#1312): the last panel New Game's options
 * (wave, lives, ...), then the live switches, so they propagate mid-game
 * without a New Game.
 */
export function canvasDevOptions(
  lastNewGame: DevOptions | undefined,
  o: StarSwarmDevOptions
): DevOptions {
  return {
    ...lastNewGame,
    pauseStraggler: o.pauseStraggler,
    playerFireDisabled: o.playerFireDisabled,
    enemyFireDisabled: o.enemyFireDisabled,
    asteroidsDisabled: o.asteroidsDisabled,
    dodgeDisabled: o.dodgeDisabled,
    flakDisabled: o.flakDisabled,
    routDisabled: o.routDisabled,
  };
}

// #2491: dev-panel run-stats view — a 4 Hz snapshot of the engine's counters.
const DEV_STATS_POLL_MS = 250;

interface DevStatsSnapshot {
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly score: number;
  readonly rows: readonly TierDodgeRow[];
  readonly run: RunStats;
}

function snapshotStats(s: StarSwarmState): DevStatsSnapshot {
  return {
    wave: s.wave,
    difficulty: s.difficulty,
    score: s.score,
    rows: dodgeRateByTier(s),
    run: s.runStats,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const col = (x: number | string, w: number) => String(x).padStart(w);

const TIER_TABLE_HEADER = `${"tier".padEnd(7)} base  eff rolls dodge  rate struck flak`;

function tierTableLine(row: TierDodgeRow): string {
  const rate = row.rolls > 0 ? pct(row.dodged / row.rolls) : col("-", 4);
  return (
    `${row.tier.padEnd(7)} ${pct(row.base)} ${pct(row.effective)} ` +
    `${col(row.rolls, 5)} ${col(row.dodged, 5)} ${col(rate, 5)} ${col(row.struck, 6)} ${col(row.flak, 4)}`
  );
}

const RUN_STAT_LINES: readonly (readonly [string, keyof RunStats])[] = [
  ["Reinforcements launched", "reinforced"],
  ["Armor deflections", "armorDeflects"],
  ["Beam hits on player", "beamHits"],
  ["Rout caught", "routCaught"],
  ["Rout escaped", "routEscaped"],
  ["Rocks spawned", "rocksSpawned"],
  ["Rocks broken by player", "rocksBrokenByPlayer"],
  ["Rocks broken by enemies", "rocksBrokenByEnemy"],
  ["Buddy launched", "buddyLaunched"], // #2845
  ["Buddy lost", "buddyLost"],
  ["Shots drawn by Buddy", "buddyShotsDrawn"],
];

/** Switches in panel order; "Throw asteroid" follows "Asteroids off". */
type SwitchKey = {
  [K in keyof StarSwarmDevOptions]: StarSwarmDevOptions[K] extends boolean ? K : never;
}[keyof StarSwarmDevOptions];

const SETUP_SWITCHES: readonly (readonly [string, SwitchKey])[] = [
  ["Infinite lives", "infiniteLives"],
  ["Straggler AI", "stragglerEnabled"],
  ["Pause straggler", "pauseStraggler"],
  ["Player missiles off", "playerFireDisabled"],
  ["Enemy missiles off", "enemyFireDisabled"],
  ["Asteroids off", "asteroidsDisabled"],
];

const ENGINE_SWITCHES: readonly (readonly [string, SwitchKey])[] = [
  ["Dodge off", "dodgeDisabled"],
  ["Flak off", "flakDisabled"],
  ["Rout off", "routDisabled"],
  // #2567: frame-time avg / p95 and canvas commits/s, shown over the game
  ["Frame readout", "frameReadout"],
];

const POWER_UPS: readonly PowerUpType[] = [
  "lightning",
  "shield",
  "buddy",
  "bomb",
  "salvage",
  "hull",
];

const MIXER: readonly (readonly [string, keyof SfxVolumes])[] = [
  ["Laser", "laser"],
  ["PU: Lightning", "poweruplightning"],
  ["PU: Shield", "powerupshield"],
  ["PU: Buddy", "powerupbuddy"],
  ["PU: Bomb", "powerupbomb"],
  ["Explosion", "explosion"],
  ["Player hit", "playerhit"],
  ["Wave clear", "waveclear"],
  ["Game over", "gameover"],
  ["Boss wave", "bosswave"],
  ["Beam charge", "beamcharge"],
  ["Beam fire", "beamfire"],
  ["Reinforce", "reinforce"],
  ["Salvage", "salvage"],
  ["Hull up", "hullup"],
  ["Hull hit", "hullhit"],
  ["Rout", "rout"],
];

export interface StarSwarmDevPanelProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly canvasRef: RefObject<GameCanvasHandle | null>;
  readonly options: StarSwarmDevOptions;
  readonly onOptionsChange: (update: (o: StarSwarmDevOptions) => StarSwarmDevOptions) => void;
  /** The panel's New Game, with its new-game options. */
  readonly onNewGame: (opts: DevOptions) => void;
}

/**
 * The side panel itself; the screen draws its DEV button over the canvas
 * (`DevButton`), since the panel spans the whole play area.
 */
export default function StarSwarmDevPanel(props: StarSwarmDevPanelProps) {
  if (!props.enabled) return null;
  return <StarSwarmDevPanelBody {...props} />;
}

function StarSwarmDevPanelBody({
  open,
  onClose,
  canvasRef,
  options,
  onOptionsChange,
  onNewGame,
}: StarSwarmDevPanelProps) {
  const set = useCallback(
    <K extends keyof StarSwarmDevOptions>(key: K, value: StarSwarmDevOptions[K]) =>
      onOptionsChange((o) => ({ ...o, [key]: value })),
    [onOptionsChange]
  );

  const adjustVolume = (key: keyof SfxVolumes, delta: number) =>
    onOptionsChange((o) => ({
      ...o,
      volumes: {
        ...o.volumes,
        [key]: Math.round(Math.min(1, Math.max(0, o.volumes[key] + delta)) * 10) / 10,
      },
    }));

  const toggle = ([label, key]: readonly [string, SwitchKey]) => (
    <DevToggle key={key} label={label} value={options[key]} onValueChange={(v) => set(key, v)} />
  );

  return (
    <DevPanelShell
      enabled
      open={open}
      onClose={onClose}
      showButton={false}
      variant="sidebar"
      title="DEV"
      panelStyle={styles.panel}
      accessibilityLabel="Developer panel"
      accessibilityRole="menu"
    >
      <DevStepper
        label="Wave"
        value={options.wave}
        onDecrement={() => onOptionsChange((o) => ({ ...o, wave: Math.max(1, o.wave - 1) }))}
        onIncrement={() => onOptionsChange((o) => ({ ...o, wave: Math.min(15, o.wave + 1) }))}
        decrementLabel="Decrease wave"
        incrementLabel="Increase wave"
      />

      {SETUP_SWITCHES.map(toggle)}

      <DevActionButton
        label="Throw asteroid"
        accessibilityLabel="Throw asteroid"
        onPress={() => canvasRef.current?.throwAsteroid()} // #2486
      />

      {ENGINE_SWITCHES.map(toggle)}

      <DevActionButton
        label="Kill escorts"
        accessibilityLabel="Kill escorts"
        onPress={() => canvasRef.current?.killEscorts()} // #2491
      />

      <RunStatsSection open={open} canvasRef={canvasRef} />

      <DevSection title="Difficulty">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tierScroll}
          contentContainerStyle={styles.tierScrollContent}
        >
          {DIFFICULTY_TIERS.map((tier) => {
            const active = options.difficulty === tier;
            return (
              <Pressable
                key={tier}
                style={[styles.tierBtn, active && styles.tierBtnActive]}
                onPress={() => set("difficulty", tier)}
                accessibilityLabel={`Dev difficulty ${difficultyLabel(tier)}`}
              >
                <Text style={[styles.tierText, active && styles.tierTextActive]}>
                  {difficultyLabel(tier)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </DevSection>

      <DevSection title="Power-ups">
        <View style={styles.powerUpRow}>
          {POWER_UPS.map((type) => (
            <Pressable
              key={type}
              style={styles.powerUpBtn}
              onPress={() => canvasRef.current?.triggerPowerUp(type)}
              accessibilityLabel={`Trigger ${type} power-up`}
            >
              <Text style={styles.powerUpText}>{type}</Text>
            </Pressable>
          ))}
        </View>
      </DevSection>

      <DevSection title="Sound">
        {MIXER.map(([label, key]) => (
          <DevStepper
            key={key}
            label={label}
            labelStyle={styles.mixerLabel}
            value={options.volumes[key].toFixed(1)}
            onDecrement={() => adjustVolume(key, -0.1)}
            onIncrement={() => adjustVolume(key, 0.1)}
            decrementLabel={`Decrease ${label} volume`}
            incrementLabel={`Increase ${label} volume`}
          />
        ))}
      </DevSection>

      <DevActionButton
        label="New Game"
        variant="primary"
        onPress={() => {
          onClose();
          onNewGame({
            wave: options.wave,
            infiniteLives: options.infiniteLives,
            stragglerEnabled: options.stragglerEnabled,
            pauseStraggler: options.pauseStraggler,
            difficulty: options.difficulty,
          });
        }}
      />

      <DevActionButton label="Collapse" onPress={onClose} />
    </DevPanelShell>
  );
}

/** The engine's run counters (#2491), refreshed at 4 Hz while the panel is open. */
function RunStatsSection({ open, canvasRef }: Pick<StarSwarmDevPanelProps, "open" | "canvasRef">) {
  const [stats, setStats] = useState<DevStatsSnapshot | null>(null);

  // A timer, never a per-frame React update; the loop itself keeps running in the canvas.
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const s = canvasRef.current?.getState();
      setStats(s ? snapshotStats(s) : null);
    };
    read();
    const id = setInterval(read, DEV_STATS_POLL_MS);
    return () => clearInterval(id);
  }, [open, canvasRef]);

  return (
    <DevSection title="Run stats">
      {stats ? (
        <View accessibilityLabel="Run stats">
          <Text style={styles.mono}>
            {`wave ${stats.wave} · ${stats.difficulty} · score ${stats.score}`}
          </Text>
          <Text style={styles.mono}>{TIER_TABLE_HEADER}</Text>
          {stats.rows.map((row) => (
            <Text key={row.tier} style={styles.mono}>
              {tierTableLine(row)}
            </Text>
          ))}
          {RUN_STAT_LINES.map(([label, key]) => (
            <DevRow key={key} label={label} value={stats.run[key]} />
          ))}
        </View>
      ) : (
        <DevRow label="Start a game to see counters" />
      )}
    </DevSection>
  );
}

const styles = StyleSheet.create({
  panel: {
    bottom: 0,
    width: 180,
    borderLeftColor: DEV_ACCENT_BORDER_SOFT,
    zIndex: 100,
    paddingVertical: 8,
  },
  mono: {
    color: "#fff",
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  mixerLabel: {
    fontSize: 11,
    minWidth: 80,
  },
  powerUpRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  powerUpBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: DEV_GOLD_BG,
    borderWidth: 1,
    borderColor: DEV_GOLD_BORDER,
  },
  powerUpText: {
    color: "#ffc800",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  tierScroll: {
    marginVertical: 2,
  },
  tierScrollContent: {
    gap: 6,
    paddingVertical: 2,
  },
  tierBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: DEV_SURFACE_FAINT,
    borderWidth: 1,
    borderColor: DEV_SURFACE_BORDER,
  },
  tierBtnActive: {
    backgroundColor: DEV_ACCENT_SELECTED_BG,
    borderColor: DEV_ACCENT_SELECTED_BORDER,
  },
  tierText: {
    color: DEV_TEXT_DIM,
    fontSize: 9,
    fontWeight: "700",
  },
  tierTextActive: {
    color: DEV_ACCENT,
  },
});
