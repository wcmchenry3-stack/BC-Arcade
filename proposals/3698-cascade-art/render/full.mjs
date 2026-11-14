import { CK, surface, save, text } from "./ck.mjs";
import { drawPiece, STYLES } from "../art/styles.mjs";
import { FRUITS } from "../art/fruits.mjs";
import { COSMOS } from "../art/cosmos.mjs";
const RAD = [18,20,23,25,28,32,36,40,45,50,56,63];
const style = process.argv[2] ?? "flat";
const bg = process.argv[3] ?? "#19191f";
const cell = 180, r = 62;
const { s, c } = surface(cell * 12, cell * 2 + 60, bg);
text(c, STYLES[style].title + " — all 24 pieces (equal size, for detail)", 20, 40, 30, bg === "#19191f" ? "#e8e8f0" : "#1a1412", "head");
[FRUITS, COSMOS].forEach((set, row) => set.forEach((p, i) => {
  drawPiece(CK, c, p, style, cell * i + cell / 2, 60 + row * cell + cell / 2 + 10, r, 0);
  text(c, p.name, cell * i + cell / 2, 60 + row * cell + cell - 4, 18, bg === "#19191f" ? "#a0a0ac" : "#6b5e4a", "body", "center");
}));
console.log(save(s, `full24_${style}.png`));
