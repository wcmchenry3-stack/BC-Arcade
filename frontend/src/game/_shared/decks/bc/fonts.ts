import { typography } from "../../../../theme/typography";

/** The two bold faces the BC decks use (the mockup's Manrope 800 is not loaded; 700 stands in). */
export interface BcFonts {
  readonly space: string;
  readonly manrope: string;
}

export const BC_FONTS: BcFonts = { space: typography.heading, manrope: typography.label };
