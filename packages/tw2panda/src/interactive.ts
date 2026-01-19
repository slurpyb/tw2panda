/**
 * Interactive migration mode for tw2panda
 *
 * Guided wizard that walks users through:
 * 1. Project analysis
 * 2. File selection
 * 3. Preview changes
 * 4. Apply conversions
 */

import { createInterface, Interface } from "readline";
import type { PandaContext } from "./panda-context";
import type { TailwindContext } from "./tw-types";
import { analyzeProject, ProjectAnalysis } from "./analyze-project";
import { batchProcess, BatchResult, generateDiff } from "./batch-processor";

// ============================================================================
// Types
// ============================================================================

export interface InteractiveOptions {
  /** Base directory */
  cwd: string;
  /** Use shorthand properties */
  shorthands?: boolean | undefined;
  /** Patterns to ignore */
  ignore?: string[] | undefined;
}

interface InteractiveContext {
  tw: TailwindContext;
  panda: PandaContext;
  options: InteractiveOptions;
  rl: Interface;
  analysis?: ProjectAnalysis | undefined;
  selectedFiles: string[];
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Run the interactive migration wizard
 */
export async function runInteractive(
  tw: TailwindContext,
  panda: PandaContext,
  options: InteractiveOptions,
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ctx: InteractiveContext = {
    tw,
    panda,
    options,
    rl,
    selectedFiles: [],
  };

  try {
    await showWelcome(ctx);
    await analyzeStep(ctx);
    await selectFilesStep(ctx);
    await previewStep(ctx);
    await applyStep(ctx);
    await finishStep(ctx);
  } catch (error) {
    if ((error as Error).message === "USER_ABORT") {
      console.log("\n  Migration cancelled.\n");
    } else {
      throw error;
    }
  } finally {
    rl.close();
  }
}

// ============================================================================
// Wizard Steps
// ============================================================================

async function showWelcome(ctx: InteractiveContext): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🐼  tw2panda Interactive Migration Wizard                   ║
║                                                               ║
║   This wizard will guide you through migrating your           ║
║   Tailwind CSS classes to Panda CSS.                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

  console.log(`  Working directory: ${ctx.options.cwd}\n`);
  await prompt(ctx, "Press Enter to begin...");
}

async function analyzeStep(ctx: InteractiveContext): Promise<void> {
  console.log("\n─── Step 1: Analyzing Project ───────────────────────────────\n");

  process.stdout.write("  Scanning files...");

  ctx.analysis = await analyzeProject(ctx.options.cwd, ctx.tw, ctx.panda, {
    shorthands: ctx.options.shorthands,
    exclude: ctx.options.ignore,
    minPatternCount: 2,
  });

  const { summary } = ctx.analysis;

  console.log(" done!\n");
  console.log(`  📊 Analysis Summary:`);
  console.log(`     • ${summary.totalFiles} files found`);
  console.log(`     • ${summary.uniqueClasses} unique Tailwind classes`);
  console.log(
    `     • ${summary.convertedClasses} can be auto-converted (${Math.round(
      (summary.convertedClasses / summary.uniqueClasses) * 100,
    )}%)`,
  );
  console.log(`     • ${summary.unconvertedClasses} need manual attention`);
  console.log(`     • ${summary.detectedPatterns} patterns detected (potential recipes)`);
  console.log(`     • Estimated effort: ${summary.estimatedEffortHours} hours\n`);

  if (summary.unconvertedClasses > 0) {
    console.log(`  ⚠️  Some classes cannot be automatically converted.`);
    console.log(`     These will be preserved as custom classes.\n`);
  }

  await prompt(ctx, "Press Enter to continue...");
}

async function selectFilesStep(ctx: InteractiveContext): Promise<void> {
  console.log("\n─── Step 2: Select Files ────────────────────────────────────\n");

  if (!ctx.analysis || ctx.analysis.files.length === 0) {
    console.log("  No files found to convert.\n");
    return;
  }

  const files = ctx.analysis.files.map((f) => f.filePath);

  console.log(`  Found ${files.length} files with Tailwind classes:\n`);

  // Group by directory for cleaner display
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    const fileName = parts[parts.length - 1] ?? file;
    const existing = byDir.get(dir) || [];
    existing.push(fileName);
    byDir.set(dir, existing);
  }

  for (const [dir, dirFiles] of byDir) {
    console.log(`     ${dir}/`);
    for (const file of dirFiles.slice(0, 5)) {
      console.log(`       • ${file}`);
    }
    if (dirFiles.length > 5) {
      console.log(`       ... and ${dirFiles.length - 5} more`);
    }
  }

  console.log("");

  const answer = await prompt(ctx, "Convert all files? (Y/n/select): ");

  if (answer.toLowerCase() === "n") {
    throw new Error("USER_ABORT");
  } else if (answer.toLowerCase() === "select") {
    // Let user select individual files
    ctx.selectedFiles = await selectIndividualFiles(ctx, files);
  } else {
    ctx.selectedFiles = files;
  }

  console.log(`\n  Selected ${ctx.selectedFiles.length} file(s) for conversion.\n`);
}

async function selectIndividualFiles(ctx: InteractiveContext, files: string[]): Promise<string[]> {
  console.log("\n  Enter file numbers to select (comma-separated), or 'all':\n");

  for (let i = 0; i < Math.min(files.length, 20); i++) {
    console.log(`     [${i + 1}] ${files[i]}`);
  }

  if (files.length > 20) {
    console.log(`     ... and ${files.length - 20} more (enter 'all' to select all)`);
  }

  console.log("");

  const answer = await prompt(ctx, "Selection: ");

  if (answer.toLowerCase() === "all") {
    return files;
  }

  const indices = answer
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < files.length);

  return indices.map((i) => files[i]).filter((f): f is string => f !== undefined);
}

async function previewStep(ctx: InteractiveContext): Promise<void> {
  console.log("\n─── Step 3: Preview Changes ─────────────────────────────────\n");

  if (ctx.selectedFiles.length === 0) {
    console.log("  No files selected.\n");
    return;
  }

  // Process files in dry-run mode
  const result = await batchProcess(ctx.tw, ctx.panda, {
    patterns: ctx.selectedFiles,
    cwd: ctx.options.cwd,
    shorthands: ctx.options.shorthands,
    dryRun: true,
    ignore: ctx.options.ignore,
  });

  console.log(`  Preview summary:`);
  console.log(`     • ${result.summary.success} files will be converted`);
  console.log(`     • ${result.summary.unchanged} files unchanged`);
  console.log(`     • ${result.summary.errors} errors\n`);

  const answer = await prompt(ctx, "View diff for a file? (enter filename or 'skip'): ");

  if (answer.toLowerCase() !== "skip" && answer !== "") {
    const file = result.files.find((f) => f.inputPath.includes(answer) || f.inputPath === answer);

    if (file && file.original && file.converted) {
      console.log("\n" + "─".repeat(60));
      console.log(generateDiff(file.original, file.converted, file.inputPath));
      console.log("─".repeat(60) + "\n");
    } else {
      console.log(`  File not found or unchanged.\n`);
    }
  }

  // Store result for apply step
  (ctx as any).previewResult = result;
}

async function applyStep(ctx: InteractiveContext): Promise<void> {
  console.log("\n─── Step 4: Apply Changes ───────────────────────────────────\n");

  if (ctx.selectedFiles.length === 0) {
    console.log("  No files to convert.\n");
    return;
  }

  const previewResult = (ctx as any).previewResult as BatchResult | undefined;
  if (!previewResult || previewResult.summary.success === 0) {
    console.log("  No changes to apply.\n");
    return;
  }

  console.log(`  Ready to convert ${previewResult.summary.success} file(s).\n`);
  console.log(`  ⚠️  This will modify your files. Make sure you have a backup!\n`);

  const answer = await prompt(ctx, "Apply changes? (yes/no): ");

  if (answer.toLowerCase() !== "yes") {
    console.log("\n  Changes not applied.\n");
    return;
  }

  // Apply changes
  console.log("\n  Applying changes...\n");

  const result = await batchProcess(ctx.tw, ctx.panda, {
    patterns: ctx.selectedFiles,
    cwd: ctx.options.cwd,
    shorthands: ctx.options.shorthands,
    dryRun: false,
    ignore: ctx.options.ignore,
    onProgress: (progress) => {
      process.stdout.write(`\r  Converting: ${progress.index}/${progress.total}`);
    },
  });

  console.log("\n");
  console.log(`  ✓ Converted ${result.summary.success} file(s)`);

  if (result.summary.errors > 0) {
    console.log(`  ✗ ${result.summary.errors} error(s):\n`);
    for (const file of result.files.filter((f) => f.status === "error")) {
      console.log(`     • ${file.inputPath}: ${file.error}`);
    }
  }

  console.log("");
}

async function finishStep(ctx: InteractiveContext): Promise<void> {
  console.log("\n─── Migration Complete ──────────────────────────────────────\n");

  console.log(`  🎉 Your Tailwind classes have been converted to Panda CSS!\n`);

  console.log(`  Next steps:`);
  console.log(`     1. Review the converted files`);
  console.log(`     2. Run your build to check for errors`);
  console.log(`     3. Test your application thoroughly`);
  console.log(`     4. Remove Tailwind dependencies when ready\n`);

  if (ctx.analysis && ctx.analysis.summary.detectedPatterns > 0) {
    console.log(`  💡 Tip: Run 'tw2panda infer' to generate recipe suggestions`);
    console.log(`     based on the ${ctx.analysis.summary.detectedPatterns} patterns detected.\n`);
  }

  console.log(`  Thank you for using tw2panda! 🐼\n`);
}

// ============================================================================
// Utilities
// ============================================================================

function prompt(ctx: InteractiveContext, question: string): Promise<string> {
  return new Promise((resolve) => {
    ctx.rl.question(`  ${question}`, (answer) => {
      resolve(answer.trim());
    });
  });
}
