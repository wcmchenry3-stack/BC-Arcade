let _fallbackSeq = 0;

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // Tier 3: deterministic fallback for environments without any Crypto API
  // (very old Hermes/JSC builds). Uses microsecond-precision timestamp +
  // session-scoped counter. Unique within the session; not cryptographically
  // random. Math.random() is intentionally absent from this path.
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
