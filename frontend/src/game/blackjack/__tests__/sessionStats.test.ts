import { initialSessionStats, reduceHandResolved } from "../sessionStats";

describe("initialSessionStats", () => {
  it("returns zeroed counters anchored to startingChips", () => {
    expect(initialSessionStats(1000)).toEqual({
      startingChips: 1000,
      chips: 1000,
      plChips: 0,
      handsPlayed: 0,
      handsWon: 0,
      handsLost: 0,
      handsPushed: 0,
      blackjacks: 0,
      busts: 0,
      biggestWin: 0,
      winStreak: 0,
    });
  });
});

describe("reduceHandResolved", () => {
  const start = initialSessionStats(1000);

  it("counts a win and updates plChips + biggestWin", () => {
    const next = reduceHandResolved(start, {
      outcome: "win",
      payoutDelta: 50,
      chipsAfter: 1050,
      isBust: false,
    });
    expect(next.handsPlayed).toBe(1);
    expect(next.handsWon).toBe(1);
    expect(next.handsLost).toBe(0);
    expect(next.plChips).toBe(50);
    expect(next.biggestWin).toBe(50);
  });

  it("counts a blackjack as both a win AND a blackjack", () => {
    const next = reduceHandResolved(start, {
      outcome: "blackjack",
      payoutDelta: 75,
      chipsAfter: 1075,
      isBust: false,
    });
    expect(next.handsWon).toBe(1);
    expect(next.blackjacks).toBe(1);
    expect(next.biggestWin).toBe(75);
  });

  it("counts a loss without bust", () => {
    const next = reduceHandResolved(start, {
      outcome: "lose",
      payoutDelta: -50,
      chipsAfter: 950,
      isBust: false,
    });
    expect(next.handsLost).toBe(1);
    expect(next.busts).toBe(0);
    expect(next.plChips).toBe(-50);
  });

  it("counts a bust as both a loss and a bust", () => {
    const next = reduceHandResolved(start, {
      outcome: "lose",
      payoutDelta: -50,
      chipsAfter: 950,
      isBust: true,
    });
    expect(next.handsLost).toBe(1);
    expect(next.busts).toBe(1);
  });

  it("counts a push and leaves plChips unchanged", () => {
    const next = reduceHandResolved(start, {
      outcome: "push",
      payoutDelta: 0,
      chipsAfter: 1000,
      isBust: false,
    });
    expect(next.handsPushed).toBe(1);
    expect(next.plChips).toBe(0);
  });

  it("biggestWin tracks the maximum across multiple wins, never decreasing", () => {
    let s = reduceHandResolved(start, {
      outcome: "win",
      payoutDelta: 30,
      chipsAfter: 1030,
      isBust: false,
    });
    s = reduceHandResolved(s, {
      outcome: "blackjack",
      payoutDelta: 75,
      chipsAfter: 1105,
      isBust: false,
    });
    s = reduceHandResolved(s, {
      outcome: "win",
      payoutDelta: 25,
      chipsAfter: 1130,
      isBust: false,
    });
    expect(s.biggestWin).toBe(75);
  });

  it("ignores isBust on non-loss outcomes (defensive)", () => {
    const next = reduceHandResolved(start, {
      outcome: "win",
      payoutDelta: 25,
      chipsAfter: 1025,
      isBust: true,
    });
    expect(next.busts).toBe(0);
  });

  describe("winStreak", () => {
    it("increments on consecutive wins", () => {
      let s = reduceHandResolved(start, {
        outcome: "win",
        payoutDelta: 50,
        chipsAfter: 1050,
        isBust: false,
      });
      expect(s.winStreak).toBe(1);
      s = reduceHandResolved(s, {
        outcome: "blackjack",
        payoutDelta: 75,
        chipsAfter: 1125,
        isBust: false,
      });
      expect(s.winStreak).toBe(2);
      s = reduceHandResolved(s, {
        outcome: "win",
        payoutDelta: 50,
        chipsAfter: 1175,
        isBust: false,
      });
      expect(s.winStreak).toBe(3);
    });

    it("resets to 0 on a loss", () => {
      let s = reduceHandResolved(start, {
        outcome: "win",
        payoutDelta: 50,
        chipsAfter: 1050,
        isBust: false,
      });
      s = reduceHandResolved(s, {
        outcome: "win",
        payoutDelta: 50,
        chipsAfter: 1100,
        isBust: false,
      });
      s = reduceHandResolved(s, {
        outcome: "lose",
        payoutDelta: -50,
        chipsAfter: 1050,
        isBust: false,
      });
      expect(s.winStreak).toBe(0);
    });

    it("resets to 0 on a push", () => {
      let s = reduceHandResolved(start, {
        outcome: "win",
        payoutDelta: 50,
        chipsAfter: 1050,
        isBust: false,
      });
      s = reduceHandResolved(s, {
        outcome: "push",
        payoutDelta: 0,
        chipsAfter: 1050,
        isBust: false,
      });
      expect(s.winStreak).toBe(0);
    });

    it("starts counting again after a reset", () => {
      let s = reduceHandResolved(start, {
        outcome: "lose",
        payoutDelta: -50,
        chipsAfter: 950,
        isBust: false,
      });
      s = reduceHandResolved(s, {
        outcome: "win",
        payoutDelta: 50,
        chipsAfter: 1000,
        isBust: false,
      });
      expect(s.winStreak).toBe(1);
    });
  });
});
