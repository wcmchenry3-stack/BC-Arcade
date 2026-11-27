/**
 * @jest-environment jsdom
 */
/** Gating and recording of the test-build-only tap probe (#4098). */

import { recordTap, TAP_ATTR } from "../tapProbe";

describe("recordTap", () => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  afterEach(() => {
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
