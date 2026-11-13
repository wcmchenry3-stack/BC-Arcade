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
import { mockDailyWordApi } from "./helpers/daily_word";
import { SUDOKU_STORAGE_KEY, midGameSudokuState } from "./helpers/sudoku";

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
 * An element that only exists once the game's real first screen has appeared
 * (not the loading, error or offline state). Measuring before it is visible
 * would test the wrong screen.
 */
const READY_TESTID: Record<(typeof STORE_GAMES)[number], string> = {
  yacht: "yacht-mode-card",
  twenty48: "twenty48-board",
  solitaire: "solitaire-stock-pile",
  freecell: "freecell-board",
  sudoku: "sudoku-pregame-start",
  sort: "sort-level-1",
  daily_word: "daily-word-row-0",
};

/**
 * Games hidden in store builds (HIDDEN_GAMES in gameVisibility.ts). The e2e
 * build shows them, so they appear on the lobby but are not checked here.
 * Keep in sync with HIDDEN_GAMES.
 */
const HIDDEN_IN_STORE = [
  "blackjack",
  "cascade",
  "hearts",
  "starswarm",
  "mahjong",
] as const;

/**
 * Known, tracked overflows (and confirmed false positives), keyed by screen,
 * locale, overflow kind, element path and exact element text so nothing else is masked.
 *
 * An entry that no longer overflows fails the test (stale entry), so this list
 * can only shrink.
 */
const ALLOWLIST: {
  screen: string;
  locale: Locale;
  kind: Finding["kind"];
  /** Substring of the finding's selector path, to pin the element. */
  pathIncludes: string;
  text: string;
  reason: string;
}[] = [
  {
    screen: "profile",
    locale: "es",
    kind: "clip",
    pathIncludes: "profile-tile-favorite",
    text: "Palabra Diaria",
    reason:
      "false positive on native: StatTileGrid uses adjustsFontSizeToFit, which shrinks the value on iOS/Android but RN-web ignores it",
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

/** Same entry means same screen, locale, kind, element path and text. */
function matches(
  a: (typeof ALLOWLIST)[number],
  f: Pick<Finding, "kind" | "path" | "text">,
): boolean {
  return (
    a.kind === f.kind && f.path.includes(a.pathIncludes) && a.text === f.text
  );
}

/** A populated Profile: per-game rows for every store game, no history. */
async function mockProfileApi(page: Page): Promise<void> {
  const game = (n: number) => ({
    last_played_at: "2026-10-01T12:00:00Z",
    sessions: n,
    completed: n,
    won: n - 2,
    lost: 2,
    tied: 0,
    current_win_streak: 3,
    best_win_streak: 5,
    time_played_ms: n * 60_000,
    best_value: 1200,
    best_label_key: "score",
  });
  await page.route("**/stats/me*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total_games: 70,
        by_game: Object.fromEntries(STORE_GAMES.map((g) => [g, game(10)])),
        favorite_game: "yacht",
        arcade_xp: 1250,
        arcade_level: 4,
        xp_into_level: 150,
        xp_for_next_level: 400,
        streak_days: 3,
      }),
    }),
  );
  await page.route("**/games/me*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], next_cursor: null }),
    }),
  );
}

async function detectSettled(page: Page): Promise<Finding[]> {
  // Late fonts change text metrics, and slide-in transforms move boxes:
  // wait for fonts, then two animation frames, then require two identical
  // detector runs before trusting the result.
  await page.evaluate(() => document.fonts.ready);
  const frames = () =>
    page.evaluate(async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
    });
  await frames();
  let prev = JSON.stringify(await page.evaluate(findTextOverflow));
  await expect
    .poll(
      async () => {
        await frames();
        const cur = JSON.stringify(await page.evaluate(findTextOverflow));
        const same = cur === prev;
        prev = cur;
        return same;
      },
      { message: "text overflow measurement never stabilised" },
    )
    .toBe(true);
  return JSON.parse(prev) as Finding[];
}

async function measure(
  page: Page,
  screen: string,
  locale: Locale | (typeof SUDOKU_BOARD_LOCALES)[number],
): Promise<Finding[]> {
  const all = await detectSettled(page);
  const entries = ALLOWLIST.filter(
    (a) => a.screen === screen && a.locale === locale,
  );
  const unexpected = all.filter((f) => !entries.some((a) => matches(a, f)));
  const stale = entries
    .filter((a) => !all.some((f) => matches(a, f)))
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

async function openLobby(
  page: Page,
  locale: Locale | (typeof SUDOKU_BOARD_LOCALES)[number],
): Promise<void> {
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
      // Sort's levels ship in the app (#2761); this mocks its leaderboard.
      await mockSortApi(page);
      // Daily Word fetches today's puzzle; without it the board never shows.
      await mockDailyWordApi(page);
      await mockProfileApi(page);
    });

    test("main tabs have no clipped or spilling text", async ({ page }) => {
      await openLobby(page, locale);
      const problems: Record<string, Finding[]> = {};

      const tileSlugs = await page
        .locator("[data-testid^='game-tile-']")
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("data-testid")!.slice(10)),
        );
      const known: string[] = [...STORE_GAMES, ...HIDDEN_IN_STORE];
      expect(
        tileSlugs.filter((slug) => !known.includes(slug)),
        "New lobby game(s): add to STORE_GAMES or HIDDEN_IN_STORE",
      ).toEqual([]);

      problems.lobby = await measure(page, "lobby", locale);

      const tabs = page.getByRole("tab");
      await tabs.nth(1).click();
      await expect(page.getByTestId("profile-list")).toBeVisible();
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
        if (slug === "solitaire") {
          // Deal Draw 1 so the board, not the draw-mode modal, is measured.
          await page.getByTestId("solitaire-draw-1").click();
        }
        await expect(page.getByTestId(READY_TESTID[slug])).toBeVisible();
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

/**
 * The Yacht board (#3748), not just its mode picker: the thumb tray's scorecard, hint, Roll and
 * action bar in en, es and fr-CA (the longest words) at 320 pt (iPhone SE class and smaller) and
 * 390 pt, solo and VS, after a roll with a die held, and during the computer's turn.
 */
const YACHT_BOARD_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

for (const locale of LOCALES) {
  for (const viewport of YACHT_BOARD_VIEWPORTS) {
    test.describe(`Yacht board overflow — ${locale} @ ${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test.beforeEach(async ({ page }) => {
        await page.route("http://localhost:8000/**", (route) => route.abort());
        await installEntitlementsMock(page);
      });

      for (const mode of ["solo", "vs"] as const) {
        test(`${mode} board has no clipped or spilling text`, async ({
          page,
        }) => {
          await openLobby(page, locale);
          await page.getByTestId("game-tile-yacht").click();
          await expect(page.getByTestId("game-tile-yacht")).toBeHidden();
          await page.getByTestId(`yacht-mode-${mode}`).click();
          await expect(page.getByTestId("yacht-tray")).toBeVisible();
          await expect(page.getByTestId("nav-menu")).toBeVisible();

          // Before the first roll, then with potentials showing and a die held.
          const problems: Record<string, Finding[]> = {};
          problems.start = await measure(page, "yacht-board", locale);
          await page.getByTestId("yacht-roll-button").click();
          await page.getByTestId("yacht-die-4").click();
          problems.rolled = await measure(page, "yacht-board", locale);

          if (mode === "vs") {
            // The computer's turn: its own hint text, its roll counter, "Computer's Turn" on Roll.
            await page.getByTestId("score-row-chance").click();
            await expect(page.getByTestId("yacht-roll-button")).toBeDisabled();
            problems.computerTurn = await measure(page, "yacht-board", locale);
          }

          const bad = Object.fromEntries(
            Object.entries(problems).filter(([, v]) => v.length),
          );
          expect(bad, JSON.stringify(bad, null, 2)).toEqual({});
        });
      }
    });
  }
}

/**
 * The Sudoku board (#3773), not just its difficulty picker: the HUD (a plural error count), the
 * five-action bar and the digit keys in en, es and fr-CA like Yacht, plus de and ru (the longest
 * words and a plural-heavy language), at 320 pt and 390 pt, with Notes off and on and the New Game
 * picker open. The action bar's labels share a ~59 pt slot each at 320.
 */
const SUDOKU_BOARD_LOCALES = [...LOCALES, "de", "ru"] as const;
const SUDOKU_BOARD_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

for (const locale of SUDOKU_BOARD_LOCALES) {
  for (const viewport of SUDOKU_BOARD_VIEWPORTS) {
    test.describe(`Sudoku board overflow — ${locale} @ ${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test.beforeEach(async ({ page }) => {
        await page.route("http://localhost:8000/**", (route) => route.abort());
        await installEntitlementsMock(page);
      });

      test("board, bar and keys have no clipped or spilling text", async ({
        page,
      }) => {
        await openLobby(page, locale);
        // A saved mid-game puzzle, so the game opens on the board with two errors on the count.
        await page.evaluate(
          ([key, state]) =>
            localStorage.setItem(key as string, JSON.stringify(state)),
          [SUDOKU_STORAGE_KEY, midGameSudokuState()] as const,
        );
        await page.getByTestId("game-tile-sudoku").click();
        await expect(page.getByTestId("game-tile-sudoku")).toBeHidden();
        await expect(page.getByTestId("sudoku-action-bar")).toBeVisible();
        await expect(page.getByTestId("nav-menu")).toBeVisible();

        const problems: Record<string, Finding[]> = {};
        problems.board = await measure(page, "sudoku-board", locale);

        await page.getByTestId("sudoku-notes").click();
        problems.notesOn = await measure(page, "sudoku-board", locale);
        await page.getByTestId("sudoku-notes").click();

        // New Game: the confirm, then the picker with its Cancel.
        await page.getByTestId("sudoku-new-game").click();
        problems.confirm = await measure(page, "sudoku-board", locale);
        await page.getByTestId("sudoku-abandon-confirm").click();
        await expect(page.getByTestId("sudoku-new-game-cancel")).toBeVisible();
        problems.picker = await measure(page, "sudoku-board", locale);

        const bad = Object.fromEntries(
          Object.entries(problems).filter(([, v]) => v.length),
        );
        expect(bad, JSON.stringify(bad, null, 2)).toEqual({});
      });
    });
  }
}
