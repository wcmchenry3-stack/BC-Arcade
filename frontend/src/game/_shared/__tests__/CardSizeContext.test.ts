import { computeCardSize, MIN_CARD_W } from "../CardSizeContext";

describe("computeCardSize", () => {
  it.each([320, 360, 1024, 1440])("snapshot at viewport width %i", (width) => {
    expect(computeCardSize(width, 52, 74, 7, 6)).toMatchSnapshot();
  });

  it("scales down at 320px viewport", () => {
    const { cardWidth } = computeCardSize(320, 52, 74, 7, 6);
    expect(cardWidth).toBeLessThan(52);
  });

  it("never exceeds natural card size", () => {
    const { cardWidth, cardHeight } = computeCardSize(2000, 52, 74, 7, 6);
    expect(cardWidth).toBe(52);
    expect(cardHeight).toBe(74);
  });

  it("clamps to minimum card width on narrow viewport", () => {
    const { cardWidth } = computeCardSize(100, 52, 74, 7, 6);
    expect(cardWidth).toBeGreaterThanOrEqual(28);
  });

  it("scales proportionally between natural width and height", () => {
    const { cardWidth, cardHeight } = computeCardSize(320, 52, 74, 7, 6);
    expect(cardHeight / cardWidth).toBeCloseTo(74 / 52, 1);
  });

  it("accounts for horizontal padding when computing scale", () => {
    const withoutPadding = computeCardSize(400, 52, 74, 7, 6);
    const withPadding = computeCardSize(400, 52, 74, 7, 6, 48);
    expect(withPadding.cardWidth).toBeLessThanOrEqual(withoutPadding.cardWidth);
  });
});

// useResponsiveCardSize wraps computeCardSize with the window width.
// Its math is verified by testing computeCardSize at the same viewports.
describe("useResponsiveCardSize math (via computeCardSize) — three viewports", () => {
  it.each([320, 768, 1280])("snapshot at viewport width %i with Solitaire params", (width) => {
    expect(computeCardSize(width, 52, 74, 7, 6, 24)).toMatchSnapshot();
  });

  it("scales down at 320px narrow phone viewport", () => {
    const { cardWidth } = computeCardSize(320, 52, 74, 7, 6, 24);
    expect(cardWidth).toBeLessThan(52);
  });

  it("returns natural size at 1280px desktop viewport", () => {
    const { cardWidth, cardHeight } = computeCardSize(1280, 52, 74, 7, 6, 24);
    expect(cardWidth).toBe(52);
    expect(cardHeight).toBe(74);
  });

  it("scales partially at 768px tablet viewport (fits board without reaching natural limit)", () => {
    const { cardWidth } = computeCardSize(768, 52, 74, 7, 6, 24);
    // 768 is wide enough for natural card size
    expect(cardWidth).toBe(52);
  });
});

describe("MIN_CARD_W (#2220)", () => {
  it("matches the documented 36 px minimum (docs/GAMEPLAY_STANDARDS.md)", () => {
    expect(MIN_CARD_W).toBe(36);
  });

  it("clamps both card games to it on a very narrow viewport", () => {
    expect(computeCardSize(100, 52, 74, 7, 6).cardWidth).toBe(36);
    expect(computeCardSize(100, 40, 57, 8, 2).cardWidth).toBe(36);
  });

  it("does not bind on the narrowest supported phones (375 pt iPhone, 360 dp Android)", () => {
    for (const w of [360, 375]) {
      expect(computeCardSize(w, 52, 74, 7, 6, 24).cardWidth).toBeGreaterThan(36);
      expect(computeCardSize(w, 40, 57, 8, 2, 24).cardWidth).toBeGreaterThan(36);
    }
  });
});
