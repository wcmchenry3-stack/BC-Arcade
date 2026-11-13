/**
 * A mid-round reshuffle rebuilds the table's N-deck shoe (#3769). When the shoe runs dry, every
 * in-round draw (hit, split hit, double, split double, dealer play) must reshuffle to
 * `rules.deck_count` decks, not one. The shoe is emptied, then one card is drawn, so the new
 * shoe holds N x 52 - 1 cards.
 */
import { DEFAULT_RULES, EngineState, doubleDown, hit, split, stand } from "../engine";
import { c, splitSetup, stateInPlayer } from "./helpers/engineFixtures";

const DECKS = 2;
const RULES = { ...DEFAULT_RULES, deck_count: DECKS };
const FULL_MINUS_ONE = DECKS * 52 - 1;

/** A split round (8+3 and 8+3, hand 0 to act) whose shoe has run dry. */
function splitRoundWithEmptyShoe(): EngineState {
  const split1 = split({ ...splitSetup(), rules: RULES });
  return { ...split1, deck: [] };
}

describe("mid-round reshuffle keeps the table's deck count", () => {
  it("single-hand hit", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      rules: RULES,
      player_hand: [c("♠", "2"), c("♥", "3")], // no card can bust or make 21
      deck: [],
    };
    const next = hit(s);
    expect(next.phase).toBe("player");
    expect(next.deck).toHaveLength(FULL_MINUS_ONE);
  });

  it("split-hand hit", () => {
    const next = hit(splitRoundWithEmptyShoe());
    expect(next.deck).toHaveLength(FULL_MINUS_ONE);
  });

  it("single-hand double", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      rules: RULES,
      player_hand: [c("♠", "2"), c("♥", "3")],
      deck: [],
    };
    const next = doubleDown(s);
    // The dealer then plays from the same shoe: more than a 1-deck shoe, at most N x 52 - 1.
    expect(next.deck.length).toBeGreaterThan(52);
    expect(next.deck.length).toBeLessThanOrEqual(FULL_MINUS_ONE);
  });

  it("split double", () => {
    const next = doubleDown(splitRoundWithEmptyShoe());
    expect(next.deck).toHaveLength(FULL_MINUS_ONE);
  });

  it("dealer play", () => {
    const s: EngineState = {
      ...stateInPlayer(1000, 100),
      rules: RULES,
      dealer_hand: [c("♦", "2"), c("♣", "3")], // draws at least one card
      deck: [],
    };
    const next = stand(s);
    expect(next.deck.length).toBeGreaterThan(52);
    expect(next.deck.length).toBeLessThanOrEqual(FULL_MINUS_ONE);
  });
});
