import i18n, { type TFunction } from "i18next";
import { formatTimestamp, formatDate } from "../formatTimestamp";

const t = i18n.t.bind(i18n) as unknown as TFunction;
// Like useTranslation's t, fixed to one language.
const tIn = (code: string) => i18n.getFixedT(code) as unknown as TFunction;

// A fixed UTC instant: 2024-06-15 20:00:00 UTC.
// In America/New_York (EDT = UTC−4) this is 4:00 PM.
// In Asia/Tokyo (JST = UTC+9) this is 05:00 next day.
// The key invariant: the output must come from the runtime's TZ-aware
// formatter, not from toISOString() or manual offset arithmetic.
const UTC_ISO = "2024-06-15T20:00:00.000Z";
// Noon UTC is June 15 in every timezone from UTC−11 to UTC+11.
const NOON_ISO = "2024-06-15T12:00:00.000Z";

describe("formatTimestamp", () => {
  it("returns — for null", () => {
    expect(formatTimestamp(t, null)).toBe("—");
  });

  it("returns — for an unparseable string", () => {
    expect(formatTimestamp(t, "not-a-date")).toBe("—");
  });

  it("returns — for empty string", () => {
    expect(formatTimestamp(t, "")).toBe("—");
  });

  it("does not return the raw ISO string", () => {
    const result = formatTimestamp(t, UTC_ISO);
    expect(result).not.toBe(UTC_ISO);
    // ISO-8601 markers that should never appear in a locale-formatted date
    expect(result).not.toContain("T");
    expect(result).not.toContain(".000Z");
  });

  it("shows the time in the device's timezone, like toLocaleString", () => {
    expect(formatTimestamp(t, UTC_ISO)).toBe(new Date(UTC_ISO).toLocaleString("en"));
  });
});

describe("formatDate", () => {
  it("returns empty string for null", () => {
    expect(formatDate(t, null)).toBe("");
  });

  it("returns empty string for an unparseable string", () => {
    expect(formatDate(t, "bad")).toBe("");
  });

  it("does not return the raw ISO string", () => {
    const result = formatDate(t, UTC_ISO);
    expect(result).not.toContain("T");
    expect(result).not.toContain("Z");
    expect(result).not.toMatch(/^\d{4}-\d{2}-\d{2}/); // ISO date fragment
  });

  it("includes the year in the output", () => {
    // year:'numeric' must include the year. This would fail if someone
    // switched to toISOString() or dropped the options.
    expect(formatDate(t, UTC_ISO)).toContain("2024");
  });

  it("takes epoch milliseconds too (Blackjack's run records)", () => {
    expect(formatDate(t, Date.parse(NOON_ISO))).toBe("Jun 15, 2024");
  });
});

describe("dates follow the app language, not the device (#2754)", () => {
  beforeEach(() => {
    // The device is on en-US, whatever machine runs the tests.
    const asEnUs = function (this: Date, _locales?: unknown, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat("en-US", options).format(this);
    };
    jest.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(asEnUs);
    jest.spyOn(Date.prototype, "toLocaleString").mockImplementation(asEnUs);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("writes the date the German way when the app is in German", () => {
    expect(formatDate(tIn("de"), NOON_ISO)).toBe("15. Juni 2024");
  });

  it("writes the date the French way when the app is in French", () => {
    expect(formatDate(tIn("fr-CA"), NOON_ISO)).toBe("15 juin 2024");
  });

  it("writes date and time the German way when the app is in German", () => {
    // The hour and minute depend on the machine's timezone; the order and 24-hour clock don't.
    expect(formatTimestamp(tIn("de"), NOON_ISO)).toMatch(/^15\.6\.2024, \d{1,2}:\d{2}:00$/);
  });

  it("uses i18next's language for a t with no language of its own", async () => {
    // i18next resolves to German only when it has German strings (jest loads English only).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    i18n.addResourceBundle("de", "common", require("../../i18n/locales/de/common.json"));
    try {
      await i18n.changeLanguage("de");
      expect(formatDate(t, NOON_ISO)).toBe("15. Juni 2024");
      expect(formatTimestamp(t, NOON_ISO)).toMatch(/^15\.6\.2024, /);
    } finally {
      i18n.removeResourceBundle("de", "common");
    }
  });

  it("still writes them the English way in English", () => {
    expect(formatDate(t, NOON_ISO)).toBe("Jun 15, 2024");
    expect(formatTimestamp(t, NOON_ISO)).toMatch(/^6\/15\/2024, \d{1,2}:\d{2}:00\s[AP]M$/);
  });

  it("falls back to English for a language Intl doesn't accept", () => {
    expect(formatDate(tIn("not a locale!"), NOON_ISO)).toBe("Jun 15, 2024");
    expect(formatTimestamp(tIn("not a locale!"), NOON_ISO)).toMatch(/^6\/15\/2024, /);
  });
});
