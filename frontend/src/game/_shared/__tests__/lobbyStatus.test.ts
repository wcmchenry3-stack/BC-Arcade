import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { bestStatus, pickStatus, readSavedGame, type TileStatus } from "../lobbyStatus";

const resume: TileStatus = { kind: "resume" };
const done: TileStatus = { kind: "doneToday" };
const best: TileStatus = { kind: "best", value: 5, unit: "score" };

describe("pickStatus (#4008)", () => {
  it("ranks Resume above Done today above Best, whatever the order given", () => {
    expect(pickStatus([best, done, resume])).toBe(resume);
    expect(pickStatus([best, done])).toBe(done);
    expect(pickStatus([done, best])).toBe(done);
    expect(pickStatus([undefined, best])).toBe(best);
  });

  it("is undefined with nothing to say", () => {
    expect(pickStatus([])).toBeUndefined();
    expect(pickStatus([undefined, undefined])).toBeUndefined();
  });
});

describe("bestStatus (#4008)", () => {
  it("gives no status for no best (0) or a nonsense one", () => {
    expect(bestStatus(0, "score")).toBeUndefined();
    expect(bestStatus(-3, "moves")).toBeUndefined();
  });

  it("keeps the value and its unit", () => {
    expect(bestStatus(754_000, "time")).toEqual({ kind: "best", value: 754_000, unit: "time" });
  });
});

describe("readSavedGame (#4008)", () => {
  const isObject = (p: unknown): p is { ok: true } => (p as { ok?: boolean }).ok === true; // throws on a stored null, as the games' own checks do

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("returns the parsed save that passes the check", async () => {
    await AsyncStorage.setItem("k", JSON.stringify({ ok: true }));
    expect(await readSavedGame("k", isObject)).toEqual({ ok: true });
  });

  it("returns null for nothing stored, a failed check, a throwing check and a read failure", async () => {
    expect(await readSavedGame("k", isObject)).toBeNull();
    await AsyncStorage.setItem("k", JSON.stringify({ ok: false }));
    expect(await readSavedGame("k", isObject)).toBeNull();
    await AsyncStorage.setItem("k", "null");
    expect(await readSavedGame("k", isObject)).toBeNull();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    expect(await readSavedGame("k", isObject)).toBeNull();
  });

  it("leaves a corrupt save exactly as stored and reports nothing (reads only)", async () => {
    await AsyncStorage.setItem("k", "{not json");
    (AsyncStorage.setItem as jest.Mock).mockClear();
    expect(await readSavedGame("k", isObject)).toBeNull();
    expect(await AsyncStorage.getItem("k")).toBe("{not json");
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
