/**
 * loadCascadeScreen (web, #2960): CanvasKit loads before the Cascade screen's chunk is imported.
 * Jest cannot run `import()`, so the resolved side is covered by the Playwright smoke spec
 * (e2e/tests/cascade-smoke.spec.ts).
 */
const mockLoadCanvasKit = jest.fn<Promise<void>, []>();
jest.mock("../../game/cascade/render/loadCanvasKit", () => ({
  loadCanvasKit: () => mockLoadCanvasKit(),
}));

let mockScreenEvaluated = false;
jest.mock("../CascadeScreen", () => {
  mockScreenEvaluated = true;
  return { __esModule: true, default: () => null };
});

import { loadCascadeScreen } from "../loadCascadeScreen.web";

it("fails with CanvasKit's error and never imports the screen when CanvasKit fails", async () => {
  const error = new Error("wasm fetch failed");
  mockLoadCanvasKit.mockRejectedValueOnce(error);
  await expect(loadCascadeScreen()).rejects.toBe(error);
  expect(mockScreenEvaluated).toBe(false);
});
