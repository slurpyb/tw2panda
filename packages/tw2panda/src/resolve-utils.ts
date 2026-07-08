/**
 * Utilities for resolving module paths in both ESM and CJS contexts.
 *
 * The published CLI runs as ESM (`bin.js` imports `dist/cli.js`), while the
 * library is also consumed from CJS (`dist/index.cjs`). A bare `require.resolve`
 * only works in CJS — in the ESM bundle esbuild replaces `require` with a shim
 * that throws on `.resolve`. Using `createRequire(import.meta.url)` works in the
 * ESM output natively, and in the CJS output `import.meta.url` is shimmed by tsup
 * (`shims: true`), so a single implementation covers both.
 */

import { dirname } from "pathe";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Resolve a module path - works in both ESM and CJS
 */
export function resolveModule(specifier: string): string {
  return require.resolve(specifier);
}

/**
 * Get the directory of a resolved module
 */
export function getModuleDir(specifier: string): string {
  return dirname(resolveModule(specifier));
}

/**
 * Get the tailwindcss package directory
 */
export function getTailwindDir(): string {
  return dirname(resolveModule("tailwindcss/package.json"));
}
