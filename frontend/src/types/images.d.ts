declare module "*.png" {
  // Metro resolves static image imports to a numeric asset-registry id.
  const content: number;
  export default content;
}

declare module "*.webp" {
  // Metro resolves static image imports to a numeric asset-registry id.
  const content: number;
  export default content;
}
