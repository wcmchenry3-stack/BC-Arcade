#!/usr/bin/env node
/**
 * Checks that all non-English locale files are in sync with English source files.
 *
 * Usage:
 *   node scripts/check-i18n-strings.js [--namespace <ns>] [--locale <code>]
 *
 * Flags:
 *   --namespace  Filter to a single namespace (common | yacht | cascade | errors)
 *   --locale     Filter to a single locale code
 *
 * Exit codes:
 *   0 — all locales are in sync
 *   1 — missing or extra keys found (printed to stdout)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { LOCALES } from "../src/i18n/locales.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");
const NAMESPACES = [
  "common",
  "yacht",
  "cascade",
  "errors",
  "blackjack",
  "twenty48",
  "solitaire",
  "sudoku",
];
const PLACEHOLDER = "__NEEDS_TRANSLATION__";

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };

  return {
    filterLocale: get("--locale"),
    filterNs: get("--namespace"),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// A locale may carry plural categories English lacks (ru: few/many, ar: zero/two/few/many,
// he: two). They are legitimate when English has the `_other` form of the key and the
// locale's own CLDR plural rules include the category.
function isLocalePluralVariant(key, code, enSet) {
  const m = key.match(/^(.*)_(zero|one|two|few|many|other)$/);
  if (!m || !enSet.has(`${m[1]}_other`)) return false;
  return new Intl.PluralRules(code).resolvedOptions().pluralCategories.includes(m[2]);
}

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { filterLocale, filterNs } = parseArgs();

  const targetLocales = LOCALES.filter(
    (l) => l.code !== "en" && (!filterLocale || l.code === filterLocale)
  );
  const namespaces = filterNs ? [filterNs] : NAMESPACES;

  let totalIssues = 0;
  let totalPending = 0;

  for (const ns of namespaces) {
    const enPath = join(LOCALES_DIR, "en", `${ns}.json`);
    const enStrings = loadJson(enPath);
    if (!enStrings) {
      console.error(`✗ Missing English source: ${enPath}`);
      process.exit(1);
    }
    const enKeys = flattenKeys(enStrings);

    for (const { code } of targetLocales) {
      const targetPath = join(LOCALES_DIR, code, `${ns}.json`);
      const targetStrings = loadJson(targetPath);

      if (!targetStrings) {
        console.log(`✗ [${code}/${ns}.json] File missing entirely`);
        totalIssues++;
        continue;
      }

      const targetKeys = flattenKeys(targetStrings);
      const enSet = new Set(enKeys);
      const targetSet = new Set(targetKeys);

      const missing = enKeys.filter((k) => !targetSet.has(k));
      const extra = targetKeys.filter(
        (k) => !enSet.has(k) && !isLocalePluralVariant(k, code, enSet)
      );
      const pending = enKeys.filter(
        (k) => targetStrings[k] === PLACEHOLDER || targetStrings[k] === undefined
      );

      if (missing.length > 0) {
        console.log(`✗ [${code}/${ns}.json] Missing keys (${missing.length}):`);
        missing.forEach((k) => console.log(`    - ${k}`));
        totalIssues += missing.length;
      }

      if (extra.length > 0) {
        console.log(`⚠ [${code}/${ns}.json] Extra keys not in English (${extra.length}):`);
        extra.forEach((k) => console.log(`    + ${k}`));
        totalIssues += extra.length;
      }

      if (pending.length > 0) {
        totalPending += pending.length;
      }

      if (missing.length === 0 && extra.length === 0) {
        const pendingNote = pending.length > 0 ? ` (${pending.length} still need translation)` : "";
        console.log(`✓ [${code}/${ns}.json]${pendingNote}`);
      }
    }
  }

  console.log("");
  if (totalIssues > 0) {
    console.error(`Found ${totalIssues} structural issue(s). Run translate.js to fill stubs.`);
    process.exit(1);
  } else if (totalPending > 0) {
    console.error(
      `Found ${totalPending} key(s) still marked ${PLACEHOLDER}. Run: npm run translate -- --locale <code> --namespace <ns>`
    );
    process.exit(1);
  } else {
    console.log(`All locale files are structurally in sync and fully translated.`);
  }
}

main();
