/**
 * Type-level guard for the event registry (#3278). This lives under tooling/
 * because `npm run typecheck` compiles tooling/** tests (it skips src/**
 * tests): the `@ts-expect-error` lines below fail the typecheck if an
 * unregistered event type ever compiles again.
 */
import type { EnqueueEventInput } from "../../../src/game/_shared/gameEventClient";
import type { GameRecorder } from "../../../src/game/_shared/gameRecorder";
import type { RegisteredEventType } from "../../../src/game/_shared/eventQueueConfig";

describe("RegisteredEventType", () => {
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
});
