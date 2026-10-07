/**
 * Layout equivalence lock (#2968).
 *
 * Until #2968 every layout existed twice: a `layouts/<id>.ts` module and a
 * `assets/mahjong/layouts/<id>.json` file, and the registry loaded the JSON.
 * The JSON files were deleted and the registry now loads the TS modules.
 *
 * The fingerprints below are SHA-256 digests of each deleted JSON file's slot
 * list, serialised in array order as `col,row,layer;col,row,layer;...`. They
 * pin count, coordinates AND ordering — ordering matters because the deal
 * assigns tile faces to slots by index, so any reorder would change every
 * seeded deal (and every dealId).
 *
 * If you intentionally change a layout's geometry, update its fingerprint in
 * the same PR and call it out: it invalidates saved games and seeded deals for
 * that layout.
 */

import { createHash } from "crypto";
import { LAYOUTS, getLayout } from "../layouts/registry";
import type { Layout } from "../types";

const LAYOUT_FINGERPRINTS: Record<string, string> = {
  anchor: "cc3ae688c2ed9af4e7fdb8d40cdb6705f0dd8f651532878fcf76b541ac78a5ca",
  arena: "fa8c708b34260dc4fde1c1ebb451d4bf04fbb30a6a150e1f05bc85a0878dc11a",
  bridge: "16e9c2510ae85bcf04a4a2ca8380e5595d00f62aa309d0696c0cd200310d846a",
  butterfly: "ff4c0fb8fe71de646519af769fab1d76fe70b2c0900225050b49bebdb7d456d1",
  castle: "3a1462d9c8c412a94de091a6cd49cca2d094e37e94145604f2a5a0e9dfb0dd6e",
  cat: "533d037632e7cc24b8caffc518185742b54b43b2cb36b35d20735b3677dc1a89",
  concentric_squares: "5acf8ffe93d752d508c68f78e2ac39e79dcb15d7fef7c49149581d35ed60b4f4",
  crown: "9304ef7c952c63a856ce6306b3e4f3076a349ae024c6f8c40bd589276a92f5cd",
  diamond: "ef1d662e3e9278fee0bf4307a9d7cbdd6f49430f1fa0c2511cf173cd8fa3eff5",
  double_pyramid: "1851116d1d6f4e8aa8c88b06c69a12513b6c7c2b141dc2ede7e79e82873b2cf5",
  fish: "69635908bafb9fdf96a98c1e07b2d5a81241bd83a6617075f8f768914435e988",
  four_rivers: "09458464294052e589c7945194e2ef3db3487d008715c513e35571626be8c72f",
  gate: "4e9e9c81f3ef6b9a77af88ea5fe3424907d93881d0768a9b96d3338f1d65a1d2",
  heart: "d39b721be5fb3fea3e30aab1ebc069f950d428dea588ec5479d6cadc276b22bf",
  hourglass: "d93b962674a4f5f8d4fae352a30ef0078fc740ed5a04e57f51b0933fbfc815e1",
  maze: "6a380d7d41fd16a4bc86fe0143395c29834f3f064e0a8eba8dfe82d0a53ad05c",
  pyramid: "6ff82ca191f7bf99883e66a27874d78cb55d692b2533410bf327f407a99e8c05",
  shield: "371e26995e9b5ced00d1853b3b73527fd832f7555eafc438d34f6b1521f548d3",
  snowflake: "f75e9ee190c8a0d33d4ee7004128b8aed76ed2521abdc2ff1001af0b0a8c57b9",
  spider: "9c05b7361d1834b9da12333d6dacb5cd60aff471b3e9b747f619b5fc243fb799",
  square: "02e3d799609c2c359a801c6c0173b8b2d06b34071a93055b93d2101a5982dd23",
  the_key: "bd4f86b857b15e49c30b75aaf18c458f0b7ed533f62ca07d023366b4a333bf1e",
  turtle: "5d92cc7831b4c3e4e1cb3f30f514b5a1294f229d4bc65066a027adcd03ffef8c",
  x_wing: "f8c411f9dd7b88de6e503d86de0d20ae86b2991f96e1ff44a17879efc83ee138",
  zig_zag: "cde3d6268f26412404418f56505eae3d8dce3974680147c7be608e54846e6a4b",
};

function fingerprint(layout: Layout): string {
  const canon = layout.map((s) => `${s.col},${s.row},${s.layer}`).join(";");
  return createHash("sha256").update(canon).digest("hex");
}

describe("layout equivalence with the pre-#2968 JSON assets", () => {
  it("the registry holds exactly the fingerprinted layout ids, in no other set", () => {
    expect(LAYOUTS.map((m) => m.id).sort()).toEqual(Object.keys(LAYOUT_FINGERPRINTS).sort());
  });

  it.each(Object.keys(LAYOUT_FINGERPRINTS))(
    "%s is slot-for-slot identical (coords + order)",
    (id) => {
      expect(fingerprint(getLayout(id))).toBe(LAYOUT_FINGERPRINTS[id]);
    }
  );

  it("every registry layout deals onto the full board: tileCount slots, no duplicates, even per layer", () => {
    // Replaces scripts/validate-mahjong-layout.py: runs for every LAYOUTS
    // entry, so a newly registered layout is covered without editing id lists.
    for (const meta of LAYOUTS) {
      const layout = getLayout(meta.id);
      expect(layout).toHaveLength(meta.tileCount);
      expect(new Set(layout.map((s) => `${s.col},${s.row},${s.layer}`)).size).toBe(meta.tileCount);
      const byLayer = new Map<number, number>();
      for (const s of layout) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
      for (const [layer, count] of byLayer) {
        expect({ id: meta.id, layer, even: count % 2 === 0 }).toEqual({
          id: meta.id,
          layer,
          even: true,
        });
      }
    }
  });

  it("slots carry only col/row/layer (no extra keys that a JSON round-trip would drop)", () => {
    for (const { id } of LAYOUTS) {
      for (const s of getLayout(id)) {
        expect(Object.keys(s).sort()).toEqual(["col", "layer", "row"]);
      }
    }
  });
});
