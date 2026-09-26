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

describe("formatTimestamp", () => {
  it("returns — for null", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("returns — for an unparseable string", () => {
    expect(formatTimestamp("not-a-date")).toBe("—");
  });

  it("returns — for empty string", () => {
    expect(formatTimestamp("")).toBe("—");
  });

  it("does not return the raw ISO string (proves toLocaleString, not toISOString)", () => {
    const result = formatTimestamp(UTC_ISO);
    expect(result).not.toBe(UTC_ISO);
    // ISO-8601 markers that should never appear in a locale-formatted date
    expect(result).not.toContain("T");
    expect(result).not.toContain(".000Z");
  });

  it("delegates to Date.prototype.toLocaleString (no manual offset math)", () => {
    const spy = jest.spyOn(Date.prototype, "toLocaleString");
    formatTimestamp(UTC_ISO);
    expect(spy).toHaveBeenCalledTimes(1);
    // Called with no arguments — lets the runtime pick the device locale & TZ.
    expect(spy).toHaveBeenCalledWith();
    spy.mockRestore();
  });

  it("returns a non-empty string for a valid UTC timestamp", () => {
    expect(formatTimestamp(UTC_ISO).length).toBeGreaterThan(0);
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
});

describe("formatDate follows the app language, not the device (#2754)", () => {
  // Noon UTC is June 15 in every timezone from UTC−11 to UTC+11.
  const NOON_ISO = "2024-06-15T12:00:00.000Z";

  beforeEach(() => {
    // The device is on en-US, whatever machine runs the tests.
    jest.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      _locales,
      options
    ) {
      return new Intl.DateTimeFormat("en-US", options).format(this);
    });
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

  it("uses i18next's language for a t with no language of its own", async () => {
    // i18next resolves to German only when it has German strings (jest loads English only).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    i18n.addResourceBundle("de", "common", require("../../i18n/locales/de/common.json"));
    try {
      await i18n.changeLanguage("de");
      expect(formatDate(t, NOON_ISO)).toBe("15. Juni 2024");
    } finally {
      i18n.removeResourceBundle("de", "common");
    }
  });

  it("still writes it the English way in English", () => {
    expect(formatDate(t, NOON_ISO)).toBe("Jun 15, 2024");
  });

  it("falls back to English for a language Intl doesn't accept", () => {
    expect(formatDate(tIn("not a locale!"), NOON_ISO)).toBe("Jun 15, 2024");
  });
});
