/**
 * Offline reveal for fr/es (#3241): `GET /upcoming` entries carry a
 * `display_blob`, scrambled like `answer_blob`, and the cache decodes it to the
 * accented spelling. French and Spanish are not offline-playable yet, so the
 * language list is widened here to exercise the decoding.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToBase64 } from "../../_shared/base64Bytes";
import { dailyWordApi } from "../api";
import {
  decodeAnswerBlob,
  findOfflinePuzzle,
  offlineAnswerFor,
  offlineDisplayFor,
  warmUpcoming,
} from "../offlinePuzzles";
import { sha256 } from "../sha256";

jest.mock("../api", () => ({ dailyWordApi: { getUpcoming: jest.fn() } }));
jest.mock("../localScoring", () => ({
  ...jest.requireActual("../localScoring"),
  OFFLINE_LANGUAGES: ["en", "fr", "es"],
}));

const getUpcoming = dailyWordApi.getUpcoming as jest.Mock;

/** The server's scramble: UTF-8, XOR with SHA-256(puzzle_id), base64. */
function scramble(id: string, text: string): string {
  const key = sha256(new TextEncoder().encode(id));
  const raw = new TextEncoder().encode(text);
  return bytesToBase64(raw.map((b, i) => b ^ key[i % key.length]!));
}

const FR_ID = "2026-10-13:fr:1";
const ES_ID = "2026-10-13:es:1";
const FR = {
  puzzle_id: FR_ID,
  word_length: 5,
  answer_blob: scramble(FR_ID, "etait"),
  display_blob: scramble(FR_ID, "était"),
};
const ES = {
  puzzle_id: ES_ID,
  word_length: 5,
  answer_blob: scramble(ES_ID, "arbol"),
  display_blob: scramble(ES_ID, "árbol"),
};
const at = Date.UTC(2026, 9, 13, 12);

beforeEach(async () => {
  await AsyncStorage.clear();
  getUpcoming.mockReset();
  jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("display_blob", () => {
  it("decodes with the answer_blob scheme, accents intact", () => {
    expect(decodeAnswerBlob(FR_ID, FR.display_blob)).toBe("était");
    expect(decodeAnswerBlob(ES_ID, ES.display_blob)).toBe("árbol");
  });

  it("is stored scrambled, not as plain text", async () => {
    jest.spyOn(Date, "now").mockReturnValue(at);
    getUpcoming.mockResolvedValue([FR]);
    await warmUpcoming(0, "fr");
    const raw = (await AsyncStorage.getItem("daily_word_upcoming_fr"))!;
    expect(JSON.parse(raw)).toEqual([FR]);
    expect(raw).not.toContain("était");
    expect(raw).not.toContain("etait");
  });

  it("gives the offline puzzle its accented display", async () => {
    await AsyncStorage.setItem("daily_word_upcoming_fr", JSON.stringify([FR]));
    expect(await findOfflinePuzzle(0, "fr", at)).toEqual({
      puzzle_id: FR_ID,
      word_length: 5,
      answer: "etait",
      display: "était",
    });
    expect(await offlineAnswerFor(FR_ID)).toBe("etait");
    expect(await offlineDisplayFor(FR_ID)).toBe("était");
  });

  it("decodes Spanish ñ and á", async () => {
    await AsyncStorage.setItem("daily_word_upcoming_es", JSON.stringify([ES]));
    expect(await offlineDisplayFor(ES_ID)).toBe("árbol");
  });

  it("has no display for an entry without a display_blob (en)", async () => {
    const en = { puzzle_id: "2026-10-13:en:2", word_length: 5, answer_blob: "" };
    const enWithBlob = { ...en, answer_blob: scramble(en.puzzle_id, "crane") };
    await AsyncStorage.setItem("daily_word_upcoming_en", JSON.stringify([enWithBlob]));
    expect(await findOfflinePuzzle(0, "en", at)).toEqual({
      puzzle_id: en.puzzle_id,
      word_length: 5,
      answer: "crane",
    });
    expect(await offlineDisplayFor(en.puzzle_id)).toBeNull();
  });

  it("drops an entry whose display_blob is not a string", async () => {
    await AsyncStorage.setItem(
      "daily_word_upcoming_fr",
      JSON.stringify([{ ...FR, display_blob: 7 }])
    );
    expect(await findOfflinePuzzle(0, "fr", at)).toBe("never");
  });
});
