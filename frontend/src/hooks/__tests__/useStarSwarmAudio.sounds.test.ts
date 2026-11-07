/**
 * #3526: which sound each Star Swarm event plays, and when the loops may sound.
 * `useSound` / `useLoopSound` are replaced by per-key spies.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useBackgroundMusic } from "../../game/_shared/useBackgroundMusic";
import { DEFAULT_SFX_VOLUMES, useStarSwarmAudio } from "../useStarSwarmAudio";
import type { CarrierEvent, UpgradeEvent } from "../../game/starswarm/types";

const mockUseBackgroundMusic = useBackgroundMusic as jest.Mock;
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
    "gunsUp to level %i plays the riff for the new level only (the pickup comes from the collection)",
    async (level, key) => {
      const { result } = await renderHook(() => useStarSwarmAudio(true));
      result.current.playUpgrade(upgrade("gunsUp", level));
      expect(calledKeys()).toEqual([key]);
    }
  );

  it.each([
    [1, "starswarm.gunsdown1"],
    [2, "starswarm.gunsdown2"],
  ] as const)(
    "gunsDown to level %i plays the falling level-down riff alone (#3560)",
    async (level, key) => {
      const { result } = await renderHook(() => useStarSwarmAudio(true));
      result.current.playUpgrade(upgrade("gunsDown", level));
      expect(calledKeys()).toEqual([key]);
    }
  );

  it("hullUp plays nothing itself (its pickup sound comes from the collection); hullHit its sting", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playUpgrade(upgrade("hullUp", 1));
    expect(calledKeys()).toEqual([]);
    result.current.playUpgrade(upgrade("hullHit", 1));
    expect(calledKeys()).toEqual(["starswarm.hullhit"]);
  });

  it("a crate below the top: pickup once (collection) plus the riff once (upgrade)", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playPowerUpCollect("salvage");
    result.current.playUpgrade(upgrade("gunsUp", 2));
    expect(calledKeys()).toEqual(["starswarm.guns2", "starswarm.salvage"]);
    expect(plays["starswarm.salvage"]!).toHaveBeenCalledTimes(1);
    expect(plays["starswarm.guns2"]!).toHaveBeenCalledTimes(1);
  });

  it("a crate at the top: the collection alone sounds the pickup (no upgrade event fires)", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playPowerUpCollect("salvage");
    expect(calledKeys()).toEqual(["starswarm.salvage"]);
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
    ["salvage", "starswarm.salvage"],
    ["hull", "starswarm.hullup"],
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

  it.each([
    ["shieldOn", "starswarm.shieldon"],
    ["shieldWarn", "starswarm.shieldwarn"],
    ["shieldOff", "starswarm.shieldoff"],
    ["buddyIn", "starswarm.buddyin"],
    ["buddyOut", "starswarm.buddyout"],
  ] as const)("the %s cue plays only %s (#3560)", async (cue, key) => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playCue(cue);
    expect(calledKeys()).toEqual([key]);
  });

  it("playBuddyDown plays its own sound and not the generic explosion (#3560)", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    result.current.playBuddyDown();
    expect(calledKeys()).toEqual(["starswarm.buddydown"]);
  });

  it("the per-shot laser is retired (#3560)", async () => {
    const { result } = await renderHook(() => useStarSwarmAudio(true));
    expect("playLaser" in result.current).toBe(false);
    expect(plays["starswarm.laser"]).toBeUndefined();
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
    expect(soundVolumes["starswarm.buddyloop"]).toBe(0.7);
    expect(soundVolumes["starswarm.rout"]).toBe(0.5);
    for (const n of [1, 2, 3]) expect(soundVolumes[`starswarm.guns${n}`]).toBe(0.3);
    expect(soundVolumes["starswarm.shieldloop"]).toBe(0.1);
    // #3560: the Shield and Buddy parts, and the Lightning loop
    for (const [k, vol] of Object.entries({
      shieldon: 0.8,
      shieldwarn: 0.8,
      shieldoff: 0.8,
      buddyin: 0.7,
      buddyout: 0.7,
      buddydown: 0.8,
      lightningloop: 0.7,
      asteroidsplit: 0.5,
      asteroidsmall: 0.5,
    })) {
      expect(soundVolumes[`starswarm.${k}`]).toBe(vol);
    }
    // every pickup key shares one file and one default volume
    for (const k of ["poweruplightning", "powerupshield", "powerupbuddy", "powerupbomb"]) {
      expect(soundVolumes[`starswarm.${k}`]).toBe(0.8);
    }
  });
});

describe("loops", () => {
  const start = (k: string) => loops[k]!.start;
  const stop = (k: string) => loops[k]!.stop;
  const lastCall = (k: string) =>
    start(k).mock.invocationCallOrder.at(-1)! > (stop(k).mock.invocationCallOrder.at(-1) ?? 0)
      ? "start"
      : "stop";

  type Props = { active: boolean; tick: number; paused: boolean; held?: boolean };
  const setup = (props: Props = { active: true, tick: 1, paused: false }) =>
    renderHook((p: Props) => useStarSwarmAudio(p.active, undefined, p.tick, p.paused, p.held), {
      initialProps: props,
    });

  it.each([
    ["shield", "starswarm.shieldloop"],
    ["buddy", "starswarm.buddyloop"],
    ["rout", "starswarm.rout"],
    ["lightning", "starswarm.lightningloop"],
  ] as const)("%s: starts on the rising edge and stops on the falling edge", async (name, key) => {
    const { result } = await setup();
    await act(() => result.current.setLoop(name, true));
    expect(lastCall(key)).toBe("start");
    await act(() => result.current.setLoop(name, false));
    expect(lastCall(key)).toBe("stop");
  });

  it("the lightning loop obeys pause, the picker hold, game over and a new run like the others (#3560)", async () => {
    const key = "starswarm.lightningloop";
    const base = { active: true, tick: 1, paused: false };
    const { result, rerender } = await setup();
    await act(() => result.current.setLoop("lightning", true));
    expect(lastCall(key)).toBe("start");
    await rerender({ ...base, paused: true });
    expect(lastCall(key)).toBe("stop");
    await rerender(base);
    expect(lastCall(key)).toBe("start");
    await rerender({ ...base, held: true });
    expect(lastCall(key)).toBe("stop");
    await rerender(base);
    expect(lastCall(key)).toBe("start");
    await rerender({ ...base, active: false });
    expect(lastCall(key)).toBe("stop");
    start(key).mockClear();
    await act(() => result.current.setLoop("lightning", true));
    expect(start(key)).not.toHaveBeenCalled();
    // a new run forgets the condition
    await rerender({ active: true, tick: 2, paused: false });
    expect(start(key)).not.toHaveBeenCalled();
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

  it("loopsHeld (the difficulty picker over a live run) stops the loops; closing it resumes only those still wanted; the music is untouched", async () => {
    const { result, rerender } = await setup();
    await act(() => {
      result.current.setLoop("shield", true);
      result.current.setLoop("buddy", true);
    });
    const base = { active: true, tick: 1, paused: false };
    await rerender({ ...base, held: true });
    expect(lastCall("starswarm.shieldloop")).toBe("stop");
    expect(lastCall("starswarm.buddyloop")).toBe("stop");
    // the music hook still gets paused=false, active=true
    expect(mockUseBackgroundMusic).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.any(Object),
      true,
      1,
      false
    );
    await act(() => result.current.setLoop("shield", false)); // ends while held
    start("starswarm.shieldloop").mockClear();
    start("starswarm.buddyloop").mockClear();
    await rerender({ ...base, held: false });
    expect(start("starswarm.buddyloop")).toHaveBeenCalled();
    expect(start("starswarm.shieldloop")).not.toHaveBeenCalled();
  });
});
