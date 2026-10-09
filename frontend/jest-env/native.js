"use strict";

// Default test environment for both jest projects (package.json `testEnvironment`).
//
// Mirrors `@react-native/jest-preset/jest/react-native-env.js` (the env jest-expo 57 uses), but
// resolves `jest-environment-node` from this package (Jest 30) instead of from the React Native
// preset, which still pins Jest 29, and applies the lazy-global fix in ./clearMocksOnScope.js.

const { TestEnvironment: NodeEnvironment } = require("jest-environment-node");
const { patchModuleMocker } = require("./clearMocksOnScope");

class ReactNativeEnvironment extends NodeEnvironment {
  customExportConditions = ["require", "react-native"];

  constructor(config, context) {
    super(config, context);
    patchModuleMocker(this);
  }
}

module.exports = ReactNativeEnvironment;
module.exports.TestEnvironment = ReactNativeEnvironment;
