/**
 * Utilities for resolving module paths in both ESM and CJS contexts
 */

import { dirname } from "pathe";

/**
 * Resolve a module path - works in both ESM and CJS
 */
export function resolveModule(specifier: string): string {
  // In CJS, require is globally available
  // In ESM bundled to CJS, this will still work because the bundler handles it
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
