/**
 * #2960 guard: the board's Picture is recorded on the UI thread, so every function the
 * `useDerivedValue` callback in `CascadeBoard` can reach must be a worklet. Jest replaces
 * Reanimated with a stub, so a missing `"worklet"` directive passes every other test and only
 * fails on a device (the first call throws, the board's try/catch swallows it, and the board
 * draws almost nothing). This runs the real worklets Babel plugin over the source and checks that
 * each such function comes out with a `__workletHash`.
 *
 * Reachable today: everything in `drawFrame.ts`, and every function it imports from a Cascade
 * module (`lidVisuals.ts`, `frame.ts`), plus what those call in their own module.
 */
import * as fs from "fs";
import * as path from "path";
import { parseSync, transformSync, traverse, types as t } from "@babel/core";

const RENDER = path.resolve(__dirname, "..");
const DRAW_FRAME = path.join(RENDER, "drawFrame.ts");

/** Parse TypeScript as-is (no type stripping is needed to read the output). */
const TS = { plugins: ["typescript" as const] };

function source(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function parse(file: string) {
  return parseSync(source(file), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: TS,
  })!;
}

/** Top-level function declarations of a module, by name. */
function functionsOf(file: string): Set<string> {
  const names = new Set<string>();
  for (const node of parse(file).program.body) {
    const decl = t.isExportNamedDeclaration(node) ? node.declaration : node;
    if (t.isFunctionDeclaration(decl) && decl.id) names.add(decl.id.name);
  }
  return names;
}

/** Names that the real worklets plugin turned into worklets (they carry a `__workletHash`). */
function workletsOf(file: string): Set<string> {
  const out = transformSync(source(file), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: TS,
    plugins: [require.resolve("react-native-worklets/plugin")],
  })!.code!;
  return new Set([...out.matchAll(/(\w+)\.__workletHash\s*=/g)].map((m) => m[1]!));
}

/** Relative imports of `file` that are functions declared in the imported module: [module, name]. */
function importedFunctions(file: string): [string, string][] {
  const found: [string, string][] = [];
  traverse(parse(file), {
    ImportDeclaration(p) {
      const from = p.node.source.value;
      if (!from.startsWith(".") || p.node.importKind === "type") return;
      const target = path.resolve(path.dirname(file), `${from}.ts`);
      const fns = functionsOf(target);
      for (const spec of p.node.specifiers) {
        if (!t.isImportSpecifier(spec) || spec.importKind === "type") continue;
        const name = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
        if (fns.has(name)) found.push([target, name]);
      }
    },
  });
  return found;
}

describe("UI-thread board renderer: every reachable function is a worklet", () => {
  it("every function in drawFrame.ts", () => {
    const worklets = workletsOf(DRAW_FRAME);
    const missing = [...functionsOf(DRAW_FRAME)].filter((n) => !worklets.has(n));
    expect(missing).toEqual([]);
  });

  it("every Cascade function drawFrame.ts imports, and every function in those modules it reaches", () => {
    const imported = importedFunctions(DRAW_FRAME);
    expect(imported.map(([, n]) => n)).toEqual(
      expect.arrayContaining(["overLidWash", "lidColor", "ringState", "ringArcPath"])
    );
    const missing: string[] = [];
    for (const target of new Set(imported.map(([f]) => f))) {
      // lidVisuals' mappings call each other (clamp01, mixHex, isOverLid): require all of them.
      const worklets = workletsOf(target);
      const need = target.endsWith("lidVisuals.ts")
        ? [...functionsOf(target)]
        : imported.filter(([f]) => f === target).map(([, n]) => n);
      for (const n of need) if (!worklets.has(n)) missing.push(`${path.basename(target)}:${n}`);
    }
    expect(missing).toEqual([]);
  });
});
