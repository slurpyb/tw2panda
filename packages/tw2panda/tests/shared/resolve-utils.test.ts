import { describe, expect, test } from "vitest";
import { getTailwindDir, resolveModule } from "../../src/shared/resolve-utils";

/**
 * Regression guard: in the ESM build a bare `require.resolve` is replaced by
 * esbuild's `__require` Proxy shim, whose `.resolve` is not a function — which
 * crashed every command that touches Tailwind resolution. These must resolve
 * real paths at runtime instead of throwing.
 */
describe("resolve-utils", () => {
  test("resolveModule resolves a package entry to a real path", () => {
    const resolved = resolveModule("tailwindcss/package.json");
    expect(resolved).toMatch(/tailwindcss[\\/]package\.json$/);
  });

  test("getTailwindDir returns the tailwindcss package directory", () => {
    const dir = getTailwindDir();
    expect(dir).toMatch(/tailwindcss$/);
  });
});
