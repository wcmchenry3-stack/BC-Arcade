/**
 * Shared fixtures for the SyncWorker suites (`syncWorker*.test.ts`): a
 * scriptable SyncApi double and response helpers. Not a test file.
 */

import type { SyncApi, SyncResponse } from "../../syncApi";

export class MockSyncApi {
  calls: Array<{
    method: string;
    path: string;
    body: unknown;
  }> = [];
  /** Response queue keyed by path substring → consecutive responses. */
  private scripts: Array<{ match: (p: string) => boolean; res: SyncResponse }> = [];
  /** Default fallback if no script matches. */
  defaultResponse: SyncResponse = {
    status: 200,
    ok: true,
    retryAfterMs: null,
    body: {},
  };

  async request(method: "POST" | "PATCH", path: string, body: unknown): Promise<SyncResponse> {
    this.calls.push({ method, path, body });
    const idx = this.scripts.findIndex((s) => s.match(path));
    if (idx !== -1) {
      const hit = this.scripts.splice(idx, 1)[0];
      if (hit === undefined) throw new Error("splice returned empty");
      return hit.res;
    }
    return this.defaultResponse;
  }

  onNext(matcher: (p: string) => boolean, res: SyncResponse): void {
    this.scripts.push({ match: matcher, res });
  }
}

export function asSyncApi(m: MockSyncApi): SyncApi {
  return m as unknown as SyncApi;
}

/** Let fire-and-forget enqueues and persists land. */
export async function flushMicro(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

export function ok(body: unknown = {}): SyncResponse {
  return { status: 200, ok: true, retryAfterMs: null, body };
}

export function err(status: number, retryAfterMs: number | null = null): SyncResponse {
  return { status, ok: false, retryAfterMs, body: { detail: "error" } };
}
