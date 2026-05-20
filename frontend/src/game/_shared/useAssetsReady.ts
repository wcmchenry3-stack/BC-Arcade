// Returns true when every image in the provided array has finished decoding.
// Pass the flattened Skia image arrays from a game's image hook; the game screen
// can render a loading indicator while this returns false and mount the canvas
// only after it flips true — preventing first-render fallback circles/empty tiles.
export function useAssetsReady(images: readonly (unknown | null)[]): boolean {
  return images.every((img) => img !== null);
}
