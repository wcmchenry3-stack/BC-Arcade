// Runs after the test framework is installed (expect/jest globals available).
// Bump testing-library's async default (1000ms) — the first render in a suite
// pays cold-JIT cost that can exceed 1s on local first-runs and CI, causing
// flaky findBy*/waitFor failures. 5000ms matches the per-call overrides
// already sprinkled through the suite.
import { configure } from "@testing-library/react-native";
configure({ asyncUtilTimeout: 5000 });

// Jest's per-test timeout ("testTimeout" in package.json) must outlast the
// async-util waits a test makes (#2584). Both were 5000 ms, so a
// waitFor/findBy that never succeeded ran the test out before it could throw,
// and every such failure surfaced as an opaque "Exceeded timeout of 5000 ms"
// instead of the assertion that failed — which is how a deterministic Sudoku
// test bug read as a CI flake. It is 15000 ms: room for one slow successful
// wait plus one failing one. That is about the error being readable, not about
// letting slow tests pass: a waitFor that fails still fails after 5 s, with
// its real message. It lives in the config, not in a jest.setTimeout() call
// here, so a --testTimeout flag (yacht-sim-gate.yml) still takes precedence.
