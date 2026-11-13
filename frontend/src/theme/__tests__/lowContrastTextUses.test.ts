/**
 * Guards #3754 / #3755: green (`colors.bonus`) or teal (`colors.accent`) must not colour TEXT,
 * because in the light theme they read ~3:1 and ~2:1 on cream. Text uses `colors.bonusText` /
 * `colors.accentText`; icons, borders, rings and fills keep the raw token (3:1 non-text rule).
 *
 * A source scan: a `color:` style key (the text colour on a <Text>; `borderColor`,
 * `backgroundColor` and an icon's `color=` JSX prop are not matched) that names `colors.bonus` or
 * `colors.accent` fails unless the file is in ALLOW below, with the reason it is not text on a
 * light surface. Do not add to ALLOW to get new low-contrast text past this: use the Text token.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "../..");

/** Files allowed to put the raw token on a `color:` key, and why. Empty today. */
const ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

export const TEXT_COLOR = /(^|[^A-Za-z])color:\s*[^,;]*\bcolors\.(bonus|accent)\b(?![A-Za-z])/;

describe("no low-contrast bonus/accent text (#3754, #3755)", () => {
  it("uses bonusText / accentText for text colour", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (rel.startsWith("theme/") || ALLOW[rel] !== undefined) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // A GameActionBar action's `color` is its ICON (3:1 is enough); its label is `labelColor`.
        if (TEXT_COLOR.test(line) && !/labelColor:/.test(lines[i + 1] ?? "")) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the pattern catches a violation and ignores icons, borders and fills", () => {
    expect(TEXT_COLOR.test("{ color: colors.bonus }")).toBe(true);
    expect(TEXT_COLOR.test("{ color: active ? colors.accent : colors.textMuted }")).toBe(true);
    expect(TEXT_COLOR.test("{ color: colors.accentText }")).toBe(false);
    expect(TEXT_COLOR.test("{ color: colors.bonusText }")).toBe(false);
    expect(TEXT_COLOR.test("{ borderColor: colors.accent }")).toBe(false);
    expect(TEXT_COLOR.test("{ backgroundColor: colors.bonus }")).toBe(false);
  });
});
