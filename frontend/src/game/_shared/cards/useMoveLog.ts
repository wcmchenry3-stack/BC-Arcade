/**
 * useMoveLog — the replay log a card-game screen records through (#3289).
 *
 * One log per screen, held for the screen's life (a lazy state initialiser) so its count and its pending chunk survive
 * every render. A chunk is recorded through `sink` (the recorder's
 * `beginUnit` / `record` / `closeUnit`), inside `guardRecording`: a failure
 * there is reported once and never reaches play.
 */

import { useState } from "react";

import {
  createMoveLog,
  guardRecording,
  recordChunk,
  type MoveLog,
  type MovesSink,
} from "./moveLog";

export function useMoveLog(game: string, sink: MovesSink): MoveLog {
  // Created once, with the first render's sink, and never replaced: the sink is
  // the recorder's own callbacks, which are stable for the screen's game type.
  const [log] = useState(() =>
    createMoveLog((actions, first) => guardRecording(game, () => recordChunk(sink, actions, first)))
  );
  return log;
}
