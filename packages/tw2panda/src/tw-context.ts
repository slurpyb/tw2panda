import { __unstable__loadDesignSystem, compile } from "tailwindcss";
import { readFileSync } from "fs";
import { dirname, join } from "pathe";
import { createRequire } from "module";
import type { TailwindContext } from "./tw-types";

// Create require for resolving tailwindcss path
const require = createRequire(import.meta.url);

// Cache for the design system
let cachedDesignSystem: TailwindContext | null = null;
let cachedCss: string | null = null;

// Get the tailwindcss package directory (root, not dist)
function getTailwindDir(): string {
  const twPath = require.resolve("tailwindcss/package.json");
  return dirname(twPath);
}

// Load a stylesheet from the tailwindcss package or filesystem
async function loadStylesheet(id: string, base: string): Promise<{ path: string; content: string; base: string }> {
  const twDir = getTailwindDir();

  // Handle tailwindcss imports
  if (id === "tailwindcss" || id === "tailwindcss/index.css") {
    const path = join(twDir, "index.css");
    const content = readFileSync(path, "utf-8");
    return { path, content, base: twDir };
  }

  if (id === "tailwindcss/preflight" || id === "tailwindcss/preflight.css") {
    const path = join(twDir, "preflight.css");
    const content = readFileSync(path, "utf-8");
    return { path, content, base: twDir };
  }

  if (id === "tailwindcss/theme" || id === "tailwindcss/theme.css") {
    const path = join(twDir, "theme.css");
    const content = readFileSync(path, "utf-8");
    return { path, content, base: twDir };
  }

  if (id === "tailwindcss/utilities" || id === "tailwindcss/utilities.css") {
    const path = join(twDir, "utilities.css");
    const content = readFileSync(path, "utf-8");
    return { path, content, base: twDir };
  }

  // For other imports, try to resolve relative to base
  try {
    const fullPath = join(base, id);
    const content = readFileSync(fullPath, "utf-8");
    return { path: fullPath, content, base: dirname(fullPath) };
  } catch {
    throw new Error(`Cannot load stylesheet: ${id} from ${base}`);
  }
}

/**
 * Creates a Tailwind context from CSS content.
 * In v4, Tailwind is CSS-first. Pass CSS with @import "tailwindcss" to load the framework.
 * For JS configs, use @config directive: @config "./tailwind.config.js";
 */
export const createTailwindContext = async (
  cssOrConfig?: string | Record<string, unknown>,
): Promise<{ context: TailwindContext }> => {
  // Default CSS that loads the full framework
  const DEFAULT_TAILWIND_CSS = `@import "tailwindcss";`;

  let css: string;

  if (typeof cssOrConfig === "string") {
    // If it looks like CSS (contains @import or @tailwind or @theme), use it directly
    if (cssOrConfig.includes("@import") || cssOrConfig.includes("@tailwind") || cssOrConfig.includes("@theme")) {
      css = cssOrConfig;
    } else {
      // Assume it's old v3 config content - use default CSS
      css = DEFAULT_TAILWIND_CSS;
    }
  } else if (cssOrConfig && typeof cssOrConfig === "object") {
    // JS config object - use default CSS (v4 doesn't support inline JS config)
    css = DEFAULT_TAILWIND_CSS;
  } else {
    css = DEFAULT_TAILWIND_CSS;
  }

  // Return cached result if CSS hasn't changed
  if (cachedDesignSystem && cachedCss === css) {
    return { context: cachedDesignSystem };
  }

  const designSystem = await __unstable__loadDesignSystem(css, {
    loadStylesheet,
  });

  // Cast to our TailwindContext type - the core interface is compatible
  cachedDesignSystem = designSystem as unknown as TailwindContext;
  cachedCss = css;

  return { context: cachedDesignSystem };
};

/**
 * Synchronous version that returns a cached design system or throws if not initialized.
 * Call createTailwindContext first to initialize.
 */
export const createTailwindContextSync = (): { context: TailwindContext } => {
  if (!cachedDesignSystem) {
    throw new Error("Tailwind context not initialized. Call createTailwindContext() first.");
  }
  return { context: cachedDesignSystem };
};

/**
 * Initialize the default Tailwind context. Call this at app startup.
 */
export const initTailwindContext = async (): Promise<TailwindContext> => {
  const { context } = await createTailwindContext();
  return context;
};

/**
 * Get CSS for a list of class names.
 * Returns an array of CSS strings (or null for invalid classes).
 */
export const getCssForClasses = (classes: string[], context: TailwindContext): (string | null)[] => {
  return context.candidatesToCss(classes);
};

/**
 * Parse a candidate class name into its components.
 */
export const parseCandidate = (candidate: string, context: TailwindContext) => {
  return context.parseCandidate(candidate);
};

/**
 * Get all available utility classes.
 */
export const getClassList = (context: TailwindContext) => {
  return context.getClassList();
};

/**
 * Get all available variants.
 */
export const getVariants = (context: TailwindContext) => {
  return context.getVariants();
};

/**
 * Clear the cached design system. Useful for testing.
 */
export const clearTailwindContextCache = () => {
  cachedDesignSystem = null;
  cachedCss = null;
};

// Re-export the compile function for advanced usage
export { compile, __unstable__loadDesignSystem };
