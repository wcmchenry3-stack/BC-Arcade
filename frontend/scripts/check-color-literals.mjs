#!/usr/bin/env node
/**
 * Fails when a screen, component, shared game module or Star Swarm render module spells out a
 * colour instead of importing a token or a per-game palette (#2989, epic #2950).
 *
 * Usage:  node scripts/check-color-literals.mjs        (tests: node --test scripts/check-color-literals.test.mjs)
 *
 * Files are parsed with TypeScript, and every string literal and template chunk is checked as a
 * whole, so a multi-line template literal cannot hide a colour on a continuation line, and
 * comments are never looked at.
 *
 * A colour literal is:
 *   hex     `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` anywhere in a string, at a word boundary
 *           ("#fff 1px", `#fff${a}`, "0 8px 40px #00000099"). A bare `#1234` (an issue number)
 *           is not a colour.
 *   func    `rgb(` / `rgba(` / `hsl(` / `hsla(`, any case, including `rgba(${r},...)` templates
 *   named   a whole string value like "white" / "black" / "red" (not "transparent") used as the
 *           value of a colour-ish property (color, backgroundColor, fill, stroke, tint, shadow...)
 *   numeric `0xRRGGBB` / `0xAARRGGBB` numbers (Star Swarm render modules only)
 *
 * Not scanned, because a colour literal is the point of the file:
 *   - `theme/theme.*.ts` (token and per-game palette modules; the design-tokens policy skips
 *     them with `theme\.[^./]+\.[jt]sx?$`) and `theme/ThemeContext.tsx`;
 *   - `game/starswarm/render/palette.ts` (Star Swarm's canvas palette);
 *   - tests and snapshots.
 *
 * ALLOWLIST below lists what is exempt and why. Do not add to it to get a new literal past the
 * check: add a token or a palette constant instead. An entry that matches no file fails the check,
 * so the list cannot go stale.
 *
 * Exit codes: 0 - clean; 1 - a literal or a stale allowlist entry was found.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname, sep } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../src");
export const ROOTS = [
  "screens",
  "components",
  "game/_shared",
  "game/cascade",
  "game/starswarm/render",
];

/**
 * Path prefixes (relative to src, posix) that are exempt, with why. `skip` narrows an entry to
 * some finding kinds (hex, func, named, numeric) so the rest of the file is still checked.
 */
export const ALLOWLIST = [
  // Dev-only code: dev panels and tooling, not shipped UI (#2273, dev-panel issue).
  { path: "screens/__dev__/", reason: "dev-only screens" },
  { path: "components/dev/", reason: "dev panel shell" },
  { path: "components/mahjong/MahjongDevPanel.tsx", reason: "dev panel" },
  { path: "components/starswarm/StarSwarmDevPanel.tsx", reason: "dev panel" },
  { path: "components/daily_word/DailyWordDevPanel.tsx", reason: "dev panel" },
  { path: "components/yacht/YachtDevPanel.tsx", reason: "dev panel" },
  { path: "components/starswarm/FrameStatsReadout.tsx", reason: "dev-only frame-time readout" },
  // Cascade's palette moved to the Cascade rework epic (#3033).
  { path: "screens/CascadeScreen.tsx", reason: "Cascade, #3033" },
  { path: "game/cascade/", reason: "Cascade, #3033" },
  // Colour-math helpers: they build a colour from computed channels, they are not a colour.
  {
    path: "game/starswarm/render/color.ts",
    reason: "packing helpers: 0xffffff / 0xff000000 are bit masks; rgba(${...}) formats channels",
    skip: ["numeric", "func"],
  },
  {
    path: "components/twenty48/tileStyles.ts",
    reason: "rgba(${r},${g},${b},${a}) formats computed channels",
    skip: ["func"],
  },
];

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])/gi;
const FUNC = /\b(?:rgba?|hsla?)\(/i;
const NUMERIC = /^0x[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const NAMED = new Set(
  (
    "white black red green blue yellow orange purple pink gray grey cyan magenta brown gold " +
    "silver navy teal lime maroon olive aqua fuchsia"
  ).split(" ")
);
const COLOR_PROP = /colou?r|background|fill|stroke|tint|shadow|border/i;

/** The name of the property or JSX attribute a string is the value of, through ?: && || as ( ). */
function ownerName(node) {
  let n = node;
  for (;;) {
    const p = n.parent;
    if (!p) return undefined;
    if (ts.isPropertyAssignment(p) && p.initializer === n) {
      return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
    }
    if (ts.isJsxAttribute(p)) return p.name.getText();
    if (ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent))
      return p.parent.name.getText();
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isConditionalExpression(p) ||
      ts.isBinaryExpression(p)
    ) {
      n = p;
      continue;
    }
    return undefined;
  }
}

/**
 * Find colour literals in one file's source. Returns [{ line, kind, text }] (1-based lines).
 * @param {string} source
 * @param {{ numeric?: boolean, skip?: string[], fileName?: string }} [opts]
 */
export function scanSource(source, opts = {}) {
  const { numeric = false, skip = [], fileName = "file.tsx" } = opts;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const add = (kind, pos, text, offsetText) => {
    if (skip.includes(kind)) return;
    const before = offsetText === undefined ? 0 : (offsetText.match(/\n/g) ?? []).length;
    found.push({ line: sf.getLineAndCharacterOfPosition(pos).line + 1 + before, kind, text });
  };

  /** Check one run of string text that starts at source position `pos`. */
  const checkText = (text, pos, node, whole) => {
    for (const m of text.matchAll(HEX)) {
      if (/^#\d{4}$/.test(m[0])) continue; // "#2989": an issue number
      add("hex", pos, m[0], text.slice(0, m.index));
    }
    const f = FUNC.exec(text);
    if (f) add("func", pos, f[0], text.slice(0, f.index));
    if (whole && NAMED.has(text.trim().toLowerCase())) {
      const owner = ownerName(node);
      if (owner && COLOR_PROP.test(owner)) add("named", pos, text, "");
    }
  };

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Import / export specifiers are module names, not colours.
      if (!(
        node.parent &&
        (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))
      )) {
        checkText(node.text, node.getStart() + 1, node, true);
      }
    } else if (ts.isTemplateExpression(node)) {
      checkText(node.head.text, node.head.getStart() + 1, node, false);
      for (const span of node.templateSpans) {
        checkText(span.literal.text, span.literal.getStart() + 1, node, false);
      }
    } else if (numeric && ts.isNumericLiteral(node) && NUMERIC.test(node.getText())) {
      add("numeric", node.getStart(), node.getText(), "");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "__snapshots__" || name === "__mocks__") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) {
      yield full;
    }
  }
}

/** Scan the repo. Returns { findings: string[], stale: string[] }. */
export function checkRepo(src = SRC) {
  const findings = [];
  const used = new Set();
  for (const root of ROOTS) {
    for (const file of walk(join(src, root))) {
      const rel = relative(src, file).split(sep).join("/");
      if (rel === "game/starswarm/render/palette.ts") continue;
      const entry = ALLOWLIST.find((e) => rel.startsWith(e.path));
      if (entry) used.add(entry.path);
      if (entry && !entry.skip) continue;
      const hits = scanSource(readFileSync(file, "utf8"), {
        numeric: rel.startsWith("game/starswarm/render/"),
        skip: entry?.skip ?? [],
        fileName: file,
      });
      for (const h of hits) findings.push(`${rel}:${h.line}: ${h.kind} ${h.text.trim()}`);
    }
  }
  const stale = ALLOWLIST.filter((e) => !used.has(e.path)).map((e) => e.path);
  return { findings, stale };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, stale } = checkRepo();
  if (stale.length > 0) {
    console.log("Allowlist entries that match no file (remove them from ALLOWLIST):\n");
    for (const s of stale) console.log(`  ${s}`);
    console.log("");
  }
  if (findings.length > 0) {
    console.log(`${findings.length} colour literal(s) outside the theme and the game palettes:\n`);
    for (const f of findings) console.log(`  ${f}`);
    console.log(
      "\nUse a token from theme/ThemeContext (useTheme().colors) or a constant from a theme/theme.<game>.ts\n" +
        "(game/starswarm/render/palette.ts for the Star Swarm canvas). See docs/BRANDING.md."
    );
  }
  if (stale.length > 0 || findings.length > 0) process.exit(1);
  console.log("No colour literals outside the theme and the game palettes.");
}
