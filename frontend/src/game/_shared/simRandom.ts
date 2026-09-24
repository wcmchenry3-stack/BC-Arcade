/**
 * Seeded randomness and normal quantiles for AI simulation harnesses
 * (Yacht #2245, Hearts #2238). Testing tools only — nothing in the shipped
 * app draws from these.
 *
 * Seeds are derived by hashing, not by adding offsets: with the engines'
 * LCG (`createSeededRng`), seeds s and s+1 produce first draws that
 * correlate at ~0.998, so `base + i` seeds are not independent samples.
 */

const GOLDEN = 0x9e3779b9;

/** MurmurHash3 32-bit finalizer — a cheap, well-mixed bijection on uint32. */
export function mix32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash an ordered list of integers into one uint32 seed. */
export function deriveSeed(...parts: readonly number[]): number {
  let h = GOLDEN;
  for (const part of parts) {
    h = mix32((h ^ mix32(part)) + GOLDEN);
  }
  return h;
}

/** Mulberry32: small, fast, full-period 32-bit generator. */
export function createStream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal quantile Φ⁻¹(p) for 0 < p < 1 (Acklam's rational
 * approximation, relative error < 1.2e-9). Used for Bonferroni-adjusted
 * critical values, e.g. normalQuantile(1 − 0.05 / (2 × 6)) ≈ 2.87.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile: p must be in (0, 1), got ${p}`);
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - pLow) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
