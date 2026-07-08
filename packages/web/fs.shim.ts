// Browser shim for Node's `fs` and `fs/promises` builtins (aliased in
// vite.config.ts). The only real filesystem reads tw2panda performs in the
// browser are Tailwind v4's CSS entrypoints, which we inline at build time via
// Vite `?raw` imports. Everything else is a no-op so the bundle can resolve the
// named imports pulled in by unused (tree-shaken) Node-only code paths.
import twIndexCss from "tailwindcss/index.css?raw";
import twPreflightCss from "tailwindcss/preflight.css?raw";
import twThemeCss from "tailwindcss/theme.css?raw";
import twUtilitiesCss from "tailwindcss/utilities.css?raw";

const tailwindCssByFile: Record<string, string> = {
  "index.css": twIndexCss,
  "preflight.css": twPreflightCss,
  "theme.css": twThemeCss,
  "utilities.css": twUtilitiesCss,
};

const basename = (path: unknown) => String(path).split("/").pop() ?? "";

export const readFileSync = (path: string, _encoding?: unknown): string => {
  return tailwindCssByFile[basename(path)] ?? "";
};

export const existsSync = (path: string): boolean => {
  return basename(path) in tailwindCssByFile;
};

export const readdirSync = (_path: string): string[] => [];
export const readdir = (_path: string): string[] => [];

const fakeStat = { isFile: () => true, isDirectory: () => false };
export const statSync = (_path: string) => fakeStat;
export const stat = (_path: string) => fakeStat;

// `fs/promises` entrypoints — no-ops in the browser (nothing is written to disk).
export const writeFile = async (_path: string, _data: unknown): Promise<void> => {};
export const mkdir = async (_path: string, _opts?: unknown): Promise<void> => {};

export const fs = { readFileSync, existsSync, readdirSync, readdir, statSync, stat, writeFile, mkdir };

export default fs;
