/**
 * #3526: which sound each Star Swarm event plays, and when the loops may sound.
 * `useSound` / `useLoopSound` are replaced by per-key spies.
 */
import { act, renderHook } from "@testing-library/react-native";
import { DEFAULT_SFX_VOLUMES, useStarSwarmAudio } from "../useStarSwarmAudio";
import type { CarrierEvent, UpgradeEvent } from "../../game/starswarm/types";

const plays: Record<string, jest.Mock> = {};
const loops: Record<string, { start: jest.Mock; stop: jest.Mock }> = {};
const soundVolumes: Record<string, number> = {};

jest.mock("../../game/_shared/useBackgroundMusic", () => ({ useBackgroundMusic: jest.fn() }));
jest.mock("../../game/_shared/useSound", () => ({
  useSound: (key: string, _registry: unknown, volume: number) => {
    soundVolumes[key] = volume;
    plays[key] ??= jest.fn();
    return { play: plays[key], stop: jest.fn() };
  },
}));
jest.mock("../../game/_shared/useLoopSound", () => ({
  useLoopSound: (key: string, _registry: unknown, volume: number) => {
    soundVolumes[key] = volume;
    loops[key] ??= { start: jest.fn(), stop: jest.fn() };
    return loops[key];
  },
}));

beforeEach(() => {
  for (const m of Object.values(plays)) m.mockClear();
  for (const l of Object.values(loops)) {
    l.start.mockClear();
    l.stop.mockClear();
  }
});

const calledKeys = () =>
  Object.entries(plays)
    .filter(([, m]) => m.mock.calls.length > 0)
    .map(([k]) => k)
    .sort();

const upgrade = (kind: UpgradeEvent["kind"], guns: 1 | 2 | 3): UpgradeEvent => ({
  kind,
  guns,
  hull: 0,
});

describe("playUpgrade", () => {
  it.each([
    [1, "starswarm.guns1"],
    [2, "starswarm.guns2"],
    [3, "starswarm.guns3"],
  ] as const)(
    "gunsUp to level %i plays the riff for the new level and the pickup",
    async (level, key) => {
      const { result } = await renderHook(() => useStarSwarmAudio(true));
      result.current.playUpgrade(upgrade("gunsUp", level));
      // the crate's pickup sound (salvage key) and the riff, on the same tick
      expect(calledKeys()).toEqual([key, "starswarm.salvage"].sort());
    }
  );

  it.each([
    [1, "starswarm.guns1"],
    [2, "starswarm.guns2"],
  ] as const)("gunsDown to level %i plays the riff for the new level alone", async (level, key) => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playUpgrade(upgrade("gunsDown", level));
    expect(calledKeys()).toEqual([key]);
  });

  it("hullUp plays the pickup sound (hullup key); hullHit its own sting", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playUpgrade(upgrade("hullUp", 1));
    expect(calledKeys()).toEqual(["starswarm.hullup"]);
    Object.values(plays).forEach((m) => m.mockClear());
    result.current.playUpgrade(upgrade("hullHit", 1));
    expect(calledKeys()).toEqual(["starswarm.hullhit"]);
  });
});

describe("playCarrierEvent", () => {
  it.each([
    ["beamCharge", "starswarm.beamcharge"],
    ["attackRun", "starswarm.attackrun"],
    ["beamFire", "starswarm.beamfire"],
    ["finalStand", "starswarm.bosswave"],
    ["reinforce", "starswarm.reinforce"],
  ] as [CarrierEvent, string][])("%s plays only %s", async (kind, key) => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playCarrierEvent(kind);
    expect(calledKeys()).toEqual([key]);
  });
});

describe("pickup and blast", () => {
  it.each([
    ["lightning", "starswarm.poweruplightning"],
    ["shield", "starswarm.powerupshield"],
    ["buddy", "starswarm.powerupbuddy"],
    ["bomb", "starswarm.powerupbomb"],
  ] as const)("collecting %s plays the pickup sound (%s)", async (type, key) => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playPowerUpCollect(type);
    expect(calledKeys()).toEqual([key]);
  });

  it("playBombBlast plays the blast sound and not the generic explosion", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playBombBlast();
    expect(calledKeys()).toEqual(["starswarm.bombblast"]);
  });

  it("the rout no longer has a one-shot sting", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    expect("playRout" in result.current).toBe(false);
  });
});

describe("volumes", () => {
  it("the new keys use their defaults; the three riffs share the guns volume; overrides apply", async () => {
    await renderHook(() => useStarSwarmAudio(true, { guns: 0.3, shieldloop: 0.1 }));
    expect(soundVolumes["starswarm.bombblast"]).toBe(DEFAULT_SFX_VOLUMES.bombblast);
    expect(soundVolumes["starswarm.attackrun"]).toBe(DEFAULT_SFX_VOLUMES.attackrun);
    expect(soundVolumes["starswarm.buddyloop"]).toBe(0.25);
    expect(soundVolumes["starswarm.rout"]).toBe(0.5);
    for (const n of [1, 2, 3]) expect(soundVolumes[`starswarm.guns${n}`]).toBe(0.3);
    expect(soundVolumes["starswarm.shieldloop"]).toBe(0.1);
  });
});

describe("loops", () => {
  const start = (k: string) => loops[k]!.start;
  const stop = (k: string) => loops[k]!.stop;
  const lastCall = (k: string) =>
    start(k).mock.invocationCallOrder.at(-1)! > (stop(k).mock.invocationCallOrder.at(-1) ?? 0)
      ? "start"
      : "stop";

  type Props = { active: boolean; tick: number; paused: boolean };
  const setup = (props: Props = { active: true, tick: 1, paused: false }) =>
    renderHook((p: Props) => useStarSwarmAudio(p.active, undefined, p.tick, p.paused), {
      initialProps: props,
    });

  it.each([
    ["shield", "starswarm.shieldloop"],
    ["buddy", "starswarm.buddyloop"],
    ["rout", "starswarm.rout"],
  ] as const)("%s: starts on the rising edge and stops on the falling edge", async (name, key) => {
    const { result } = await setup();
    await act(() => result.current.setLoop(name, true));
    expect(lastCall(key)).toBe("start");
    await act(() => result.current.setLoop(name, false));
    expect(lastCall(key)).toBe("stop");
  });

  it("pausing stops every loop; unpausing resumes only those whose condition still holds", async () => {
    const { result, rerender } = await setup();
    await act(() => {
      result.current.setLoop("shield", true);
      result.current.setLoop("buddy", true);
    });
    await rerender({ active: true, tick: 1, paused: true });
    expect(lastCall("starswarm.shieldloop")).toBe("stop");
    expect(lastCall("starswarm.buddyloop")).toBe("stop");
    // the shield ends while paused (the canvas still reports the edge)
    await act(() => result.current.setLoop("shield", false));
    start("starswarm.buddyloop").mockClear();
    start("starswarm.shieldloop").mockClear();
    await rerender({ active: true, tick: 1, paused: false });
    expect(start("starswarm.buddyloop")).toHaveBeenCalled();
    expect(start("starswarm.shieldloop")).not.toHaveBeenCalled();
  });

  it("a condition that rises while paused does not sound until unpause", async () => {
    const { result, rerender } = await setup({ active: true, tick: 1, paused: true });
    await act(() => result.current.setLoop("rout", true));
    expect(start("starswarm.rout")).not.toHaveBeenCalled();
    await rerender({ active: true, tick: 1, paused: false });
    expect(lastCall("starswarm.rout")).toBe("start");
  });

  it("game over stops every loop and they stay off", async () => {
    const { result, rerender } = await setup();
    await act(() => result.current.setLoop("rout", true));
    await rerender({ active: false, tick: 1, paused: false });
    expect(lastCall("starswarm.rout")).toBe("stop");
    start("starswarm.rout").mockClear();
    await act(() => result.current.setLoop("rout", true));
    expect(start("starswarm.rout")).not.toHaveBeenCalled();
  });

  it("a new run clears every condition, so a restart from game over starts silent", async () => {
    const { result, rerender } = await setup();
    await act(() => {
      result.current.setLoop("shield", true);
      result.current.setLoop("buddy", true);
    });
    await rerender({ active: false, tick: 1, paused: false });
    start("starswarm.shieldloop").mockClear();
    start("starswarm.buddyloop").mockClear();
    await rerender({ active: true, tick: 2, paused: false });
    expect(start("starswarm.shieldloop")).not.toHaveBeenCalled();
    expect(start("starswarm.buddyloop")).not.toHaveBeenCalled();
    expect(lastCall("starswarm.shieldloop")).toBe("stop");
  });
});
