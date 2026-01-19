#!/usr/bin/env npx vite-node
/**
 * HTML to TSX Converter with Tailwind → Panda CSS conversion
 *
 * This script is a standalone runner for development/testing.
 * For production use, prefer the CLI: tw2panda html <file>
 *
 * Usage:
 *   npx vite-node scripts/html-to-tsx.ts -- ./example.html
 *   npx vite-node scripts/html-to-tsx.ts -- ./example.html -o ./Example.tsx
 *   npx vite-node scripts/html-to-tsx.ts -- ./example.html -s
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, basename, extname } from "pathe";
import { createMergeCss } from "@pandacss/shared";
import { createTailwindContext } from "../src/tw-context";
import { createPandaContext } from "../src/panda-context";
import { rewriteHtmlToPanda } from "../src/rewrite-html-to-panda";
import { maybePretty } from "../src/maybe-pretty";

interface Options {
  shorthands?: boolean;
  output?: string;
  componentName?: string;
}

/** Check if an arg is a value for a preceding option flag */
function isOptionValue(args: string[], arg: string): boolean {
  const idx = args.indexOf(arg);
  if (idx <= 0) return false;
  const prev = args[idx - 1];
  return prev === "-o" || prev === "--output" || prev === "-n" || prev === "--name";
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
HTML to TSX Converter with Tailwind → Panda CSS

Usage:
  npx vite-node scripts/html-to-tsx.ts -- <input.html> [options]

For production use, prefer the CLI:
  tw2panda html <file> [options]

Options:
  --output, -o <file>   Output file path (default: stdout)
  --shorthands, -s      Use Panda CSS shorthand properties
  --name, -n <name>     Component name (default: derived from filename)
  --help, -h            Show this help message

Examples:
  npx vite-node scripts/html-to-tsx.ts -- example.html
  npx vite-node scripts/html-to-tsx.ts -- example.html -o Example.tsx -s
  npx vite-node scripts/html-to-tsx.ts -- page.html --name MyPage
`);
    process.exit(0);
  }

  // Find the input file (first arg that doesn't start with - and isn't an option value)
  const inputFile = args.find((arg) => !arg.startsWith("-") && !isOptionValue(args, arg));
  if (!inputFile) {
    console.error("Error: Input file is required");
    console.error("Usage: npx vite-node scripts/html-to-tsx.ts -- <input.html> [options]");
    process.exit(1);
  }

  const options: Options = {
    shorthands: args.includes("--shorthands") || args.includes("-s"),
  };

  // Parse --output / -o
  const outputIdx = args.findIndex((a) => a === "--output" || a === "-o");
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    options.output = args[outputIdx + 1];
  }

  // Parse --name / -n
  const nameIdx = args.findIndex((a) => a === "--name" || a === "-n");
  if (nameIdx !== -1 && args[nameIdx + 1]) {
    options.componentName = args[nameIdx + 1];
  }

  try {
    const absolutePath = resolve(process.cwd(), inputFile);
    const html = readFileSync(absolutePath, "utf-8");
    const fileName = basename(inputFile, extname(inputFile));

    // Initialize contexts
    const tw = await createTailwindContext();
    const panda = createPandaContext();
    const { mergeCss } = createMergeCss({
      utility: panda.utility,
      conditions: panda.conditions,
      hash: false,
    });

    // Convert
    const result = rewriteHtmlToPanda(html, tw.context, panda, mergeCss, {
      shorthands: options.shorthands,
      componentName: options.componentName,
      fileName,
    });

    const formatted = maybePretty(result.output);

    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      writeFileSync(outputPath, formatted);
      console.log(`✓ Converted ${inputFile} → ${options.output}`);
      if (result.unconvertedClasses.length > 0) {
        console.log(`  Custom classes to define: ${result.unconvertedClasses.join(", ")}`);
      }
    } else {
      console.log(formatted);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
