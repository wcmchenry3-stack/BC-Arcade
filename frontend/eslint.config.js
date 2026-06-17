// @ts-check
const { fixupPluginRules } = require("@eslint/compat");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const pluginReact = require("eslint-plugin-react");
const pluginReactHooks = require("eslint-plugin-react-hooks");
const pluginImport = require("eslint-plugin-import");
const js = require("@eslint/js");
const globals = require("globals");

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
      import: fixupPluginRules(pluginImport),
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
      // These react-hooks v7 rules are new — disable to match old behaviour
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/globals": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/game",
              from: "./src/components",
              message: "Game engines must not import from components/. Keep logic and UI separate.",
            },
            {
              target: "./src/game",
              from: "./src/screens",
              message: "Game engines must not import from screens/. Keep logic and UI separate.",
            },
          ],
        },
      ],
    },
  },
];
