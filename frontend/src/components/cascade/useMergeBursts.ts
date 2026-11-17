/**
 * The merge bursts on screen (`MergeBurst`, #2960; moved out of `CascadeScreen.tsx` in #3928 to
 * keep the screen under 800 lines, unchanged): `add` one at a screen point, `remove` it when its
 * animation ends.
 */
import { useCallback, useId, useState } from "react";
import type { MergeBurstData } from "./MergeBurst";

export function useMergeBursts() {
  const [bursts, setBursts] = useState<MergeBurstData[]>([]);
  const idPrefix = useId();
  const add = useCallback(
    (x: number, y: number, color: string) => {
      const id = `${idPrefix}-${Date.now()}-${x.toFixed(0)}`;
      setBursts((prev) => [...prev, { id, x, y, color }]);
    },
    [idPrefix]
  );
  const remove = useCallback(
    (id: string) => setBursts((prev) => prev.filter((b) => b.id !== id)),
    []
  );
  return { bursts, add, remove };
}
