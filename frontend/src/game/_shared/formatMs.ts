/** Formats a duration as `m:ss`, or `h:mm:ss` from an hour up. */
export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Formats whole seconds as `mm:ss`, or `h:mm:ss` from an hour up (a HUD clock, #4091). */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Milliseconds until `elapsedMs` next crosses a whole second (1000 on a boundary). */
export function msToNextSecond(elapsedMs: number): number {
  return 1000 - (((elapsedMs % 1000) + 1000) % 1000);
}
