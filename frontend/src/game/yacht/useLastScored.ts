import { useCallback, useEffect, useRef, useState } from "react";

type Scores = Readonly<Record<string, number | null>>;

/**
 * The row a scorecard gained last (#3748): the screen watches the computer's, and highlights the
 * row it just scored so you can see where it landed. The scores a hook starts with (a restored
 * game) highlight nothing; a later change in which a row goes from open to scored sets that row.
 * `clear` drops it (the player's next roll, a new game).
 */
export function useLastScored(scores: Scores | null | undefined): {
  readonly lastScored: string | null;
  readonly clear: () => void;
} {
  const [lastScored, setLastScored] = useState<string | null>(null);
  const prevRef = useRef<Scores | null>(scores ?? null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = scores ?? null;
    if (!scores || !prev || scores === prev) return;
    const gained = Object.keys(scores).find((key) => scores[key] != null && prev[key] == null);
    if (gained !== undefined) setLastScored(gained);
  }, [scores]);

  const clear = useCallback(() => setLastScored(null), []);
  return { lastScored, clear };
}
