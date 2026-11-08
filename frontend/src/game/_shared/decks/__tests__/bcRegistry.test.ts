/**
 * #3577: every registry entry resolves to the right deck. The other deck suites mock the
 * registry, and Jest here cannot run a dynamic `import()` (no --experimental-vm-modules), so
 * the registry's thunks cannot be called. Instead: the registry source must map each id to
 * `import("./<id>")` (the directory the deck lives in), and each of those directories' real
 * index must export a DeckTheme with that id and its display name.
 */
import fs from "fs";
import path from "path";
import { AVAILABLE_DECK_IDS, DECK_REGISTRY } from "../registry";
import type { DeckTheme } from "../types";

const NAMES: Record<string, string> = {
  minimal: "Minimal",
  classic: "Classic",
  neon: "Neon",
  arcade: "Arcade",
  parlor: "Parlor",
  synthwave: "Synthwave",
};

/** `id -> directory` for every `id: () => import("./dir")` line of registry.ts. */
function registryTargets(): Record<string, string> {
  const src = fs.readFileSync(path.join(__dirname, "..", "registry.ts"), "utf8");
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*(\w+):\s*\(\)\s*=>\s*import\("\.\/([\w-]+)"\)/gm)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe("DECK_REGISTRY", () => {
  const targets = registryTargets();

  it("registers the three BC decks next to the existing three", () => {
    expect(Object.keys(targets).sort()).toEqual(Object.keys(NAMES).sort());
    expect(Object.keys(DECK_REGISTRY).sort()).toEqual(Object.keys(NAMES).sort());
    expect([...AVAILABLE_DECK_IDS].sort()).toEqual(Object.keys(NAMES).sort());
    for (const thunk of Object.values(DECK_REGISTRY)) expect(typeof thunk).toBe("function");
  });

  it.each(Object.keys(NAMES))("%s: its import target is the deck with that id and name", (id) => {
    expect(targets[id]).toBe(id);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const deck = require(`../${targets[id]}`).default as DeckTheme;
    expect(deck.id).toBe(id);
    expect(deck.name).toBe(NAMES[id]);
    expect(typeof deck.CardFace).toBe("function");
  });
});
