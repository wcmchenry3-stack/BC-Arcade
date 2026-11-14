/**
 * #3843: the app ships subset icon fonts with only the glyphs it uses, not the full
 * MaterialIcons (357 KB) and MaterialCommunityIcons (1.31 MB) fonts. These checks keep the
 * subset honest: every listed name has its upstream codepoint in the glyph map and a glyph in
 * the committed font (so no icon renders as a missing-glyph box), nothing in app code imports
 * the full fonts or their glyph maps again, and the subset fonts stay small.
 *
 * A failure here after adding an icon name usually means the subset was not regenerated:
 * run `python tools/assets/subset_icon_fonts.py` from the repo root (see iconNames.ts).
 */
import * as fs from "fs";
import * as path from "path";

import { MATERIAL_COMMUNITY_ICON_NAMES, MATERIAL_ICON_NAMES } from "../components/icons/iconNames";

const ROOT = path.join(__dirname, "../..");
const ICONS_DIR = path.join(ROOT, "src/components/icons");
const UPSTREAM = path.dirname(
  require.resolve("@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json")
);
const MAX_SUBSET_FONT_BYTES = 20 * 1024;

const FAMILIES = [
  { family: "MaterialIcons", names: MATERIAL_ICON_NAMES as readonly string[] },
  { family: "MaterialCommunityIcons", names: MATERIAL_COMMUNITY_ICON_NAMES as readonly string[] },
] as const;

function readJson(file: string): Record<string, number> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, number>;
}

const subsetFontPath = (family: string) => path.join(ROOT, "assets/fonts", `${family}.subset.ttf`);
const subsetGlyphMap = (family: string) =>
  readJson(path.join(ICONS_DIR, `${family}.glyphmap.json`));
const upstreamGlyphMap = (family: string) => readJson(path.join(UPSTREAM, `${family}.json`));

/** Every codepoint the font's cmap maps to a real glyph (formats 4 and 12, the ones TTFs use). */
function cmapCodepoints(file: string): Set<number> {
  const buf = fs.readFileSync(file);
  const numTables = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("latin1", rec, rec + 4) === "cmap") cmap = buf.readUInt32BE(rec + 8);
  }
  if (cmap < 0) throw new Error(`${file} has no cmap table`);
  const out = new Set<number>();
  const numSubtables = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < numSubtables; i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const offsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = buf.readUInt16BE(ends + s);
        const start = buf.readUInt16BE(starts + s);
        const delta = buf.readInt16BE(deltas + s);
        const rangeOffset = buf.readUInt16BE(offsets + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid: number;
          if (rangeOffset === 0) gid = (c + delta) & 0xffff;
          else {
            const g = buf.readUInt16BE(offsets + s + rangeOffset + (c - start) * 2);
            gid = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (gid !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const rec = sub + 16 + g * 12;
        const start = buf.readUInt32BE(rec);
        const end = buf.readUInt32BE(rec + 4);
        const firstGid = buf.readUInt32BE(rec + 8);
        for (let c = start; c <= end; c++) if (firstGid + (c - start) !== 0) out.add(c);
      }
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.test\.(ts|tsx|js|jsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const APP_SOURCES = [
  path.join(ROOT, "App.tsx"),
  path.join(ROOT, "index.ts"),
  ...walk(path.join(ROOT, "src")),
].filter((f) => fs.existsSync(f));

describe.each(FAMILIES)("$family subset (#3843)", ({ family, names }) => {
  it("lists each icon name once", () => {
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("glyph map holds exactly the listed names, each with its upstream codepoint", () => {
    const upstream = upstreamGlyphMap(family);
    const subset = subsetGlyphMap(family);
    expect(Object.keys(subset).sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(upstream[name]).toEqual(expect.any(Number));
      expect([name, subset[name]]).toEqual([name, upstream[name]]);
    }
  });

  it("committed font has a glyph for every listed codepoint", () => {
    const cmap = cmapCodepoints(subsetFontPath(family));
    const upstream = upstreamGlyphMap(family);
    const missing = names.filter((n) => !cmap.has(upstream[n]!));
    expect(missing).toEqual([]);
  });

  it(`font is under ${MAX_SUBSET_FONT_BYTES} bytes`, () => {
    expect(fs.statSync(subsetFontPath(family)).size).toBeLessThan(MAX_SUBSET_FONT_BYTES);
  });

  it("every listed name is used by app code (no stale glyphs)", () => {
    const text = APP_SOURCES.filter((f) => path.dirname(f) !== ICONS_DIR)
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    const unused = names.filter((n) => !text.includes(`"${n}"`));
    expect(unused).toEqual([]);
  });
});

describe("full icon fonts stay out of app code (#3843)", () => {
  it("imports no @expo/vector-icons family, glyph map or font; only createIconSet", () => {
    const re = /["'](@expo\/vector-icons(?:\/[^"']*)?|react-native-vector-icons(?:\/[^"']*)?)["']/g;
    const bad: string[] = [];
    for (const file of APP_SOURCES) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(re)) {
        if (m[1] !== "@expo/vector-icons/createIconSet") {
          bad.push(`${path.relative(ROOT, file)}: ${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("each family module builds on its subset font and glyph map", () => {
    for (const { family } of FAMILIES) {
      const text = fs.readFileSync(path.join(ICONS_DIR, `${family}.ts`), "utf8");
      expect(text).toContain(`"./${family}.glyphmap.json"`);
      expect(text).toContain(`"../../../assets/fonts/${family}.subset.ttf"`);
      expect(text).toContain('from "@expo/vector-icons/createIconSet"');
    }
  });
});
