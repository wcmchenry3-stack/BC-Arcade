/**
 * Tests for the client-side Blackjack engine: the seedable RNG (`setRng`, `createSeededRng`).
 *
 * Ports backend/tests/test_blackjack_game.py so the two engines behave identically. Split out of
 * the former `engine.test.ts` (#2955) by exported-function cluster of `engine.ts`; describe blocks
 * moved whole, shared fixtures live in `helpers/engineFixtures.ts`.
 */
import { newGame, placeBet, stand, setRng, createSeededRng } from "../engine";

// --- Seedable RNG ---------------------------------------------------------

describe("seedable RNG (setRng + createSeededRng)", () => {
  afterEach(() => {
    // Restore default RNG so subsequent tests aren't affected.
    setRng(Math.random);
  });

  it("same seed produces identical shuffled decks", () => {
    setRng(createSeededRng(42));
    const a = newGame();
    setRng(createSeededRng(42));
    const b = newGame();
    expect(a.deck).toEqual(b.deck);
  });

  it("different seeds produce different decks", () => {
    setRng(createSeededRng(1));
    const a = newGame();
    setRng(createSeededRng(999));
    const b = newGame();
    expect(a.deck).not.toEqual(b.deck);
  });

  it("same seed replays identical placeBet outcome (deal order preserved)", () => {
    setRng(createSeededRng(7));
    const a = placeBet(newGame(), 100);
    setRng(createSeededRng(7));
    const b = placeBet(newGame(), 100);
    expect(a.player_hand).toEqual(b.player_hand);
    expect(a.dealer_hand).toEqual(b.dealer_hand);
    expect(a.phase).toEqual(b.phase);
    expect(a.outcome).toEqual(b.outcome);
  });

  it("same seed replays identical stand → dealer play sequence", () => {
    setRng(createSeededRng(123));
    let a = placeBet(newGame(), 100);
    if (a.phase === "player") a = stand(a);

    setRng(createSeededRng(123));
    let b = placeBet(newGame(), 100);
    if (b.phase === "player") b = stand(b);

    expect(a.player_hand).toEqual(b.player_hand);
    expect(a.dealer_hand).toEqual(b.dealer_hand);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.chips).toEqual(b.chips);
  });

  it("deck contains all 52 unique card types regardless of seed", () => {
    setRng(createSeededRng(12345));
    const { deck } = newGame();
    expect(deck).toHaveLength(312); // 6 decks
    const keys = new Set(deck.map((card) => `${card.rank}-${card.suit}`));
    expect(keys.size).toBe(52); // 52 unique card types, each repeated 6 times
  });

  it("setRng(Math.random) afterEach restores non-determinism", () => {
    const a = newGame();
    const b = newGame();
    // Two fresh shuffles from Math.random almost never match across 52 cards.
    expect(a.deck).not.toEqual(b.deck);
  });
});
