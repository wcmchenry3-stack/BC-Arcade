/**
 * Reporting rules every game follows (#2642, epic #2519 decisions 11 and 12).
 *
 * Each game's screen suite tests its own reporting; this one checks that
 * every game follows the same rules, so a new or changed game can't quietly
 * write the wrong outcome or ask for a rank it has no right to:
 *
 *   1. A game with no winner (`has_winner = False` on its backend module,
 *      #2619) only ever records `completed`, `kept_playing` or `abandoned`.
 *   2. A finished game never records `abandoned`; `abandoned` is only
 *      written where the player leaves (quit, restart, unmount).
 *   3. The result card never asks for a rank on an abandon, restart or
 *      unmount path (#2677: the card is rank-only).
 *
 * Driving all twelve screens through every path in one suite would repeat
 * each screen suite's whole harness, so the rules are checked in two layers:
 *
 *   - Every game, from its source: the file that calls `useGameSync(<game>)`
 *     is parsed, and the outcome of each `complete()` call is worked out from
 *     the code (literals, conditionals, local constants and functions, typed
 *     parameters, and `recordedOutcome()` run for real). The games come from
 *     `GAME_TYPES` and `has_winner` from each backend module, so a new game
 *     is covered as soon as it exists. A `complete()` call this can't work
 *     out fails the suite instead of passing unchecked. Checked per game:
 *     rule 1; for rule 3, that the id of a completion that can be `abandoned`
 *     is never kept (useGameSync's own abandons return none), so it can't
 *     reach the rank lookup; for rule 2, only that a finish has a
 *     non-abandoned outcome to record (which branch a finish takes is
 *     runtime behaviour).
 *   - One screen, for real, one check per path:
 *     `screens/__tests__/reportingInvariants.screen.test.ts` plays FreeCell
 *     (score-only) to a win, and restarts and leaves (unmounts) it mid-game,
 *     checking the recorded outcome and the rank lookup on each. It lives
 *     with the screens because game code may not import them (lint rule
 *     `bc-arcade/no-game-ui-imports`). Game-over paths are left to the
 *     screen suites (e.g. Twenty48's and Mahjong's losses).
 *
 * Already covered elsewhere and not repeated here (#2642 amendment): a stats
 * route for every game type (`screens/__tests__/gameStatsCoverage.test.tsx`),
 * and a glyph for every outcome (`api/__tests__/outcomeDisplay.test.ts`, plus
 * the exhaustive switch in `api/outcomeDisplay.ts`; ProfileScreen.test.tsx
 * checks there is no cross-game Top score tile).
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { GAME_OUTCOMES, GAME_TYPES, type GameType } from "../../../api/vocab";
import { recordedOutcome, type ResultOutcome } from "../recordedOutcome";

const SRC = path.resolve(__dirname, "../../..");
const BACKEND = path.resolve(SRC, "../../backend");

/** What a game with no winner may record (backend `vocab.GameOutcome`). */
const NO_WINNER_OUTCOMES: ReadonlySet<string> = new Set(["completed", "kept_playing", "abandoned"]);

// ---------------------------------------------------------------------------
// Which games, and which of them have a winner
// ---------------------------------------------------------------------------

/** `has_winner` as the game's backend module declares it (#2619). */
function hasWinner(game: GameType): boolean {
  const file = path.join(BACKEND, game, "module.py");
  if (!fs.existsSync(file)) throw new Error(`${game}: no backend module at ${file}`);
  const match = /^\s*has_winner\s*=\s*(True|False)\b/m.exec(fs.readFileSync(file, "utf8"));
  if (!match) throw new Error(`${game}: ${file} declares no has_winner`);
  return match[1] === "True";
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "__mocks__" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    kind
  );
}

/** Game type -> the source files that open its sessions (`useGameSync("<game>")`). */
function syncFilesByGame(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    // Cheap filter first; the parse skips mentions in comments.
    if (!fs.readFileSync(file, "utf8").includes("useGameSync(")) continue;
    const games = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "useGameSync" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        games.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
    for (const game of games) out.set(game, [...(out.get(game) ?? []), file]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Working out the outcome a `complete()` call records
// ---------------------------------------------------------------------------

/** Stands for an expression the analysis can't follow. */
const UNKNOWN = "<unknown>";

/** Every result card outcome; the type check keeps the list complete. */
const CARDS = ["win", "loss", "draw", "ended"] as const satisfies readonly ResultOutcome[];
const cardsAreComplete: [Exclude<ResultOutcome, (typeof CARDS)[number]>] extends [never]
  ? true
  : never = true;

type FunctionNode = ts.FunctionLikeDeclaration;

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

/** The nearest declaration of `name` visible from `from`: a local, a parameter or a function. */
function declarationOf(name: string, from: ts.Node): ts.Node | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const param = scope.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
      if (param) return param;
    }
    const statements =
      ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isCaseClause(scope)
        ? scope.statements
        : undefined;
    for (const statement of statements ?? []) {
      if (ts.isVariableStatement(statement)) {
        const decl = statement.declarationList.declarations.find(
          (d) => ts.isIdentifier(d.name) && d.name.text === name
        );
        if (decl) return decl;
      } else if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return statement;
      } else if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
        return statement;
      }
    }
  }
  return undefined;
}

/** The function a declaration holds: `function f`, `const f = () => …`, `useCallback(() => …)`. */
function functionOf(decl: ts.Node | undefined): FunctionNode | undefined {
  if (!decl) return undefined;
  if (ts.isFunctionDeclaration(decl)) return decl;
  if (!ts.isVariableDeclaration(decl) || !decl.initializer) return undefined;
  const init = unwrap(decl.initializer);
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  if (ts.isCallExpression(init) && init.arguments[0]) {
    const inner = unwrap(init.arguments[0]);
    if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return inner;
  }
  return undefined;
}

function returnedExpressions(fn: FunctionNode): ts.Expression[] {
  if (fn.body && !ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return; // a nested function's returns are its own
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
  return out;
}

/** The string literals a type annotation allows, or UNKNOWN. */
function typeValues(type: ts.TypeNode | undefined, seen: Set<ts.Node>): Set<string> {
  if (!type) return new Set([UNKNOWN]);
  if (ts.isParenthesizedTypeNode(type)) return typeValues(type.type, seen);
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    return new Set([type.literal.text]);
  }
  if (ts.isUnionTypeNode(type)) {
    return union(type.types.map((t) => typeValues(t, seen)));
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && !seen.has(type)) {
    const alias = declarationOf(type.typeName.text, type);
    if (alias && ts.isTypeAliasDeclaration(alias)) {
      return typeValues(alias.type, new Set([...seen, type]));
    }
  }
  return new Set([UNKNOWN]);
}

function union(sets: Iterable<Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const s of sets) s.forEach((v) => out.add(v));
  return out;
}

/** Every value `expr` can take, as far as the source shows (UNKNOWN where it can't tell). */
function valuesOf(expr: ts.Expression, seen: Set<ts.Node> = new Set()): Set<string> {
  const e = unwrap(expr);
  if (seen.has(e)) return new Set([UNKNOWN]);
  const next = new Set([...seen, e]);

  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return new Set([e.text]);
  if (ts.isConditionalExpression(e)) {
    return union([valuesOf(e.whenTrue, next), valuesOf(e.whenFalse, next)]);
  }
  if (ts.isIdentifier(e)) return declaredValues(e.text, e, next);
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const callee = e.expression.text;
    if (callee === "recordedOutcome") {
      // Run the real mapping on every card the argument can be.
      const cards = e.arguments[0] ? valuesOf(e.arguments[0], next) : new Set([UNKNOWN]);
      const known = [...cards].filter((c): c is ResultOutcome =>
        (CARDS as readonly string[]).includes(c)
      );
      const anyCard = known.length < cards.size;
      return new Set((anyCard ? CARDS : known).map((c) => recordedOutcome(c)));
    }
    const fn = functionOf(declarationOf(callee, e));
    if (fn) {
      const returns = returnedExpressions(fn);
      return returns.length ? union(returns.map((r) => valuesOf(r, next))) : new Set([UNKNOWN]);
    }
  }
  return new Set([UNKNOWN]);
}

function declaredValues(name: string, from: ts.Node, seen: Set<ts.Node>): Set<string> {
  const decl = declarationOf(name, from);
  if (!decl) return new Set([UNKNOWN]);
  if (ts.isParameter(decl)) return typeValues(decl.type, seen);
  if (ts.isVariableDeclaration(decl) && decl.initializer) return valuesOf(decl.initializer, seen);
  return new Set([UNKNOWN]);
}

/** The `outcome` a `complete()` summary argument carries. */
function outcomeExpression(summary: ts.Expression | undefined): ts.Expression | undefined {
  if (!summary) return undefined;
  const obj = unwrap(summary);
  if (!ts.isObjectLiteralExpression(obj)) return undefined;
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name.getText() === "outcome") return prop.initializer;
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "outcome") return prop.name;
  }
  return undefined;
}

interface CompleteSite {
  /** file:line, for failure messages. */
  where: string;
  outcomes: Set<string>;
  /**
   * Whether the id `complete()` returns can reach the rank lookup: "used"
   * when the call's value is kept, else "discarded". A call whose value a
   * wrapper returns is judged at each of the wrapper's call sites.
   */
  value: "used" | "discarded";
}

function enclosingFunction(node: ts.Node): FunctionNode | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) return n as FunctionNode;
  }
  return undefined;
}

/** The name a function is declared under (`function f`, `const f = …`, `const f = useCallback(…)`). */
function nameOf(fn: FunctionNode): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text;
  let holder: ts.Node = fn.parent;
  if (ts.isCallExpression(holder)) holder = holder.parent;
  return ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)
    ? holder.name.text
    : undefined;
}

type ValueUse = "used" | "discarded" | "returned";

function valueUse(call: ts.CallExpression): ValueUse {
  let node: ts.Node = call;
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) return "discarded";
  if (ts.isReturnStatement(parent)) return "returned";
  if (ts.isArrowFunction(parent) && parent.body === node) return "returned";
  return "used";
}

function where(sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${path.relative(SRC, sf.fileName)}:${line + 1}`;
}

function callsTo(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      out.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The local names `useGameSync(...)`'s results are bound to in `sf`. */
function syncBindings(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sf) === "useGameSync"
    ) {
      if (!ts.isObjectBindingPattern(node.name)) {
        throw new Error(`${where(sf, node)}: destructure useGameSync()'s result`);
      }
      for (const el of node.name.elements) {
        names.set((el.propertyName ?? el.name).getText(sf), el.name.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** Every `complete()` call in a game's sync file, with what it records and where its id goes. */
function completeSites(file: string): CompleteSite[] {
  const sf = parse(file);
  const complete = syncBindings(sf).get("complete");
  if (!complete) return [];

  const sites: CompleteSite[] = [];
  for (const call of callsTo(sf, complete)) {
    const expr = outcomeExpression(call.arguments[0]);
    const outcomes = expr ? valuesOf(expr) : new Set([UNKNOWN]);
    const use = valueUse(call);
    if (use !== "returned") {
      sites.push({ where: where(sf, call), outcomes, value: use });
      continue;
    }
    // A wrapper returns the id (Cascade's endInstrumentedSession): judge each
    // of its calls, with the outcome that call passes when it is a parameter.
    const wrapper = enclosingFunction(call);
    const name = wrapper && nameOf(wrapper);
    if (!wrapper || !name) {
      sites.push({ where: where(sf, call), outcomes: new Set([UNKNOWN]), value: "used" });
      continue;
    }
    const decl =
      expr && ts.isIdentifier(unwrap(expr))
        ? declarationOf(unwrap(expr).getText(sf), expr)
        : undefined;
    const paramIndex =
      decl && ts.isParameter(decl) && decl.parent === wrapper
        ? wrapper.parameters.indexOf(decl)
        : -1;
    for (const outer of callsTo(sf, name)) {
      const arg = paramIndex >= 0 ? outer.arguments[paramIndex] : undefined;
      const outerUse = valueUse(outer);
      sites.push({
        where: `${where(sf, outer)} (through ${name})`,
        outcomes: paramIndex >= 0 ? (arg ? valuesOf(arg) : new Set([UNKNOWN])) : outcomes,
        value: outerUse === "discarded" ? "discarded" : "used",
      });
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Every game, from its source
// ---------------------------------------------------------------------------

const SYNC_FILES = syncFilesByGame();

function syncFile(game: GameType): string {
  const files = SYNC_FILES.get(game) ?? [];
  if (files.length !== 1) {
    throw new Error(`${game}: expected one file calling useGameSync("${game}"), found ${files}`);
  }
  return files[0]!;
}

const WINNERLESS = GAME_TYPES.filter((g) => !hasWinner(g));

describe("reporting invariants: the games", () => {
  it("covers every game type, and only those", () => {
    expect([...SYNC_FILES.keys()].sort()).toEqual([...GAME_TYPES].sort());
    // Both kinds exist, so neither rule below passes by having no games.
    expect(WINNERLESS.length).toBeGreaterThan(0);
    expect(WINNERLESS.length).toBeLessThan(GAME_TYPES.length);
  });

  describe.each(GAME_TYPES)("%s", (game) => {
    const sites = completeSites(syncFile(game));
    const describeSite = (s: CompleteSite) => `${s.where}: ${[...s.outcomes].join(" | ")}`;

    it("records outcomes the analysis can follow, all of them real outcomes", () => {
      expect(sites.length).toBeGreaterThan(0);
      const unknown = sites.filter((s) => s.outcomes.has(UNKNOWN)).map(describeSite);
      // Make the outcome traceable (a literal, a typed parameter, a local
      // constant or function, recordedOutcome()) rather than widen this.
      expect(unknown).toEqual([]);
      for (const site of sites) {
        for (const outcome of site.outcomes) expect(GAME_OUTCOMES).toContain(outcome);
      }
    });

    if (!hasWinner(game)) {
      it("has no winner, so never records win, loss or push", () => {
        const wrong = sites
          .filter((s) => [...s.outcomes].some((o) => !NO_WINNER_OUTCOMES.has(o)))
          .map(describeSite);
        expect(wrong).toEqual([]);
      });
    }

    it("records something other than abandoned when a game finishes", () => {
      // Which branch runs on a finish can't be read from the source (e.g.
      // Blackjack's one call is win / loss / abandoned by how the run ended);
      // the screens check that. Here: a finished game has an outcome to record.
      const finishes = union(sites.map((s) => s.outcomes));
      finishes.delete("abandoned");
      expect([...finishes]).not.toEqual([]);
    });

    it("never keeps the id of a completion that can be an abandon (no rank lookup for it)", () => {
      // useGameSync's own abandons (unmount, restart, close) return no id;
      // an explicit abandon must not hand one to the result card either.
      const leaks = sites
        .filter((s) => s.outcomes.has("abandoned") && s.value === "used")
        .map(describeSite);
      expect(leaks).toEqual([]);
    });
  });
});

describe("reporting invariants: recordedOutcome", () => {
  it("never records abandoned or kept_playing for a finished game", () => {
    expect(cardsAreComplete).toBe(true);
    for (const card of CARDS) {
      expect(["abandoned", "kept_playing"]).not.toContain(recordedOutcome(card));
    }
  });

  it('maps "ended", the only card a game with no winner shows, to an outcome it may record', () => {
    expect(NO_WINNER_OUTCOMES.has(recordedOutcome("ended"))).toBe(true);
  });
});
