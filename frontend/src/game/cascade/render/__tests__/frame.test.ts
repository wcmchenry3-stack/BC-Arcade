/** #2960: packing the board into the shared frame buffer, and the publish gate. */
import {
  FRAME_HEADER,
  FRAME_STRIDE,
  HEADER_FIELD,
  PIECE_FIELD,
  createFramePacker,
  createGameState,
  emptyFrame,
  nextFrame,
  packFrame,
  sameFrame,
  type FramePiece,
} from "../frame";

const piece = (id: number, x: number, y: number, isSleeping = false): FramePiece => ({
  id,
  tier: 2,
  x,
  y,
  angle: 0.25,
  isSleeping,
});

const field = (buf: Float64Array, i: number, f: number) => buf[FRAME_HEADER + i * FRAME_STRIDE + f];

describe("packFrame", () => {
  it("writes the header and every piece's id, tier, x, y, angle and sleeping flag", () => {
    const packer = createFramePacker();
    const n = packFrame(
      packer,
      { pieces: [piece(7, 100, 200), piece(8, 50, 60, true)], dangerRatio: 0.5, canDrop: false },
      3
    );
    const buf = packer.buf;
    expect(n).toBe(FRAME_HEADER + 2 * FRAME_STRIDE);
    expect(buf[HEADER_FIELD.count]).toBe(2);
    expect(buf[HEADER_FIELD.dangerRatio]).toBe(0.5);
    expect(buf[HEADER_FIELD.canDrop]).toBe(0);
    expect(buf[HEADER_FIELD.spawnerTier]).toBe(3);
    expect([0, 1, 2, 3, 4, 5].map((f) => field(buf, 0, f))).toEqual([7, 2, 100, 200, 0.25, 0]);
    expect(field(buf, 1, PIECE_FIELD.sleeping)).toBe(1);
  });

  it("packs each piece's grow-in scale (#3697), 1 when the piece has none", () => {
    const packer = createFramePacker();
    packFrame(packer, { pieces: [{ ...piece(1, 10, 20), scale: 0.875 }, piece(2, 30, 40)] }, 0);
    expect(field(packer.buf, 0, PIECE_FIELD.scale)).toBe(0.875);
    expect(field(packer.buf, 1, PIECE_FIELD.scale)).toBe(1);
  });

  it("defaults a state without the lid fields to calm and open", () => {
    const packer = createFramePacker();
    packFrame(packer, { pieces: [] }, 0);
    expect(packer.buf[HEADER_FIELD.dangerRatio]).toBe(0);
    expect(packer.buf[HEADER_FIELD.canDrop]).toBe(1);
  });

  it("draws a sleeping piece where it fell asleep until it wakes (the #1746 freeze)", () => {
    const packer = createFramePacker();
    packFrame(packer, { pieces: [piece(1, 100, 200, true)] }, 0);
    packFrame(packer, { pieces: [piece(1, 100.3, 200.2, true)] }, 0);
    expect(field(packer.buf, 0, PIECE_FIELD.x)).toBe(100);
    expect(field(packer.buf, 0, PIECE_FIELD.y)).toBe(200);
    packFrame(packer, { pieces: [piece(1, 101, 203, false)] }, 0);
    expect(field(packer.buf, 0, PIECE_FIELD.x)).toBe(101);
    packFrame(packer, { pieces: [piece(1, 102, 204, true)] }, 0);
    expect(field(packer.buf, 0, PIECE_FIELD.x)).toBe(102);
  });

  it("forgets a frozen piece once it is gone", () => {
    const packer = createFramePacker();
    packFrame(packer, { pieces: [piece(1, 100, 200, true), piece(2, 5, 5, true)] }, 0);
    expect(packer.frozen.size).toBe(2);
    packFrame(packer, { pieces: [piece(2, 5, 5, true)] }, 0);
    expect([...packer.frozen.keys()]).toEqual([2]);
    packFrame(packer, { pieces: [] }, 0);
    expect(packer.frozen.size).toBe(0);
  });

  it("grows the scratch buffer for a big board and keeps it", () => {
    const packer = createFramePacker();
    const many = Array.from({ length: 200 }, (_, i) => piece(i, i, i));
    packFrame(packer, { pieces: many }, 0);
    const grown = packer.buf;
    expect(grown.length).toBeGreaterThanOrEqual(FRAME_HEADER + 200 * FRAME_STRIDE);
    packFrame(packer, { pieces: [piece(1, 1, 1)] }, 0);
    expect(packer.buf).toBe(grown);
    expect(packer.length).toBe(FRAME_HEADER + FRAME_STRIDE);
  });
});

describe("the publish gate", () => {
  it("publishes a fresh copy when something drawn changed, nothing when not", () => {
    const packer = createFramePacker();
    packFrame(packer, { pieces: [piece(1, 10, 20)] }, 0);
    const first = nextFrame(packer, emptyFrame(0))!;
    expect(first).not.toBe(packer.buf);
    expect(first.length).toBe(packer.length);
    packFrame(packer, { pieces: [piece(1, 10, 20)] }, 0);
    expect(nextFrame(packer, first)).toBeNull();
    packFrame(packer, { pieces: [piece(1, 10, 21)] }, 0);
    expect(nextFrame(packer, first)).not.toBeNull();
  });

  it("a settled board publishes nothing, frame after frame", () => {
    const packer = createFramePacker();
    packFrame(packer, { pieces: [piece(1, 10, 20, true)] }, 0);
    const published = nextFrame(packer, emptyFrame(0))!;
    for (let i = 0; i < 60; i++) {
      packFrame(packer, { pieces: [piece(1, 10 + i * 1e-3, 20, true)] }, 0);
      expect(nextFrame(packer, published)).toBeNull();
    }
  });

  it("a different spawner piece or lid state is a change", () => {
    const a = emptyFrame(1);
    const packer = createFramePacker();
    packFrame(packer, { pieces: [] }, 2);
    expect(sameFrame(packer.buf, packer.length, a)).toBe(false);
    packFrame(packer, { pieces: [] }, 1);
    expect(sameFrame(packer.buf, packer.length, a)).toBe(true);
    packFrame(packer, { pieces: [], canDrop: false }, 1);
    expect(sameFrame(packer.buf, packer.length, a)).toBe(false);
  });
});

describe("createGameState", () => {
  it("is an empty, calm board", () => {
    expect(createGameState()).toEqual({
      pieces: [],
      score: 0,
      gameOver: false,
      dangerRatio: 0,
      canDrop: true,
    });
  });
});
