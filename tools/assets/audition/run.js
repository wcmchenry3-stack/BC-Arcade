#!/usr/bin/env node
/**
 * run.js: play a game in the web build, record a video and log every sound it plays (#3673).
 *
 * The second step of the sound process (#3578, #3665). It drives the games' moves in a browser,
 * records the page, and writes `<scenario>.webm` and `<scenario>.plays.json` (every
 * `HTMLMediaElement.play`, with its time in seconds from when the page opened). `mix.py` then lays
 * the logged sounds onto the video.
 *
 *   node tools/assets/audition/run.js <scenario> [--base URL] [--out DIR] [--headed]
 *   node tools/assets/audition/run.js --list
 *
 * Build and serve the web build first (README.md: the exact build command, never a plain
 * `expo export`). The page can only reach `https://dev-games-api.buffingchi.com`, answered here
 * by mocks: /entitlements with the JWT the e2e specs use, plus the per-game routes a scenario
 * needs (Daily Word's /today, /guess, /answer). Every other request is aborted, so a recording
 * never touches a real server, and a build pointed at production would fail loudly.
 *
 * Needs Playwright: `cd e2e && npm ci && npx playwright install chromium`. Set CHROME_PATH to
 * use an installed Chrome or Chromium instead.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const REPO = path.resolve(__dirname, "..", "..", "..");
const API_ORIGIN = "https://dev-games-api.buffingchi.com";
const DEFAULT_BASE = "http://localhost:8081";
const VIEWPORT = { width: 480, height: 860 };

// ---------------------------------------------------------------------------
// Network mocks
// ---------------------------------------------------------------------------

const b64url = (s) =>
  Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

/**
 * The GET /entitlements body: the same token `installEntitlementsMock` builds in
 * e2e/tests/helpers/api-mock.ts (keep the two in step), granting every premium game.
 */
function entitlementsBody() {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: "e2e-test",
      entitled_games: [
        "blackjack",
        "cascade",
        "hearts",
        "starswarm",
        "mahjong",
      ],
      iat: 1000000000,
      exp: 9999999999,
    }),
  );
  return {
    token: `${header}.${payload}.e2e-sig`,
    expires_at: "2286-11-20T17:46:39.000Z",
  };
}

const DAILY_WORD_ANSWER = "crane";
const DAILY_WORD_PUZZLE_ID = "2026-05-03:en";
/** Guesses the mock server refuses with a 422 `not_a_word`. */
const DAILY_WORD_NOT_WORDS = new Set(["xyzzy"]);

/** Score a guess against the answer, the way Wordle does (duplicate letters included). */
function scoreGuess(answer, guess) {
  const status = Array.from(guess, () => "absent");
  const left = {};
  Array.from(answer).forEach((ch, i) => {
    if (guess[i] === ch) status[i] = "correct";
    else left[ch] = (left[ch] || 0) + 1;
  });
  Array.from(guess).forEach((ch, i) => {
    if (status[i] !== "correct" && left[ch] > 0) {
      status[i] = "present";
      left[ch] -= 1;
    }
  });
  return Array.from(guess, (letter, i) => ({ letter, status: status[i] }));
}

/** Daily Word's /today, /guess (scored against a fixed answer) and /answer. */
function dailyWordMock({ pathname, method, body }) {
  if (pathname === "/daily-word/today") {
    return {
      status: 200,
      json: {
        puzzle_id: DAILY_WORD_PUZZLE_ID,
        word_length: DAILY_WORD_ANSWER.length,
      },
    };
  }
  if (pathname === "/daily-word/guess" && method === "POST") {
    const guess = String(JSON.parse(body || "{}").guess || "").toLowerCase();
    if (DAILY_WORD_NOT_WORDS.has(guess)) {
      return { status: 422, json: { detail: "not_a_word" } };
    }
    return {
      status: 200,
      json: { tiles: scoreGuess(DAILY_WORD_ANSWER, guess) },
    };
  }
  if (pathname === "/daily-word/answer") {
    return { status: 200, json: { answer: DAILY_WORD_ANSWER } };
  }
  return null;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * Route everything: the page's own origin passes through, the dev API is answered by the mocks
 * (`/entitlements` plus the scenario's), and every other request is aborted.
 */
async function installNetwork(context, base, gameMocks) {
  const baseOrigin = new URL(base).origin;
  const mocks = [
    ({ pathname }) =>
      pathname === "/entitlements" && { status: 200, json: entitlementsBody() },
  ];
  mocks.push(...gameMocks);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (process.env.AUDIT_DEBUG && url.origin !== baseOrigin)
      console.error("ext", request.method(), request.url());
    if (url.origin === baseOrigin) return route.continue();
    if (url.origin !== API_ORIGIN) return route.abort();
    if (request.method() === "OPTIONS") {
      const allow = request.headers()["access-control-request-headers"] || "*";
      return route.fulfill({
        status: 204,
        headers: { ...CORS, "access-control-allow-headers": allow },
      });
    }
    if (process.env.AUDIT_DEBUG)
      console.error("api", request.method(), url.pathname);
    const call = {
      pathname: url.pathname,
      method: request.method(),
      body: request.postData(),
    };
    for (const mock of mocks) {
      const reply = mock(call);
      if (reply) {
        return route.fulfill({
          status: reply.status,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify(reply.json),
        });
      }
    }
    return route.abort();
  });
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open the home screen with a game's saved state cleared (and optionally replaced). */
async function openHome(page, base, storage = {}, clear = []) {
  await page.goto(base);
  await page.evaluate(
    ([set, remove]) => {
      remove.forEach((key) => localStorage.removeItem(key));
      Object.entries(set).forEach(([key, value]) =>
        localStorage.setItem(key, JSON.stringify(value)),
      );
    },
    [storage, clear],
  );
  await page.goto(base);
  await page.getByText("BC Arcade").first().waitFor({ timeout: 15_000 });
}

// --- Daily Word ------------------------------------------------------------

const DAILY_WORD_KEY = "daily_word_state_v1";
/** The last row has flipped by about 0.55 s after Enter; the next guess waits for it. */
const DAILY_WORD_ROW_MS = 1400;

async function openDailyWord(page, base) {
  await openHome(page, base, {}, [DAILY_WORD_KEY]);
  await page.getByRole("button", { name: "Play Daily Word" }).click();
  await page
    .getByRole("heading", { name: "Daily Word", exact: true })
    .waitFor({ timeout: 10_000 });
}

async function typeWord(page, word) {
  for (const letter of word.toUpperCase()) {
    await page.getByRole("button", { name: letter, exact: true }).click();
    await sleep(60);
  }
}

async function pressKey(page, name, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.getByRole("button", { name, exact: true }).click();
    await sleep(60);
  }
}

async function submitWord(page, word, settleMs = DAILY_WORD_ROW_MS) {
  await typeWord(page, word);
  await pressKey(page, "Enter");
  await sleep(settleMs);
}

// --- Mahjong ---------------------------------------------------------------

/**
 * A four-tile board: two pairs set on the corners of a 2 x 2 block, so every tile is free and the
 * tiles left after the first match still span the same block (the camera refits to the tiles that
 * remain, #3612, and would move the next tap otherwise). A are the diagonal (0,0) and (2,1), B the
 * other diagonal.
 */
function mahjongFourTileState() {
  const tile = (id, faceId, col, row) => ({
    id,
    suit: "characters",
    rank: faceId - 7,
    faceId,
    col,
    row,
    layer: 0,
  });
  return {
    _v: 2,
    tiles: [
      tile(0, 8, 0, 0),
      tile(1, 9, 2, 0),
      tile(2, 9, 0, 1),
      tile(3, 8, 2, 1),
    ],
    pairsRemoved: 70,
    score: 1000,
    shufflesLeft: 0,
    selected: null,
    undoStack: [],
    isComplete: false,
    isDeadlocked: false,
    startedAt: null,
    accumulatedMs: 0,
    dealId: "aud1",
    currentLayoutId: "turtle",
  };
}

/**
 * Where the four tiles are on screen, found by looking: the board's camera (the layout's bounds,
 * the opening zoom, the refit) is too involved to replay, and the layout's own bounds are not the
 * four tiles'. The tiles are ivory on a dark green felt, so the light pixels' bounding box is the
 * 2 x 2 block, and each tile is a quarter of it. Returns the box in page coordinates.
 */
async function locateTileBlock(page, canvasBox) {
  const view = page.viewportSize();
  const clip = {
    x: Math.max(0, canvasBox.x),
    y: Math.max(0, canvasBox.y),
    width:
      Math.min(view.width, canvasBox.x + canvasBox.width) -
      Math.max(0, canvasBox.x),
    height:
      Math.min(view.height, canvasBox.y + canvasBox.height) -
      Math.max(0, canvasBox.y),
  };
  const png = await page.screenshot({ clip });
  const found = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      img.width,
      img.height,
    );
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 170) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    return { x0, y0, x1, y1 };
  }, png.toString("base64"));
  if (found.x1 < 0) throw new Error("no tiles found on the Mahjong board");
  return {
    x: clip.x + found.x0,
    y: clip.y + found.y0,
    width: found.x1 - found.x0,
    height: found.y1 - found.y0,
  };
}

/** The screen point of a tile's centre: the block is 2 tiles wide and 2 high. */
function mahjongTilePoint(block, col, row) {
  return {
    x: block.x + ((col / 2 + 0.5) / 2) * block.width,
    y: block.y + ((row + 0.5) / 2) * block.height,
  };
}

// --- 2048 ------------------------------------------------------------------

const TWENTY48_KEY = "twenty48_game_v2";

function twenty48State(board, score = 0) {
  const tiles = [];
  let id = 1;
  board.forEach((cells, row) =>
    cells.forEach((value, col) => {
      if (value) {
        tiles.push({
          id: (id += 1),
          value,
          row,
          col,
          prevRow: row,
          prevCol: col,
          isNew: false,
          isMerge: false,
        });
      }
    }),
  );
  return {
    board,
    tiles,
    score,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
  };
}

async function openTwenty48(page, base, state) {
  await openHome(page, base, { [TWENTY48_KEY]: state });
  await page.getByRole("button", { name: "Play 2048" }).click();
  await page.getByLabel("Game board").waitFor({ timeout: 10_000 });
}

async function swipes(page, keys, gapMs) {
  for (const key of keys) {
    await page.keyboard.press(key);
    await sleep(gapMs);
  }
}

// ---------------------------------------------------------------------------
// Scenarios: each plays one recording. `mark(label)` notes a moment in the log, for `mix.py
// --frames`; `ctx.base` is the served build.
// ---------------------------------------------------------------------------

const SCENARIOS = {
  "daily-word": {
    describe:
      "Daily Word, a won game: SLATE, too short, XYZZY (refused), TRACE, CRANE",
    mocks: [dailyWordMock],
    async play({ page, base, mark }) {
      await openDailyWord(page, base);
      mark("start");
      await submitWord(page, "slate");
      // Too short: a local refusal and the row shakes.
      await typeWord(page, "tr");
      await pressKey(page, "Enter");
      await sleep(900);
      await pressKey(page, "Delete", 2);
      // Refused by the server (422 not_a_word).
      await typeWord(page, "xyzzy");
      await pressKey(page, "Enter");
      await sleep(900);
      await pressKey(page, "Delete", 5);
      await submitWord(page, "trace");
      mark("last-row");
      await submitWord(page, "crane", 4500);
      mark("end");
    },
  },
  "daily-word-loss": {
    describe:
      "Daily Word, a lost game: six wrong words, then the answer flips in",
    mocks: [dailyWordMock],
    async play({ page, base, mark }) {
      await openDailyWord(page, base);
      mark("start");
      for (const word of ["slate", "briny", "mound", "plumb", "fight"]) {
        await submitWord(page, word);
      }
      mark("last-row");
      await submitWord(page, "showy", 4500);
      mark("end");
    },
  },
  mahjong: {
    describe:
      "Mahjong, a four-tile board: select, deselect, select, match, select, the winning match",
    mocks: [],
    async play({ page, base, mark }) {
      await openHome(page, base, { mahjong_game: mahjongFourTileState() });
      await page
        .getByRole("button", { name: "Play Mahjong Solitaire" })
        .click();
      const canvas = page.getByRole("img", { name: /Mahjong Solitaire/i });
      await canvas.waitFor({ timeout: 15_000 });
      await sleep(1500); // the opening zoom settles
      const box = await canvas.boundingBox();
      if (!box) throw new Error("the Mahjong board has no bounding box");
      // The camera refits to the tiles left after a match, so find the tiles again then.
      let block = await locateTileBlock(page, box);
      const tap = (col, row) => {
        const { x, y } = mahjongTilePoint(block, col, row);
        return page.mouse.click(x, y);
      };
      mark("start");
      await tap(0, 0); // select
      await sleep(700);
      await tap(0, 0); // deselect (silent)
      await sleep(700);
      await tap(0, 0); // select
      await sleep(700);
      mark("match");
      await tap(2, 1); // match A: the clack as the pair meets
      await sleep(1800); // the burst ends and the camera refits to the two tiles left
      block = await locateTileBlock(page, box);
      await tap(2, 0); // select
      await sleep(700);
      mark("win");
      await tap(0, 1); // match B: the last pair, the win
      await sleep(4000);
      mark("end");
    },
  },
  yacht: {
    describe:
      "Yacht, solo: a roll, two holds, a release, two re-rolls, then a score",
    mocks: [],
    async play({ page, base, mark }) {
      await openHome(page, base, {}, ["yacht_game_v2"]);
      await page.getByRole("button", { name: "Play Yacht" }).click();
      await page.getByRole("button", { name: /^Solo$/i }).click();
      await page.getByText("Round 1 / 13").waitFor({ timeout: 10_000 });
      mark("start");
      const roll = page.getByRole("button", { name: /^Roll/i });
      await roll.click();
      await sleep(1500);
      const die = (n) =>
        page.getByRole("button", { name: new RegExp(`^Die ${n}:`) });
      await die(1).click(); // hold
      await sleep(700);
      await die(2).click(); // hold
      await sleep(700);
      await die(1).click(); // release
      await sleep(1000);
      await roll.click();
      await sleep(1500);
      await roll.click();
      await sleep(1800);
      mark("score");
      await page.getByText("Chance").first().click();
      await sleep(2500);
      mark("end");
    },
  },
  twenty48: {
    describe:
      "2048: eight calm swipes, then eight fast ones, on a board of pairs",
    mocks: [],
    async play({ page, base, mark }) {
      const board = [
        [2, 2, 4, 4],
        [0, 0, 0, 0],
        [8, 8, 0, 0],
        [0, 0, 16, 16],
      ];
      await openTwenty48(page, base, twenty48State(board));
      mark("start");
      const cycle = ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"];
      await swipes(page, [...cycle, ...cycle], 450);
      mark("fast");
      await swipes(page, [...cycle, ...cycle], 220);
      await sleep(1500);
      mark("end");
    },
  },
  "twenty48-win": {
    describe: "2048: 1024 + 1024 merge into 2048 (the win card), then Continue",
    mocks: [],
    async play({ page, base, mark }) {
      const board = [
        [1024, 1024, 0, 0],
        [2, 4, 8, 16],
        [4, 8, 16, 32],
        [8, 16, 32, 64],
      ];
      await openTwenty48(page, base, twenty48State(board, 5000));
      mark("start");
      await page.keyboard.press("ArrowLeft");
      await page.getByText("You Win!").waitFor({ timeout: 5_000 });
      mark("win");
      await sleep(3000);
      mark("end");
    },
  },
};

// Sort and Sudoku are left out until their moves are scripted (they are separate stories).
SCENARIOS["2048"] = SCENARIOS.twenty48;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function loadPlaywright() {
  const roots = [
    path.join(REPO, "e2e"),
    path.join(REPO, "frontend"),
    process.cwd(),
  ];
  for (const root of roots) {
    for (const name of ["@playwright/test", "playwright"]) {
      try {
        return createRequire(path.join(root, "package.json"))(name);
      } catch {
        // try the next one
      }
    }
  }
  throw new Error(
    "Playwright not found: run `cd e2e && npm ci` (see README.md)",
  );
}

function parseArgs(argv) {
  const args = {
    scenario: null,
    base: DEFAULT_BASE,
    out: null,
    headed: false,
    list: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--base") args.base = argv[(i += 1)];
    else if (a === "--out") args.out = argv[(i += 1)];
    else if (a === "--headed") args.headed = true;
    else if (a === "--list") args.list = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else args.scenario = a;
  }
  return args;
}

async function record(scenarioName, { base, out, headed }) {
  const scenario = SCENARIOS[scenarioName];
  const outDir = path.resolve(
    out || path.join(os.tmpdir(), "bc-arcade-audition"),
  );
  const slug = scenarioName === "2048" ? "twenty48" : scenarioName;
  fs.mkdirSync(outDir, { recursive: true });
  const videoDir = fs.mkdtempSync(path.join(outDir, `.${slug}-`));

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    serviceWorkers: "block",
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  await installNetwork(context, base, scenario.mocks);

  const plays = [];
  const marks = [];
  let t0 = Date.now();
  const pauses = [];
  await context.exposeFunction("__auditPlay", (src, at, info) => {
    plays.push({ t: Math.max(0, (at - t0) / 1000), src, ...info });
  });
  await context.exposeFunction("__auditPause", (at, el) => {
    pauses.push({ t: Math.max(0, (at - t0) / 1000), el });
  });
  await context.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    const ids = new WeakMap();
    let nextId = 0;
    const idOf = (el) => {
      if (!ids.has(el)) ids.set(el, (nextId += 1));
      return ids.get(el);
    };
    // A paused or finished element stops contributing to the mix. Media events do not bubble
    // and a detached Audio never reaches the document, so each element is listened to itself.
    const watched = new WeakSet();
    const watch = (el) => {
      if (watched.has(el)) return;
      watched.add(el);
      for (const type of ["pause", "ended"]) {
        el.addEventListener(type, () => {
          try {
            window.__auditPause(Date.now(), idOf(el));
          } catch {
            // logging must never break the page
          }
        });
      }
    };
    HTMLMediaElement.prototype.play = function play(...args) {
      try {
        watch(this);
        window.__auditPlay(this.currentSrc || this.src, Date.now(), {
          el: idOf(this),
          volume: this.volume,
          muted: this.muted,
        });
      } catch {
        // logging must never break the page
      }
      return original.apply(this, args);
    };
  });
  const page = await context.newPage();
  t0 = Date.now(); // the recording starts with the page
  const mark = (label) => marks.push({ t: (Date.now() - t0) / 1000, label });

  let failure = null;
  try {
    await scenario.play({ page, base, mark });
  } catch (err) {
    failure = err;
    // A picture of where it stopped, for the next fix of a scenario.
    await page
      .screenshot({ path: path.join(outDir, `${slug}.failure.png`) })
      .catch(() => {});
  }
  const recordingEnd = (Date.now() - t0) / 1000; // the scenario is over: the recording ends here
  const video = page.video();
  await context.close(); // finishes the video file
  await browser.close();

  const videoPath = path.join(outDir, `${slug}.webm`);
  if (video) fs.copyFileSync(await video.path(), videoPath);
  fs.rmSync(videoDir, { recursive: true, force: true });
  const logPath = path.join(outDir, `${slug}.plays.json`);
  plays.sort((a, b) => a.t - b.t);
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        scenario: slug,
        base,
        viewport: VIEWPORT,
        recordingEnd,
        marks,
        plays,
        pauses,
      },
      null,
      2,
    ),
  );
  if (failure) throw failure;
  return { videoPath, logPath, plays };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || !args.scenario) {
    console.log("scenarios:");
    for (const [name, s] of Object.entries(SCENARIOS))
      console.log(`  ${name.padEnd(16)} ${s.describe}`);
    process.exit(args.list ? 0 : 2);
  }
  if (!SCENARIOS[args.scenario]) {
    console.error(`unknown scenario '${args.scenario}'; try --list`);
    process.exit(2);
  }
  const { videoPath, logPath, plays } = await record(args.scenario, args);
  for (const p of plays)
    console.log(`${p.t.toFixed(3).padStart(8)} s  ${path.basename(p.src)}`);
  console.log(`${plays.length} sounds logged\n${videoPath}\n${logPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  SCENARIOS,
  scoreGuess,
  entitlementsBody,
  dailyWordMock,
  mahjongTilePoint,
};
