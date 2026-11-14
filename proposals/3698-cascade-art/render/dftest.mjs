import { CK, surface, save, image } from "./ck.mjs";
import { drawPiece } from "../art/styles.mjs";
import { dragonfruit } from "../art/dragonfruit.mjs";
const { s, c } = surface(1800, 640, "#ffffff");
const ref = image("/tmp/claude-0/-home-user-BC-Arcade/44eba4e8-df7f-57d0-86bb-989fc05932a9/scratchpad/df_ref.png");
c.drawImageRect(ref, CK.LTRBRect(0,0,2000,2000), CK.LTRBRect(0,0,600,600), new CK.Paint());
["A","B","C"].forEach((t,i)=>drawPiece(CK, c, dragonfruit(t), "kawaii", 600+i*400+200, 360, 135, 0));
save(s, "_dftest.png");
