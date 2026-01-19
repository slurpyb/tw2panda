/**
 * Watch mode for tw2panda
 *
 * Continuously watches for file changes and converts Tailwind to Panda CSS
 */

import { watch } from "chokidar";
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

export interface WatchOptions {
  /** Glob patterns to watch */
  patterns: string[];
  /** Base directory */
  cwd: string;
  /** Output directory (if different from source) */
  outDir?: string | undefined;
  /** Use shorthand properties */
  shorthands?: boolean | undefined;
  /** File extensions to process as HTML */
  htmlExtensions?: string[] | undefined;
  /** File extensions to process as TypeScript/JavaScript */
  tsExtensions?: string[] | undefined;
  /** Patterns to ignore */
  ignore?: string[] | undefined;
  /** Callback for events */
  onEvent?: ((event: WatchEvent) => void) | undefined;
}

export interface WatchEvent {
  type: "ready" | "change" | "add" | "unlink" | "error";
  file?: string | undefined;
  outputFile?: string | undefined;
  duration?: number | undefined;
  error?: string | undefined;
}

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_HTML_EXTENSIONS = [".html", ".htm"];
const DEFAULT_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/styled-system/**"];

/**
 * Start watching files for changes
 * Returns a stop function to terminate the watcher
 */
export function watchFiles(
  tw: TailwindContext,
  panda: PandaContext,
  options: WatchOptions,
): { stop: () => Promise<void> } {
  const {
    patterns,
    cwd,
    outDir,
    shorthands = false,
    htmlExtensions = DEFAULT_HTML_EXTENSIONS,
    tsExtensions = DEFAULT_TS_EXTENSIONS,
    ignore = [],
    onEvent,
  } = options;

  // Create merge function
  const { mergeCss } = createMergeCss({
    utility: panda.utility,
    conditions: panda.conditions,
    hash: false,
  });

  // Initialize watcher
  const watcher = watch(patterns, {
    cwd,
    ignored: [...DEFAULT_IGNORE, ...ignore],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  // Process a file change
  const processFile = async (filePath: string) => {
    const startTime = Date.now();
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

      if (htmlExtensions.includes(ext)) {
        // HTML -> TSX conversion
        const result = rewriteHtmlToPanda(content, tw, panda, mergeCss, {
          shorthands,
          fileName: basename(filePath, ext),
        });
        converted = maybePretty(result.output);
      } else if (tsExtensions.includes(ext)) {
        // TS/JS conversion
        const result = rewriteTwFileContentToPanda(content, filePath, tw, panda, mergeCss, {
          shorthands,
        } as RewriteOptions);
        converted = result.output;
      } else {
        return; // Skip unsupported file types
      }

      // Skip if content unchanged
      if (converted === content) {
        return;
      }

      // Write file
      const absoluteOutputPath = join(cwd, outputPath);
      await mkdir(dirname(absoluteOutputPath), { recursive: true });
      await writeFile(absoluteOutputPath, converted);

      const duration = Date.now() - startTime;
      onEvent?.({
        type: "change",
        file: filePath,
        outputFile: filePath !== outputPath ? outputPath : undefined,
        duration,
      });
    } catch (error) {
      onEvent?.({
        type: "error",
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Set up event handlers
  watcher.on("ready", () => {
    onEvent?.({ type: "ready" });
  });

  watcher.on("change", (filePath) => {
    processFile(filePath);
  });

  watcher.on("add", (filePath) => {
    processFile(filePath);
  });

  watcher.on("unlink", (filePath) => {
    onEvent?.({ type: "unlink", file: filePath });
  });

  watcher.on("error", (error) => {
    onEvent?.({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Return stop function
  return {
    stop: async () => {
      await watcher.close();
    },
  };
}

/**
 * Format a watch event for display
 */
export function formatWatchEvent(event: WatchEvent): string {
  const timestamp = new Date().toLocaleTimeString();

  switch (event.type) {
    case "ready":
      return `[${timestamp}] 👀 Watching for changes...`;

    case "change":
      const suffix = event.outputFile ? ` → ${event.outputFile}` : "";
      const duration = event.duration ? ` (${event.duration}ms)` : "";
      return `[${timestamp}] ✓ ${event.file}${suffix}${duration}`;

    case "add":
      return `[${timestamp}] + ${event.file}`;

    case "unlink":
      return `[${timestamp}] - ${event.file}`;

    case "error":
      return `[${timestamp}] ✗ Error: ${event.error}`;

    default:
      return `[${timestamp}] Unknown event`;
  }
}
