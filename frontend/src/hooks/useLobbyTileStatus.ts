/**
 * The status line of each lobby tile (#4008): Resume, Done today or a personal best, from this
 * device's storage.
 *
 * Cost and timing: the reads start after first paint (`setTimeout(0)`, like
 * `prefetchLobbyGameScreens`), run together (one `Promise.all`, a few keys), and run again only
 * when Home gains focus. Nothing waits on them: the grid renders at once and a tile gains its
 * status when its read lands. No network, no writes, no Sentry. A reader that fails or finds
 * nothing leaves its tile without a status, and a slug without a reader (a hidden game, or one
 * with no status) is never read.
 */
import { useEffect, useRef, useState } from "react";

import type { TileStatus } from "../game/_shared/lobbyStatus";
import { LOBBY_STATUS_READERS } from "../components/home/lobbyStatusReaders";

export type TileStatuses = Readonly<Record<string, TileStatus | undefined>>;

const NONE: TileStatuses = {};

/** The two maps hold the same statuses. */
function same(a: TileStatuses, b: TileStatuses): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const x = a[key];
    const y = b[key];
    return (
      x?.kind === y?.kind && (x?.kind !== "best" || (y?.kind === "best" && x.value === y.value))
    );
  });
}

interface FocusSource {
  addListener(event: "focus", callback: () => void): () => void;
}

/**
 * @param visibleSlugs the games with a tile in this build; only these are read.
 * @param navigation Home's navigation: the reads run again on its `focus`.
 * @param readers each game's reader (overridable for tests).
 */
export function useLobbyTileStatus(
  visibleSlugs: readonly string[],
  navigation: FocusSource,
  readers: Readonly<Record<string, () => Promise<TileStatus | undefined>>> = LOBBY_STATUS_READERS
): TileStatuses {
  const [statuses, setStatuses] = useState<TileStatuses>(NONE);
  const slugKey = visibleSlugs.join(",");

  const navigationRef = useRef(navigation);
  useEffect(() => {
    navigationRef.current = navigation;
  });
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const slugs = slugKey === "" ? [] : slugKey.split(",");
    const run = () => {
      // One pending read at a time: the mount and the focus that follows it share one.
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const mine = ++generation.current;
        const wanted = slugs.filter((slug) => readers[slug] !== undefined);
        void Promise.all(
          wanted.map((slug) =>
            Promise.resolve()
              .then(() => readers[slug]?.())
              .catch(() => undefined)
          )
        ).then((results) => {
          if (generation.current !== mine) return;
          const next: Record<string, TileStatus | undefined> = {};
          wanted.forEach((slug, i) => {
            next[slug] = results[i];
          });
          setStatuses((prev) => (same(prev, next) ? prev : next));
        });
      }, 0);
    };
    run();
    const unsubscribe = navigationRef.current.addListener("focus", run);
    return () => {
      unsubscribe();
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [slugKey, readers]);

  return statuses;
}
