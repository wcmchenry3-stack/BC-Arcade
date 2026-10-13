// Tests for i18n-placeholders.js. Run: node --test scripts/i18n-placeholders.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeholderMismatches, placeholderTokens, referenceKey } from "./i18n-placeholders.js";

const runAll = (en, target, waivers) => placeholderMismatches(en, target, waivers);
// Just the placeholder mismatches, as { key, missing, extra }.
const run = (en, target, waivers) =>
  runAll(en, target, waivers)
    .filter((i) => i.kind === "mismatch")
    .map(({ key, missing, extra }) => ({ key, missing, extra }));

test("tokens: formats and escape flag reduce to the name; tags and nests are kept", () => {
  assert.deepEqual(placeholderTokens("{{ n, number }} {{- x}} {{y}}"), ["{{n}}", "{{x}}", "{{y}}"]);
  assert.deepEqual(placeholderTokens("<0>a</0><1/><bold>b</bold>"), [
    "<0>",
    "</0>",
    "<1/>",
    "<bold>",
    "</bold>",
  ]);
  assert.deepEqual(placeholderTokens("$t(common:ok) and $t(x, {})"), ["$t(common:ok)", "$t(x)"]);
});

test("identical placeholders pass, reordered pass", () => {
  assert.deepEqual(run({ a: "{{x}} of {{y}}" }, { a: "{{y}} de {{x}}" }), []);
});

test("a dropped placeholder fails", () => {
  assert.deepEqual(run({ a: "{{x}} of {{y}}" }, { a: "{{x}} de" }), [
    { key: "a", missing: ["{{y}}"], extra: [] },
  ]);
});

test("a renamed placeholder fails (both ways)", () => {
  assert.deepEqual(run({ a: "{{count}} left" }, { a: "{{nombre}} restant" }), [
    { key: "a", missing: ["{{count}}"], extra: ["{{nombre}}"] },
  ]);
});

test("a duplicated or added placeholder fails", () => {
  assert.equal(run({ a: "{{x}}" }, { a: "{{x}} {{x}}" })[0].extra[0], "{{x}}");
  assert.equal(run({ a: "hi" }, { a: "hi {{x}}" })[0].extra[0], "{{x}}");
});

test("a differing format on the same name passes", () => {
  assert.deepEqual(run({ a: "{{n, number}}" }, { a: "{{n}}" }), []);
});

test("a dropped Trans tag fails; moved tags pass", () => {
  const en = { a: "Read <0>the rules</0>" };
  assert.deepEqual(run(en, { a: "Lire <0>les règles" }), [
    { key: "a", missing: ["</0>"], extra: [] },
  ]);
  assert.deepEqual(run(en, { a: "<0>Les règles</0> à lire" }), []);
  assert.equal(run(en, { a: "Lire les règles" }).length, 1);
});

test("plural _one may omit {{count}}; other placeholders still checked", () => {
  const en = {
    w_one: "{{count}} word",
    w_other: "{{count}} words",
    s_one: "{{count}} of {{y}}",
    s_other: "x",
  };
  assert.deepEqual(run(en, { w_one: "un mot", w_other: "{{count}} mots" }), []);
  assert.deepEqual(run(en, { w_one: "{{count}} mot" }), []);
  assert.equal(run(en, { w_other: "mots" }).length, 1); // _other is strict
  assert.deepEqual(run(en, { s_one: "un de {{z}}" }), [
    { key: "s_one", missing: ["{{y}}"], extra: ["{{z}}"] },
  ]);
});

test("a locale-only plural form is compared with English _other", () => {
  const en = { w_one: "{{count}} word", w_other: "{{count}} words" };
  assert.equal(referenceKey("w_many", en), "w_other");
  assert.deepEqual(run(en, { w_many: "{{count}} de mots" }), []);
  assert.deepEqual(run(en, { w_many: "des mots" }), [
    { key: "w_many", missing: ["{{count}}"], extra: [] },
  ]);
  assert.deepEqual(run(en, { w_few: "{{n}} слова" }), [
    { key: "w_few", missing: ["{{count}}"], extra: ["{{n}}"] },
  ]);
});

test("_meta and unknown keys are skipped", () => {
  const en = { a: "{{x}}" };
  assert.deepEqual(runAll(en, { _meta: { b: "{{y}}" }, unknown: "{{z}}" }), []);
});

test("a nested (non-string) value is reported, not silently skipped", () => {
  const issues = runAll({ a: "x" }, { a: { b: "{{y}}" }, c: ["z"] });
  assert.deepEqual(
    issues.map((i) => [i.kind, i.key]),
    [
      ["nested", "a"],
      ["nested", "c"],
    ]
  );
});

const waiver = (waive) => ({ a_one: { waive, reason: "r" } });
const enPlural = { a_one: "{{value}} pt", a_other: "{{value}} pts" };

test("a waived token may be missing; the rest still passes", () => {
  assert.deepEqual(runAll(enPlural, { a_one: "one point" }, waiver(["{{value}}"])), []);
});

test("an unrelated extra token on a waived key still fails", () => {
  assert.deepEqual(runAll(enPlural, { a_one: "one {{bogus}}" }, waiver(["{{value}}"])), [
    { kind: "mismatch", key: "a_one", missing: [], extra: ["{{bogus}}"], waive: [] },
  ]);
});

test("another missing token on a waived key still fails", () => {
  const en = { a_one: "{{value}} {{unit}}", a_other: "x" };
  assert.equal(run(en, { a_one: "one" }, waiver(["{{value}}"]))[0].missing[0], "{{unit}}");
});

test("a stale waiver fails: token not missing, or key gone", () => {
  assert.deepEqual(runAll(enPlural, { a_one: "{{value}} pt" }, waiver(["{{value}}"])), [
    { kind: "stale", key: "a_one", missing: [], extra: [], waive: ["{{value}}"] },
  ]);
  assert.equal(runAll(enPlural, {}, waiver(["{{value}}"]))[0].kind, "stale");
});

test("a key is a plural form only when English has the _other sibling", () => {
  const en = { "g.moves_at_least_one": "{{count}} moves" };
  // Not a plural: {{count}} is required, and there is no _other to compare _many with.
  assert.equal(run(en, { "g.moves_at_least_one": "un mouvement" }).length, 1);
  assert.equal(referenceKey("g.moves_at_least_many", en), null);
});

test("text inside a placeholder is part of its name", () => {
  assert.deepEqual(placeholderTokens("{{count bogus}} {{ count }}"), [
    "{{count bogus}}",
    "{{count}}",
  ]);
});
