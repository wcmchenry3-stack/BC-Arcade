/**
 * Stable public URLs for the legal documents (#828, #1922). The same URLs go
 * into the App Store Connect and Play Console listings — change them in all
 * three places or not at all. The documents themselves are not translated, so
 * the URLs are locale-independent; only the link labels go through i18n.
 */
export const PRIVACY_POLICY_URL = "https://buffingchi.com/privacy";
export const TERMS_OF_SERVICE_URL = "https://buffingchi.com/terms";

/**
 * Where a player is sent when a valid purchase cannot be used on this install
 * (docs/IAP.md §5, `not_linkable`). Keep in step with the store listings.
 */
export const SUPPORT_URL = "https://buffingchi.com/support";
