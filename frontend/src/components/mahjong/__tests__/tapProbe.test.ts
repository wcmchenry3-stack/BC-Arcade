/**
 * @jest-environment jsdom
 */
/** Gating and recording of the test-build-only tap probe (#4098). */

import { MATCH_MS } from "../../../game/mahjong/motion";
import { matchBurstActive, noteMatch, recordTap, resetMatchProbe, TAP_ATTR } from "../tapProbe";

describe("recordTap", () => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  afterEach(() => {
    resetMatchProbe();
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  });

  it("writes nothing when test hooks are off (store builds)", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "0";
    const el = document.createElement("canvas");
    recordTap(el, performance.now(), true);
    expect(el.hasAttribute(TAP_ATTR.seq)).toBe(false);
    expect(el.hasAttribute(TAP_ATTR.ms)).toBe(false);
    expect(el.hasAttribute(TAP_ATTR.burst)).toBe(false);
  });

  it("counts taps and records burst state when on", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const el = document.createElement("canvas");
    recordTap(el, performance.now(), true);
    expect(el.getAttribute(TAP_ATTR.burst)).toBe("true");
    recordTap(el, performance.now(), false);
    expect(el.getAttribute(TAP_ATTR.seq)).toBe("2");
    expect(el.getAttribute(TAP_ATTR.burst)).toBe("false");
  });

  it("measures from the event timestamp", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const el = document.createElement("canvas");
    recordTap(el, performance.now() - 40, true);
    expect(Number(el.getAttribute(TAP_ATTR.ms))).toBeGreaterThanOrEqual(40);
  });

  it("tolerates a missing element", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    expect(() => recordTap(null, 0, false)).not.toThrow();
  });
});

describe("match burst signal", () => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  afterEach(() => {
    resetMatchProbe();
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  });

  it("is false before any match", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    expect(matchBurstActive()).toBe(false);
  });

  it("is true right after a match, with no render in between", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    noteMatch();
    expect(matchBurstActive()).toBe(true);
  });

  it("is false once MATCH_MS has passed", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    noteMatch();
    expect(matchBurstActive(performance.now() + MATCH_MS + 1)).toBe(false);
  });

  it("does nothing when test hooks are off", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "0";
    noteMatch();
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    expect(matchBurstActive()).toBe(false);
    process.env.EXPO_PUBLIC_TEST_HOOKS = "0";
    expect(matchBurstActive()).toBe(false);
  });
});
