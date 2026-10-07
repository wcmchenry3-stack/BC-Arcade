import { registerTestHooks } from "../testHooks/registry";

const g = globalThis as unknown as Record<string, unknown>;

describe("registerTestHooks (#2975)", () => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  });

  it("installs nothing when test hooks are disabled", () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    const cleanup = registerTestHooks("reg", { ping: () => 1 });
    expect(g.__reg_ping).toBeUndefined();
    expect(() => cleanup()).not.toThrow();
  });

  it("installs __<namespace>_<name> hooks and removes only its own on cleanup", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    g.__other_keep = 1;
    const cleanup = registerTestHooks("reg", { ping: () => 1, pong: () => 2 });
    expect((g.__reg_ping as () => number)()).toBe(1);
    expect((g.__reg_pong as () => number)()).toBe(2);
    cleanup();
    expect(g.__reg_ping).toBeUndefined();
    expect(g.__reg_pong).toBeUndefined();
    expect(g.__other_keep).toBe(1);
    delete g.__other_keep;
  });
});
