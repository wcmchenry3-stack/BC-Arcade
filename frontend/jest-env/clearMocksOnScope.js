"use strict";

// Shared Jest 30 fix for every test environment in this directory.
//
// Backport of jest-expo 58's `src/preset/nativeEnvironment.js`. Since Jest 30.4,
// `Runtime.resetModules()` (also run at teardown) calls `moduleMocker.clearMocksOnScope(global)`,
// which reads every enumerable global. Expo's winter runtime (loaded by the jest-expo preset
// setup) installs some globals lazily (`structuredClone`, `fetch`, `__ExpoImportMetaRegistry`, ...)
// through getters that `require()` their implementation on first access, so reading them after
// the test file has finished throws "You are trying to `require` a file outside of the scope of
// the test code". This version skips accessor properties so lazy globals are never evaluated
// during teardown; data-property mocks are cleared exactly as before.
//
// Delete this directory (and the `testEnvironment` / `@jest-environment` references to it) once
// jest-expo >= 58 is adopted with the SDK 58 upgrade.

/**
 * @this {{ isMockFunction(value: unknown): boolean }} the environment's jest-mock ModuleMocker
 * @param {object} scope
 */
function clearMocksOnScope(scope) {
  for (const key of Object.keys(scope)) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, key);
    if (!descriptor || typeof descriptor.get === "function") {
      continue;
    }
    const value = descriptor.value;
    if (
      value != null &&
      (typeof value === "object" || typeof value === "function") &&
      "_isMockFunction" in value &&
      this.isMockFunction(value) &&
      typeof value.mockClear === "function"
    ) {
      value.mockClear();
    }
  }
}

/**
 * Patch an environment's module mocker in place. The environment already handed this mocker to
 * the legacy fake timers, so replacing it would leave timer mocks owned by a mocker the runtime
 * never sees.
 */
function patchModuleMocker(environment) {
  environment.moduleMocker.clearMocksOnScope = clearMocksOnScope;
}

module.exports = { patchModuleMocker };
