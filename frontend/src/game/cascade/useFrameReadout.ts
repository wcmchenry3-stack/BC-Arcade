/**
 * Frame time and React commits for the dev panel's readout (#2960; moved out of
 * `CascadeScreen.tsx` in #3701, unchanged). Star Swarm's #2567 ring buffer. Commits are counted by
 * a Profiler around the whole screen body, so a commit of ScoreDisplay alone counts too, and a
 * commit that touches several components counts once. Dev builds only, like the panel.
 */
import { useCallback, useRef } from "react";
import {
  createFrameStats,
  recordCommit,
  summarizeFrameStats,
} from "../starswarm/render/frameStats";

export const FRAME_STATS_ENABLED = __DEV__;

export function useFrameReadout() {
  const frameStatsRef = useRef(FRAME_STATS_ENABLED ? createFrameStats() : null);
  const onCommit = useCallback(() => {
    if (frameStatsRef.current) recordCommit(frameStatsRef.current, performance.now());
  }, []);
  const readFrameStats = useCallback(() => {
    const stats = frameStatsRef.current;
    return stats ? summarizeFrameStats(stats, performance.now()) : null;
  }, []);
  return { frameStatsRef, onCommit, readFrameStats };
}
