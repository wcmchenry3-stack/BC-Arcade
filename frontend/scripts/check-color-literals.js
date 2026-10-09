#!/usr/bin/env node
/**
 * Fails when a screen, component or Star Swarm render module spells out a colour
 * instead of importing a token or a per-game palette (#2989, epic #2950).
 *
 * Usage:  node scripts/check-color-literals.js
 *
 * Scanned: src/screens, src/components, src/game/starswarm/render.
 *
 * A colour literal is a quoted `#rgb` / `#rrggbb` / `#rrggbbaa`, a quoted
 * `rgb(` / `rgba(` / `hsl(` / `hsla(` call with a number in it, or (render
 * modules only) a `0xRRGGBB` / `0xAARRGGBB` number. Comments are ignored.
 *
 * Not scanned, because a colour literal is the point of the file:
 *   - `theme/theme.*.ts`  - token and per-game palette modules (the design-tokens
 *     policy skips them with `theme\.[^./]+\.[jt]sx?$`), and `theme/ThemeContext.tsx`;
 *   - `game/starswarm/render/palette.ts` - Star Swarm's canvas palette;
 *   - tests and snapshots.
 *
 * Allowlisted below, each with the reason and where it goes next. Do not add to
 * this list to get a new literal past the check: add a token or a palette
 * constant instead.
 *
 * Exit codes: 0 - clean; 1 - a literal was found (printed as file:line).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../src");
const ROOTS = ["screens", "components", "game/starswarm/render"];

/** Path prefixes (relative to src, posix) that are exempt, with why. */
const ALLOWLIST = [
  // Dev-only code: dev panels and tooling, not shipped UI (#2273, dev-panel issue).
  ["screens/__dev__/", "dev-only screens"],
  ["components/dev/", "dev panel shell"],
  ["components/mahjong/MahjongDevPanel.tsx", "dev panel"],
  ["components/starswarm/StarSwarmDevPanel.tsx", "dev panel"],
  ["components/daily_word/DailyWordDevPanel.tsx", "dev panel"],
  ["components/yacht/YachtDevPanel.tsx", "dev panel"],
  ["components/hearts/HeartsDebugPanel.tsx", "dev panel"],
  ["components/starswarm/FrameStatsReadout.tsx", "dev-only frame-time readout"],
  // Cascade's palette moved to the Cascade rework epic (#3033).
  ["screens/CascadeScreen.tsx", "Cascade, #3033"],
  ["components/cascade/", "Cascade, #3033"],
  // Packing helpers: 0xffffff / 0xff000000 here are bit masks, not colours.
  ["game/starswarm/render/color.ts", "alpha/RGB bit masks"],
  // Card faces and ink: PR 2 of #2989, after #3059 (cardFace / cardInk / cardRedSuit tokens).
  ["components/shared/PlayingCard.tsx", "card face, PR 2 of #2989"],
  ["components/hearts/CapturedPile.tsx", "card face, PR 2 of #2989"],
  ["components/freecell/FoundationPile.tsx", "red-suit ink (#ff716c), PR 2 of #2989"],
];

const HEX = /(["'`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\1/;
// A colour function call inside a string: rgba(0,0,0,.5), rgb(1 2 3), hsl(120, ...).
// Template pieces such as `rgba(${r}, ...)` start with `$` and are not literals.
const FUNC = /["'`][^"'`]*\b(?:rgba?|hsla?)\(\s*[0-9.]/;
// A hex colour embedded in a longer string: "0 8px 40px #00000099".
const EMBEDDED_HEX =
  /["'`][^"'`]*\s#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b[^"'`]*["'`]/;
const NUMERIC = /\b0x[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/;

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

/** Blank out block comments and line comments, keeping line numbers. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

const found = [];
for (const root of ROOTS) {
  const rootDir = join(SRC, root);
  for (const file of walk(rootDir)) {
    const rel = relative(SRC, file).split(sep).join("/");
    if (rel === "game/starswarm/render/palette.ts") continue;
    if (ALLOWLIST.some(([prefix]) => rel.startsWith(prefix))) continue;
    const renderModule = rel.startsWith("game/starswarm/render/");
    stripComments(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (
          HEX.test(line) ||
          FUNC.test(line) ||
          EMBEDDED_HEX.test(line) ||
          (renderModule && NUMERIC.test(line))
        ) {
          found.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
  }
}

if (found.length > 0) {
  console.log(`${found.length} colour literal(s) outside the theme and the game palettes:\n`);
  for (const f of found) console.log(`  ${f}`);
  console.log(
    "\nUse a token from theme/ThemeContext (useTheme().colors) or a constant from a theme/theme.<game>.ts\n" +
      "(game/starswarm/render/palette.ts for the Star Swarm canvas). See docs/BRANDING.md."
  );
  process.exit(1);
}
console.log("No colour literals outside the theme and the game palettes.");
