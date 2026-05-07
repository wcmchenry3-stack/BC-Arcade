/**
 * Term glossary for the BC Arcade i18n workflow.
 *
 * Used by scripts/translate.js — injected into OpenAI system prompts
 * so protected terms are never translated or modified.
 *
 * Schema per entry:
 *   category        — 'brand' | 'game' | 'fruit' | 'acronym'
 *   doNotTranslate  — true = never hand to translator
 *   reason          — why this term is protected
 *   definition      — context for the AI translator
 *   notes           — casing or locale-specific guidance
 */
export const glossary = {
  // ─── Game brands ─────────────────────────────────────────────────────────

  Yacht: {
    category: "brand",
    doNotTranslate: true,
    reason: "Game name. Must not be translated.",
    definition: "Classic dice game where players roll five dice to score combinations.",
    notes: "Always capitalize exactly as shown.",
  },

  "Yacht!": {
    category: "game",
    doNotTranslate: true,
    reason: "The scoring category worth 50 points. Translating would confuse game mechanics.",
    definition: "A scoring category in the Yacht game — achieved by rolling five of a kind.",
    notes: "Includes the exclamation mark. Keep as-is in all locales.",
  },

  "Cascade": {
    category: "brand",
    doNotTranslate: true,
    reason: "The name of the Cascade game. Used as a proper noun.",
    definition: "A physics-based fruit dropping and merging game.",
    notes: "One word, capitalized.",
  },

  "BC Arcade": {
    category: "brand",
    doNotTranslate: true,
    reason: "The app name. Translating would break app store identity.",
    definition: "The name of this application.",
    notes: null,
  },

  // ─── Fruit names (data layer — appear in game events) ────────────────────

  Cherry: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier in engine events.",
    definition: "The smallest fruit tier in Cascade.",
    notes: null,
  },

  Strawberry: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 2 fruit in Cascade.",
    notes: null,
  },

  Grape: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 3 fruit in Cascade.",
    notes: null,
  },

  Orange: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 4 fruit in Cascade.",
    notes: null,
  },

  Apple: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 5 fruit in Cascade.",
    notes: null,
  },

  Pear: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 6 fruit in Cascade.",
    notes: null,
  },

  Peach: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 7 fruit in Cascade.",
    notes: null,
  },

  Pineapple: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 8 fruit in Cascade.",
    notes: null,
  },

  Melon: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier.",
    definition: "Tier 9 fruit in Cascade.",
    notes: null,
  },

  Watermelon: {
    category: "fruit",
    doNotTranslate: true,
    reason: "Fruit name used as game piece identifier. Also the highest-tier merge goal.",
    definition: "Tier 10 (max) fruit in Cascade.",
    notes: null,
  },
};

/**
 * Flat list of terms that must never be modified in translated strings.
 * Used by scripts/translate.js to validate translation output.
 */
export const doNotTranslateTerms = Object.entries(glossary)
  .filter(([, meta]) => meta.doNotTranslate)
  .map(([term]) => term);
