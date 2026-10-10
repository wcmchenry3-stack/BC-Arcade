/**
 * explainCardToPlay / explainCardsToPass (#3163): the same decision as
 * selectCardToPlay / selectCardsToPass, with the principle behind it.
 */
import { explainCardToPlay, explainCardsToPass, selectCardToPlay, selectCardsToPass } from "../ai";
import { choosePass } from "../conservative/pass";
import { choosePlay } from "../conservative/play";
import { commitPass, createSeededRng, dealGame, selectPassCard, setRng } from "../engine";
import type { HeartsState } from "../types";

function playingState(): HeartsState {
  setRng(createSeededRng(7));
  let s = dealGame("conservative");
  for (let seat = 0; seat < 4; seat++) {
    for (const c of choosePass([...s.playerHands[seat]!], s.passDirection).cards) {
      s = selectPassCard(s, seat, c);
    }
  }
  return commitPass(s);
}

describe("explainCardsToPass", () => {
  it("conservative: the same three cards as selectCardsToPass, each with its principle", () => {
    setRng(createSeededRng(7));
    const s = dealGame("conservative");
    const hand = [...s.playerHands[1]!];
    const out = explainCardsToPass(hand, s.passDirection, "conservative", 1);
    expect(out.map((e) => e.card)).toEqual(
      selectCardsToPass(hand, s.passDirection, "conservative", 1)
    );
    const d = choosePass(hand, s.passDirection);
    expect(out.map((e) => e.principle)).toEqual(d.principles);
    expect(out.map((e) => e.reason)).toEqual(d.reasons);
    for (const e of out) expect(e.principle).toMatch(/^P\d/);
  });

  it("legacy personas have no principle", () => {
    setRng(createSeededRng(7));
    const s = dealGame("schemer");
    const out = explainCardsToPass([...s.playerHands[1]!], s.passDirection, "schemer", 1);
    expect(out).toHaveLength(3);
    for (const e of out) expect(e).toMatchObject({ principle: null, reason: "" });
  });
});

describe("explainCardToPlay", () => {
  it("conservative: the card selectCardToPlay returns, with the CPU's principle and reason", () => {
    const s = playingState();
    const seat = s.currentPlayerIndex;
    const hand = s.playerHands[seat]! as never;
    const out = explainCardToPlay(hand, s.currentTrick as never, s, seat, "conservative");
    expect(out).toEqual(choosePlay(s, seat));
    expect(selectCardToPlay(hand, s.currentTrick as never, s, seat, "conservative")).toEqual(
      out.card
    );
    expect(out.reason).not.toBe("");
  });

  it("legacy personas have no principle", () => {
    const s = playingState();
    const seat = s.currentPlayerIndex;
    const out = explainCardToPlay(s.playerHands[seat]! as never, [], s, seat, "schemer");
    expect(out.principle).toBeNull();
    expect(out.reason).toBe("");
    expect(
      s.playerHands[seat]!.some((c) => c.suit === out.card.suit && c.rank === out.card.rank)
    ).toBe(true);
  });
});
