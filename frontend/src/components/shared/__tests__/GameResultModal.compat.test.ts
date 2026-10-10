/**
 * The old `components/shared/GameResultModal` path (#2990): it re-exports the
 * split-out card from `components/result/` for one release, so existing
 * imports keep resolving to the very same components.
 */
import * as legacy from "../GameResultModal";
import GameResultModal, {
  CELEBRATION_MAX_MS,
  useResultFeedback,
} from "../../result/GameResultModal";
import { ResultCard } from "../../result/ResultCard";

describe("components/shared/GameResultModal re-exports", () => {
  it("is the same modal, card, feedback hook and constant as components/result", () => {
    expect(legacy.default).toBe(GameResultModal);
    expect(legacy.ResultCard).toBe(ResultCard);
    expect(legacy.useResultFeedback).toBe(useResultFeedback);
    expect(legacy.CELEBRATION_MAX_MS).toBe(CELEBRATION_MAX_MS);
  });
});
