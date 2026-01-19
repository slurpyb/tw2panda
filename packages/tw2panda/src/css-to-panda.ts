/**
 * CSS string to Panda CSS-in-JS converter
 *
 * Converts raw CSS strings to Panda-compatible style objects.
 * Handles nested selectors, pseudo-classes, and media queries.
 */

import postcss from "postcss";
import postcssJs from "postcss-js";
import type { PandaContext } from "./panda-context";
import { mapToShorthands } from "./panda-map-to-shorthands";

export interface CssToPandaOptions {
  /** Use Panda shorthand properties (bg, p, m, etc.) */
  shorthands?: boolean | undefined;
  /** Panda context for token resolution (optional) */
  panda?: PandaContext | undefined;
}

export interface CssToPandaResult {
  /** The converted Panda style object */
  styles: Record<string, unknown>;
  /** Any warnings or notes about the conversion */
  warnings: string[];
}

/**
 * Panda condition mappings for CSS selectors/pseudo-classes
 * @see https://panda-css.com/docs/concepts/conditional-styles
 */
const SELECTOR_TO_CONDITION: Record<string, string> = {
  // Pseudo-classes
  "&:hover": "_hover",
  "&:focus": "_focus",
  "&:focus-visible": "_focusVisible",
  "&:focus-within": "_focusWithin",
  "&:active": "_active",
  "&:visited": "_visited",
  "&:target": "_target",
  "&:first-child": "_first",
  "&:last-child": "_last",
  "&:only-child": "_only",
  "&:odd": "_odd",
  "&:even": "_even",
  "&:first-of-type": "_firstOfType",
  "&:last-of-type": "_lastOfType",
  "&:only-of-type": "_onlyOfType",
  "&:empty": "_empty",
  "&:enabled": "_enabled",
  "&:disabled": "_disabled",
  "&:checked": "_checked",
  "&:indeterminate": "_indeterminate",
  "&:default": "_default",
  "&:required": "_required",
  "&:valid": "_valid",
  "&:invalid": "_invalid",
  "&:in-range": "_inRange",
  "&:out-of-range": "_outOfRange",
  "&:placeholder-shown": "_placeholderShown",
  "&:autofill": "_autofill",
  "&:read-only": "_readOnly",
  "&:read-write": "_readWrite",

  // Pseudo-elements (keep as-is, Panda supports them)
  "&::before": "_before",
  "&::after": "_after",
  "&::placeholder": "_placeholder",
  "&::selection": "_selection",
  "&::first-letter": "_firstLetter",
  "&::first-line": "_firstLine",
  "&::marker": "_marker",
  "&::backdrop": "_backdrop",

  // State selectors
  "&[data-hover]": "_hover",
  "&[data-focus]": "_focus",
  "&[data-active]": "_active",
  "&[data-disabled]": "_disabled",
  "&[data-checked]": "_checked",
  "&[data-selected]": "_selected",
  "&[data-expanded]": "_expanded",
  "&[data-open]": "_open",
  "&[data-closed]": "_closed",
  "&[data-loading]": "_loading",
  "&[data-highlighted]": "_highlighted",
  "&[data-current]": "_current",
  "&[data-pressed]": "_pressed",
  "&[data-invalid]": "_invalid",
  "&[data-readonly]": "_readOnly",

  // ARIA states
  '&[aria-disabled="true"]': "_disabled",
  '&[aria-checked="true"]': "_checked",
  '&[aria-selected="true"]': "_selected",
  '&[aria-expanded="true"]': "_expanded",
  '&[aria-pressed="true"]': "_pressed",
  '&[aria-invalid="true"]': "_invalid",
  '&[aria-readonly="true"]': "_readOnly",
  '&[aria-current="page"]': "_currentPage",
  '&[aria-current="step"]': "_currentStep",
  '&[aria-current="date"]': "_currentDate",

  // Group/peer variants
  "[role=group]:hover &": "_groupHover",
  "[role=group]:focus &": "_groupFocus",
  "[role=group]:active &": "_groupActive",
  "[role=group]:disabled &": "_groupDisabled",
  "[data-group]:hover &": "_groupHover",
  "[data-group]:focus &": "_groupFocus",
  ".group:hover &": "_groupHover",
  ".group:focus &": "_groupFocus",
  ".peer:hover ~ &": "_peerHover",
  ".peer:focus ~ &": "_peerFocus",
  ".peer:checked ~ &": "_peerChecked",
  ".peer:disabled ~ &": "_peerDisabled",

  // Color scheme
  "@media (prefers-color-scheme: dark)": "_osDark",
  "@media (prefers-color-scheme: light)": "_osLight",
  ".dark &": "_dark",
  ".light &": "_light",
  '[data-theme="dark"] &': "_dark",
  '[data-theme="light"] &': "_light",
  '[data-color-mode="dark"] &': "_dark",
  '[data-color-mode="light"] &': "_light",

  // Motion preference
  "@media (prefers-reduced-motion: reduce)": "_motionReduce",
  "@media (prefers-reduced-motion: no-preference)": "_motionSafe",

  // Contrast preference
  "@media (prefers-contrast: more)": "_highContrast",
  "@media (prefers-contrast: less)": "_lessContrast",

  // Orientation
  "@media (orientation: portrait)": "_portrait",
  "@media (orientation: landscape)": "_landscape",

  // Print
  "@media print": "_print",
};

/**
 * Breakpoint mappings for responsive styles
 * Maps common media query patterns to Panda breakpoint keys
 */
const BREAKPOINT_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /min-width:\s*640px/, key: "sm" },
  { pattern: /min-width:\s*768px/, key: "md" },
  { pattern: /min-width:\s*1024px/, key: "lg" },
  { pattern: /min-width:\s*1280px/, key: "xl" },
  { pattern: /min-width:\s*1536px/, key: "2xl" },
];

/**
 * Convert a CSS selector to a Panda condition key
 */
function selectorToCondition(selector: string): string | null {
  // Direct mapping
  const directMapping = SELECTOR_TO_CONDITION[selector];
  if (directMapping) {
    return directMapping;
  }

  // Check breakpoint patterns
  for (const { pattern, key } of BREAKPOINT_PATTERNS) {
    if (pattern.test(selector)) {
      return key;
    }
  }

  // Handle combined selectors like "&:hover:focus"
  if (selector.startsWith("&:") && selector.includes(":")) {
    const parts = selector.slice(1).split(":");
    const conditions = parts
      .filter(Boolean)
      .map((p) => SELECTOR_TO_CONDITION[`&:${p}`])
      .filter((c): c is string => c !== undefined);
    if (conditions.length > 0) {
      // Return the first condition (Panda doesn't support combined pseudo-classes directly)
      return conditions[0] ?? null;
    }
  }

  return null;
}

/**
 * Recursively transform a postcss-js object to Panda format
 */
function transformToPanda(obj: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip null/undefined
    if (value === null || value === undefined) continue;

    // Handle nested objects (selectors, media queries)
    if (typeof value === "object" && !Array.isArray(value)) {
      const condition = selectorToCondition(key);

      if (condition) {
        // Known condition - transform to Panda format
        result[condition] = transformToPanda(value as Record<string, unknown>, warnings);
      } else if (key.startsWith("@media")) {
        // Unknown media query - keep as-is with warning
        warnings.push(`Unknown media query kept as-is: ${key}`);
        result[key] = transformToPanda(value as Record<string, unknown>, warnings);
      } else if (key.startsWith("&")) {
        // Arbitrary selector - keep with & prefix
        result[key] = transformToPanda(value as Record<string, unknown>, warnings);
      } else {
        // Other nested selector (e.g., "& .child")
        result[key] = transformToPanda(value as Record<string, unknown>, warnings);
      }
    } else {
      // Regular property-value pair
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert a CSS string to a Panda-compatible style object
 *
 * @example
 * ```ts
 * const css = `
 *   background: #3b82f6;
 *   padding: 1rem;
 *   &:hover {
 *     background: #2563eb;
 *   }
 * `;
 *
 * const { styles } = cssToPanda(css);
 * // Result:
 * // {
 * //   background: "#3b82f6",
 * //   padding: "1rem",
 * //   _hover: { background: "#2563eb" }
 * // }
 * ```
 */
export function cssToPanda(cssString: string, options: CssToPandaOptions = {}): CssToPandaResult {
  const { shorthands = false, panda } = options;
  const warnings: string[] = [];

  // Wrap CSS in a placeholder selector for postcss to parse
  const wrappedCss = `.__panda_temp__ { ${cssString} }`;

  // Parse CSS to AST
  const root = postcss.parse(wrappedCss);

  // Convert to JS object using postcss-js
  const jsObject = postcssJs.objectify(root);

  // Extract the inner styles (unwrap the temp selector)
  const innerStyles = (jsObject[".__panda_temp__"] as Record<string, unknown>) || jsObject;

  // Transform to Panda format
  let styles = transformToPanda(innerStyles, warnings);

  // Apply shorthands if requested
  if (shorthands && panda) {
    styles = mapToShorthands(styles, panda);
  }

  return { styles, warnings };
}

/**
 * Convert a CSS string to a Panda recipe-compatible object
 * Useful for converting component CSS to Panda recipes
 *
 * @example
 * ```ts
 * const css = `
 *   .btn {
 *     padding: 0.5rem 1rem;
 *     border-radius: 0.25rem;
 *   }
 *   .btn-primary {
 *     background: blue;
 *     color: white;
 *   }
 * `;
 *
 * const recipe = cssToRecipe(css);
 * // Result suitable for defineRecipe()
 * ```
 */
export function cssToRecipe(
  cssString: string,
  options: CssToPandaOptions = {},
): {
  base: Record<string, unknown>;
  variants: Record<string, Record<string, Record<string, unknown>>>;
  warnings: string[];
} {
  const { shorthands = false, panda } = options;
  const warnings: string[] = [];

  // Parse CSS to AST
  const root = postcss.parse(cssString);

  // Convert to JS object using postcss-js
  const jsObject = postcssJs.objectify(root);

  const base: Record<string, unknown> = {};
  const variants: Record<string, Record<string, Record<string, unknown>>> = {};

  for (const [selector, value] of Object.entries(jsObject)) {
    if (typeof value !== "object" || value === null) continue;

    // Transform the styles
    let styles = transformToPanda(value as Record<string, unknown>, warnings);

    if (shorthands && panda) {
      styles = mapToShorthands(styles, panda);
    }

    // Parse selector to determine if it's base or variant
    // e.g., ".btn" → base, ".btn-primary" or ".btn--primary" → variant
    const cleanSelector = selector.replace(/^\./, "");

    if (cleanSelector.includes("-") || cleanSelector.includes("--")) {
      // Looks like a variant (e.g., btn-primary, btn--large)
      const parts = cleanSelector.split(/--|(?<!^)-/);
      const baseName = parts[0];
      const variantValue = parts.slice(1).join("-");

      if (baseName && variantValue) {
        // Try to infer variant name from common patterns
        const variantName = inferVariantName(variantValue);

        if (!variants[variantName]) {
          variants[variantName] = {};
        }
        const variantGroup = variants[variantName];
        if (variantGroup) {
          variantGroup[variantValue] = styles;
        }
      } else {
        // Can't parse, add to base with warning
        Object.assign(base, styles);
        warnings.push(`Couldn't parse variant from selector: ${selector}`);
      }
    } else {
      // Base styles
      Object.assign(base, styles);
    }
  }

  return { base, variants, warnings };
}

/**
 * Infer variant name from variant value
 */
function inferVariantName(value: string): string {
  const sizePatterns = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
  const colorPatterns = ["primary", "secondary", "danger", "warning", "success", "info", "error"];

  if (sizePatterns.includes(value)) return "size";
  if (colorPatterns.includes(value)) return "variant";

  // Default to "variant"
  return "variant";
}

/**
 * Convert CSS for globalCss usage
 * Preserves top-level selectors for global styles
 */
export function cssToGlobalCss(cssString: string, options: CssToPandaOptions = {}): CssToPandaResult {
  const { shorthands = false, panda } = options;
  const warnings: string[] = [];

  // Parse CSS to AST
  const root = postcss.parse(cssString);

  // Convert to JS object using postcss-js
  const jsObject = postcssJs.objectify(root);

  // Transform each selector's styles
  const styles: Record<string, unknown> = {};

  for (const [selector, value] of Object.entries(jsObject)) {
    if (typeof value !== "object" || value === null) {
      styles[selector] = value;
      continue;
    }

    let transformed = transformToPanda(value as Record<string, unknown>, warnings);

    if (shorthands && panda) {
      transformed = mapToShorthands(transformed, panda);
    }

    styles[selector] = transformed;
  }

  return { styles, warnings };
}
