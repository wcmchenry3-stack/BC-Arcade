export type DevLogEntry = {
  ts: number;
  method: string;
  path: string;
  body?: unknown;
  status?: number;
  response?: unknown;
  error?: string;
};

const entries: DevLogEntry[] = [];
const subscribers = new Set<() => void>();

export const devLog = {
  push(entry: DevLogEntry) {
    entries.unshift(entry);
    if (entries.length > 50) entries.pop();
    subscribers.forEach((cb) => cb());
  },
  list(): readonly DevLogEntry[] {
    return entries;
  },
  subscribe(cb: () => void): () => void {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
  clear() {
    entries.length = 0;
    subscribers.forEach((cb) => cb());
  },
};
