/**
 * Spanish (`es`) targets neutral Latin American / US Spanish (es-419 wording), per #3197.
 * Guards against Spain-only vocabulary and vosotros forms creeping back in.
 */
import * as fs from "fs";
import * as path from "path";

const ES_DIR = path.join(__dirname, "..", "locales", "es");

const SPAIN_ONLY = [
  /\blobby\b/i,
  /\bordenador/i,
  /\bm[oó]vil(es)?\b/i,
  /\bcoche/i,
  /\bzumo\b/i,
  /\bvosotros\b/i,
  /\bvuestr[oa]s?\b/i,
  /\bsois\b/i,
  /\b(hab|ten|pod|quer)[ée]is\b/i,
  /\bIntro\b/,
  /\bhan sido\b/i,
];

const entries: Array<[string, string]> = [];
for (const f of fs.readdirSync(ES_DIR).filter((n) => n.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(ES_DIR, f), "utf8")) as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") entries.push([`${f}:${k}`, v]);
  }
}

describe("es copy is neutral Latin American Spanish", () => {
  it("contains no Spain-only vocabulary or vosotros forms", () => {
    const hits = entries.filter(([, v]) => SPAIN_ONLY.some((re) => re.test(v)));
    expect(hits).toEqual([]);
  });

  it("uses Sala for the lobby and CPU for the computer opponent", () => {
    const get = (f: string, k: string) => entries.find(([id]) => id === `${f}:${k}`)?.[1];
    expect(get("common.json", "nav.lobby")).toBe("Sala");
    expect(get("yacht.json", "vsMode.computerTurn")).toBe("Turno de la CPU");
    expect(get("daily_word.json", "keyboard.enter")).toBe("Enviar");
  });
});
