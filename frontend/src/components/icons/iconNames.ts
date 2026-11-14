/**
 * The only icon glyphs the app ships (#3843). Each family is a subset font with
 * just these glyphs (`assets/fonts/*.subset.ttf`) and a matching glyph map, so
 * the full MaterialIcons (357 KB) and MaterialCommunityIcons (1.31 MB) fonts
 * and their 272 KB of glyph-map JSON stay out of the app.
 *
 * Adding an icon: add its name to the family's list below (names from
 * https://icons.expo.fyi, same family), run
 * `python tools/assets/subset_icon_fonts.py` from the repo root, and commit the
 * regenerated `.ttf` and `.glyphmap.json`. `tsc` rejects a name that is not
 * listed; `src/__tests__/iconSubset.test.ts` fails if the font or glyph map was
 * not regenerated.
 */

export const MATERIAL_ICON_NAMES = [
  "add",
  "arrow-back",
  "arrow-downward",
  "arrow-forward",
  "arrow-upward",
  "backspace",
  "call-split",
  "check-box",
  "check-box-outline-blank",
  "chevron-left",
  "chevron-right",
  "circle",
  "edit",
  "emoji-events",
  "feedback",
  "grid-view",
  "history",
  "info-outline",
  "insights",
  "lightbulb",
  "more-horiz",
  "pause",
  "person",
  "play-arrow",
  "refresh",
  "scoreboard",
  "settings",
  "shuffle",
  "sports-esports",
  "undo",
] as const;

export const MATERIAL_COMMUNITY_ICON_NAMES = [
  "account-remove-outline",
  "alert-circle-outline",
  "check",
  "check-circle-outline",
  "clock-outline",
  "cloud-off-outline",
  "cloud-upload-outline",
  "dice-multiple-outline",
  "equal",
  "exit-to-app",
  "flag-outline",
  "hand-back-right",
  "home-outline",
  "minus-circle-outline",
  "numeric-2-circle-outline",
  "play-circle-outline",
  "podium",
  "star",
  "star-outline",
  "trophy-outline",
] as const;

export type MaterialIconName = (typeof MATERIAL_ICON_NAMES)[number];
export type MaterialCommunityIconName = (typeof MATERIAL_COMMUNITY_ICON_NAMES)[number];
