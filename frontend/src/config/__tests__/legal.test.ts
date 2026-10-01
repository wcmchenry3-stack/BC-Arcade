/**
 * The legal/support URLs are also entered in App Store Connect and Play Console
 * and recorded in docs/LEGAL-PUBLISHING.md (#2780). Changing one here without
 * the others breaks the store listings, so pin the exact values.
 */
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_SERVICE_URL } from "../legal";

describe("legal URLs", () => {
  it("match the published URLs recorded in docs/LEGAL-PUBLISHING.md", () => {
    expect(PRIVACY_POLICY_URL).toBe("https://buffingchi.com/privacy");
    expect(TERMS_OF_SERVICE_URL).toBe("https://buffingchi.com/terms");
    expect(SUPPORT_URL).toBe("https://buffingchi.com/support");
  });

  it("are distinct HTTPS URLs", () => {
    const urls = [PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, SUPPORT_URL];
    for (const url of urls) expect(new URL(url).protocol).toBe("https:");
    expect(new Set(urls).size).toBe(urls.length);
  });
});
