#!/usr/bin/env node
/**
 * Checks that all non-English locale files are in sync with English source files.
 *
 * Usage:
 *   node scripts/check-i18n-strings.js [--namespace <ns>] [--locale <code>] [--update-pending]
 *
 * Flags:
 *   --namespace       Filter to a single namespace (any file in locales/en)
 *   --locale          Filter to a single locale code
 *   --update-pending  Rewrite the "pending" list in i18n-english-copies.json to
 *                     the English copies found now (after translating some)
 *
 * Checks, per locale file:
 *   - the same keys as English (plural forms the locale needs are allowed);
 *   - every plural form the locale needs (#2754): for each key English has an
 *     `_other` form of, one form per category in the locale's CLDR plural
 *     rules (fr/es/pt _many, ru _few/_many, ar _zero/_two/_few/_many, he _two).
 *     A missing one makes i18next show English for counts in that category;
 *   - no __NEEDS_TRANSLATION__ placeholders;
 *   - no value that is still a copy of the English one (#2678), unless it is
 *     a do-not-translate term, has no words of its own, or is listed in
 *     i18n-english-copies.json: "accepted" (the word really is the same in
 *     that language) or "pending" (known untranslated backlog, #2681).
 *     "pending" may only shrink: a new English copy fails, and so does a
 *     listed one that has since been translated, until the list is updated;
 *   - every value within its _meta characterLimit, English included (#2681).
 *     Characters are counted as the reader sees them (grapheme clusters), so
 *     Devanagari vowel signs don't count extra. A plural form only some locales
 *     have (ru _few, ar _many) is held to English's _other entry.
 *
 * And per namespace, that _meta has an entry for every English key, under that
 * exact key (translate.js looks entries up by it), and none for keys English
 * no longer has (#2681).
 *
 * Exit codes:
 *   0 — all locales are in sync
 *   1 — an issue was found (printed to stdout)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { LOCALES } from "../src/i18n/locales.js";
import { doNotTranslateTerms } from "../src/i18n/glossary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");
const META_DIR = join(LOCALES_DIR, "_meta");
const COPIES_PATH = join(__dirname, "i18n-english-copies.json");
// Every namespace English has (#2194): a hand-kept list here drifted and missed
// six games. A namespace in NOT_ALL_LOCALES may lack a file in some locales
// (English is shown there); the files it does have are still checked. Add a
// new namespace here while it is being translated; remove it once every locale
// has its file. Empty since #2195: every locale has every namespace.
const NOT_ALL_LOCALES = new Set([]);
const NAMESPACES = readdirSync(join(LOCALES_DIR, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();
const PLACEHOLDER = "__NEEDS_TRANSLATION__";
// Names that stay in English everywhere, on top of the glossary's terms.
const SAME_EVERYWHERE = new Set([
  ...doNotTranslateTerms,
  "Blackjack",
  "FreeCell",
  "Star Swarm",
  "Mahjong Solitaire",
  "BC Arcade Premium",
  "X-Wing",
]);

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
    updatePending: args.includes("--update-pending"),
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

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// A locale may carry plural categories English lacks (ru: few/many, ar: zero/two/few/many,
// he: two). They are legitimate when English has the `_other` form of the key and the
// locale's own CLDR plural rules include the category.
function isLocalePluralVariant(key, code, enSet) {
  const m = key.match(new RegExp(`^(.*)${PLURAL_SUFFIX.source}`));
  if (!m || !enSet.has(`${m[1]}_other`)) return false;
  return new Intl.PluralRules(code).resolvedOptions().pluralCategories.includes(m[2]);
}

// Plural forms the locale's CLDR rules need but the file lacks, e.g. fr "_many"
// (1,000,000), for every key English has an `_other` form of.
function missingPluralForms(targetSet, code, enKeys) {
  const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  return enKeys
    .filter((k) => k.endsWith("_other"))
    .flatMap((k) => {
      const base = k.slice(0, -"_other".length);
      return categories.map((c) => `${base}_${c}`).filter((form) => !targetSet.has(form));
    });
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

// True when the text has a word of its own once {{placeholders}} are removed.
function hasWords(value) {
  return /\p{L}/u.test(value.replace(/\{\{[^}]*\}\}/g, ""));
}

// The _meta entry for a key: its own, or for a plural form English lacks, the _other one.
function metaFor(meta, key) {
  return meta[key] ?? meta[`${key.replace(PLURAL_SUFFIX, "")}_other`];
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// Characters as the reader sees them: "कि" is one, not two code points.
function visibleLength(value) {
  return [...graphemes.segment(value)].length;
}

// Values longer than their _meta characterLimit (which counts raw {{placeholders}}).
function overLimit(strings, meta) {
  return Object.entries(strings).filter(([k, v]) => {
    const limit = metaFor(meta, k)?.characterLimit;
    return typeof v === "string" && limit && visibleLength(v) > limit;
  });
}

function reportOverLimit(label, over, meta) {
  if (over.length === 0) return 0;
  console.log(`✗ [${label}] Over the _meta characterLimit (${over.length}):`);
  over.forEach(([k, v]) =>
    console.log(
      `    > ${k}: ${visibleLength(v)}/${metaFor(meta, k).characterLimit} ${JSON.stringify(v)}`
    )
  );
  return over.length;
}

// ns -> locale -> keys, from one section of i18n-english-copies.json.
function listed(section, ns, code) {
  return new Set(section?.[ns]?.[code] ?? []);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { filterLocale, filterNs, updatePending } = parseArgs();

  const targetLocales = LOCALES.filter(
    (l) => l.code !== "en" && (!filterLocale || l.code === filterLocale)
  );
  const namespaces = filterNs ? [filterNs] : NAMESPACES;
  const copies = loadJson(COPIES_PATH) ?? { accepted: {}, pending: {} };
  const foundPending = {};

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
    const enSet = new Set(enKeys);

    const meta = loadJson(join(META_DIR, `${ns}.meta.json`)) ?? {};
    if (!filterLocale || filterLocale === "en") {
      const noMeta = enKeys.filter((k) => !meta[k]);
      const staleMeta = Object.keys(meta).filter((k) => !enSet.has(k));
      if (noMeta.length > 0) {
        console.log(`✗ [_meta/${ns}.meta.json] No entry for (${noMeta.length}):`);
        noMeta.forEach((k) => console.log(`    - ${k}`));
        totalIssues += noMeta.length;
      }
      if (staleMeta.length > 0) {
        console.log(
          `✗ [_meta/${ns}.meta.json] Entry for a key English no longer has (${staleMeta.length}):`
        );
        staleMeta.forEach((k) => console.log(`    + ${k}`));
        totalIssues += staleMeta.length;
      }
      totalIssues += reportOverLimit(`en/${ns}.json`, overLimit(enStrings, meta), meta);
    }

    for (const { code } of targetLocales) {
      const targetPath = join(LOCALES_DIR, code, `${ns}.json`);

      if (!existsSync(targetPath) && NOT_ALL_LOCALES.has(ns)) {
        console.log(
          `… [${code}/${ns}.json] not translated yet (NOT_ALL_LOCALES); English is shown`
        );
        continue;
      }

      const targetStrings = loadJson(targetPath);
      if (!targetStrings) {
        console.log(`✗ [${code}/${ns}.json] File missing or not valid JSON`);
        totalIssues++;
        continue;
      }

      const targetKeys = flattenKeys(targetStrings);
      const targetSet = new Set(targetKeys);

      const missing = enKeys.filter((k) => !targetSet.has(k));
      const extra = targetKeys.filter(
        (k) => !enSet.has(k) && !isLocalePluralVariant(k, code, enSet)
      );
      // Forms English also has are already under "missing".
      const pluralGaps = missingPluralForms(targetSet, code, enKeys).filter((k) => !enSet.has(k));
      const pending = enKeys.filter(
        (k) => targetStrings[k] === PLACEHOLDER || targetStrings[k] === undefined
      );

      if (missing.length > 0) {
        console.log(`✗ [${code}/${ns}.json] Missing keys (${missing.length}):`);
        missing.forEach((k) => console.log(`    - ${k}`));
        totalIssues += missing.length;
      }

      if (pluralGaps.length > 0) {
        console.log(
          `✗ [${code}/${ns}.json] Missing plural forms ${code} needs (${pluralGaps.length}); English is shown for those counts:`
        );
        pluralGaps.forEach((k) => console.log(`    - ${k}`));
        totalIssues += pluralGaps.length;
      }

      if (extra.length > 0) {
        console.log(`⚠ [${code}/${ns}.json] Extra keys not in English (${extra.length}):`);
        extra.forEach((k) => console.log(`    + ${k}`));
        totalIssues += extra.length;
      }

      if (pending.length > 0) {
        totalPending += pending.length;
      }

      const over = overLimit(targetStrings, meta);
      totalIssues += reportOverLimit(`${code}/${ns}.json`, over, meta);

      // English copies: values identical to English that are not expected to be.
      const accepted = listed(copies.accepted, ns, code);
      const knownPending = listed(copies.pending, ns, code);
      const englishCopies = enKeys.filter(
        (k) =>
          typeof enStrings[k] === "string" &&
          targetStrings[k] === enStrings[k] &&
          hasWords(enStrings[k]) &&
          !SAME_EVERYWHERE.has(enStrings[k]) &&
          !accepted.has(k)
      );
      if (englishCopies.length > 0) {
        (foundPending[ns] ??= {})[code] = englishCopies;
      }
      if (!updatePending) {
        const fresh = englishCopies.filter((k) => !knownPending.has(k));
        const translated = [...knownPending].filter((k) => !englishCopies.includes(k));
        if (fresh.length > 0) {
          console.log(`✗ [${code}/${ns}.json] Still a copy of the English text (${fresh.length}):`);
          fresh.forEach((k) => console.log(`    = ${k}: ${JSON.stringify(enStrings[k])}`));
          totalIssues += fresh.length;
        }
        if (translated.length > 0) {
          console.log(
            `✗ [${code}/${ns}.json] Translated now, still listed as pending (${translated.length}); run with --update-pending:`
          );
          translated.forEach((k) => console.log(`    ✓ ${k}`));
          totalIssues += translated.length;
        }
      }

      if (
        missing.length === 0 &&
        pluralGaps.length === 0 &&
        extra.length === 0 &&
        over.length === 0
      ) {
        const pendingNote = pending.length > 0 ? ` (${pending.length} still need translation)` : "";
        const copyNote =
          englishCopies.length > 0 ? ` (${englishCopies.length} English copies pending)` : "";
        console.log(`✓ [${code}/${ns}.json]${pendingNote}${copyNote}`);
      }
    }
  }

  if (updatePending) {
    if (filterNs || filterLocale) {
      console.error("--update-pending rewrites the whole list; run it without filters.");
      process.exit(1);
    }
    const next = { ...copies, pending: foundPending };
    writeFileSync(COPIES_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`\nWrote the pending English copies to ${COPIES_PATH}.`);
    return;
  }

  console.log("");
  if (totalIssues > 0) {
    console.error(`Found ${totalIssues} issue(s). Run translate.js to fill stubs.`);
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
