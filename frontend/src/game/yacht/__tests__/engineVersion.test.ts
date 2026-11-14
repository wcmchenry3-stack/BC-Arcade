import { ENGINE_VERSION } from "../engine";
import { startedData } from "../replay";

describe("yacht engine_version in game_started (#3909)", () => {
  it("is a positive integer, starting at 1", () => {
    expect(Number.isInteger(ENGINE_VERSION)).toBe(true);
    expect(ENGINE_VERSION).toBe(1);
  });

  it("is the value the game_started data records", () => {
    expect(startedData(null).engine_version).toBe(ENGINE_VERSION);
    expect(startedData("hard").engine_version).toBe(ENGINE_VERSION);
  });
});
