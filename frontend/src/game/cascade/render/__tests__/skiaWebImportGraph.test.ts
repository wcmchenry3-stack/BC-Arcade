/**
 * Skia on web only works after CanvasKit has loaded (#2960).
 *
 * `@shopify/react-native-skia`'s web module runs `export const Skia = JsiSkApi(global.CanvasKit)`
 * once, when it is first evaluated. If any module that imports Skia is evaluated before
 * `loadCanvasKit()` has put CanvasKit on the global, `Skia` is built from `undefined` and stays
 * broken for the page's lifetime: Cascade would never draw on web, whatever Retry does. Several
 * plain `.ts` files import Skia without a `.web` sibling (`game/starswarm/assets.ts`,
 * `game/starswarm/render/*`, `game/mahjong/tileFaces.ts`, `game/cascade/render/drawFrame.ts`),
 * so a single new static import from web code could do it, unnoticed.
 *
 * How this guards it: a full static import-graph walk from the web entry (`index.ts`). It parses
 * every reached module with the TypeScript parser and follows `import`, `export ... from`,
 * dynamic `import()` and `require()` of relative paths, resolving the way Metro does for
 * `platform: "web"` (`X.web.{tsx,ts,js,jsx}` before `X.{tsx,ts,js,jsx}`, then `X/index`; never
 * `.native`, `.ios` or `.android`). Type-only imports are skipped (they are erased). The one
 * edge it does not follow is the Cascade route's `import("./CascadeScreen")` in
 * `loadCascadeScreen.web.ts`, which runs only after CanvasKit has loaded; the test asserts that
 * edge exists, so the exception cannot go stale. Every other module reached must not import
 * `@shopify/react-native-skia`. A module reached only through that edge (the Cascade screen and
 * what only it imports) is fine; one that the rest of the app also imports is reached by the
 * walk through the other path and fails here.
 *
 * Limits: only relative imports are followed (the app has no path aliases), and a computed
 * module name would not be seen.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const FRONTEND = path.resolve(__dirname, "../../../../..");
const SRC = path.join(FRONTEND, "src");
const ENTRY = path.join(FRONTEND, "index.ts");
const SKIA = "@shopify/react-native-skia";

const LOADER = path.join(SRC, "screens/loadCascadeScreen.web.ts");
const SCREEN_SPECIFIER = "./CascadeScreen";

const EXTENSIONS = [".web.tsx", ".web.ts", ".web.js", ".web.jsx", ".tsx", ".ts", ".js", ".jsx"];

/** The file Metro picks on web for a relative specifier, or null (JSON, assets, packages). */
function resolveOnWeb(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
  ];
  // An explicit extension (`./x.js`) is itself a candidate.
  candidates.unshift(base);
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

type Imports = Array<{ specifier: string; dynamic: boolean }>;

/** Every module this file loads at run time. */
function importsOf(file: string): Imports {
  if (!/\.(tsx?|jsx?)$/.test(file)) return [];
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found: Imports = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyTypes =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            named !== undefined &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every((el) => el.isTypeOnly)));
      if (!onlyTypes) found.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      found.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      found.push({
        specifier: (node.arguments[0] as ts.StringLiteral).text,
        dynamic: node.expression.kind === ts.SyntaxKind.ImportKeyword,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Walks the web import graph from the entry. Returns every reached source file and, for each, the
 * file that first reached it (to print an import chain on failure).
 */
function walkWebGraph(skipEdge: (from: string, specifier: string) => boolean) {
  const via = new Map<string, string | null>([[ENTRY, null]]);
  const skippedEdges: Array<{ from: string; specifier: string }> = [];
  const importsSkia: string[] = [];
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const { specifier } of importsOf(file)) {
      if (specifier === SKIA || specifier.startsWith(`${SKIA}/`)) {
        importsSkia.push(file);
        continue;
      }
      if (skipEdge(file, specifier)) {
        skippedEdges.push({ from: file, specifier });
        continue;
      }
      const target = resolveOnWeb(file, specifier);
      if (target === null || via.has(target)) continue;
      via.set(target, file);
      queue.push(target);
    }
  }
  return { via, skippedEdges, importsSkia };
}

function chain(via: Map<string, string | null>, file: string): string {
  const parts: string[] = [];
  for (let at: string | null | undefined = file; at; at = via.get(at)) {
    parts.unshift(path.relative(FRONTEND, at));
  }
  return parts.join(" -> ");
}

describe("web import graph and Skia (#2960)", () => {
  const graph = walkWebGraph(
    (from, specifier) => from === LOADER && specifier === SCREEN_SPECIFIER
  );

  it("starts at the entry and reaches the app (the walk is not vacuous)", () => {
    expect(graph.via.size).toBeGreaterThan(300);
    // Metro's web resolution: the .web route, never the native CascadeRoute.tsx.
    expect(graph.via.has(path.join(SRC, "screens/CascadeRoute.web.tsx"))).toBe(true);
    expect(graph.via.has(path.join(SRC, "screens/CascadeRoute.tsx"))).toBe(false);
    // A web-only sibling wins over its plain file.
    expect(graph.via.has(LOADER)).toBe(true);
  });

  it("skips exactly one edge: the Cascade route's import() of the screen, after CanvasKit loads", () => {
    expect(graph.skippedEdges).toEqual([{ from: LOADER, specifier: SCREEN_SPECIFIER }]);
    // It is the dynamic import that follows `await loadCanvasKit()`.
    const dynamic = importsOf(LOADER).find((i) => i.specifier === SCREEN_SPECIFIER);
    expect(dynamic?.dynamic).toBe(true);
    const source = fs.readFileSync(LOADER, "utf8");
    expect(source.indexOf("await loadCanvasKit()")).toBeGreaterThan(-1);
    expect(source.indexOf("await loadCanvasKit()")).toBeLessThan(
      source.indexOf(`import("${SCREEN_SPECIFIER}")`)
    );
  });

  it("does not reach the Cascade screen except through that import()", () => {
    expect(graph.via.has(path.join(SRC, "screens/CascadeScreen.tsx"))).toBe(false);
  });

  it("reaches no module that imports @shopify/react-native-skia before CanvasKit has loaded", () => {
    const offenders = [...new Set(graph.importsSkia)].map((file) => chain(graph.via, file));
    expect(offenders).toEqual([]);
  });

  it("would catch a Skia import: the walk finds them in the Cascade screen's own subtree", () => {
    // Control: with the exception lifted, the walk reaches the screen and the Skia importers
    // behind it, so an empty `offenders` above means "none reached", not "none found".
    const all = walkWebGraph(() => false);
    expect(all.importsSkia.length).toBeGreaterThan(0);
    expect(all.importsSkia.map((f) => path.relative(SRC, f))).toContain(
      "components/cascade/CascadeBoard.tsx"
    );
  });
});
