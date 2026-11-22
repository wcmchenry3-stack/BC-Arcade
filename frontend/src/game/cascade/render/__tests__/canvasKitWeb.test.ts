/**
 * CanvasKit for Cascade on web (#2960): the `.wasm` the web build serves must be the version the
 * installed `@shopify/react-native-skia` was built against, and the CanvasKit loader must stay
 * out of the iOS and Android bundles.
 */
import fs from "fs";
import path from "path";

const FRONTEND = path.resolve(__dirname, "../../../../..");
const SRC = path.join(FRONTEND, "src");

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function deps(pkg: Record<string, unknown>): Record<string, string> {
  return (pkg.dependencies ?? {}) as Record<string, string>;
}

/** Every source file under src/, tests excluded. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "__mocks__" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("canvaskit-wasm version", () => {
  const app = readJson(path.join(FRONTEND, "package.json"));
  const skia = readJson(
    path.join(FRONTEND, "node_modules/@shopify/react-native-skia/package.json")
  );
  const installed = readJson(path.join(FRONTEND, "node_modules/canvaskit-wasm/package.json"));

  it("is pinned to the version @shopify/react-native-skia depends on", () => {
    expect(deps(app)["canvaskit-wasm"]).toBe(deps(skia)["canvaskit-wasm"]);
  });

  it("is the version installed, so the bundled .wasm matches Skia's JS", () => {
    expect(installed.version).toBe(deps(app)["canvaskit-wasm"]);
  });
});

describe("CanvasKit stays out of native bundles", () => {
  const LOADER = path.join(SRC, "game/cascade/render/loadCanvasKit.ts");
  const IMPORTS_CANVASKIT = /from\s+["'](canvaskit-wasm[^"']*|[^"']*\/loadCanvasKit)["']/;

  it("is imported only by web files (and the loader itself)", () => {
    const importers = sourceFiles(SRC)
      .filter((file) => IMPORTS_CANVASKIT.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file));
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      const isWebFile = /\.web\.(ts|tsx)$/.test(file);
      expect({ file, ok: isWebFile || path.join(SRC, file) === LOADER }).toEqual({
        file,
        ok: true,
      });
    }
  });

  it("is loaded on web by the Cascade route, which lazy-loads the screen after it", () => {
    const route = fs.readFileSync(path.join(SRC, "screens/CascadeRoute.web.tsx"), "utf8");
    const loader = fs.readFileSync(path.join(SRC, "screens/loadCascadeScreen.web.ts"), "utf8");
    expect(route).toMatch(/from "\.\/loadCascadeScreen\.web"/);
    // A static import would evaluate Skia's web module before CanvasKit is on the global.
    for (const source of [route, loader]) {
      expect(source).not.toMatch(/^import[^;]*["']\.\/CascadeScreen["']/m);
    }
    const loadAt = loader.indexOf("await loadCanvasKit()");
    expect(loadAt).toBeGreaterThan(-1);
    expect(loadAt).toBeLessThan(loader.indexOf('import("./CascadeScreen")'));
  });

  it("routes Cascade through CascadeRoute, whose native file is the screen itself", () => {
    const lazy = fs.readFileSync(path.join(SRC, "utils/lazyScreens.ts"), "utf8");
    expect(lazy).toMatch(/Cascade: \(\) => import\("\.\.\/screens\/CascadeRoute"\)/);
    const native = fs.readFileSync(path.join(SRC, "screens/CascadeRoute.tsx"), "utf8");
    const imports = native.split("\n").filter((line) => /^\s*(import|export)\b/.test(line));
    expect(imports).toEqual(['export { default } from "./CascadeScreen";']);
  });
});
