// @ts-check
const path = require("path");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const pluginReact = require("eslint-plugin-react");
const pluginReactHooks = require("eslint-plugin-react-hooks");
const js = require("@eslint/js");
const globals = require("globals");

// eslint-plugin-import v2's no-restricted-paths silently skips TypeScript imports
// in ESLint 9 flat config because its resolver returns null without a TS resolver
// configured. This inline rule enforces the same boundary using path.resolve()
// directly — no import resolution needed.
const gameDir = path.resolve(__dirname, "src/game");
const noGameUiImports = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (!filename.startsWith(gameDir + path.sep) && filename !== gameDir) return {};
    if (filename.endsWith(".tsx")) return {}; // game-level UI components may use shared components
    return {
      ImportDeclaration(node) {
        const resolved = path.resolve(path.dirname(filename), node.source.value);
        const componentsDir = path.resolve(__dirname, "src/components");
        const screensDir = path.resolve(__dirname, "src/screens");
        if (resolved.startsWith(componentsDir + path.sep) || resolved === componentsDir) {
          context.report({
            node,
            message: "Game engines must not import from components/. Keep logic and UI separate.",
          });
        }
        if (resolved.startsWith(screensDir + path.sep) || resolved === screensDir) {
          context.report({
            node,
            message: "Game engines must not import from screens/. Keep logic and UI separate.",
          });
        }
      },
    };
  },
};

module.exports = [
  // Global ignores
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "ios/**",
      "android/**",
      "**/*.config.js",
      "**/*.py",
      "index.ts",
    ],
  },

  // Base JS recommended
  js.configs.recommended,

  // Global environment and settings
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    settings: {
      react: { version: "detect" },
    },
  },

  // TypeScript: parser + recommended rules
  ...tsPlugin.configs["flat/recommended"],

  // React: JSX language options + recommended rules
  pluginReact.configs.flat.recommended,

  // React Hooks recommended
  pluginReactHooks.configs.flat["recommended-latest"],

  // Project-specific overrides
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "bc-arcade": { rules: { "no-game-ui-imports": noGameUiImports } },
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // react-hooks v7 rules: warn-only for now (they catch hot-path defects the
      // refactor epic targets). Fix the warnings, then ratchet to "error" (#2951, #2950).
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/globals": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "bc-arcade/no-game-ui-imports": "error",
    },
  },

  // Complexity quality gates (#2951, epic #2950). Ratchet the numbers down quarterly.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["**/__tests__/**"],
    rules: {
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", 20],
    },
  },

  // The 11 files over 800 effective lines (blanks/comments skipped) when the gate landed:
  // warn only, so current PRs still pass. Remove each entry as its split lands
  // (#2951, epic #2950). Do NOT add new files here.
  {
    files: [
      "src/components/starswarm/GameCanvas.tsx",
      "src/components/starswarm/GameCanvas.web.tsx",
      "src/game/starswarm/engine.ts",
      "src/screens/CascadeScreen.tsx",
      "src/screens/DailyWordScreen.tsx",
      "src/screens/GameScreen.tsx",
      "src/screens/HeartsScreen.tsx",
      "src/screens/MahjongScreen.tsx",
      "src/screens/SolitaireScreen.tsx",
      "src/screens/StarSwarmScreen.tsx",
    ],
    rules: {
      "max-lines": ["warn", { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },

  // Sound maps: Metro needs a literal require() per asset, so a generic loader is
  // impossible. (Cascade keeps its per-line disables until epic #3033.)
  {
    files: ["src/game/*/sounds.ts"],
    ignores: ["src/game/cascade/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // The app must not import the CI/script-only simulators in tooling/ (#2969):
  // they would be bundled into the production app.
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "App.tsx", "index.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/tooling", "**/tooling/**"],
              message: "tooling/ is script/CI-only simulation code; the app must not import it.",
            },
          ],
        },
      ],
    },
  },
];
