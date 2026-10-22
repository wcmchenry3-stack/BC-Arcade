/**
 * The default drop report (#3493): "over the size caps" only for a size-cap
 * drop; a pure `dropped_unsent` sends nothing.
 */

import { reportToSentry, type RecordingDropReport } from "../gameRecorder";
import { captureThrottledMessage } from "../sentryThrottle";

jest.mock("../sentryThrottle", () => ({ captureThrottledMessage: jest.fn() }));

const base: RecordingDropReport = {
  game_type: "yacht",
  recorded: 1,
  saved: 0,
  chunked: 0,
  parts: 0,
  dropped_oversize: 0,
  dropped_session_cap: 0,
  dropped_invalid: 0,
  dropped_unsent: 0,
  dropped_memory: 0,
  saved_bytes: 0,
  largest_bytes: 147,
};
const mock = captureThrottledMessage as jest.Mock;

describe("reportToSentry", () => {
  beforeEach(() => mock.mockClear());

  it("sends nothing for events that were only unsent (BC_GAMES-6B)", () => {
    reportToSentry({ ...base, dropped_unsent: 1 });
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([["dropped_oversize"], ["dropped_session_cap"]] as const)(
    "reports %s as over the size caps, throttled per game type",
    (field) => {
      reportToSentry({ ...base, [field]: 1 });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(
        "gameRecorder.drop.yacht",
        "gameRecorder: recorded events over the size caps not saved",
        expect.objectContaining({ level: "warning" })
      );
    }
  );

  it("keeps the size-cap message when unsent events came with a size-cap drop", () => {
    reportToSentry({ ...base, dropped_oversize: 1, dropped_unsent: 1 });
    expect(mock.mock.calls[0][1]).toContain("over the size caps");
  });

  it.each([["dropped_invalid"], ["dropped_memory"]] as const)(
    "reports %s without claiming a size cap",
    (field) => {
      reportToSentry({ ...base, [field]: 1 });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][1]).toBe("gameRecorder: recorded events not saved");
    }
  );
});
