import { describe, expect, test } from "vitest";
import { createMergeCss } from "@pandacss/shared";
import {
  createPandaContext,
  createTailwindContextSync,
  initTailwindContext,
  rewriteTwFileContentToPanda,
} from "tw2panda";

/**
 * Exercises the exact browser code path the playground uses: the built tw2panda
 * dist resolving Tailwind v4's CSS assets through the `fs` / `module` aliases
 * (fs.shim.ts / module.shim.ts in vite.config.ts). If the shims stop serving
 * Tailwind's `index.css`, the design system can't initialize and this fails.
 */
describe("browser Tailwind v4 conversion", () => {
  test("initializes the design system and converts tw classes to Panda", async () => {
    // Mirrors PlaygroundWithMachine: init once, then read synchronously.
    await initTailwindContext();
    const tailwind = createTailwindContextSync().context;

    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const input = `export const App = () => <div className="flex items-center gap-4 bg-red-500 md:p-4" />;`;
    const { output } = rewriteTwFileContentToPanda(input, "App.tsx", tailwind, panda, mergeCss);

    // Wrapped in css(), and v4 tokens resolved from the bundled index.css.
    expect(output).toContain("css(");
    expect(output).toContain("display");
    expect(output).toContain("flex");
    // bg-red-500 -> shorthand bgColor with a v4 oklch token fallback
    expect(output).toContain("bgColor");
    expect(output).toContain("token(colors.red.500");
    // md: breakpoint condition preserved
    expect(output).toContain("md");
  });
});
