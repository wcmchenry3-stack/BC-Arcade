#!/usr/bin/env node
/**
 * One-shot: inject six tooltip i18n keys into blackjack.json for every
 * non-English locale. Added for GH #1913 (table rules tooltip icons).
 *
 * Keys go immediately after rules.increasePenetrationLabel to mirror the
 * ordering in the English source file.
 *
 * English text is used as the fallback value for all locales; proper
 * translations can be applied later via:
 *   node scripts/translate.js --locale <code> --namespace blackjack
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../src/i18n/locales");

const locales = ["ar", "de", "es", "fr-CA", "he", "hi", "ja", "ko", "nl", "pt", "ru", "zh"];

const newKeys = {
  "rules.soft17TooltipLabel": "Information about Dealer Soft 17",
  "rules.decksTooltipLabel": "Information about Deck Count",
  "rules.penetrationTooltipLabel": "Information about Penetration",
  "rules.soft17Tooltip":
    "S17: Dealer stands on soft 17 — slightly better for the player. H17: Dealer hits on soft 17 — slightly better for the house.",
  "rules.decksTooltip":
    "Number of decks shuffled into the shoe. More decks increase the house edge slightly and make card counting harder.",
  "rules.penetrationTooltip":
    "How much of the shoe is dealt before reshuffling. 75% means 75% of cards are played before a new shuffle. Higher penetration = more variance.",
};

const ANCHOR = "rules.increasePenetrationLabel";

for (const locale of locales) {
  const path = join(LOCALES_DIR, locale, "blackjack.json");
  const data = JSON.parse(readFileSync(path, "utf8"));

  // Skip if already has the new keys
  if (Object.keys(data).some((k) => k.startsWith("rules.soft17TooltipLabel"))) {
    console.log(`Skipped ${locale} (already has keys)`);
    continue;
  }

  const newData = {};
  for (const [k, v] of Object.entries(data)) {
    newData[k] = v;
    if (k === ANCHOR) {
      for (const [nk, nv] of Object.entries(newKeys)) {
        newData[nk] = nv;
      }
    }
  }

  writeFileSync(path, JSON.stringify(newData, null, 2) + "\n", "utf8");
  console.log(`Updated ${locale}`);
}

console.log("Done.");
