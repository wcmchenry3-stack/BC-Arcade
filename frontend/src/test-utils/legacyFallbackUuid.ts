/**
 * The tier-3 fallback `generateUUID` used before #3303, copied verbatim from
 * `frontend/src/game/_shared/uuid.ts` on dev, so tests can produce the
 * predictable ids that release Hermes builds stored as session ids. Tests only.
 */

let _fallbackSeq = 0;

export function resetLegacyFallbackSeq(): void {
  _fallbackSeq = 0;
}

export function legacyFallbackUuid(): string {
  const now =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? Math.floor(performance.now() * 1000)
      : Date.now() * 1000;
  const seq = ++_fallbackSeq;
  const lo = now >>> 0;
  const hi = Math.floor(now / 0x100000000) >>> 0;
  const h = (v: number, l: number) => (v >>> 0).toString(16).padStart(l, "0");
  return [
    h(hi, 8),
    h(lo >>> 16, 4),
    h((lo & 0x0fff) | 0x4000, 4),
    h(((seq >>> 14) & 0x3fff) | 0x8000, 4),
    h(seq & 0x3fff, 4) + h((lo >>> 8) & 0xffff, 4) + h(hi & 0xffff, 4),
  ].join("-");
}
