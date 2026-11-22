/**
 * useOpeningZoom (#3612): a fresh board whose tiles are too small at fit opens zoomed in on
 * its top-left corner, unless the player turned it off; the choice is stored.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useOpeningZoom } from "../useOpeningZoom";
import { loadOpeningZoom, saveOpeningZoom } from "../storage";

jest.mock("../storage", () => ({
  loadOpeningZoom: jest.fn(),
  saveOpeningZoom: jest.fn(() => Promise.resolve()),
}));
const mockLoad = loadOpeningZoom as jest.Mock;
const mockSave = saveOpeningZoom as jest.Mock;

const SMALL = { scale: 0.5, tileWidth: 40 }; // 20 px at fit
const LARGE = { scale: 1, tileWidth: 40 }; // 40 px at fit
type Props = {
  board: { dealId: string; pairsRemoved: number } | null;
  camera: { scale: number; tileWidth: number };
};

async function mount(stored: boolean | null, props: Props) {
  mockLoad.mockResolvedValue(stored);
  const zoomInAt = jest.fn();
  const hook = await renderHook((p: Props) => useOpeningZoom(p.board, p.camera, zoomInAt), {
    initialProps: props,
  });
  await act(async () => {}); // the stored choice loads
  return { hook, zoomInAt };
}

beforeEach(() => jest.clearAllMocks());

describe("useOpeningZoom", () => {
  it("opens a fresh small-tiled board zoomed in on its top-left corner, by default", async () => {
    const { hook, zoomInAt } = await mount(null, {
      board: { dealId: "A", pairsRemoved: 0 },
      camera: SMALL,
    });
    expect(zoomInAt).toHaveBeenCalledWith(0, 0);
    expect(hook.result.current.enabled).toBe(true);
  });

  it("leaves a board with readable tiles at fit", async () => {
    const { zoomInAt } = await mount(null, {
      board: { dealId: "A", pairsRemoved: 0 },
      camera: LARGE,
    });
    expect(zoomInAt).not.toHaveBeenCalled();
  });

  it("never moves the camera on a game in progress", async () => {
    const { zoomInAt } = await mount(null, {
      board: { dealId: "A", pairsRemoved: 3 },
      camera: SMALL,
    });
    expect(zoomInAt).not.toHaveBeenCalled();
  });

  it("stays at fit when the player turned it off, and remembers their choice", async () => {
    const { hook, zoomInAt } = await mount(false, {
      board: { dealId: "A", pairsRemoved: 0 },
      camera: SMALL,
    });
    expect(zoomInAt).not.toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(false);
    await act(async () => {
      hook.result.current.setEnabled(true);
    });
    expect(mockSave).toHaveBeenCalledWith(true);
    expect(hook.result.current.enabled).toBe(true);
  });

  it("applies again on a new deal", async () => {
    const { hook, zoomInAt } = await mount(null, {
      board: { dealId: "A", pairsRemoved: 0 },
      camera: SMALL,
    });
    await hook.rerender({ board: { dealId: "B", pairsRemoved: 0 }, camera: SMALL });
    expect(zoomInAt).toHaveBeenCalledTimes(2);
  });
});
