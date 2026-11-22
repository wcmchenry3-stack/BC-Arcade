/**
 * freeCellBoardGeometry with Large cards on (#3653 review): whenever the board is
 * drawn with the fitted cards it still sits in the horizontal scroller, so the
 * scroller's top and bottom padding come off the fitted height.
 */
import { SCROLL_PAD, freeCellBoardGeometry, freeCellGeometry } from "../layout";
import { LARGE_CARD_WIDTH } from "../largeCards";

const TALLEST = [new Array(19).fill(0), [0]];

describe("freeCellBoardGeometry", () => {
  it("Large cards off: the fitted cards for the whole felt", () => {
    const { geometry, large } = freeCellBoardGeometry({
      width: 361,
      height: 494,
      largeCards: false,
      tableau: TALLEST,
    });
    expect(large).toBe(false);
    expect(geometry).toEqual(freeCellGeometry({ width: 361, height: 494 }));
  });

  it("Large cards fallen back: the fitted cards for the felt less the scroller's padding", () => {
    const { geometry, large, fallbackAt } = freeCellBoardGeometry({
      width: 361,
      height: 494,
      largeCards: true,
      tableau: TALLEST,
    });
    expect(large).toBe(false);
    expect(fallbackAt).toBe(19);
    expect(geometry).toEqual(freeCellGeometry({ width: 361, height: 494 - 2 * SCROLL_PAD }));
  });

  it("Large cards on a tablet (fitted cards already wider): the same padding comes off", () => {
    const { geometry, large } = freeCellBoardGeometry({
      width: 1000,
      height: 1200,
      largeCards: true,
      tableau: TALLEST,
    });
    expect(large).toBe(false);
    expect(geometry.cardWidth).toBeGreaterThanOrEqual(LARGE_CARD_WIDTH);
    expect(geometry).toEqual(freeCellGeometry({ width: 1000, height: 1200 - 2 * SCROLL_PAD }));
  });
});
