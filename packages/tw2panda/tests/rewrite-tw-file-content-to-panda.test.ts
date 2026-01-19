import { createMergeCss } from "@pandacss/shared";
import { describe, expect, test, beforeAll } from "vitest";
import { createPandaContext } from "../src/panda-context";
import { createTailwindContext, clearTailwindContextCache } from "../src/tw-context";
import { rewriteTwFileContentToPanda } from "../src/rewrite-tw-file-content-to-panda";
import { TailwindContext } from "../src/tw-types";

// @ts-expect-error
import buttonRaw from "../samples/button?raw";

describe("rewrite-tw-file-content-to-panda", () => {
  let tailwindContext: TailwindContext;

  beforeAll(async () => {
    clearTailwindContextCache();
    const tw = await createTailwindContext();
    tailwindContext = tw.context;
  });

  test("samples/button.ts - basic transformation", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const { output, resultList } = rewriteTwFileContentToPanda(
      buttonRaw,
      "samples/button.ts",
      tailwindContext,
      panda,
      mergeCss,
    );

    // Verify the output contains expected transformations
    expect(output).toContain("import { css }");
    expect(output).toContain("cva({");

    // Verify resultList has items
    expect(resultList.length).toBeGreaterThan(0);
  });

  test("JSX expressions", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const input = `
      const App = () => {
        return (
          <>
            <header
              className={'flex items-center bg-transparent'}
              class={'text-red-400'}
            />
          </>
        )
      }
      `;
    const { output } = rewriteTwFileContentToPanda(input, "App.tsx", tailwindContext, panda, mergeCss);

    // Verify css() calls are added
    expect(output).toContain("css({");
    expect(output).toContain("import { css }");
  });

  test("NoSubstitutionTemplateLiteral", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const input = `
      const App = () => {
        return (
          <>
            <div class={\`text-blue-400\`} />
          </>
        )
      }
      `;

    const { output } = rewriteTwFileContentToPanda(input, "App.tsx", tailwindContext, panda, mergeCss);

    // Verify template literal is transformed
    expect(output).toContain("css({");
  });

  test("TemplateLiteral with condition", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const input = `
      const App = () => {
        return (
          <>
            <div class={\`text-yellow-400 \$\{sticky ? 'bg-yellow-200' : "bg-yellow-400"} \`} />
          </>
        )
      }
      `;
    const { output } = rewriteTwFileContentToPanda(input, "App.tsx", tailwindContext, panda, mergeCss);

    // Verify cx is imported for template literals with conditions
    expect(output).toContain("cx(");
    expect(output).toContain("import { css, cx }");
  });

  test("Simple React component", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const input = `
      const Card = () => {
        return (
          <div className="p-4 rounded-lg bg-white shadow-md">
            <h1 className="text-xl font-bold">Title</h1>
            <p className="text-gray-600">Description</p>
          </div>
        )
      }
    `;

    const { output, resultList } = rewriteTwFileContentToPanda(input, "Card.tsx", tailwindContext, panda, mergeCss);

    // Verify transformations
    expect(output).toContain("css({");
    expect(resultList.length).toBe(3); // 3 className attributes
  });

  test("dark mode classes", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const input = `
      const Component = () => {
        return (
          <div className="bg-white dark:bg-slate-800 text-black dark:text-white">
            Content
          </div>
        )
      }
    `;

    const { output } = rewriteTwFileContentToPanda(input, "Component.tsx", tailwindContext, panda, mergeCss);

    // Verify dark mode is converted to _dark
    expect(output).toContain("_dark");
    expect(output).toContain("css({");
  });
});
