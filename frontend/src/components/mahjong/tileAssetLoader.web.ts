import { Asset } from "expo-asset";
import { TILE_REQUIRES } from "./tileAssets";

// Module-level singleton: first caller triggers the download; every subsequent
// caller (including concurrent ones) awaits the same in-flight promise.
let _promise: Promise<readonly (string | null)[]> | null = null;

export function loadTileAssets(): Promise<readonly (string | null)[]> {
  if (!_promise) {
    _promise = (async () => {
      const uris: (string | null)[] = Array(TILE_REQUIRES.length).fill(null);
      await Promise.all(
        (TILE_REQUIRES as number[]).map(async (src, i) => {
          try {
            const asset = Asset.fromModule(src);
            await asset.downloadAsync();
            uris[i] = asset.localUri ?? asset.uri ?? null;
          } catch {
            // keep null — suit-color fallback remains in canvas renderer
          }
        })
      );
      return uris as readonly (string | null)[];
    })();
  }
  return _promise;
}
