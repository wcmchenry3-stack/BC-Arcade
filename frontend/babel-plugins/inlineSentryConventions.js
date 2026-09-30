/**
 * Inlines the string constants Sentry imports from
 * `@sentry/conventions/attributes` (#2869).
 *
 * That module is ~340 KB of minified JS: every OpenTelemetry/Sentry attribute
 * name (745 exports), plus metadata tables for all of them. The Sentry SDK
 * packages we ship import about 25 of the names, e.g.
 * `import { URL_FULL } from '@sentry/conventions/attributes'`. Metro can't
 * tree-shake, so without this plugin the whole module lands in the JS bundle.
 *
 * The plugin replaces each use of an imported name with its string value,
 * read from the installed package at build time, and drops the import. The
 * values are identical, so Sentry behaves exactly as before. It only
 * rewrites an import when every imported name is a string constant used as a
 * plain value; anything else (a namespace import, the metadata tables, a
 * re-export) is left alone, which costs bundle size but never changes
 * behaviour. metro.config.js folds this file and the conventions module into
 * Metro's cache key, so editing either re-transforms the importing files.
 * __tests__/inlineSentryConventions.test.ts checks every Sentry file we
 * install still gets its import inlined.
 */

const MODULE = "@sentry/conventions/attributes";

// The CommonJS build of the same module Metro would bundle. Same values.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Babel plugins load in Node as CommonJS
const attributes = require(MODULE);

function importedName(t, specifier) {
  if (!t.isImportSpecifier(specifier)) return null;
  const { imported } = specifier;
  return t.isIdentifier(imported) ? imported.name : imported.value;
}

module.exports = function inlineSentryConventions({ types: t }) {
  return {
    name: "inline-sentry-conventions",
    visitor: {
      ImportDeclaration(path) {
        const { node } = path;
        if (node.source.value !== MODULE || node.importKind === "type") return;
        if (node.specifiers.length === 0) return;

        const plan = [];
        for (const specifier of node.specifiers) {
          const name = importedName(t, specifier);
          if (name === null || !Object.prototype.hasOwnProperty.call(attributes, name)) return;
          const value = attributes[name];
          if (typeof value !== "string") return;
          const binding = path.scope.getBinding(specifier.local.name);
          if (!binding || !binding.constant) return;
          for (const ref of binding.referencePaths) {
            // `export { URL_FULL }` and similar need a binding, not a literal.
            if (!ref.isIdentifier() || ref.parentPath.isExportSpecifier()) return;
          }
          plan.push({ binding, value });
        }

        for (const { binding, value } of plan) {
          for (const ref of binding.referencePaths) ref.replaceWith(t.stringLiteral(value));
        }
        path.remove();
      },
    },
  };
};

module.exports.MODULE = MODULE;
