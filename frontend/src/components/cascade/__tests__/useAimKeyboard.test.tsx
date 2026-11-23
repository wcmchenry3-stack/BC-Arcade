/**
 * #3934: keyboard aiming (web). The hook writes the drag's aim shared values and drops through the
 * screen's drop path. Keys come in through `attach`, a fake DOM node here.
 */
import { act, renderHook } from "@testing-library/react-native";
import { Platform } from "react-native";
import { AIM_STATE } from "../../../game/cascade/aim";
import { WALL_THICKNESS, WORLD_WIDTH } from "../../../game/cascade/constants";
import { SPAWNER } from "../../../game/cascade/lidVisuals";
import { MOTION } from "../../../game/cascade/motion";
import { useBoardMotion } from "../useBoardMotion";
import { aimKeyStepX, useAimKeyboard, type AimKeyEvent } from "../useAimKeyboard";

const A = MOTION.aim;

function key(k: string, extra: Partial<AimKeyEvent> = {}): AimKeyEvent & { prevented: boolean } {
  const e = {
    key: k,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...extra,
  };
  return e;
}

async function mount(opts: { enabled?: boolean; web?: boolean } = {}) {
  jest.replaceProperty(Platform, "OS", opts.web === false ? "ios" : "web");
  const motion = (await renderHook(() => useBoardMotion(false))).result.current;
  const onDrop = jest.fn();
  const hook = await renderHook(
    (p: { enabled: boolean }) =>
      useAimKeyboard({ values: motion.values, wake: motion.wake, enabled: p.enabled, onDrop }),
    { initialProps: { enabled: opts.enabled ?? true } }
  );
  const press = (e: AimKeyEvent) => act(() => hook.result.current.handleKey(e));
  return { motion, v: motion.values, onDrop, hook, press };
}

afterEach(() => jest.restoreAllMocks());

describe("aimKeyStepX", () => {
  it("steps and clamps between the walls", () => {
    expect(aimKeyStepX(200, 1, false)).toBe(200 + A.keyStep);
    expect(aimKeyStepX(200, -1, true)).toBe(200 - A.keyStepBig);
    expect(aimKeyStepX(WALL_THICKNESS + 2, -1, true)).toBe(WALL_THICKNESS);
    expect(aimKeyStepX(WORLD_WIDTH - WALL_THICKNESS - 2, 1, true)).toBe(
      WORLD_WIDTH - WALL_THICKNESS
    );
  });
});

describe("useAimKeyboard", () => {
  it("the first arrow starts aiming from the spawner's centre, one step on", async () => {
    const m = await mount();
    const e = key("ArrowRight");
    await m.press(e);
    expect(m.v.aimState.value).toBe(AIM_STATE.aiming);
    expect(m.v.aimX.value).toBe(SPAWNER.cx + A.keyStep);
    expect(e.prevented).toBe(true);
    await m.press(key("ArrowLeft"));
    await m.press(key("ArrowLeft"));
    expect(m.v.aimX.value).toBe(SPAWNER.cx - A.keyStep);
  });

  it("Shift steps bigger, and the aim clamps at the walls", async () => {
    const m = await mount();
    await m.press(key("ArrowRight", { shiftKey: true }));
    expect(m.v.aimX.value).toBe(SPAWNER.cx + A.keyStepBig);
    for (let i = 0; i < 20; i++) await m.press(key("ArrowRight", { shiftKey: true }));
    expect(m.v.aimX.value).toBe(WORLD_WIDTH - WALL_THICKNESS);
    for (let i = 0; i < 20; i++) await m.press(key("ArrowLeft", { shiftKey: true }));
    expect(m.v.aimX.value).toBe(WALL_THICKNESS);
  });

  it.each([" ", "Enter"])("%j drops at the moved x through the drop path", async (k) => {
    const m = await mount();
    await m.press(key("ArrowRight"));
    await m.press(key("ArrowRight"));
    await m.press(key(k));
    expect(m.onDrop).toHaveBeenCalledTimes(1);
    expect(m.onDrop).toHaveBeenCalledWith(SPAWNER.cx + 2 * A.keyStep);
    expect(m.v.aimState.value).toBe(AIM_STATE.released);
  });

  it("Space with no aim drops in the middle, as the accessibility action does", async () => {
    const m = await mount();
    await m.press(key(" "));
    expect(m.onDrop).toHaveBeenCalledWith(SPAWNER.cx);
    expect(m.v.aimState.value).toBe(AIM_STATE.idle);
  });

  it("a held Space drops once", async () => {
    const m = await mount();
    await m.press(key(" "));
    await m.press(key(" ", { repeat: true }));
    expect(m.onDrop).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels the aim: the piece glides back and nothing drops", async () => {
    const m = await mount();
    await m.press(key("ArrowLeft"));
    const e = key("Escape");
    await m.press(e);
    expect(m.v.aimState.value).toBe(AIM_STATE.cancelled);
    expect(m.v.aimFromX.value).toBe(SPAWNER.cx - A.keyStep);
    expect(e.prevented).toBe(true);
    await m.press(key(" "));
    expect(m.onDrop).toHaveBeenCalledTimes(1); // only the unaimed middle drop
    expect(m.onDrop).toHaveBeenCalledWith(SPAWNER.cx);
  });

  it("Escape with no aim does nothing and is left to the page", async () => {
    const m = await mount();
    const e = key("Escape");
    await m.press(e);
    expect(e.prevented).toBe(false);
    expect(m.v.aimState.value).toBe(AIM_STATE.idle);
  });

  it("ignores every key when play is disabled (game over)", async () => {
    const m = await mount({ enabled: false });
    for (const k of ["ArrowLeft", "ArrowRight", " ", "Enter", "Escape"]) await m.press(key(k));
    expect(m.v.aimState.value).toBe(AIM_STATE.idle);
    expect(m.onDrop).not.toHaveBeenCalled();
  });

  it("game over while aiming drops the aim", async () => {
    const m = await mount();
    await m.press(key("ArrowRight"));
    await m.hook.rerender({ enabled: false });
    expect(m.v.aimState.value).toBe(AIM_STATE.cancelled);
  });

  it("ignores modified keys and other keys", async () => {
    const m = await mount();
    await m.press(key("ArrowLeft", { ctrlKey: true }));
    await m.press(key("ArrowLeft", { metaKey: true }));
    await m.press(key("a"));
    expect(m.v.aimState.value).toBe(AIM_STATE.idle);
  });

  it("leaves a pointer's aim alone", async () => {
    const m = await mount();
    m.v.aimState.set(AIM_STATE.aiming);
    m.v.aimX.set(100);
    await m.press(key("ArrowRight"));
    await m.press(key("Escape"));
    expect(m.v.aimX.value).toBe(100);
    expect(m.v.aimState.value).toBe(AIM_STATE.aiming);
  });

  // B1: the keyboard's aim goes stale when a pointer takes over.
  describe("a pointer takes over from the keyboard", () => {
    it("A: key aim, then a mouse drag and release: the next arrow starts again from the centre", async () => {
      const m = await mount();
      await m.press(key("ArrowRight"));
      m.v.aimState.set(AIM_STATE.aiming); // the drag
      m.v.aimX.set(320);
      m.v.aimState.set(AIM_STATE.released); // the release
      await m.press(key("ArrowLeft"));
      expect(m.v.aimState.value).toBe(AIM_STATE.aiming);
      expect(m.v.aimX.value).toBe(SPAWNER.cx - A.keyStep);
    });

    it("B: key aim, then a drag in progress: arrows leave the pointer's aim alone", async () => {
      const m = await mount();
      await m.press(key("ArrowRight"));
      m.v.aimX.set(320); // the drag moved the aim
      const e = key("ArrowRight");
      await m.press(e);
      expect(m.v.aimX.value).toBe(320);
      expect(e.prevented).toBe(true);
      await m.press(key("Escape"));
      expect(m.v.aimState.value).toBe(AIM_STATE.aiming);
    });

    it("C: key aim, then a mouse tap: Space drops in the middle, not at the mouse x", async () => {
      const m = await mount();
      await m.press(key("ArrowRight"));
      m.v.aimX.set(320);
      m.v.aimState.set(AIM_STATE.pressed);
      m.v.aimState.set(AIM_STATE.idle); // the tap ended
      await m.press(key(" "));
      expect(m.onDrop).toHaveBeenCalledWith(SPAWNER.cx);
    });

    it("Escape after a pointer aim does nothing", async () => {
      const m = await mount();
      await m.press(key("ArrowRight"));
      m.v.aimX.set(320);
      m.v.aimState.set(AIM_STATE.released);
      const e = key("Escape");
      await m.press(e);
      expect(e.prevented).toBe(false);
      expect(m.v.aimState.value).toBe(AIM_STATE.released);
    });
  });

  it("N1: Space and the arrows are still kept from scrolling the page when disabled", async () => {
    const m = await mount({ enabled: false });
    const e = key(" ");
    await m.press(e);
    expect(e.prevented).toBe(true);
    expect(m.onDrop).not.toHaveBeenCalled();
  });

  it("S1: a handled key shows the focus ring after a mouse focus", async () => {
    const m = await mount();
    expect(m.hook.result.current.focusVisible).toBe(false);
    await m.press(key("ArrowLeft"));
    expect(m.hook.result.current.focusVisible).toBe(true);
  });

  it("a refused drop is the drop path's call (the area glides the piece back)", async () => {
    const m = await mount();
    m.onDrop.mockReturnValue(false);
    await m.press(key("ArrowRight"));
    await m.press(key("Enter"));
    expect(m.onDrop).toHaveBeenCalledWith(SPAWNER.cx + A.keyStep);
  });

  describe("attach (the DOM node)", () => {
    function fakeNode() {
      const l: Record<string, (e: never) => void> = {};
      return {
        l,
        attrs: {} as Record<string, string>,
        addEventListener: (t: string, f: (e: never) => void) => void (l[t] = f),
        removeEventListener: jest.fn((t: string) => void delete l[t]),
        setAttribute(n: string, v: string) {
          this.attrs[n] = v;
        },
        matches: jest.fn(() => true),
      };
    }

    it("routes keydown, shows the ring on keyboard focus and cancels the aim on blur", async () => {
      const m = await mount();
      const node = fakeNode();
      await act(() => m.hook.result.current.attach(node));
      expect(node.attrs["aria-keyshortcuts"]).toContain("Escape");
      await act(() => node.l.focus!(undefined as never));
      expect(m.hook.result.current.focusVisible).toBe(true);
      await act(() => node.l.keydown!(key("ArrowRight") as never));
      expect(m.v.aimState.value).toBe(AIM_STATE.aiming);
      await act(() => node.l.blur!(undefined as never));
      expect(m.hook.result.current.focusVisible).toBe(false);
      expect(m.v.aimState.value).toBe(AIM_STATE.cancelled);
    });

    it("no ring for a mouse focus", async () => {
      const m = await mount();
      const node = fakeNode();
      node.matches.mockReturnValue(false);
      await act(() => m.hook.result.current.attach(node));
      await act(() => node.l.focus!(undefined as never));
      expect(m.hook.result.current.focusVisible).toBe(false);
    });

    it("on native nothing is attached and the board is not a keyboard target", async () => {
      const m = await mount({ web: false });
      const node = fakeNode();
      await act(() => m.hook.result.current.attach(node));
      expect(Object.keys(node.l)).toHaveLength(0);
      expect(m.hook.result.current.webKeyboard).toBe(false);
    });

    it("detaches when the node goes", async () => {
      const m = await mount();
      const node = fakeNode();
      await act(() => m.hook.result.current.attach(node));
      await act(() => m.hook.result.current.attach(null));
      expect(node.removeEventListener).toHaveBeenCalledTimes(3);
    });
  });
});
