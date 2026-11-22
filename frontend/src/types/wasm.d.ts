declare module "*.wasm" {
  // Metro bundles .wasm as an asset (metro.config.js assetExts): a numeric asset-registry id.
  const content: number;
  export default content;
}
