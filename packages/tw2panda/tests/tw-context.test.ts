import { describe, expect, test } from "vitest";
import { createTailwindContext, clearTailwindContextCache } from "../src/tw-context";

describe("tw-context", () => {
  test("createTailwindContext", async () => {
    // Clear cache before test
    clearTailwindContextCache();

    const ctx = await createTailwindContext();

    // v4 DesignSystem has a different structure than v3
    expect(typeof ctx.context.candidatesToCss).toBe("function");
    expect(typeof ctx.context.parseCandidate).toBe("function");
    expect(typeof ctx.context.getClassList).toBe("function");
    expect(typeof ctx.context.getVariants).toBe("function");
    expect(typeof ctx.context.getClassOrder).toBe("function");
    expect(typeof ctx.context.resolveThemeValue).toBe("function");

    // Test that candidatesToCss works
    const cssResults = ctx.context.candidatesToCss(["flex", "bg-red-500"]);
    expect(cssResults).toHaveLength(2);
    expect(cssResults[0]).toContain("display: flex");
    expect(cssResults[1]).toContain("background-color:");
  });
});
