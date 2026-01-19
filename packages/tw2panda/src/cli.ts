import { createMergeCss } from "@pandacss/shared";
import { cac } from "cac";
import { readFileSync } from "fs";
import { basename, extname, join, resolve } from "pathe";
import { extractTwFileClassList } from "./extract-tw-class-list";
import { rewriteTwFileContentToPanda } from "./rewrite-tw-file-content-to-panda";
import { rewriteHtmlToPanda } from "./rewrite-html-to-panda";
import { generateTailwindThemeCss, generateThemeVariablesOnly } from "./generate-tailwind-theme-css";
import { createTailwindContext } from "./tw-context";
import { createPandaContext } from "./panda-context";
import { twClassListToPanda } from "./tw-to-panda";
import { maybePretty } from "./maybe-pretty";
import { z } from "zod";

import { name, version } from "../package.json";
import { writeFile } from "fs/promises";
import { RewriteOptions } from "./types";
import { loadPandaContext } from "./config/load-context";

const DEFAULT_THEME_OUTPUT = "tailwind-theme.css";

const cwd = process.cwd();

const withTw = z.object({ tailwind: z.string() });
const withWrite = z.object({ write: z.boolean() });
const rewriteOptions = z.object({ shorthands: z.boolean() }).partial();
const configOptions = z.object({ config: z.string().optional(), cwd: z.string().default(cwd) });

const rewriteFlags = withWrite
  .merge(withTw)
  .merge(rewriteOptions)
  .extend({
    silent: z.boolean(),
    theme: z.boolean().default(false),
    themeOutput: z.string().default(DEFAULT_THEME_OUTPUT),
  })
  .partial()
  .merge(configOptions);
const extractFlags = withTw.merge(rewriteOptions).partial().merge(configOptions);

const cli = cac(name);

cli
  .command("rewrite <file>", "Output the given file converted to panda, doesn't actually write to disk unless using -w")
  .option("--tw, --tailwind <file>", "Path to tailwind CSS file (v4 uses CSS-first config)")
  .option("-w, --write", "Write to disk instead of stdout")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("-t, --theme", "Also generate Tailwind theme CSS file")
  .option("--theme-output <file>", `Theme CSS output path (default: ${DEFAULT_THEME_OUTPUT})`)
  .option("--silent", "Do not output anything to stdout")
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (file, _options) => {
    const options = rewriteFlags.parse(_options);
    const cwdResolved = resolve(options.cwd);
    const content = readFileSync(join(cwdResolved, file), "utf-8");

    // In v4, we use the default Tailwind CSS config
    const tw = await createTailwindContext();
    const configPath = options.config;

    const ctx = await loadPandaContext({ cwd: cwdResolved, configPath, file });
    const panda = ctx.context;
    const { mergeCss } = createMergeCss(Object.assign(panda, { hash: false }));

    const result = rewriteTwFileContentToPanda(content, file, tw.context, panda, mergeCss, options as RewriteOptions);
    if (options.write) {
      await writeFile(join(cwdResolved, file), result.output);
      console.log(`✓ Converted ${file}`);

      // Generate theme CSS if requested
      if (options.theme) {
        const themeCss = await generateTailwindThemeCss();
        const themeOutputPath = resolve(cwdResolved, options.themeOutput ?? DEFAULT_THEME_OUTPUT);
        await writeFile(themeOutputPath, themeCss);
        console.log(`✓ Generated ${options.themeOutput ?? DEFAULT_THEME_OUTPUT}`);
      }
      return;
    }

    if (!options.silent) {
      console.log(result.output);
    }
  });

cli
  .command(
    "extract <file>",
    "Extract each tailwind candidate and show its converted output, doesn't actually write to disk",
  )
  .option("--tw, --tailwind <file>", "Path to tailwind CSS file (v4 uses CSS-first config)")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (file, _options) => {
    const options = extractFlags.parse(_options);
    const content = readFileSync(join(cwd, file), "utf-8");

    // In v4, we use the default Tailwind CSS config
    const tw = await createTailwindContext();
    const configPath = options.config;

    const ctx = await loadPandaContext({ cwd, configPath, file });
    const panda = ctx.context;
    const { mergeCss } = createMergeCss(Object.assign(panda, { hash: false }));

    const list = extractTwFileClassList(content, tw.context, panda, mergeCss, options as RewriteOptions);
    console.log(list.map(({ node, ...item }) => item));
  });

cli
  .command("convert <classList>", "Example: inline-flex disabled:pointer-events-none underline-offset-4")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .action(async (classList, _options) => {
    const options = rewriteOptions.partial().parse(_options);
    const result = await twClassListToPanda(classList, options);
    console.log("input:", classList);
    console.log("output:\n");
    console.log(JSON.stringify(result, null, 2));
  });

// Theme generation command
const themeFlags = z
  .object({
    output: z.string().default(DEFAULT_THEME_OUTPUT),
    minimal: z.boolean().default(false),
    customCss: z.string().optional(),
  })
  .partial();

cli
  .command("theme", "Generate Tailwind theme CSS file with CSS variables for token fallbacks")
  .option("-o, --output <file>", `Output file path (default: ${DEFAULT_THEME_OUTPUT})`)
  .option("-m, --minimal", "Only output CSS custom properties (no utilities)")
  .option("--custom-css <css>", "Additional custom CSS to include")
  .action(async (_options) => {
    const options = themeFlags.parse(_options);

    console.log("Generating Tailwind theme CSS...");

    const themeCss = options.minimal
      ? await generateThemeVariablesOnly({ customCss: options.customCss })
      : await generateTailwindThemeCss({ customCss: options.customCss });

    const outputPath = resolve(cwd, options.output ?? DEFAULT_THEME_OUTPUT);
    await writeFile(outputPath, themeCss);
    console.log(`✓ Generated ${options.output}`);
    console.log(`  Import in your app: import "./${options.output}";`);
  });

// HTML conversion with theme support
const htmlRewriteFlags = withWrite
  .merge(rewriteOptions)
  .extend({
    name: z.string().optional(),
    theme: z.boolean().default(false),
    themeOutput: z.string().default(DEFAULT_THEME_OUTPUT),
  })
  .partial();

cli
  .command("html <file>", "Convert HTML file with Tailwind classes to TSX with Panda CSS")
  .option("-w, --write", "Write to disk instead of stdout (outputs to same name with .tsx extension)")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-n, --name <name>", "Component name (defaults to PascalCase of filename)")
  .option("-t, --theme", "Also generate Tailwind theme CSS file")
  .option("--theme-output <file>", `Theme CSS output path (default: ${DEFAULT_THEME_OUTPUT})`)
  .action(async (file, _options) => {
    const options = htmlRewriteFlags.parse(_options);
    const content = readFileSync(resolve(cwd, file), "utf-8");

    // Initialize contexts
    const tw = await createTailwindContext();
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    const fileName = basename(file, extname(file));
    const result = rewriteHtmlToPanda(content, tw.context, panda, mergeCss, {
      shorthands: options.shorthands,
      componentName: options.name,
      fileName,
    });

    const formatted = maybePretty(result.output);

    if (options.write) {
      const outputPath = join(cwd, fileName + ".tsx");
      await writeFile(outputPath, formatted);
      console.log(`✓ Converted ${file} → ${fileName}.tsx`);

      // Generate theme CSS if requested
      if (options.theme) {
        const themeCss = await generateTailwindThemeCss({
          customCss: result.extractedStyles,
          customClasses: result.unconvertedClasses,
        });
        const themeOutputPath = resolve(cwd, options.themeOutput ?? DEFAULT_THEME_OUTPUT);
        await writeFile(themeOutputPath, themeCss);
        console.log(`✓ Generated ${options.themeOutput ?? DEFAULT_THEME_OUTPUT}`);
      }

      if (result.unconvertedClasses.length > 0) {
        console.log(`  Custom classes to define: ${result.unconvertedClasses.join(", ")}`);
      }
      return;
    }

    console.log(formatted);
  });

// CSS to Panda conversion
import { cssToPanda, cssToGlobalCss, cssToRecipe } from "./css-to-panda";

cli
  .command("css <file>", "Convert raw CSS to Panda-compatible style object")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("-g, --global", "Output as globalCss format (preserves top-level selectors)")
  .option("-r, --recipe", "Output as recipe format (base + variants)")
  .option("-w, --write <file>", "Write output to file")
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (file, _options) => {
    const options = z
      .object({
        shorthands: z.boolean().optional(),
        config: z.string().optional(),
        global: z.boolean().optional(),
        recipe: z.boolean().optional(),
        write: z.string().optional(),
        cwd: z.string().default(cwd),
      })
      .parse(_options);

    const cwdResolved = resolve(options.cwd);
    const content = readFileSync(join(cwdResolved, file), "utf-8");

    // Load panda context if available (for shorthands)
    let panda: ReturnType<typeof createPandaContext> | undefined;
    if (options.shorthands) {
      const ctx = await loadPandaContext({ cwd: cwdResolved, configPath: options.config, file });
      panda = ctx.context;
    }

    let result: { styles: Record<string, unknown>; warnings: string[] };
    let outputLabel: string;

    if (options.recipe) {
      const recipeResult = cssToRecipe(content, { shorthands: options.shorthands, panda });
      result = {
        styles: { base: recipeResult.base, variants: recipeResult.variants },
        warnings: recipeResult.warnings,
      };
      outputLabel = "Recipe";
    } else if (options.global) {
      result = cssToGlobalCss(content, { shorthands: options.shorthands, panda });
      outputLabel = "globalCss";
    } else {
      result = cssToPanda(content, { shorthands: options.shorthands, panda });
      outputLabel = "css()";
    }

    // Format output
    const output = JSON.stringify(result.styles, null, 2);

    if (options.write) {
      const outputPath = resolve(cwdResolved, options.write);
      await writeFile(outputPath, output);
      console.log(`✓ Converted CSS to ${outputLabel} format → ${options.write}`);
    } else {
      console.log(`// ${outputLabel} format from ${basename(file)}`);
      console.log(output);
    }

    // Print warnings
    if (result.warnings.length > 0) {
      console.log("\n// Warnings:");
      result.warnings.forEach((w) => console.log(`//   - ${w}`));
    }
  });

// Component extraction from HTML
import { htmlToSlotRecipes } from "./extract-components";

cli
  .command("components <file>", "Extract components from HTML and generate Panda slot recipes")
  .option("--tw, --tailwind <file>", "Path to tailwind CSS file (v4 uses CSS-first config)")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("--min-confidence <n>", "Minimum confidence threshold (0-1)", { default: "0.5" })
  .option("--json", "Output as JSON instead of code")
  .option("-w, --write <dir>", "Write recipes to directory")
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (file, _options) => {
    const options = z
      .object({
        tailwind: z.string().optional(),
        shorthands: z.boolean().optional(),
        config: z.string().optional(),
        minConfidence: z.string().default("0.5"),
        json: z.boolean().optional(),
        write: z.string().optional(),
        cwd: z.string().default(cwd),
      })
      .parse(_options);

    const cwdResolved = resolve(options.cwd);
    const content = readFileSync(join(cwdResolved, file), "utf-8");

    // Create contexts
    const tw = await createTailwindContext();
    const ctx = await loadPandaContext({ cwd: cwdResolved, configPath: options.config, file });
    const panda = ctx.context;

    // Extract components
    const minConfidence = parseFloat(options.minConfidence);
    const recipes = htmlToSlotRecipes(content, tw.context, panda, {
      minConfidence,
      shorthands: options.shorthands,
    });

    if (recipes.length === 0) {
      console.log("No components detected with confidence >= " + minConfidence);
      return;
    }

    console.log(`Found ${recipes.length} component(s):\n`);

    for (const recipe of recipes) {
      if (options.json) {
        console.log(`// ${recipe.name} (${recipe.slots.length} slots)`);
        console.log(
          JSON.stringify(
            {
              name: recipe.name,
              slots: recipe.slots,
              base: recipe.base,
              variants: recipe.variants,
            },
            null,
            2,
          ),
        );
        console.log();
      } else {
        console.log(`// ═══════════════════════════════════════════════════════════`);
        console.log(`// ${recipe.name} - ${recipe.description}`);
        console.log(`// ═══════════════════════════════════════════════════════════\n`);
        console.log(recipe.code);
      }

      // Write to file if requested
      if (options.write) {
        const fileName = `${recipe.name.toLowerCase()}.recipe.ts`;
        const outputPath = resolve(cwdResolved, options.write, fileName);
        await writeFile(outputPath, recipe.code);
        console.log(`  ✓ Wrote ${fileName}`);
      }
    }
  });

// Project analysis and token extraction
import { analyzeProject, generateTokenConfig, generateMigrationReport, inferVariants } from "./analyze-project";

cli
  .command("tokens [dir]", "Extract used tokens and generate minimal Panda theme config")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("-o, --output <file>", "Output file path (default: stdout)")
  .option("--include <patterns>", "File patterns to include (comma-separated)")
  .option("--exclude <patterns>", "File patterns to exclude (comma-separated)")
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (dir, _options) => {
    const options = z
      .object({
        shorthands: z.boolean().optional(),
        config: z.string().optional(),
        output: z.string().optional(),
        include: z.string().optional(),
        exclude: z.string().optional(),
        cwd: z.string().default(cwd),
      })
      .parse(_options);

    const cwdResolved = resolve(options.cwd, dir || ".");

    console.log(`Analyzing ${cwdResolved}...\n`);

    // Create contexts
    const tw = await createTailwindContext();
    const ctx = await loadPandaContext({ cwd: cwdResolved, configPath: options.config, file: "" });
    const panda = ctx.context;

    // Parse include/exclude patterns
    const include = options.include?.split(",").map((p) => p.trim());
    const exclude = options.exclude?.split(",").map((p) => p.trim());

    // Analyze project
    const analysis = await analyzeProject(cwdResolved, tw.context, panda, {
      shorthands: options.shorthands,
      include,
      exclude,
    });

    console.log(`Found ${analysis.tokens.length} unique tokens across ${analysis.summary.totalFiles} files\n`);

    // Generate config
    const configCode = generateTokenConfig(analysis);

    if (options.output) {
      const outputPath = resolve(cwdResolved, options.output);
      await writeFile(outputPath, configCode);
      console.log(`✓ Generated ${options.output}`);
    } else {
      console.log(configCode);
    }

    // Show summary
    console.log("\nTop tokens by usage:");
    analysis.tokens.slice(0, 10).forEach((t) => {
      console.log(`  ${t.category}.${t.path}: ${t.count} uses`);
    });
  });

cli
  .command("report [dir]", "Generate migration report for a project")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("-o, --output <file>", "Output file path (default: stdout)")
  .option("--include <patterns>", "File patterns to include (comma-separated)")
  .option("--exclude <patterns>", "File patterns to exclude (comma-separated)")
  .option("--min-pattern <n>", "Minimum pattern occurrences to report", { default: "2" })
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (dir, _options) => {
    const options = z
      .object({
        shorthands: z.boolean().optional(),
        config: z.string().optional(),
        output: z.string().optional(),
        include: z.string().optional(),
        exclude: z.string().optional(),
        minPattern: z.coerce.string().default("2"),
        cwd: z.string().default(cwd),
      })
      .parse(_options);

    const cwdResolved = resolve(options.cwd, dir || ".");

    console.log(`Analyzing ${cwdResolved}...\n`);

    // Create contexts
    const tw = await createTailwindContext();
    const ctx = await loadPandaContext({ cwd: cwdResolved, configPath: options.config, file: "" });
    const panda = ctx.context;

    // Parse options
    const include = options.include?.split(",").map((p) => p.trim());
    const exclude = options.exclude?.split(",").map((p) => p.trim());
    const minPatternCount = parseInt(options.minPattern, 10);

    // Analyze project
    const analysis = await analyzeProject(cwdResolved, tw.context, panda, {
      shorthands: options.shorthands,
      include,
      exclude,
      minPatternCount,
    });

    // Generate report
    const report = generateMigrationReport(analysis);

    if (options.output) {
      const outputPath = resolve(cwdResolved, options.output);
      await writeFile(outputPath, report);
      console.log(`✓ Generated ${options.output}`);
    } else {
      console.log(report);
    }
  });

cli
  .command("infer [dir]", "Infer recipe variants from repeated patterns")
  .option("-s, --shorthands", "Use shorthands instead of longhand properties")
  .option("-c, --config <path>", "Path to panda config file")
  .option("-o, --output <dir>", "Output directory for recipe files")
  .option("--include <patterns>", "File patterns to include (comma-separated)")
  .option("--exclude <patterns>", "File patterns to exclude (comma-separated)")
  .option("--min-pattern <n>", "Minimum pattern occurrences", { default: "3" })
  .option("--cwd <cwd>", "Current working directory", { default: cwd })
  .action(async (dir, _options) => {
    const options = z
      .object({
        shorthands: z.boolean().optional(),
        config: z.string().optional(),
        output: z.string().optional(),
        include: z.string().optional(),
        exclude: z.string().optional(),
        minPattern: z.coerce.string().default("3"),
        cwd: z.string().default(cwd),
      })
      .parse(_options);

    const cwdResolved = resolve(options.cwd, dir || ".");

    console.log(`Analyzing ${cwdResolved} for patterns...\n`);

    // Create contexts
    const tw = await createTailwindContext();
    const ctx = await loadPandaContext({ cwd: cwdResolved, configPath: options.config, file: "" });
    const panda = ctx.context;

    // Parse options
    const include = options.include?.split(",").map((p) => p.trim());
    const exclude = options.exclude?.split(",").map((p) => p.trim());
    const minPatternCount = parseInt(options.minPattern, 10);

    // Analyze project
    const analysis = await analyzeProject(cwdResolved, tw.context, panda, {
      shorthands: options.shorthands,
      include,
      exclude,
      minPatternCount,
    });

    console.log(`Found ${analysis.patterns.length} repeated patterns\n`);

    // Infer variants
    const recipes = inferVariants(analysis.patterns);

    if (recipes.length === 0) {
      console.log("No variant patterns detected. Try lowering --min-pattern threshold.");
      return;
    }

    console.log(`Inferred ${recipes.length} recipe(s):\n`);

    for (const recipe of recipes) {
      console.log(`// ═══════════════════════════════════════════════════════════`);
      console.log(`// ${recipe.name} - ${Object.keys(recipe.variants).length} variant dimensions`);
      console.log(`// Inferred from ${recipe.sourcePatterns.length} similar patterns`);
      console.log(`// ═══════════════════════════════════════════════════════════\n`);
      console.log(recipe.code);

      if (options.output) {
        const fileName = `${recipe.name}.recipe.ts`;
        const outputPath = resolve(cwdResolved, options.output, fileName);
        await writeFile(outputPath, recipe.code);
        console.log(`  ✓ Wrote ${fileName}`);
      }
    }
  });

cli.help();
cli.version(version);
cli.parse();
