# Mahjong Tile Assets

The 42 tile faces (`01-white-dragon.svg` through `42-bamboo.svg`) are **original artwork, drawn in
code** for BC Arcade (#3611) by `tools/assets/gen_mahjong_tiles.py`. Owned by the project; no
attribution required.

Regenerate them from the repo root with `python tools/assets/gen_mahjong_tiles.py`. The output is
deterministic: the same files every run.

**Lettering.** The Chinese characters are glyph outlines from **Yuji Syuku** (Copyright 2021 The
Yuji Project Authors, https://github.com/Kinutafontfactory/Yuji), licensed under the **SIL Open
Font License 1.1**. They are reshaped per character in the generator, for example the tapering
tail on 中 and the flared base on 東 and 萬. The outlines are cached in
`tools/assets/mahjong_glyphs.json`, with the font's licence in
`tools/assets/mahjong_glyphs.OFL.txt`. No font file ships in the app.

Until #3611 the faces were vendored from `samoheen/mahjong-tiles` (CC0), whose source and licence
were never recorded in the asset-rights audit (U1).
