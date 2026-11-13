import { joinSentence } from "../joinSentence";

describe("joinSentence (#3796)", () => {
  it("adds no extra period after an ASCII mark", () => {
    expect(joinSentence("You Win!", "Won: 2")).toBe("You Win! Won: 2");
    expect(joinSentence("Done.", "Next")).toBe("Done. Next");
    expect(joinSentence("Really?", "Yes")).toBe("Really? Yes");
    expect(joinSentence("Wait…", "Go")).toBe("Wait… Go");
  });

  it("adds '. ' when the text has no closing mark", () => {
    expect(joinSentence("Push", "Won: 1")).toBe("Push. Won: 1");
  });

  it("handles fr-CA's space before the mark", () => {
    expect(joinSentence("Gagné !", "Gagnées : 2")).toBe("Gagné ! Gagnées : 2");
  });

  it("joins with no space after a full-width mark", () => {
    expect(joinSentence("你赢了！", "赢: 2")).toBe("你赢了！赢: 2");
    expect(joinSentence("勝利。", "勝ち: 2")).toBe("勝利。勝ち: 2");
    expect(joinSentence("本当？", "はい")).toBe("本当？はい");
  });

  it("ignores trailing whitespace on the first text", () => {
    expect(joinSentence("You Win!  ", "Won: 2")).toBe("You Win! Won: 2");
    expect(joinSentence("Push  ", "Won: 1")).toBe("Push. Won: 1");
  });
});
