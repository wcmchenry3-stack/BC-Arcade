import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/tmp/claude-0/wt3698/frontend/package.json");
const init = require("canvaskit-wasm/bin/canvaskit.js");
export const CK = await init();
const FM = "/tmp/claude-0/wt3698/frontend/node_modules/@expo-google-fonts/";
const tf = (f) => CK.Typeface.MakeFreeTypeFaceFromData(fs.readFileSync(FM + f).buffer);
export const FONTS = { body: tf("manrope/600SemiBold/Manrope_600SemiBold.ttf"), bold: tf("manrope/700Bold/Manrope_700Bold.ttf"), head: tf("space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf") };
export const OUT = "/tmp/claude-0/-home-user-BC-Arcade/44eba4e8-df7f-57d0-86bb-989fc05932a9/scratchpad/proposals3698/";
export function surface(w, h, bg) {
  const s = CK.MakeSurface(w, h);
  const c = s.getCanvas();
  if (bg) c.clear(CK.parseColorString(bg));
  else c.clear(CK.TRANSPARENT);
  return { s, c };
}
export function save(s, name) {
  const img = s.makeImageSnapshot();
  const bytes = img.encodeToBytes();
  fs.writeFileSync(OUT + name, bytes);
  return bytes.length;
}
export function text(c, str, x, y, size, color, font = "body", align = "left") {
  const f = new CK.Font(FONTS[font], size);
  const p = new CK.Paint(); p.setAntiAlias(true); p.setColor(CK.parseColorString(color));
  let dx = 0;
  if (align !== "left") {
    const ids = f.getGlyphIDs(str); const w = f.getGlyphWidths(ids).reduce((a, b) => a + b, 0);
    dx = align === "center" ? -w / 2 : -w;
  }
  c.drawText(str, x + dx, y, p, f);
}
export function image(path) {
  return CK.MakeImageFromEncoded(fs.readFileSync(path));
}
