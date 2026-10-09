"use strict";

// Plain Node environment for suites that need no React Native export conditions.
// Opt in with the docblock `@jest-environment ./jest-env/node.js` (use this instead of plain
// `node`, which crashes at teardown on Jest 30 — see ./clearMocksOnScope.js).

const { TestEnvironment: NodeEnvironment } = require("jest-environment-node");
const { patchModuleMocker } = require("./clearMocksOnScope");

class PatchedNodeEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    patchModuleMocker(this);
  }
}

module.exports = PatchedNodeEnvironment;
module.exports.TestEnvironment = PatchedNodeEnvironment;
