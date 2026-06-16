// Jest transform that patches the react-native-renderer version check.
// react-native@0.85.x compiles ReactNativeRenderer-dev.js with a hardcoded
// version equality check that throws when react is a patch ahead.
// This transform replaces the check with a no-op so tests can run.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const babelJest = require("babel-jest");
const createTransformer = babelJest.createTransformer || babelJest.default.createTransformer;
const delegate = createTransformer({});

module.exports = {
  ...delegate,
  process(sourceText, sourcePath, options) {
    const patched = sourceText.replace(/"19\.\d+\.\d+" !== isomorphicReactPackageVersion/, "false");
    return delegate.process(patched, sourcePath, options);
  },
};
