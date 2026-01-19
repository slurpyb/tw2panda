/**
 * HTML to Panda CSS TSX converter
 *
 * Converts HTML files with Tailwind classes to TSX components with Panda CSS.
 */

import { createMergeCss } from "@pandacss/shared";
import type { PandaContext } from "./panda-context";
import { twClassListToPandaStyles } from "./tw-class-list-to-panda-styles";
import { mapToShorthands } from "./panda-map-to-shorthands";
import { extractBodyContent, extractClassAttributes, htmlToJsx, toPascalCase } from "./html-to-jsx";
import type { TailwindContext } from "./tw-types";
import type { RewriteOptions } from "./types";

export interface HtmlToPandaOptions extends RewriteOptions {
  /** Component name (defaults to PascalCase of filename) */
  componentName?: string | undefined;
  /** Original filename for comments */
  fileName?: string | undefined;
}

export interface HtmlToPandaResult {
  /** The generated TSX output */
  output: string;
  /** Classes that couldn't be converted (custom classes) */
  unconvertedClasses: string[];
  /** Original CSS styles extracted from <style> tags */
  extractedStyles: string;
  /** Whether the output uses IconifyIcon */
  usesIconify: boolean;
  /** Whether the output uses cx() for class combining */
  usesCx: boolean;
}

export interface ConvertedClass {
  pandaString: string;
  /** Custom classes that need manual CSS definitions */
  unconverted: string[];
  /** Classes to keep in className (marker classes like group/peer + custom classes) */
  classesToKeep: string[];
}

/**
 * Tailwind marker classes that don't generate CSS but are needed for variants
 * - `group` / `group/{name}` - for group-hover:, group-focus:, etc.
 * - `peer` / `peer/{name}` - for peer-checked:, peer-focus:, etc.
 * @see https://tailwindcss.com/docs/hover-focus-and-other-states#styling-based-on-parent-state
 */
const TAILWIND_MARKER_CLASS_PATTERN = /^(group|peer)(\/[\w-]+)?$/;

/**
 * Check if a class is a Tailwind marker class (group, peer, etc.)
 * These don't generate CSS but must be kept for variant selectors to work
 */
function isTailwindMarkerClass(cls: string): boolean {
  return TAILWIND_MARKER_CLASS_PATTERN.test(cls);
}

/**
 * Convert a Tailwind class list to Panda CSS object string
 */
export function convertClassesToPandaString(
  classString: string,
  tailwind: TailwindContext,
  panda: PandaContext,
  mergeCss: ReturnType<typeof createMergeCss>["mergeCss"],
  options: RewriteOptions = {},
): ConvertedClass {
  const classList = new Set(
    classString
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean),
  );

  // Separate into: Tailwind utilities, marker classes, and custom classes
  const customClasses: string[] = [];
  const markerClasses: string[] = [];
  const twClasses = new Set<string>();

  classList.forEach((cls) => {
    // Check for Tailwind marker classes (group, peer) - keep these but don't report as unconverted
    if (isTailwindMarkerClass(cls)) {
      markerClasses.push(cls);
      return;
    }

    // Check if it generates CSS - if not, it's a custom class
    const css = tailwind.candidatesToCss([cls])[0];
    if (!css) {
      customClasses.push(cls);
    } else {
      twClasses.add(cls);
    }
  });

  // Marker classes should be included in output but not reported as "unconverted"
  const classesToKeep = [...markerClasses, ...customClasses];

  if (twClasses.size === 0) {
    // No Tailwind utilities, but may have marker classes to keep
    return { pandaString: "", unconverted: customClasses, classesToKeep };
  }

  const styles = twClassListToPandaStyles(twClasses, tailwind, panda);
  if (!styles.length) {
    return { pandaString: "", unconverted: customClasses, classesToKeep };
  }

  const merged = mergeCss(...styles.map((s) => s.styles));
  const finalStyles = options.shorthands ? mapToShorthands(merged, panda) : merged;

  // Convert to string representation
  const styleString = JSON.stringify(finalStyles, null, 2)
    // Remove quotes from property names that don't need them
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, "$1:")
    // Keep quotes for values
    .replace(/: "([^"]+)"/g, ': "$1"');

  // Return: pandaString for css(), classesToKeep for cx(), unconverted for reporting
  return { pandaString: styleString, unconverted: customClasses, classesToKeep };
}

/**
 * Convert HTML content with Tailwind classes to TSX with Panda CSS
 */
export function rewriteHtmlToPanda(
  html: string,
  tailwind: TailwindContext,
  panda: PandaContext,
  mergeCss: ReturnType<typeof createMergeCss>["mergeCss"],
  options: HtmlToPandaOptions = {},
): HtmlToPandaResult {
  // Extract body content
  const { content, styles: cssStyles } = extractBodyContent(html);

  // Convert base HTML to JSX
  let jsx = htmlToJsx(content);

  // Extract and convert class attributes
  const classMatches = extractClassAttributes(jsx);
  const allUnconverted: string[] = [];
  const conversions: Array<{ original: string; replacement: string }> = [];
  let usesCx = false;

  for (const match of classMatches) {
    const { pandaString, unconverted, classesToKeep } = convertClassesToPandaString(
      match.classes,
      tailwind,
      panda,
      mergeCss,
      options,
    );

    // Track truly unconverted classes (not marker classes) for reporting
    allUnconverted.push(...unconverted);

    if (pandaString) {
      // Build the className attribute
      const cssCall = `css(${pandaString})`;

      let replacement: string;
      if (classesToKeep.length > 0) {
        // Use cx() to combine css() with marker classes (group/peer) and custom classes
        usesCx = true;
        const keptClassesStr = classesToKeep.map((c) => `"${c}"`).join(", ");
        replacement = `className={cx(${cssCall}, ${keptClassesStr})}`;
      } else {
        replacement = `className={${cssCall}}`;
      }

      conversions.push({ original: match.fullMatch, replacement });
    } else if (classesToKeep.length > 0) {
      // Only marker/custom classes, keep as className
      conversions.push({
        original: match.fullMatch,
        replacement: `className="${classesToKeep.join(" ")}"`,
      });
    }
  }

  // Apply conversions in reverse order to preserve indices
  conversions.reverse().forEach(({ original, replacement }) => {
    jsx = jsx.replace(original, replacement);
  });

  // Determine component name
  const componentName = options.componentName || (options.fileName ? toPascalCase(options.fileName) : "Component");

  // Collect unique custom classes for comment
  const uniqueUnconverted = [...new Set(allUnconverted)];
  const usesIconify = jsx.includes("IconifyIcon");

  // Build the styled-system import
  const cssImports = usesCx ? "{ css, cx }" : "{ css }";

  // Build the TSX output
  const output = `/**
 * Auto-generated${options.fileName ? ` from ${options.fileName}` : ""}
 * Converted Tailwind CSS classes to Panda CSS
 *
 * To use this component:
 * 1. Install Panda CSS: pnpm add -D @pandacss/dev
 * 2. Run: pnpm panda init
 * 3. Import css from your styled-system: import { css } from "../styled-system/css"
 */${
   uniqueUnconverted.length > 0
     ? `
/*
 * Custom classes that need manual CSS definitions:
 * ${uniqueUnconverted.map((c) => `- .${c}`).join("\n * ")}
 */`
     : ""
 }

import ${cssImports} from "../styled-system/css";
${usesIconify ? 'import { Icon as IconifyIcon } from "@iconify/react";' : ""}

${
  cssStyles
    ? `/* Original inline styles (move to your global.css or Panda config):
${cssStyles}
*/

`
    : ""
}export function ${componentName}() {
  return (
    <>
${jsx
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}
    </>
  );
}

export default ${componentName};
`;

  return {
    output,
    unconvertedClasses: uniqueUnconverted,
    extractedStyles: cssStyles,
    usesIconify,
    usesCx,
  };
}
