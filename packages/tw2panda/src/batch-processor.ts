/**
 * Batch processing for tw2panda
 *
 * Process multiple files at once using glob patterns with:
 * - Parallel file processing
 * - Progress reporting
 * - Dry-run/preview mode
 * - Detailed summary
 */

import fg from "fast-glob";
import { readFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname, extname, basename } from "pathe";
import { createMergeCss } from "@pandacss/shared";
import type { PandaContext } from "./panda-context";
import type { TailwindContext } from "./tw-types";
import { rewriteTwFileContentToPanda } from "./rewrite-tw-file-content-to-panda";
import { rewriteHtmlToPanda } from "./rewrite-html-to-panda";
import { maybePretty } from "./maybe-pretty";
import type { RewriteOptions } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface BatchOptions {
  /** Glob patterns to match files */
  patterns: string[];
  /** Base directory for glob matching */
  cwd: string;
  /** Output directory (if different from source) */
  outDir?: string | undefined;
  /** Use shorthand properties */
  shorthands?: boolean | undefined;
  /** Dry run - don't write files */
  dryRun?: boolean | undefined;
  /** Show diff instead of full output */
  showDiff?: boolean | undefined;
  /** File extensions to process as HTML */
  htmlExtensions?: string[] | undefined;
  /** File extensions to process as TypeScript/JavaScript */
  tsExtensions?: string[] | undefined;
  /** Patterns to ignore */
  ignore?: string[] | undefined;
  /** Callback for progress updates */
  onProgress?: ((progress: BatchProgress) => void) | undefined;
  /** Concurrency limit for parallel processing */
  concurrency?: number | undefined;
}

export interface BatchProgress {
  /** Current file being processed */
  current: string;
  /** Index of current file (1-based) */
  index: number;
  /** Total files to process */
  total: number;
  /** Status of current file */
  status: "processing" | "success" | "error" | "skipped";
  /** Error message if status is error */
  error?: string | undefined;
}

export interface BatchFileResult {
  /** Input file path (relative to cwd) */
  inputPath: string;
  /** Output file path (relative to cwd) */
  outputPath: string;
  /** Status of conversion */
  status: "success" | "error" | "skipped" | "unchanged";
  /** Original content */
  original?: string;
  /** Converted content */
  converted?: string;
  /** Error message if failed */
  error?: string;
  /** Classes that couldn't be converted */
  unconvertedClasses?: string[];
  /** Time taken in ms */
  duration: number;
}

export interface BatchResult {
  /** Individual file results */
  files: BatchFileResult[];
  /** Summary statistics */
  summary: {
    total: number;
    success: number;
    errors: number;
    skipped: number;
    unchanged: number;
    totalDuration: number;
  };
}

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_HTML_EXTENSIONS = [".html", ".htm"];
const DEFAULT_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

/**
 * Process multiple files matching glob patterns
 */
export async function batchProcess(
  tw: TailwindContext,
  panda: PandaContext,
  options: BatchOptions,
): Promise<BatchResult> {
  const {
    patterns,
    cwd,
    outDir,
    shorthands = false,
    dryRun = false,
    htmlExtensions = DEFAULT_HTML_EXTENSIONS,
    tsExtensions = DEFAULT_TS_EXTENSIONS,
    ignore = [],
    onProgress,
    concurrency = 4,
  } = options;

  const startTime = Date.now();

  // Find all matching files
  const files = await fg(patterns, {
    cwd,
    ignore: [...DEFAULT_IGNORE, ...ignore],
    absolute: false,
    onlyFiles: true,
  });

  if (files.length === 0) {
    return {
      files: [],
      summary: {
        total: 0,
        success: 0,
        errors: 0,
        skipped: 0,
        unchanged: 0,
        totalDuration: 0,
      },
    };
  }

  // Create merge function
  const { mergeCss } = createMergeCss({
    utility: panda.utility,
    conditions: panda.conditions,
    hash: false,
  });

  // Process files with controlled concurrency
  const results: BatchFileResult[] = [];
  const chunks = chunkArray(files, concurrency);

  let processedCount = 0;

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(async (file) => {
        processedCount++;
        onProgress?.({
          current: file,
          index: processedCount,
          total: files.length,
          status: "processing",
        });

        const result = await processFile(file, {
          cwd,
          outDir,
          shorthands,
          dryRun,
          htmlExtensions,
          tsExtensions,
          tw,
          panda,
          mergeCss,
        });

        onProgress?.({
          current: file,
          index: processedCount,
          total: files.length,
          status: result.status === "error" ? "error" : "success",
          error: result.error,
        });

        return result;
      }),
    );

    results.push(...chunkResults);
  }

  // Calculate summary
  const summary = {
    total: results.length,
    success: results.filter((r) => r.status === "success").length,
    errors: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    totalDuration: Date.now() - startTime,
  };

  return { files: results, summary };
}

interface ProcessFileOptions {
  cwd: string;
  outDir: string | undefined;
  shorthands: boolean;
  dryRun: boolean;
  htmlExtensions: string[];
  tsExtensions: string[];
  tw: TailwindContext;
  panda: PandaContext;
  mergeCss: ReturnType<typeof createMergeCss>["mergeCss"];
}

async function processFile(filePath: string, options: ProcessFileOptions): Promise<BatchFileResult> {
  const startTime = Date.now();
  const { cwd, outDir, shorthands, dryRun, htmlExtensions, tsExtensions, tw, panda, mergeCss } = options;

  const absolutePath = join(cwd, filePath);
  const ext = extname(filePath).toLowerCase();

  // Determine output path
  let outputPath = filePath;
  if (outDir) {
    outputPath = join(outDir, filePath);
  }

  // Convert HTML to TSX
  if (htmlExtensions.includes(ext)) {
    outputPath = outputPath.replace(/\.(html?|htm)$/i, ".tsx");
  }

  try {
    const content = readFileSync(absolutePath, "utf-8");

    let converted: string;
    let unconvertedClasses: string[] = [];

    if (htmlExtensions.includes(ext)) {
      // HTML -> TSX conversion
      const result = rewriteHtmlToPanda(content, tw, panda, mergeCss, {
        shorthands,
        fileName: basename(filePath, ext),
      });
      converted = maybePretty(result.output);
      unconvertedClasses = result.unconvertedClasses;
    } else if (tsExtensions.includes(ext)) {
      // TS/JS conversion
      const result = rewriteTwFileContentToPanda(content, filePath, tw, panda, mergeCss, {
        shorthands,
      } as RewriteOptions);
      converted = result.output;
      // TS converter doesn't track unconverted classes yet
      unconvertedClasses = [];
    } else {
      // Skip unsupported file types
      return {
        inputPath: filePath,
        outputPath,
        status: "skipped",
        duration: Date.now() - startTime,
      };
    }

    // Check if content changed
    if (converted === content) {
      return {
        inputPath: filePath,
        outputPath,
        status: "unchanged",
        original: content,
        converted,
        duration: Date.now() - startTime,
      };
    }

    // Write file if not dry run
    if (!dryRun) {
      const absoluteOutputPath = join(cwd, outputPath);
      await mkdir(dirname(absoluteOutputPath), { recursive: true });
      await writeFile(absoluteOutputPath, converted);
    }

    return {
      inputPath: filePath,
      outputPath,
      status: "success",
      original: content,
      converted,
      unconvertedClasses,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      inputPath: filePath,
      outputPath,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Generate a simple diff between original and converted content
 */
export function generateDiff(original: string, converted: string, filePath: string): string {
  const originalLines = original.split("\n");
  const convertedLines = converted.split("\n");

  const lines: string[] = [`--- ${filePath}`, `+++ ${filePath}`];

  // Simple line-by-line diff (not a full diff algorithm)
  const maxLines = Math.max(originalLines.length, convertedLines.length);
  let inHunk = false;
  let hunkStart = 0;
  let hunkLines: string[] = [];

  for (let i = 0; i < maxLines; i++) {
    const orig = originalLines[i];
    const conv = convertedLines[i];

    if (orig !== conv) {
      if (!inHunk) {
        inHunk = true;
        hunkStart = i + 1;
        // Add context before
        if (i > 0) hunkLines.push(` ${originalLines[i - 1] ?? ""}`);
      }
      if (orig !== undefined) hunkLines.push(`-${orig}`);
      if (conv !== undefined) hunkLines.push(`+${conv}`);
    } else if (inHunk) {
      // Add context after
      hunkLines.push(` ${orig ?? ""}`);
      // Flush hunk
      lines.push(`@@ -${hunkStart} +${hunkStart} @@`);
      lines.push(...hunkLines);
      hunkLines = [];
      inHunk = false;
    }
  }

  // Flush remaining hunk
  if (hunkLines.length > 0) {
    lines.push(`@@ -${hunkStart} +${hunkStart} @@`);
    lines.push(...hunkLines);
  }

  return lines.join("\n");
}

/**
 * Format batch results for display
 */
export function formatBatchResults(result: BatchResult, options: { verbose?: boolean } = {}): string {
  const { files, summary } = result;
  const { verbose = false } = options;

  const lines: string[] = [];

  // Header
  lines.push("═".repeat(60));
  lines.push("  tw2panda Batch Processing Results");
  lines.push("═".repeat(60));
  lines.push("");

  // Summary
  lines.push(`  Total files:   ${summary.total}`);
  lines.push(`  ✓ Converted:   ${summary.success}`);
  lines.push(`  ✗ Errors:      ${summary.errors}`);
  lines.push(`  ○ Unchanged:   ${summary.unchanged}`);
  lines.push(`  - Skipped:     ${summary.skipped}`);
  lines.push(`  ⏱ Duration:    ${(summary.totalDuration / 1000).toFixed(2)}s`);
  lines.push("");

  // File details
  if (verbose || summary.errors > 0) {
    if (summary.errors > 0) {
      lines.push("─".repeat(60));
      lines.push("  Errors:");
      lines.push("");
      for (const file of files.filter((f) => f.status === "error")) {
        lines.push(`  ✗ ${file.inputPath}`);
        lines.push(`    ${file.error}`);
      }
      lines.push("");
    }

    if (verbose) {
      const converted = files.filter((f) => f.status === "success");
      if (converted.length > 0) {
        lines.push("─".repeat(60));
        lines.push("  Converted files:");
        lines.push("");
        for (const file of converted) {
          const suffix = file.inputPath !== file.outputPath ? ` → ${file.outputPath}` : "";
          lines.push(`  ✓ ${file.inputPath}${suffix} (${file.duration}ms)`);
          if (file.unconvertedClasses && file.unconvertedClasses.length > 0) {
            lines.push(
              `    Custom classes: ${file.unconvertedClasses.slice(0, 5).join(", ")}${
                file.unconvertedClasses.length > 5 ? "..." : ""
              }`,
            );
          }
        }
        lines.push("");
      }
    }
  }

  lines.push("═".repeat(60));

  return lines.join("\n");
}

// ============================================================================
// Utilities
// ============================================================================

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
