/**
 * #3577: every real registry entry loads and is a DeckTheme with the id it is registered under.
 * The other deck suites mock the registry.
 *
 * Jest here cannot run a dynamic `import()` (no --experimental-vm-modules), so the registry's
 * source is compiled with a one-line Babel plugin that turns `import(x)` into
 * `Promise.resolve().then(() => require(x))`; the thunks run are the registry's own.
 */
import fs from "fs";
import path from "path";
import { transformSync, type PluginObj } from "@babel/core";
import type { DeckTheme } from "../types";
import { AVAILABLE_DECK_IDS } from "../registry";

type Thunk = () => Promise<{ default: DeckTheme }>;

const DIR = path.resolve(__dirname, "..");

function importToRequire({ types: t }: { types: typeof import("@babel/types") }): PluginObj {
  return {
    visitor: {
      CallExpression(p) {
        if (p.node.callee.type !== "Import") return;
        const req = t.callExpression(t.identifier("require"), p.node.arguments);
        p.replaceWith(
          t.callExpression(
            t.memberExpression(
              t.callExpression(
                t.memberExpression(t.identifier("Promise"), t.identifier("resolve")),
                []
              ),
              t.identifier("then")
            ),
            [t.arrowFunctionExpression([], req)]
          )
        );
      },
    },
  };
}

function loadRegistry(): Record<string, Thunk> {
  const src = fs.readFileSync(path.join(DIR, "registry.ts"), "utf8");
  const out = transformSync(src, {
    filename: "registry.ts",
    babelrc: false,
    configFile: false,
    plugins: [
      ["@babel/plugin-transform-typescript", { onlyRemoveTypeImports: true }],
      "@babel/plugin-transform-modules-commonjs",
      importToRequire,
    ],
  })!.code!;
  const exports: Record<string, unknown> = {};
  const localRequire = (p: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(path.resolve(DIR, p));
  new Function("exports", "require", out)(exports, localRequire);
  return exports.DECK_REGISTRY as Record<string, Thunk>;
}

const NAMES: Record<string, string> = {
  minimal: "Minimal",
  classic: "Classic",
  neon: "Neon",
  arcade: "Arcade",
  parlor: "Parlor",
  synthwave: "Synthwave",
};

describe("DECK_REGISTRY", () => {
  const registry = loadRegistry();

  it("registers the three BC decks next to the existing three", () => {
    expect(Object.keys(registry).sort()).toEqual(Object.keys(NAMES).sort());
    expect([...AVAILABLE_DECK_IDS].sort()).toEqual(Object.keys(NAMES).sort());
  });

  it.each(Object.keys(NAMES))("%s loads a DeckTheme with the right id and name", async (id) => {
    const mod = await registry[id]!();
    expect(mod.default.id).toBe(id);
    expect(mod.default.name).toBe(NAMES[id]);
    expect(typeof mod.default.CardFace).toBe("function");
  });
});
