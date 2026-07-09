import { createMergeCss } from "@pandacss/shared";
import { readFileSync } from "fs";
import { describe, expect, test, beforeAll } from "vitest";
import { createPandaContext } from "../src/panda/context";
import { createTailwindContext, clearTailwindContextCache } from "../src/tailwind/context";
import { rewriteTwFileContentToPanda } from "../src/convert/rewrite-file";
import { TailwindContext } from "../src/tailwind/types";

// @ts-expect-error
import buttonRaw from "../samples/button?raw";

const shadcnThemeRaw = readFileSync(new URL("./fixtures/shadcn-theme.css", import.meta.url), "utf-8");

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

  test("samples/button.ts - converted output is valid & lossless (caveat fixes)", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({ utility: panda.utility, conditions: panda.conditions, hash: false });

    const { output } = rewriteTwFileContentToPanda(buttonRaw, "samples/button.ts", tailwindContext, panda, mergeCss);

    // Caveat 1: the VariantProps import is renamed AND so are its usages, so the
    // converted file never references an unimported name.
    expect(output).toContain("RecipeVariantProps<typeof buttonVariants>");
    expect(output).not.toMatch(/\bVariantProps\b/); // no un-prefixed VariantProps left

    // Caveat 2: unconvertible custom classes are preserved as annotations, never
    // dropped silently nor left as a raw string inside a cva value.
    expect(output).toContain("TODO(tw2panda): unconverted");
    expect(output).toContain("bg-primary"); // kept in the annotation
    expect(output).not.toMatch(/:\s*["']bg-primary/); // not a raw class-string value
    // defaultVariants values are variant names, not classes -> left untouched
    expect(output).toMatch(/variant:\s*["']default["']/);
    expect(output).toMatch(/size:\s*["']default["']/);

    // Caveat 3: no Tailwind v4 internal plumbing leaks into the output; resolvable
    // internals become concrete values.
    expect(output).not.toContain("var(--tw-");
    expect(output).toMatch(/borderStyle:\s*["']solid["']/);
    expect(output).toMatch(/transitionTimingFunction:\s*["']cubic-bezier/);
  });

  test("custom shadcn tokens convert when their @theme is supplied (mock theme)", async () => {
    // Mock the project's theme so custom utilities (bg-primary, ...) resolve —
    // the same effect the CLI's `--tw <file>` option provides in real use.
    const twThemed = (await createTailwindContext(shadcnThemeRaw)).context;

    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({ utility: panda.utility, conditions: panda.conditions, hash: false });

    const input = [
      "import { cva } from 'class-variance-authority';",
      "const button = cva('inline-flex', {",
      "  variants: {",
      "    variant: {",
      "      default: 'bg-primary text-primary-foreground hover:bg-primary/90',",
      "      destructive: 'bg-destructive text-destructive-foreground',",
      "    },",
      "  },",
      "});",
    ].join("\n");

    const { output } = rewriteTwFileContentToPanda(input, "button.ts", twThemed, panda, mergeCss);

    // With the theme, custom tokens resolve to Panda token() references...
    expect(output).toMatch(/token\(colors\.primary,/);
    expect(output).toMatch(/token\(colors\.destructive,/);
    // ...and are no longer flagged as unconverted.
    expect(output).not.toContain("unconverted -> bg-primary");
  });

  test("compoundVariants: class keys become css, condition refs are preserved", async () => {
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({ utility: panda.utility, conditions: panda.conditions, hash: false });

    const input = [
      "import { cva } from 'class-variance-authority';",
      "const b = cva('inline-flex', {",
      "  variants: { variant: { solid: 'font-bold' }, size: { lg: 'text-lg' } },",
      "  compoundVariants: [",
      "    { variant: 'solid', size: 'lg', class: 'uppercase tracking-wide' },",
      "    { variant: 'solid', className: 'italic' },",
      "  ],",
      "  defaultVariants: { variant: 'solid', size: 'lg' },",
      "});",
    ].join("\n");

    const { output } = rewriteTwFileContentToPanda(input, "b.ts", tailwindContext, panda, mergeCss);

    // `class`/`className` keys are renamed to `css` with a converted style object...
    expect(output).toMatch(/css:\s*\{\s*textTransform:\s*["']uppercase["']/);
    expect(output).toMatch(/css:\s*\{\s*fontStyle:\s*["']italic["']/);
    // ...while the condition references (variant/size names) stay as plain strings.
    expect(output).toMatch(/variant:\s*["']solid["']/);
    expect(output).toMatch(/size:\s*["']lg["']/);
    // No leftover raw class strings under class/className keys.
    expect(output).not.toMatch(/class(Name)?:\s*["']/);
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
