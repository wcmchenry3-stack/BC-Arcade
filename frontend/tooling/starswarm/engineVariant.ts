/**
 * #2880 balance sim — a *sim-only* copy of the Star Swarm engine with tuning overrides.
 *
 * Node/Jest only (reads `engine.ts` from disk and compiles it with `typescript`); never imported
 * by the app. The real engine keeps its tuning as module-level constants, so to sweep a value
 * without touching gameplay code this loads the engine source, rewrites the named constant
 * declarations (and, for behaviour prototypes, exact code snippets), transpiles it and evaluates
 * it as a fresh, isolated module instance (its own rng and id counters).
 *
 * Every rewrite must match: a constant that no longer exists, or a snippet that no longer
 * appears verbatim, throws — so a prototype can never silently measure the unmodified engine.
 * With no overrides the variant is the real engine (a smoke test holds that it replays a seeded
 * run identically).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import type * as EngineModule from "../../src/game/starswarm/engine";

export type Engine = typeof EngineModule;

// CommonJS module scope under Jest/Node (the app's typecheck carries no Node types)
declare const __dirname: string;

/** A tuning override set: constant name → replacement TypeScript expression (source text). */
export type ConstOverrides = Readonly<Record<string, string>>;

/** A behaviour prototype: replace `find` (must appear exactly once) with `replace`. */
export interface SourcePatch {
  readonly find: string;
  readonly replace: string;
}

export interface EngineVariantSpec {
  readonly consts?: ConstOverrides;
  readonly patches?: readonly SourcePatch[];
}

const cache = new Map<string, Engine>();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The engine source with `spec` applied (exported for tests). */
export function patchEngineSource(src: string, spec: EngineVariantSpec): string {
  let out = src;
  for (const [name, expr] of Object.entries(spec.consts ?? {})) {
    // `[export ]const NAME[: Type] = <expr>;` — the expression runs to the first `;`
    const re = new RegExp(`(^|\\n)((?:export )?const ${escapeRe(name)}\\b[^=]*=)[^;]*;`);
    if (!re.test(out)) throw new Error(`engineVariant: no constant ${name} in engine.ts`);
    out = out.replace(re, (_m, pre: string, decl: string) => `${pre}${decl} ${expr};`);
  }
  for (const p of spec.patches ?? []) {
    const first = out.indexOf(p.find);
    if (first < 0 || out.indexOf(p.find, first + 1) >= 0) {
      throw new Error(
        `engineVariant: patch anchor must appear exactly once: ${p.find.slice(0, 80)}`
      );
    }
    out = out.replace(p.find, () => p.replace);
  }
  return out;
}

/** A fresh engine module with `spec` applied. Cached per spec. */
export function loadEngineVariant(spec: EngineVariantSpec = {}): Engine {
  const key = JSON.stringify(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  // the app's typecheck has no Node types, so the few Node calls used here are typed locally
  const fs = require("fs") as { readFileSync(p: string, enc: "utf8"): string };
  const path = require("path") as {
    resolve(...p: string[]): string;
    join(...p: string[]): string;
  };
  const ts = require("typescript") as typeof import("typescript");
  const dir = path.resolve(__dirname, "../../src/game/starswarm");
  const src = patchEngineSource(fs.readFileSync(path.join(dir, "engine.ts"), "utf8"), spec);
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = (id: string): unknown => {
    if (id.startsWith("./")) return require(path.join(dir, id.slice(2)));
    return require(id);
  };
  const g = globalThis as { __DEV__?: boolean };
  const fn = new Function("exports", "require", "module", "__DEV__", js) as (
    e: Record<string, unknown>,
    r: (id: string) => unknown,
    m: { exports: Record<string, unknown> },
    dev: boolean
  ) => void;
  fn(mod.exports, localRequire, mod, g.__DEV__ ?? false);
  const engine = mod.exports as unknown as Engine;
  cache.set(key, engine);
  return engine;
}
