/**
 * The game event registry (#3278): its shape, and that the recorder's caps are
 * derived from it. The cross-language half (every type seeded and validated
 * on the backend) is backend/tests/test_event_registry_contract.py.
 */
import { GAME_TYPES } from "../../../api/vocab";
import {
  DEFAULT_RECORDING_CONFIG,
  gameEventRegistry,
  type EventTypeSpec,
  gameRecordingConfigs,
  logConfig,
  recordingConfigFor,
  recordingEventCap,
  Priority,
  WAVE_STATS_MAX_BYTES,
  WAVE_STATS_RUN_MAX_BYTES,
} from "../eventQueueConfig";

const TIERS: readonly Priority[] = [
  Priority.LIFECYCLE,
  Priority.MID,
  Priority.GRANULAR,
  Priority.REPLAY,
];

describe("gameEventRegistry", () => {
  it("has an entry for every game type, and no other", () => {
    expect(Object.keys(gameEventRegistry).sort()).toEqual([...GAME_TYPES].sort());
  });

  it.each(GAME_TYPES)("%s registers the two lifecycle events", (game) => {
    const events = gameEventRegistry[game].events;
    expect(events.game_started?.tier).toBe(Priority.LIFECYCLE);
    expect(events.game_ended?.tier).toBe(Priority.LIFECYCLE);
  });

  it("gives every type a queue tier, and none the bug-log tier", () => {
    for (const game of GAME_TYPES) {
      for (const [name, spec] of Object.entries(gameEventRegistry[game].events)) {
        expect({ game, name, ok: TIERS.includes(spec.tier) }).toEqual({ game, name, ok: true });
      }
    }
  });

  it("reads the queue priority of a registered type from the registry (#3276)", () => {
    for (const game of GAME_TYPES) {
      for (const [name, spec] of Object.entries(gameEventRegistry[game].events)) {
        expect({ game, name, tier: logConfig.priorityForEvent("game_event", name) }).toEqual({
          game,
          name,
          tier: spec.tier,
        });
      }
    }
  });

  it("gives a type the same tier in every game that registers it", () => {
    const seen = new Map<string, Priority>();
    for (const game of GAME_TYPES) {
      for (const [name, spec] of Object.entries(gameEventRegistry[game].events)) {
        const before = seen.get(name);
        if (before !== undefined) expect({ name, tier: spec.tier }).toEqual({ name, tier: before });
        seen.set(name, spec.tier);
      }
    }
  });

  it("keeps today's priority for an unknown type, no type, and a bug log", () => {
    expect(logConfig.priorityForEvent("game_event", "not_registered")).toBe(Priority.GRANULAR);
    expect(logConfig.priorityForEvent("game_event")).toBe(Priority.MID);
    expect(logConfig.priorityForEvent("bug_log")).toBe(Priority.BUG_LOG);
    expect(logConfig.priorityForEvent("bug_log", "roll")).toBe(Priority.BUG_LOG);
  });

  // The mapping #3276 pins: a type that rebuilds a game is REPLAY, the lifecycle
  // names LIFECYCLE. A new gameplay type must be added here too.
  const REPLAY_TYPES: Readonly<Record<string, readonly string[]>> = {
    yacht: ["roll", "score"],
    twenty48: ["move"],
    blackjack: ["bet_placed", "hand_dealt", "player_action", "round_played"],
    cascade: ["drop", "merge"],
    starswarm: ["wave_completed"],
  };

  it.each(GAME_TYPES)("%s: its gameplay types are replay, the rest lifecycle", (game) => {
    const replay = REPLAY_TYPES[game] ?? [];
    const events = gameEventRegistry[game].events as Record<string, { tier: Priority }>;
    for (const [name, spec] of Object.entries(events)) {
      const expected = replay.includes(name) ? Priority.REPLAY : Priority.LIFECYCLE;
      expect({
        game,
        name,
        tier: spec.tier,
        queued: logConfig.priorityForEvent("game_event", name),
      }).toEqual({ game, name, tier: expected, queued: expected });
    }
    for (const name of replay) expect(events[name]).toBeDefined();
  });

  it("holds every cap under the queue's per-row cap", () => {
    for (const game of GAME_TYPES) {
      for (const [name, spec] of Object.entries(gameEventRegistry[game].events)) {
        const cap = recordingEventCap(recordingConfigFor(game), name);
        expect({ game, name, ok: cap <= logConfig.MAX_EVENT_PAYLOAD_BYTES }).toEqual({
          game,
          name,
          ok: true,
        });
        if (spec.maxBytes !== undefined) expect(spec.maxBytes).toBeGreaterThan(0);
      }
    }
  });

  it("opts out of the envelope only Star Swarm's wave_completed, never together with chunking", () => {
    const bare: string[] = [];
    for (const game of GAME_TYPES) {
      const events = gameEventRegistry[game].events as Record<string, EventTypeSpec>;
      for (const [name, spec] of Object.entries(events)) {
        if (spec.envelope === undefined) continue;
        expect(spec.envelope).toBe(false);
        expect(spec.chunkField).toBeUndefined();
        bare.push(`${game}.${name}`);
      }
    }
    expect(bare).toEqual(["starswarm.wave_completed"]);
  });

  it("names a chunk field only as a non-empty string", () => {
    for (const game of GAME_TYPES) {
      for (const spec of Object.values(gameEventRegistry[game].events)) {
        if (spec.chunkField !== undefined) expect(spec.chunkField.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("recording caps derived from the registry", () => {
  it("gives Star Swarm its wave caps", () => {
    const ss = recordingConfigFor("starswarm");
    expect(ss.sessionMaxBytes).toBe(WAVE_STATS_RUN_MAX_BYTES);
    expect(ss.events.wave_completed?.maxBytes).toBe(WAVE_STATS_MAX_BYTES);
    expect(recordingEventCap(ss, "wave_completed")).toBe(WAVE_STATS_MAX_BYTES);
    // its payload is the backend's versioned wire contract: no recorder envelope (#3280)
    expect(ss.events.wave_completed?.envelope).toBe(false);
    expect(recordingEventCap(ss, "game_started")).toBe(
      DEFAULT_RECORDING_CONFIG.defaultEventMaxBytes
    );
  });

  it("derives a config only for a game whose entry overrides something", () => {
    expect(Object.keys(gameRecordingConfigs)).toEqual(["blackjack", "starswarm"]);
    expect(recordingConfigFor("daily_word")).toBe(DEFAULT_RECORDING_CONFIG);
  });
});
