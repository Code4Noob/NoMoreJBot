import { describe, expect, test } from "bun:test";

// Minimal smoke test so `bun test` exits 0 in CI while the repo has no
// real test suite yet. Replace/extend this once real tests are added.
describe("smoke", () => {
  test("bun test runner works", () => {
    expect(1 + 1).toBe(2);
  });
});
