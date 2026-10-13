/**
 * Placeholder parity for check-i18n-strings.js (#3152). Pure functions, no I/O,
 * so scripts/i18n-placeholders.test.mjs can test them.
 *
 * A translated value must carry exactly the English value's interpolations:
 *   - `{{name}}`, `{{name, number}}`, `{{- name}}` -> the token is `{{name}}`
 *     (the format and escape flag are not compared, only the name);
 *   - Trans tags `<0>`, `</0>`, `<1/>`, `<bold>` -> compared by name and kind;
 *   - `$t(key)` nesting.
 * Compared as multisets, so reordering passes; a dropped, renamed, added or
 * duplicated one fails. A dropped `{{count}}` would render a raw "{{count}}" or
 * lose the number.
 *
 * Plural keys: English has `_one` and `_other`; a locale also has `_few`, `_many`,
 * `_zero`, `_two` as its CLDR rules need. A form English lacks is compared with
 * English's `_other`. A key only counts as a plural form when English has the
 * `<base>_other` sibling. In `_zero`, `_one` and `_two` forms `{{count}}` is optional
 * in both directions ("un mot", "ein Wort" are correct for exactly one); any other
 * placeholder still has to match. `_few`, `_many` and `_other` forms are strict.
 */

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const COUNT_OPTIONAL = new Set(["zero", "one", "two"]);

/** Tokens of one string: interpolations, Trans tags, `$t()` nests. */
export function placeholderTokens(value) {
  const tokens = [];
  for (const m of value.matchAll(/\{\{\s*-?\s*([^,}\s]+)[^}]*\}\}/g)) tokens.push(`{{${m[1]}}}`);
  for (const m of value.matchAll(/<(\/?)\s*([A-Za-z0-9_-]+)\s*(\/?)>/g)) {
    tokens.push(`<${m[1]}${m[2]}${m[3]}>`);
  }
  for (const m of value.matchAll(/\$t\(\s*([^),]+?)\s*[,)]/g)) tokens.push(`$t(${m[1]})`);
  return tokens;
}

// Multiset difference: the tokens of `a` that `b` does not (also) have.
function difference(a, b) {
  const rest = [...b];
  const out = [];
  for (const t of a) {
    const i = rest.indexOf(t);
    if (i === -1) out.push(t);
    else rest.splice(i, 1);
  }
  return out;
}

// The plural category of a key, only when English has the `<base>_other` sibling:
// `goal.solitaire.moves_at_least_one` is a plain key, not a plural form.
function pluralCategory(key, enStrings) {
  const m = key.match(PLURAL_SUFFIX);
  if (!m) return null;
  return typeof enStrings[`${key.slice(0, -m[0].length)}_other`] === "string" ? m[1] : null;
}

/**
 * The English key a translated key is compared with: itself, or for a plural
 * form English lacks (ru `_few`, fr `_many`), English's `_other`. null if none.
 */
export function referenceKey(key, enStrings) {
  if (typeof enStrings[key] === "string") return key;
  if (pluralCategory(key, enStrings) === null) return null;
  return `${key.replace(PLURAL_SUFFIX, "")}_other`;
}

/**
 * Placeholders the translation dropped (`missing`) or has that English does not
 * (`extra`). `category` is the key's plural category (or null) for the rule above.
 */
export function placeholderDiff(category, enValue, targetValue) {
  const skipCount = category !== null && COUNT_OPTIONAL.has(category);
  const prep = (v) => placeholderTokens(v).filter((t) => !(skipCount && t === "{{count}}"));
  const en = prep(enValue);
  const target = prep(targetValue);
  return { missing: difference(en, target), extra: difference(target, en) };
}

/**
 * Every placeholder problem in a locale file against English (flat key -> value
 * maps). `waivers` is { key: { waive: [tokens], reason } } (the JSON exceptions):
 * each waived token is removed once from that key's `missing`; anything else
 * still fails. Returns [{ kind, key, missing, extra, waive }] where kind is
 *   "mismatch" - placeholders differ from English;
 *   "stale"    - a waived token is not actually missing (or the key is gone);
 *   "nested"   - a value that is not a string (not checked).
 * `_meta` is skipped.
 */
export function placeholderMismatches(enStrings, targetStrings, waivers = {}) {
  const out = [];
  for (const [key, value] of Object.entries(targetStrings)) {
    if (key === "_meta") continue;
    if (typeof value !== "string") {
      out.push({ kind: "nested", key, missing: [], extra: [], waive: [] });
      continue;
    }
    const ref = referenceKey(key, enStrings);
    if (ref === null) continue; // an unknown key is reported as "extra keys"
    const diff = placeholderDiff(pluralCategory(key, enStrings), enStrings[ref], value);
    const missing = [...diff.missing];
    const unused = [];
    for (const token of waivers[key]?.waive ?? []) {
      const i = missing.indexOf(token);
      if (i === -1) unused.push(token);
      else missing.splice(i, 1);
    }
    if (unused.length > 0) out.push({ kind: "stale", key, missing: [], extra: [], waive: unused });
    if (missing.length > 0 || diff.extra.length > 0) {
      out.push({ kind: "mismatch", key, missing, extra: diff.extra, waive: [] });
    }
  }
  for (const key of Object.keys(waivers)) {
    if (!(key in targetStrings)) {
      out.push({ kind: "stale", key, missing: [], extra: [], waive: waivers[key].waive ?? [] });
    }
  }
  return out;
}
