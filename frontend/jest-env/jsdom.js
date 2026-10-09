"use strict";

// jsdom environment for suites that need a DOM under the jest-expo (native) preset.
// Opt in with the docblock `@jest-environment ./jest-env/jsdom.js` (use this instead of plain
// `jsdom`).
//
// Besides the lazy-global fix in ./clearMocksOnScope.js, this handles one more Jest 30 change:
// jsdom 26 (jest-environment-jsdom 30) defines `window` as [LegacyUnforgeable], i.e.
// non-configurable. `@react-native/jest-preset/jest/setup.js` (a preset setupFile) redefines
// `global.window = global` with Object.defineProperties, which throws "Cannot redefine property:
// window". In jsdom `window` already is the global, so that one key is dropped from the preset's
// call; every other property it defines is applied unchanged.

const { TestEnvironment: JSDOMEnvironment } = require("jest-environment-jsdom");
const { patchModuleMocker } = require("./clearMocksOnScope");

class ReactNativeJSDOMEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);
    patchModuleMocker(this);

    const global = this.global;
    const ObjectCtor = global.Object;
    const defineProperties = ObjectCtor.defineProperties;
    ObjectCtor.defineProperties = function (target, props) {
      const descriptor = target === global && Object.getOwnPropertyDescriptor(global, "window");
      if (descriptor && !descriptor.configurable && props && "window" in props) {
        // One-shot: restore the original as soon as the preset's call has been handled.
        ObjectCtor.defineProperties = defineProperties;
        const rest = { ...props };
        delete rest.window;
        return defineProperties.call(this, target, rest);
      }
      return defineProperties.call(this, target, props);
    };
  }
}

module.exports = ReactNativeJSDOMEnvironment;
module.exports.TestEnvironment = ReactNativeJSDOMEnvironment;
