/**
 * i18n-overflow.spec.ts — GH #3152 item 4a (epic #3150)
 *
 * Loads the screens a launch (store) user can reach in en (control), es and
 * fr-CA at a small phone viewport (iPhone SE, 375x667) and fails when any
 * text is clipped or spills out of its container. French runs 20-30% longer
 * than English, so this is where translated copy first breaks the layout.
 *
 * Detection runs in the page (see `findTextOverflow`). For every visible
 * element with its own text it flags:
 *   clip   — scrollWidth > clientWidth with overflow hidden/clip or an ellipsis
 *   clamp  — scrollHeight > clientHeight under a line clamp (numberOfLines)
 *   spill  — the text's rendered box leaves the viewport or the nearest
 *            clipping ancestor (overflow hidden/clip)
 * Elements inside a horizontally scrolling container (overflow-x auto/scroll,
 * i.e. ScrollView) are exempt: overflowing there is the point.
 *
 * English is the control: an English failure is a pre-existing layout bug,
 * not a translation one. Known issues go in ALLOWLIST with a reason (see there).
 *
 * Store-visible games only: HIDDEN_GAMES (gameVisibility.ts) are hidden in
 * store builds, but the e2e build is an internal build that shows them, so
 * the list below is explicit.
 */

import { test, expect, type Page } from "@playwright/test";
import { installEntitlementsMock } from "./helpers/api-mock";
import { mockSortApi } from "./helpers/sort";

const VIEWPORT = { width: 375, height: 667 };
const LOCALES = ["en", "es", "fr-CA"] as const;
type Locale = (typeof LOCALES)[number];

/** Launch-visible games (frontend/src/entitlements/gameVisibility.ts). */
const STORE_GAMES = [
  "yacht",
  "twenty48",
  "solitaire",
  "freecell",
  "sudoku",
  "sort",
  "daily_word",
] as const;

/**
 * Known, tracked overflows (and confirmed false positives), keyed by screen,
 * locale and exact element text so nothing else is masked.
 *
 * The #3211 entries are real bugs, not false positives: the game header title
 * is squeezed by the fixed-width back button, pills and menu button. REMOVE
 * THEM WHEN #3211 LANDS. An entry that no longer overflows fails the test
 * (stale entry), so this list can only shrink.
 */
const ALLOWLIST: {
  screen: string;
  locale: Locale;
  text: string;
  reason: string;
}[] = [
  {
    screen: "solitaire",
    locale: "es",
    text: "Solitario",
    reason: "header title squeezed by fixed-width header items — #3211",
  },
  {
    screen: "solitaire",
    locale: "fr-CA",
    text: "Solitaire",
    reason: "header title squeezed by fixed-width header items — #3211",
  },
  {
    screen: "freecell",
    locale: "es",
    text: "FreeCell",
    reason: "header title squeezed by fixed-width header items — #3211",
  },
  {
    screen: "freecell",
    locale: "fr-CA",
    text: "FreeCell",
    reason: "header title squeezed by fixed-width header items — #3211",
  },
  {
    screen: "sort",
    locale: "es",
    text: "Puzle de Colores",
    reason: "header title squeezed by fixed-width header items — #3211",
  },
  {
    screen: "sort",
    locale: "fr-CA",
    text: "Tri des couleurs",
    reason: "header title squeezed by fixed-width header items — #3211",
  },
];

interface Finding {
  kind: "clip" | "clamp" | "spill" | "stale-allowlist-entry";
  text: string;
  path: string;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Runs in the browser. Kept self-contained: Playwright serialises it. */
function findTextOverflow(): Finding[] {
  const found: Finding[] = [];
  const vw = window.innerWidth;

  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 4) {
      const id = cur.getAttribute("data-testid");
      parts.unshift(
        id ? `${cur.tagName.toLowerCase()}[${id}]` : cur.tagName.toLowerCase(),
      );
      if (id) break;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
  );
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n as HTMLElement;
    if (
      ["SCRIPT", "STYLE", "SELECT", "OPTION", "SVG", "CANVAS"].includes(
        el.tagName.toUpperCase(),
      )
    )
      continue;
    const ownText = Array.from(el.childNodes)
      .filter((c) => c.nodeType === Node.TEXT_NODE)
      .map((c) => c.textContent ?? "")
      .join("")
      .trim();
    if (!ownText) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      continue;
    if (el.closest("[aria-hidden='true']")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const cs = getComputedStyle(el);
    const clipsX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const clamped =
      (cs.getPropertyValue("-webkit-line-clamp") || "none") !== "none";
    const base = {
      text: ownText.slice(0, 80),
      path: pathOf(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };

    // Exempt anything inside a horizontal scroller; find the clip ancestor.
    let scroller = false;
    let clipAncestor: Element | null = null;
    for (let a: Element | null = el.parentElement; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === "auto" || acs.overflowX === "scroll") {
        scroller = true;
        break;
      }
      if (
        !clipAncestor &&
        (acs.overflowX === "hidden" || acs.overflowX === "clip")
      ) {
        clipAncestor = a;
      }
    }
    if (scroller) continue;

    if (clamped && el.scrollHeight > el.clientHeight + 1) {
      found.push({ kind: "clamp", ...base });
      seen.add(el);
      continue;
    }
    if (
      (clipsX || cs.textOverflow === "ellipsis") &&
      el.scrollWidth > el.clientWidth + 1
    ) {
      found.push({ kind: "clip", ...base });
      seen.add(el);
      continue;
    }

    const range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    const bounds = clipAncestor ? clipAncestor.getBoundingClientRect() : null;
    const outOfViewport = tr.right > vw + 1 || tr.left < -1;
    const outOfClip =
      bounds && (tr.right > bounds.right + 1 || tr.left < bounds.left - 1);
    if (outOfViewport || outOfClip) found.push({ kind: "spill", ...base });
  }
  return found;
}

async function settle(page: Page): Promise<void> {
  // Fonts shift text metrics; layout must be final before measuring.
  await page.evaluate(() => document.fonts.ready);
}

async function measure(
  page: Page,
  screen: string,
  locale: Locale,
): Promise<Finding[]> {
  await settle(page);
  const all = await page.evaluate(findTextOverflow);
  const entries = ALLOWLIST.filter(
    (a) => a.screen === screen && a.locale === locale,
  );
  const unexpected = all.filter((f) => !entries.some((a) => f.text === a.text));
  const stale = entries
    .filter((a) => !all.some((f) => f.text === a.text))
    .map((a) => ({
      kind: "stale-allowlist-entry" as const,
      text: a.text,
      path: `ALLOWLIST (${a.reason}): no longer overflows, remove it`,
      scrollWidth: 0,
      clientWidth: 0,
      scrollHeight: 0,
      clientHeight: 0,
    }));
  return [...unexpected, ...stale];
}

async function openLobby(page: Page, locale: Locale): Promise<void> {
  await page.goto("/");
  await page.getByTestId("game-tile-yacht").waitFor();
  if (locale !== "en") {
    await page.getByRole("tab").last().click();
    await page.getByTestId("lang-switcher-select").selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.getByRole("tab").first().click();
    await page.getByTestId("game-tile-yacht").waitFor();
  }
}

for (const locale of LOCALES) {
  test.describe(`Text overflow — ${locale} @ 375x667`, () => {
    test.use({ viewport: VIEWPORT });

    test.beforeEach(async ({ page }) => {
      // Offline-capable app: unmocked API calls fail fast instead of hanging.
      // Registered first so the entitlements mock (registered later) wins.
      await page.route("http://localhost:8000/**", (route) => route.abort());
      await installEntitlementsMock(page);
      // Sort fetches its levels from the API; without them it shows a retry
      // state instead of the level-select screen a player sees.
      await mockSortApi(page);
    });

    test("main tabs have no clipped or spilling text", async ({ page }) => {
      await openLobby(page, locale);
      const problems: Record<string, Finding[]> = {};

      problems.lobby = await measure(page, "lobby", locale);

      const tabs = page.getByRole("tab");
      await tabs.nth(1).click();
      await page.waitForLoadState("networkidle");
      problems.profile = await measure(page, "profile", locale);

      await tabs.nth(2).click();
      await expect(page.getByTestId("lang-switcher-select")).toBeVisible();
      problems.settings = await measure(page, "settings", locale);

      const bad = Object.fromEntries(
        Object.entries(problems).filter(([, v]) => v.length),
      );
      expect(bad, JSON.stringify(bad, null, 2)).toEqual({});
    });

    for (const slug of STORE_GAMES) {
      test(`${slug} main screen has no clipped or spilling text`, async ({
        page,
      }) => {
        await openLobby(page, locale);
        await page.getByTestId(`game-tile-${slug}`).click();
        // The lobby tile leaves the viewport once the game screen is pushed.
        await expect(page.getByTestId(`game-tile-${slug}`)).toBeHidden();
        // The ⋯ menu only renders once the game has finished loading. Until
        // then the header has no right slot, so the title would be measured
        // wider than it ends up.
        await expect(page.getByTestId("nav-menu")).toBeVisible();
        const found = await measure(page, slug, locale);
        expect(found, JSON.stringify(found, null, 2)).toEqual([]);
      });
    }
  });
}
