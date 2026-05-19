// Native stub — tile SVGs are rendered via Skia on native and do not use this loader.
export function loadTileAssets(): Promise<readonly (string | null)[]> {
  return Promise.resolve([]);
}
