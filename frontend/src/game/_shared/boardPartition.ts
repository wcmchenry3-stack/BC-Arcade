import { useRef } from "react";

/** A board's partition: its partition keys' values, e.g. `{ difficulty: "hard" }`. */
export type Partition = Readonly<Record<string, string>>;

/**
 * One string per partition, whatever order its keys were written in (#2633):
 * the leaderboard link, screen and data hook compare and memoise partitions by it.
 */
export function partitionKey(partition: Partition = {}): string {
  return JSON.stringify(
    Object.keys(partition)
      .sort()
      .map((k) => [k, partition[k]])
  );
}

/**
 * `partition`, kept as the same object while its values don't change, so a
 * caller can build it inline without re-running effects that depend on it.
 */
export function useStablePartition(partition: Partition = {}): Partition {
  const key = partitionKey(partition);
  const ref = useRef({ key, partition });
  if (ref.current.key !== key) ref.current = { key, partition };
  return ref.current.partition;
}
