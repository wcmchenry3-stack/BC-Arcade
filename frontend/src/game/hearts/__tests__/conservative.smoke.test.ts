/**
 * Smoke test for the conservative CPU (#3159): full seeded hands with four
 * conservative seats through the real engine. Every pass and play must be
 * legal, explained by a principle from docs/hearts/CONSERVATIVE_AI.md, and
 * made without touching the RNG.
 */
import { selectCardToPlay, selectCardsToPass } from "../ai";
import {
  commitPass,
  createSeededRng,
  dealGame,
  dealNextHand,
  getValidPlays,
  playCard,
  selectPassCard,
  setRng,
} from "../engine";
import { choosePass } from "../conservative/pass";
import { choosePlay } from "../conservative/play";
import type { HeartsState } from "../types";

const PLAY_PRINCIPLES = [
  "P1-DUCK",
  "P2-FREE-TRICK",
  "P3-SHED",
  "P5-QUEEN",
  "P6-DISCARD",
  "P7-MOON-GUARD",
  "P9-EXIT",
];
const PASS_STEPS = ["P5-QUEEN", "P6-DISCARD", "P4-DANGER"];
const HANDS = 60;

const key = (c: { suit: string; rank: number }) => `${c.rank}${c.suit}`;

afterEach(() => setRng(Math.random));

it(`plays ${HANDS} seeded hands with four conservative seats: legal, explained, no RNG`, () => {
  let state: HeartsState | null = null;
  const seen = new Set<string>();
  let decisions = 0;

  for (let h = 0; h < HANDS; h++) {
    // Only the deal draws from the RNG.
    setRng(createSeededRng(1000 + h));
    state = !state || state.phase === "game_over" ? dealGame("conservative") : dealNextHand(state);
    const rng = jest.fn(() => 0.5);
    setRng(rng);

    if (state.phase === "passing") {
      for (let seat = 0; seat < 4; seat++) {
        const hand = [...state.playerHands[seat]!];
        const d = choosePass(hand, state.passDirection);
        expect(new Set(d.cards.map(key)).size).toBe(3);
        for (const c of d.cards) expect(hand.map(key)).toContain(key(c));
        for (const p of d.principles) expect(PASS_STEPS).toContain(p);
        expect(selectCardsToPass(hand, state.passDirection, "conservative", seat)).toEqual(d.cards);
        for (const c of d.cards) state = selectPassCard(state, seat, c);
      }
      state = commitPass(state);
    }

    for (let n = 0; n < 52; n++) {
      const seat: number = state.currentPlayerIndex;
      const legal = getValidPlays(state, seat);
      const d = choosePlay(state, seat);
      expect(legal.map(key)).toContain(key(d.card));
      if (legal.length === 1) expect(d.principle).toBeNull();
      else expect(PLAY_PRINCIPLES).toContain(d.principle);
      if (d.principle) seen.add(d.principle);
      const hand = [...state.playerHands[seat]!];
      expect(selectCardToPlay(hand, [...state.currentTrick], state, seat, "conservative")).toEqual(
        d.card
      );
      state = playCard(state, seat, d.card);
      decisions++;
    }
    expect(state.tricksPlayedInHand).toBe(13);
    expect(["dealing", "game_over"]).toContain(state.phase);
    expect(rng).not.toHaveBeenCalled();
  }

  expect(decisions).toBe(HANDS * 52);
  // Over this many hands the everyday principles all decide something.
  for (const p of ["P1-DUCK", "P2-FREE-TRICK", "P3-SHED", "P5-QUEEN", "P6-DISCARD", "P9-EXIT"]) {
    expect(seen).toContain(p);
  }
});
