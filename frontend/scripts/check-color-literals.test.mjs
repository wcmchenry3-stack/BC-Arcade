// Tests for check-color-literals.mjs. Run: node --test scripts/check-color-literals.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWLIST, ROOTS, checkRepo, scanSource } from "./check-color-literals.mjs";

const kinds = (src, opts) => scanSource(src, opts).map((h) => h.kind);

test("catches a hex colour and an rgba() call", () => {
  assert.deepEqual(kinds(`const a = { color: "#ffd700" };`), ["hex"]);
  assert.deepEqual(kinds(`const a = "rgba(0,0,0,0.5)";`), ["func"]);
});

test("catches a colour on the continuation line of a multi-line template, with its line", () => {
  const src = ["const s = `0 0 4px", "  #fff", "  rgba(0,0,0,.5)`;"].join("\n");
  const hits = scanSource(src);
  assert.deepEqual(
    hits.map((h) => [h.kind, h.line]),
    [
      ["hex", 2],
      ["func", 3],
    ]
  );
});

test("catches the false-negative forms", () => {
  assert.deepEqual(kinds(`x("#fff 1px solid");`), ["hex"]); // hex at the start of a longer string
  assert.deepEqual(kinds("x(`#fff${a}`);"), ["hex"]); // hex before a substitution
  assert.deepEqual(kinds("x(`rgba(${r},${g},${b},1)`);"), ["func"]); // rgba template
  assert.deepEqual(kinds(`x("RGBA(0,0,0,1)");`), ["func"]); // upper case
  assert.deepEqual(kinds(`x("0 8px 40px #00000099");`), ["hex"]); // hex inside a shadow
  assert.deepEqual(kinds(`x("hsl(120 50% 50%)");`), ["func"]);
});

test("catches whole-string named colours on a colour property", () => {
  assert.deepEqual(kinds(`const s = { color: "white" };`), ["named"]);
  assert.deepEqual(kinds(`const s = { backgroundColor: "Black" };`), ["named"]);
  assert.deepEqual(kinds(`<Rect fill="red" />;`), ["named"]);
  assert.deepEqual(kinds(`const s = { color: on ? "white" : x };`), ["named"]);
});

test("exempts transparent, tokens and non-colour strings", () => {
  assert.deepEqual(kinds(`const s = { backgroundColor: "transparent" };`), []);
  assert.deepEqual(kinds(`const s = { color: colors.text };`), []);
  assert.deepEqual(kinds("const s = `${colors.accent}55`;"), []);
  assert.deepEqual(kinds(`const label = { name: "red" };`), []); // not a colour property
  assert.deepEqual(kinds(`import x from "#fff";`), []); // module specifier
});

test("ignores comments and issue numbers", () => {
  assert.deepEqual(kinds(`// color: "#fff"\n/* rgba(0,0,0,1) */\nconst a = 1;`), []);
  assert.deepEqual(kinds(`const m = "see #2989 and #1234";`), []);
});

test("numeric 0x colours are flagged only when asked, and skip narrows a file", () => {
  assert.deepEqual(kinds("const c = 0xff00ffcc;"), []);
  assert.deepEqual(kinds("const c = 0xff00ffcc;", { numeric: true }), ["numeric"]);
  assert.deepEqual(
    kinds("const c = 0xff00ffcc; const d = '#fff';", { numeric: true, skip: ["numeric"] }),
    ["hex"]
  );
});

test("the allowlist has no stale entries and the repo is clean", () => {
  const { findings, stale } = checkRepo();
  assert.deepEqual(stale, []);
  assert.deepEqual(findings, []);
});

test("the roots cover shared game code and Cascade", () => {
  assert.ok(ROOTS.includes("game/_shared"));
  assert.ok(ROOTS.includes("game/cascade"));
  assert.ok(ALLOWLIST.every((e) => e.reason));
});
