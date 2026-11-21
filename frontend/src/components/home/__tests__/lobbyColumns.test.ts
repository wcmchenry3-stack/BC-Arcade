import { lobbyColumns, TILE_ICON_ZONE } from "../lobbyColumns";

describe("lobbyColumns (#4005)", () => {
  it.each([
    [280, 1],
    [359, 1],
    [360, 2],
    [390, 2],
    [699, 2],
    [700, 3],
    [834, 3],
    [999, 3],
    [1000, 4],
    [1366, 4],
    [2560, 4],
  ])("width %d -> %d columns", (width, cols) => {
    expect(lobbyColumns(width)).toBe(cols);
  });

  it("exposes the icon zone height", () => {
    expect(TILE_ICON_ZONE).toBe(68);
  });
});
