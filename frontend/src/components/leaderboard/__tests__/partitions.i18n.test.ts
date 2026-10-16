/** #2221: Star Swarm rank labels are translated for display; the partition id stays the tier key. */
import i18n from "i18next";
import EsStarswarm from "../../../i18n/locales/es/starswarm.json";
import FrCaStarswarm from "../../../i18n/locales/fr-CA/starswarm.json";

import { partitionValueLabel } from "../partitions";
import { DIFFICULTY_TIERS } from "../../../game/starswarm/engine";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Star Swarm tier partition label (#2221)", () => {
  it("shows the English rank name by default", () => {
    expect(partitionValueLabel(i18n.t, "starswarm", "difficulty_tier", "RearAdmiral")).toBe(
      "Rear Admiral"
    );
  });

  it("shows the translated rank in Spanish", async () => {
    i18n.addResourceBundle("es", "starswarm", EsStarswarm);
    await i18n.changeLanguage("es");
    expect(partitionValueLabel(i18n.t, "starswarm", "difficulty_tier", "Commander")).toBe(
      "Comandante"
    );
  });

  it("has a translation for every tier (no raw id falls through)", async () => {
    i18n.addResourceBundle("fr-CA", "starswarm", FrCaStarswarm);
    await i18n.changeLanguage("fr-CA");
    for (const tier of DIFFICULTY_TIERS) {
      const label = partitionValueLabel(i18n.t, "starswarm", "difficulty_tier", tier);
      expect(label).not.toBe(tier);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
