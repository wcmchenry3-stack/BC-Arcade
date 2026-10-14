/**
 * The game event registry (#3278): its shape, and that the recorder's caps are
 * derived from it. The cross-language half (every type seeded and validated
 * on the backend) is backend/tests/test_event_registry_contract.py.
 */
import { GAME_TYPES } from "../../../api/vocab";
import {
  DEFAULT_RECORDING_CONFIG,
  gameEventRegistry,
  gameRecordingConfigs,
  logConfig,
  recordingConfigFor,
  recordingEventCap,
  Priority,
  WAVE_STATS_MAX_BYTES,
  WAVE_STATS_RUN_MAX_BYTES,
} from "../eventQueueConfig";

const TIERS: readonly Priority[] = [Priority.LIFECYCLE, Priority.MID, Priority.GRANULAR];

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

  it("holds each type's tier equal to the queue's priorityForEvent (until #3276 moves it)", () => {
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
    expect(recordingEventCap(ss, "game_started")).toBe(
      DEFAULT_RECORDING_CONFIG.defaultEventMaxBytes
    );
  });

  it("derives a config only for a game whose entry overrides something", () => {
    expect(Object.keys(gameRecordingConfigs)).toEqual(["starswarm"]);
    expect(recordingConfigFor("daily_word")).toBe(DEFAULT_RECORDING_CONFIG);
  });
});
