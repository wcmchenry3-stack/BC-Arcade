// Runs after the test framework is installed (expect/jest globals available).
// Bump testing-library's async default (1000ms) — the first render in a suite
// pays cold-JIT cost that can exceed 1s on local first-runs and CI, causing
// flaky findBy*/waitFor failures. 5000ms matches the per-call overrides
// already sprinkled through the suite.
import { configure } from "@testing-library/react-native";
configure({ asyncUtilTimeout: 5000 });

// Jest's per-test timeout must outlast one full async-util wait (#2584). Both
// were 5000 ms, so a waitFor/findBy that never succeeded ran the test out
// before it could throw: every such failure surfaced as an opaque "Exceeded
// timeout of 5000 ms for a test" instead of the assertion that actually
// failed — which is how a deterministic Sudoku test bug read as a CI flake.
// This is about the error being readable, not about letting slow tests pass:
// a waitFor that fails still fails after 5 s, now with its real message.
jest.setTimeout(10_000);
