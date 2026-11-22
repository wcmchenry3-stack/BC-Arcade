/**
 * The board's frame (#2960; moved out of `CascadeScreen.tsx` in #3701, unchanged): what the loop
 * last published, read by `CascadeBoard`'s Picture on the UI thread. The loop writes through refs;
 * nothing per frame touches React state. One empty frame, made once, seeds both the shared value
 * and the publish gate, so a render never reads `.value` (a synchronous UI-runtime read on device).
 */
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { useSharedValue } from "react-native-reanimated";
import type { PieceQueue } from "./pieceQueue";
import {
  createFramePacker,
  createGameState,
  emptyFrame,
  nextFrame,
  packFrame,
  type FrameState,
} from "./render/frame";

/** A board with no pieces, for a reset (the lid and spawner still draw). */
export const NO_PIECES: FrameState = { pieces: [] };

export function useBoardFrame(queueRef: MutableRefObject<PieceQueue>) {
  const [initialFrame] = useState(() => emptyFrame(queueRef.current.current));
  const frameSV = useSharedValue<Float64Array>(initialFrame);
  const frameSVRef = useRef(frameSV);
  frameSVRef.current = frameSV;
  const publishedFrameRef = useRef<Float64Array>(initialFrame);
  const packerRef = useRef(createFramePacker());
  // The engine writes the board into this each frame (`getState(into)`), allocation-free.
  const engineStateRef = useRef(createGameState());
  // The board last read from the engine; a reset points it at an empty board.
  const lastBoardRef = useRef<FrameState>(NO_PIECES);

  /** Publishes `board` (with the queue's current piece in the spawner) if it draws anything new. */
  const publishBoard = useCallback(
    (board: FrameState) => {
      lastBoardRef.current = board;
      const packer = packerRef.current;
      packFrame(packer, board, queueRef.current.current);
      const next = nextFrame(packer, publishedFrameRef.current);
      if (next) {
        publishedFrameRef.current = next;
        frameSVRef.current.value = next;
      }
    },
    [queueRef]
  );

  return { frameSV, publishBoard, engineStateRef, lastBoardRef };
}
