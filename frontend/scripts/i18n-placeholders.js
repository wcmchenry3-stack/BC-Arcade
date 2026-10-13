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
 * English's `_other`. In `_zero`, `_one` and `_two` forms `{{count}}` is optional
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

/**
 * The English key a translated key is compared with: itself, or for a plural
 * form English lacks (ru `_few`, fr `_many`), English's `_other`. null if none.
 */
export function referenceKey(key, enStrings) {
  if (typeof enStrings[key] === "string") return key;
  if (!PLURAL_SUFFIX.test(key)) return null;
  const other = `${key.replace(PLURAL_SUFFIX, "")}_other`;
  return typeof enStrings[other] === "string" ? other : null;
}

/**
 * Placeholders the translation dropped (`missing`) or has that English does not
 * (`extra`). `key` is the translated key, for the plural rule above.
 */
export function placeholderDiff(key, enValue, targetValue) {
  const suffix = key.match(PLURAL_SUFFIX)?.[1];
  const skipCount = suffix !== undefined && COUNT_OPTIONAL.has(suffix);
  const prep = (v) => placeholderTokens(v).filter((t) => !(skipCount && t === "{{count}}"));
  const en = prep(enValue);
  const target = prep(targetValue);
  return { missing: difference(en, target), extra: difference(target, en) };
}

/**
 * Every placeholder mismatch in a locale file against English (flat key -> value
 * maps). `allowed` is a set of keys exempt from the check (the JSON allowlist).
 * Returns [{ key, missing, extra }]; _meta and non-string values are skipped.
 */
export function placeholderMismatches(enStrings, targetStrings, allowed = new Set()) {
  const out = [];
  for (const [key, value] of Object.entries(targetStrings)) {
    if (key === "_meta" || typeof value !== "string" || allowed.has(key)) continue;
    const ref = referenceKey(key, enStrings);
    if (ref === null) continue; // an unknown key is reported as "extra keys"
    const { missing, extra } = placeholderDiff(key, enStrings[ref], value);
    if (missing.length > 0 || extra.length > 0) out.push({ key, missing, extra });
  }
  return out;
}
