/**
 * toSubmission (#2976): the rank-lookup hook's state → GameResultModal's
 * `submission` prop, which keeps its own shape (owner decision, #2976/#2990).
 */
import { toSubmission, type SubmissionSource } from "../toSubmission";

function source(overrides: Partial<SubmissionSource> = {}): SubmissionSource {
  return {
    status: "saved",
    rank: 4,
    isBest: false,
    playerName: "Riley",
    joinLeaderboards: jest.fn(() => Promise.resolve(true)),
    retry: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("toSubmission", () => {
  it("passes the status fields through unchanged", () => {
    expect(toSubmission(source())).toEqual({
      status: "saved",
      rank: 4,
      isBest: false,
      playerName: "Riley",
      onJoinLeaderboards: expect.any(Function),
      onRetry: expect.any(Function),
    });
  });

  it("maps joinLeaderboards to onJoinLeaderboards and retry to onRetry", () => {
    const s = source();
    const submission = toSubmission(s);
    expect(submission.onJoinLeaderboards).toBe(s.joinLeaderboards);
    expect(submission.onRetry).toBe(s.retry);
  });

  it("keeps null rank and name for a lookup that hasn't settled", () => {
    expect(
      toSubmission(source({ status: "submitting", rank: null, isBest: true, playerName: null }))
    ).toMatchObject({ status: "submitting", rank: null, isBest: true, playerName: null });
  });

  it("carries only the card's fields, not the hook's submit / reset", () => {
    const withExtras = { ...source(), submit: jest.fn(), reset: jest.fn() };
    expect(Object.keys(toSubmission(withExtras)).sort()).toEqual(
      ["isBest", "onJoinLeaderboards", "onRetry", "playerName", "rank", "status"].sort()
    );
  });
});
