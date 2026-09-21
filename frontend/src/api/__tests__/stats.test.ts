const mockRequest = jest.fn().mockResolvedValue({});
jest.mock("../../game/_shared/httpClient", () => ({
  createGameClient:
    () =>
    (...args: unknown[]) =>
      mockRequest(...args),
}));

import { statsApi } from "../stats";

describe("statsApi.getMyStats", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockRequest.mockClear();
  });

  it("sends the device's UTC offset in minutes east of UTC, so the streak counts local days", async () => {
    // JS reports minutes WEST of UTC: UTC-5 -> 300, UTC+5:30 -> -330.
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(300);
    await statsApi.getMyStats();
    expect(mockRequest).toHaveBeenCalledWith("/stats/me?tz_offset_minutes=-300");

    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-330);
    await statsApi.getMyStats();
    expect(mockRequest).toHaveBeenLastCalledWith("/stats/me?tz_offset_minutes=330");
  });

  it("sends 0 (not -0) for a UTC device", async () => {
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    await statsApi.getMyStats();
    expect(mockRequest).toHaveBeenCalledWith("/stats/me?tz_offset_minutes=0");
  });
});
