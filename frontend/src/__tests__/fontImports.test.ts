/**
 * #3839: Google fonts are imported per weight (`@expo-google-fonts/<family>/<weight>`), never from the
 * package barrel. A barrel `index.js` requires every weight's .ttf, so Metro packaged all 12 files
 * (+648 KB, 17% of the store bundle's assets) for the 5 the app uses. This also checks that every font
 * family name the app styles with is one `useFonts` actually loads.
 */
import * as fs from "fs";
import * as path from "path";

import { typography } from "../theme/typography";

const ROOT = path.join(__dirname, "../..");
const APP = fs.readFileSync(path.join(ROOT, "App.tsx"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const SOURCES = [
  path.join(ROOT, "App.tsx"),
  path.join(ROOT, "index.ts"),
  ...walk(path.join(ROOT, "src")),
].filter((f) => fs.existsSync(f));

// import { A } from "@expo-google-fonts/manrope/400Regular"  (also require() and dynamic import())
const SPEC_RE = /["'](@expo-google-fonts\/[^"']+)["']/g;

describe("Google font imports (#3839)", () => {
  it("never import a font family barrel; only per-weight subpaths", () => {
    const barrels: string[] = [];
    for (const file of SOURCES) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(SPEC_RE)) {
        const parts = m[1]!.split("/"); // ["@expo-google-fonts", "manrope", "400Regular"?]
        if (parts.length < 3) barrels.push(`${path.relative(ROOT, file)}: ${m[1]}`);
      }
    }
    expect(barrels).toEqual([]);
  });

  it("each subpath import binds the export named for that weight", () => {
    const re = /import\s*\{\s*(\w+)\s*\}\s*from\s*["']@expo-google-fonts\/([\w-]+)\/(\w+)["']/g;
    const found = [...APP.matchAll(re)];
    expect(found.length).toBeGreaterThan(0);
    for (const [, name, family, weight] of found) {
      expect(name!.endsWith(`_${weight}`)).toBe(true);
      expect(name!.toLowerCase().replace(/_/g, "")).toContain(family!.replace(/-/g, ""));
    }
  });

  it("every typography family is loaded by useFonts, and nothing else is loaded", () => {
    const block = /useFonts\(\{([^}]*)\}\)/.exec(APP);
    expect(block).not.toBeNull();
    const loaded = block![1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(loaded).toEqual(Object.values(typography).sort());
  });

  it("every font family name styled anywhere in src is loaded", () => {
    const loaded = new Set(Object.values(typography));
    const used = new Set<string>();
    for (const file of SOURCES) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:Manrope|SpaceGrotesk)_\d{3}[A-Za-z]*\b/g)) used.add(m[0]);
    }
    expect([...used].filter((n) => !loaded.has(n))).toEqual([]);
  });
});
