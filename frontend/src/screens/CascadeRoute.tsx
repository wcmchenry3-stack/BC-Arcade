/**
 * The Cascade route's screen on iOS and Android: the Cascade screen itself, where Skia is native.
 *
 * On web Metro picks `CascadeRoute.web.tsx` instead, which loads Skia's web runtime (CanvasKit)
 * before it imports the screen (#2960). Keeping the split here, rather than in `CascadeScreen`,
 * keeps the CanvasKit loader and its `.wasm` out of the native bundles.
 */
export { default } from "./CascadeScreen";
