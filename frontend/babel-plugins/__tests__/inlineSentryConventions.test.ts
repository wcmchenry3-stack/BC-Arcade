/**
 * babel-plugins/inlineSentryConventions.js (#2869) keeps the 340 KB
 * `@sentry/conventions/attributes` module out of the JS bundle by inlining
 * the few string constants Sentry imports from it.
 *
 * These tests pin two things:
 *   - the rewrite is exact (same strings) and conservative (anything it can't
 *     inline safely is left untouched);
 *   - every Sentry ESM file installed today loses its conventions import. A
 *     Sentry upgrade that imports it some new way fails here, instead of
 *     silently putting the 340 KB back into the bundle.
 */

import { transformSync } from "@babel/core";
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Babel plugin
const plugin = require("../inlineSentryConventions");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real module, for its values
const attributes = require("@sentry/conventions/attributes") as Record<string, unknown>;

const MODULE = "@sentry/conventions/attributes";

function transform(code: string): string {
  const out = transformSync(code, {
    babelrc: false,
    configFile: false,
    sourceType: "module",
    plugins: [plugin],
  });
  return out?.code ?? "";
}

describe("inlineSentryConventions", () => {
  it("replaces imported constants with their exact string values", () => {
    const out = transform(
      `import { URL_FULL, SENTRY_OP as OP } from '${MODULE}';\n` +
        `export function f(span) { span.setAttribute(URL_FULL, 1); return { [OP]: URL_FULL }; }`
    );
    expect(out).not.toContain(MODULE);
    expect(out).toContain(JSON.stringify(attributes.URL_FULL));
    expect(out).toContain(JSON.stringify(attributes.SENTRY_OP));
    expect(attributes.URL_FULL).toBe("url.full");
  });

  it("leaves namespace imports alone", () => {
    const code = `import * as A from '${MODULE}';\nconsole.log(A.URL_FULL);`;
    expect(transform(code)).toContain(MODULE);
  });

  it("leaves non-string exports alone", () => {
    const code = `import { URL_FULL, ATTRIBUTE_METADATA } from '${MODULE}';\nconsole.log(URL_FULL, ATTRIBUTE_METADATA);`;
    const out = transform(code);
    expect(out).toContain(MODULE);
    expect(out).toContain("URL_FULL");
  });

  it("leaves unknown names alone", () => {
    const code = `import { NOT_A_REAL_ATTRIBUTE } from '${MODULE}';\nconsole.log(NOT_A_REAL_ATTRIBUTE);`;
    expect(transform(code)).toContain(MODULE);
  });

  it("leaves re-exports alone", () => {
    const code = `import { URL_FULL } from '${MODULE}';\nexport { URL_FULL };`;
    expect(transform(code)).toContain(MODULE);
  });

  it("ignores other modules", () => {
    const code = `import { URL_FULL } from '@sentry/core';\nconsole.log(URL_FULL);`;
    expect(transform(code)).toContain("@sentry/core");
  });
});

describe("installed Sentry packages", () => {
  const sentryDir = path.dirname(require.resolve("@sentry/core/package.json"));
  const scopeDir = path.dirname(sentryDir);

  function esmFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "cjs") esmFiles(full, out);
      } else if (/\.m?js$/.test(entry.name) && fs.readFileSync(full, "utf8").includes(MODULE)) {
        out.push(full);
      }
    }
    return out;
  }

  const files = fs
    .readdirSync(scopeDir)
    .filter((pkg) => pkg !== "conventions")
    .flatMap((pkg) => {
      const build = path.join(scopeDir, pkg, "build");
      return fs.existsSync(build) ? esmFiles(build) : [];
    });

  it("finds the files that import the conventions module", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(scopeDir, f), f]))(
    "%s no longer imports it after the transform",
    (_name, file) => {
      expect(transform(fs.readFileSync(file, "utf8"))).not.toContain(MODULE);
    }
  );
});
