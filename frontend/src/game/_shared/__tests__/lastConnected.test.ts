import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LAST_CONNECTED_KEY,
  clearLastConnected,
  daysOffline,
  getLastConnected,
  localDaysBetween,
  offlineWindowExhausted,
  recordConnected,
} from "../lastConnected";

// jest does not forward process.env.TZ changes to Date, so the device time zone
// is simulated through the offset Date reports (minutes behind UTC).
type Zone = (utcMs: number) => number;
const FIXED =
  (minutes: number): Zone =>
  () =>
    minutes;
const NEW_YORK = FIXED(240); // EDT, in force on the dates used below
const TOKYO = FIXED(-540);
const LOS_ANGELES = FIXED(420); // PDT
// US rules: EST (300) until 2026-03-08 07:00 UTC and from 2026-11-01 06:00 UTC, EDT (240) between.
const NEW_YORK_DST: Zone = (ms) =>
  ms >= Date.UTC(2026, 2, 8, 7) && ms < Date.UTC(2026, 10, 1, 6) ? 240 : 300;

let zone: Zone = FIXED(0);

beforeAll(() => {
  jest.spyOn(Date.prototype, "getTimezoneOffset").mockImplementation(function (this: Date) {
    return zone(this.getTime());
  });
});

beforeEach(async () => {
  zone = NEW_YORK;
  await AsyncStorage.clear();
  await clearLastConnected();
});

afterAll(() => {
  jest.restoreAllMocks();
});

/** Epoch ms of a wall-clock time in the simulated device zone. */
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  return wall + zone(wall + zone(wall) * 60_000) * 60_000;
};

describe("localDaysBetween", () => {
  it("is 0 within one local day, from first to last minute", () => {
    expect(localDaysBetween(local(2026, 10, 10, 0, 0), local(2026, 10, 10, 23, 59))).toBe(0);
  });

  it("rolls over at local midnight, not after 24 hours", () => {
    expect(localDaysBetween(local(2026, 10, 10, 23, 59), local(2026, 10, 11, 0, 1))).toBe(1);
    expect(localDaysBetween(local(2026, 10, 10, 0, 1), local(2026, 10, 10, 23, 59))).toBe(0);
    expect(localDaysBetween(local(2026, 10, 10, 0, 1), local(2026, 10, 11, 0, 0))).toBe(1);
  });

  it("counts calendar days across a month and year boundary", () => {
    expect(localDaysBetween(local(2026, 12, 30, 12), local(2027, 1, 2, 12))).toBe(3);
  });

  it("is not shifted by a DST change (spring forward and fall back)", () => {
    // US DST: 2026-03-08 (23 h day) and 2026-11-01 (25 h day).
    zone = NEW_YORK_DST;
    expect(localDaysBetween(local(2026, 3, 7, 12), local(2026, 3, 10, 12))).toBe(3);
    expect(localDaysBetween(local(2026, 10, 31, 12), local(2026, 11, 3, 12))).toBe(3);
    expect(localDaysBetween(local(2026, 3, 8, 0, 30), local(2026, 3, 9, 0, 30))).toBe(1);
  });

  it("counts a clock set back as 0, never negative", () => {
    expect(localDaysBetween(local(2026, 10, 12), local(2026, 10, 10))).toBe(0);
  });

  it("follows the device's time zone when it changes (travel)", () => {
    // 2026-10-10 23:30 in New York is already 2026-10-11 in Tokyo.
    const connected = Date.UTC(2026, 9, 11, 3, 30);
    const now = Date.UTC(2026, 9, 11, 10, 0); // 06:00 New York, 19:00 Tokyo
    zone = NEW_YORK;
    expect(localDaysBetween(connected, now)).toBe(1);
    zone = TOKYO;
    expect(localDaysBetween(connected, now)).toBe(0);
  });
});

describe("recordConnected / getLastConnected", () => {
  it("is null before any connection", async () => {
    expect(await getLastConnected()).toBeNull();
    expect(await daysOffline(Date.now())).toBeNull();
  });

  it("persists the time in AsyncStorage, so it survives a restart", async () => {
    const t = local(2026, 10, 10, 9);
    await recordConnected(t);
    expect(await AsyncStorage.getItem(LAST_CONNECTED_KEY)).toBe(String(t));
    expect(await getLastConnected()).toBe(t);
  });

  it("skips a second write within the throttle window, then writes again", async () => {
    const t = local(2026, 10, 10, 9);
    await recordConnected(t);
    await recordConnected(t + 5_000);
    expect(await getLastConnected()).toBe(t);
    await recordConnected(t + 61_000);
    expect(await getLastConnected()).toBe(t + 61_000);
  });

  it("ignores a corrupt stored value", async () => {
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, "not-a-number");
    expect(await getLastConnected()).toBeNull();
  });

  it("never throws when storage fails", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(recordConnected(local(2026, 10, 10, 9))).resolves.toBeUndefined();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("unreadable"));
    expect(await getLastConnected()).toBeNull();
  });
});

describe("offlineWindowExhausted", () => {
  it("is false when never connected", async () => {
    expect(await offlineWindowExhausted(Date.now())).toBe(false);
  });

  it("is false on days 0 to 2 and true from day 3", async () => {
    await recordConnected(local(2026, 10, 10, 18));
    expect(await offlineWindowExhausted(local(2026, 10, 10, 23, 59))).toBe(false);
    expect(await offlineWindowExhausted(local(2026, 10, 11, 8))).toBe(false);
    expect(await offlineWindowExhausted(local(2026, 10, 12, 23, 59))).toBe(false);
    expect(await offlineWindowExhausted(local(2026, 10, 13, 0, 0))).toBe(true);
    expect(await offlineWindowExhausted(local(2026, 10, 20, 12))).toBe(true);
  });

  it("flips at local midnight, even when under 72 hours have passed", async () => {
    await recordConnected(local(2026, 10, 10, 23, 30));
    expect(await offlineWindowExhausted(local(2026, 10, 13, 0, 5))).toBe(true);
  });

  it("uses the time zone in force when asked, after a zone change", async () => {
    const connected = Date.UTC(2026, 9, 10, 20, 0); // 16:00 on the 10th in New York
    await recordConnected(connected);
    const now = Date.UTC(2026, 9, 13, 5, 0);
    zone = NEW_YORK; // 01:00 on the 13th: day 3
    expect(await offlineWindowExhausted(now)).toBe(true);
    zone = LOS_ANGELES; // 22:00 on the 12th; connected on the 10th: day 2
    expect(await offlineWindowExhausted(now)).toBe(false);
  });
});
