/**
 * Type-level guard for the event registry (#3278). This lives under tooling/
 * because `npm run typecheck` compiles tooling/** tests (it skips src/**
 * tests): the `@ts-expect-error` lines below fail the typecheck if an
 * unregistered event type, or one registered for another game, ever compiles
 * again.
 */
import type { EnqueueEventInput } from "../../../src/game/_shared/gameEventClient";
import type { GameRecorder } from "../../../src/game/_shared/gameRecorder";
import type { EventTypeOf, RegisteredEventType } from "../../../src/game/_shared/eventQueueConfig";
import type { useGameSync } from "../../../src/game/_shared/useGameSync";
import type { useGameRecorder } from "../../../src/game/_shared/useGameRecorder";

// What `useGameSync("yacht")` / `useGameRecorder("yacht")` return (the literal is inferred).
type YachtSync = ReturnType<typeof useGameSync<"yacht">>;
type YachtHook = ReturnType<typeof useGameRecorder<"yacht">>;

describe("RegisteredEventType / EventTypeOf", () => {
  it("accepts registered names and rejects any other literal at compile time", () => {
    const ok: EnqueueEventInput = { type: "wave_completed" };
    const lifecycle: RegisteredEventType = "game_started";
    // @ts-expect-error not in gameEventRegistry
    const bad: EnqueueEventInput = { type: "new_event" };
    // @ts-expect-error not in gameEventRegistry
    const badName: RegisteredEventType = "card_played";
    const record: GameRecorder["record"] = () => undefined;
    record("roll");
    // @ts-expect-error not in gameEventRegistry
    record("new_event");
    expect([ok.type, lifecycle, bad.type, badName]).toHaveLength(4);
  });

  it("narrows to the game: another game's event does not compile", () => {
    const sync = {} as YachtSync;
    const hook = {} as YachtHook;
    const yachtRecorder = {} as GameRecorder<"yacht">;
    const roll: EventTypeOf<"yacht"> = "roll";
    // @ts-expect-error wave_completed is Star Swarm's
    const wave: EventTypeOf<"yacht"> = "wave_completed";
    const calls = [
      () => sync.enqueue({ type: "roll" }),
      // @ts-expect-error wave_completed is Star Swarm's
      () => sync.enqueue({ type: "wave_completed" }),
      // @ts-expect-error wave_completed is Star Swarm's
      () => sync.enqueueMany([{ type: "wave_completed" }]),
      () => yachtRecorder.record("score"),
      // @ts-expect-error wave_completed is Star Swarm's
      () => yachtRecorder.record("wave_completed"),
      // @ts-expect-error wave_completed is Star Swarm's
      () => hook.record("wave_completed"),
    ];
    expect([roll, wave, calls]).toHaveLength(3);
  });

  it("falls back to every game's names for a widened game type", () => {
    const any: EventTypeOf = "wave_completed";
    expect(any).toBe("wave_completed");
  });
});
