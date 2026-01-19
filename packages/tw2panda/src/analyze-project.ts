/**
 * Project analysis utilities for tw2panda
 *
 * Provides:
 * - File scanning with glob patterns
 * - Class extraction across multiple files
 * - Token usage tracking
 * - Pattern detection for variant inference
 * - Migration report generation
 */

import { readFileSync, existsSync, readdirSync, Dirent } from "fs";
import { join, relative } from "pathe";
import { createMergeCss } from "@pandacss/shared";
import type { PandaContext } from "./panda-context";
import type { TailwindContext } from "./tw-types";
import { twClassListToPandaStyles } from "./tw-class-list-to-panda-styles";
import { mapToShorthands } from "./panda-map-to-shorthands";
import type { StyleObject } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface FileAnalysis {
  /** File path relative to project root */
  filePath: string;
  /** All Tailwind classes found */
  classes: string[];
  /** Classes that were successfully converted */
  convertedClasses: string[];
  /** Classes that couldn't be converted (custom classes) */
  unconvertedClasses: string[];
  /** Extracted component-like patterns */
  patterns: ExtractedPattern[];
}

export interface ExtractedPattern {
  /** Pattern identifier (hash of sorted classes) */
  id: string;
  /** All classes in this pattern */
  classes: string[];
  /** Converted Panda styles */
  styles: StyleObject;
  /** Number of times this pattern appears */
  count: number;
  /** Files where this pattern appears */
  files: string[];
  /** Line numbers in each file */
  locations: Array<{ file: string; line: number }>;
}

export interface TokenUsage {
  /** Token category (colors, spacing, etc.) */
  category: string;
  /** Token path (e.g., "blue.500") */
  path: string;
  /** Raw value */
  value: string;
  /** Number of times used */
  count: number;
  /** Files where used */
  files: string[];
}

export interface ProjectAnalysis {
  /** All analyzed files */
  files: FileAnalysis[];
  /** Aggregated token usage */
  tokens: TokenUsage[];
  /** Detected patterns (potential recipes) */
  patterns: ExtractedPattern[];
  /** Summary statistics */
  summary: {
    totalFiles: number;
    totalClasses: number;
    uniqueClasses: number;
    convertedClasses: number;
    unconvertedClasses: number;
    detectedPatterns: number;
    estimatedEffortHours: number;
  };
}

export interface AnalyzeOptions {
  /** File patterns to include */
  include?: string[] | undefined;
  /** File patterns to exclude */
  exclude?: string[] | undefined;
  /** Use shorthand properties */
  shorthands?: boolean | undefined;
  /** Minimum pattern occurrences to report */
  minPatternCount?: number | undefined;
}

// ============================================================================
// File Scanning
// ============================================================================

/**
 * Simple glob implementation for file matching
 */
function matchGlob(pattern: string, filePath: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * Recursively scan directory for files matching patterns
 */
function scanDirectory(dir: string, include: string[], exclude: string[], baseDir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(baseDir, fullPath);

    // Check exclusions first
    if (exclude.some((pattern) => matchGlob(pattern, relativePath))) {
      continue;
    }

    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (["node_modules", ".git", "dist", "build", ".next", ".panda"].includes(entry.name)) {
        continue;
      }
      files.push(...scanDirectory(fullPath, include, exclude, baseDir));
    } else if (entry.isFile()) {
      // Check if file matches include patterns
      if (include.some((pattern) => matchGlob(pattern, relativePath))) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Get files matching glob patterns
 */
export function getFilesToAnalyze(cwd: string, options: AnalyzeOptions = {}): string[] {
  const {
    include = ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js", "**/*.html"],
    exclude = ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  } = options;

  return scanDirectory(cwd, include, exclude, cwd);
}

// ============================================================================
// Class Extraction
// ============================================================================

/**
 * Extract all Tailwind classes from a file using regex
 * This is a fast, simple extraction that works for most cases
 */
function extractClassesFromFile(
  filePath: string,
  tailwind: TailwindContext,
): { classes: string[]; converted: string[]; unconverted: string[] } {
  const content = readFileSync(filePath, "utf-8");

  let allClasses: string[] = [];

  // Extract classes from various patterns
  const patterns = [
    // className="..." or class="..."
    /(?:class|className)=["']([^"']+)["']/g,
    // className={`...`} template literals (simple case)
    /(?:class|className)=\{`([^`]+)`\}/g,
    // className={css({...})} won't match - that's fine, we want utility classes
    // tw`...` template literals
    /tw`([^`]+)`/g,
    // clsx/cn/cx("...", "...")
    /(?:clsx|cn|cx|cva)\s*\(\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const classes = match[1]?.split(/\s+/).filter(Boolean) || [];
      allClasses.push(...classes);
    }
  }

  // Deduplicate
  allClasses = [...new Set(allClasses)];

  // Categorize classes
  const converted: string[] = [];
  const unconverted: string[] = [];

  for (const cls of allClasses) {
    // Skip non-utility looking classes
    if (!cls || cls.startsWith("{") || cls.startsWith("$")) {
      continue;
    }

    const css = tailwind.candidatesToCss([cls])[0];
    if (css) {
      converted.push(cls);
    } else {
      unconverted.push(cls);
    }
  }

  return { classes: allClasses, converted, unconverted };
}

// ============================================================================
// Token Tracking
// ============================================================================

/**
 * Token categories we track
 * @internal Used for reference/documentation
 */
const _TOKEN_CATEGORIES = [
  "colors",
  "spacing",
  "sizes",
  "fontSizes",
  "fontWeights",
  "lineHeights",
  "letterSpacings",
  "radii",
  "shadows",
  "zIndex",
  "opacity",
  "durations",
  "easings",
] as const;

// Suppress unused warning - kept for documentation
void _TOKEN_CATEGORIES;

/**
 * Extract token references from Panda styles
 */
function extractTokensFromStyles(styles: StyleObject, filePath: string, tokens: Map<string, TokenUsage>): void {
  const tokenPattern = /token\(([^,)]+)(?:,\s*([^)]+))?\)/g;

  function walkObject(obj: unknown): void {
    if (typeof obj === "string") {
      let match;
      while ((match = tokenPattern.exec(obj)) !== null) {
        const tokenPath = match[1]?.trim();
        const fallback = match[2]?.trim();

        if (tokenPath) {
          // Parse category from path (e.g., "colors.blue.500" -> "colors")
          const parts = tokenPath.split(".");
          const category = parts[0] || "unknown";
          const path = parts.slice(1).join(".");

          const key = `${category}.${path}`;
          const existing = tokens.get(key);

          if (existing) {
            existing.count++;
            if (!existing.files.includes(filePath)) {
              existing.files.push(filePath);
            }
          } else {
            tokens.set(key, {
              category,
              path,
              value: fallback || "",
              count: 1,
              files: [filePath],
            });
          }
        }
      }
    } else if (typeof obj === "object" && obj !== null) {
      for (const value of Object.values(obj)) {
        walkObject(value);
      }
    }
  }

  walkObject(styles);
}

// ============================================================================
// Pattern Detection
// ============================================================================

/**
 * Generate a pattern ID from a set of classes
 */
function generatePatternId(classes: string[]): string {
  return [...classes].sort().join("|");
}

/**
 * Find repeated patterns across files
 * @internal Currently unused - patterns are detected in analyzeProject directly
 */
function _detectPatterns(fileAnalyses: FileAnalysis[], minCount: number): ExtractedPattern[] {
  const patternMap = new Map<string, ExtractedPattern>();

  for (const analysis of fileAnalyses) {
    // Group classes by their occurrence context
    // For now, treat each unique class set as a pattern
    if (analysis.classes.length > 0) {
      const id = generatePatternId(analysis.classes);

      const existing = patternMap.get(id);
      if (existing) {
        existing.count++;
        if (!existing.files.includes(analysis.filePath)) {
          existing.files.push(analysis.filePath);
        }
      } else {
        patternMap.set(id, {
          id,
          classes: analysis.classes,
          styles: {},
          count: 1,
          files: [analysis.filePath],
          locations: [],
        });
      }
    }
  }

  // Filter by minimum count and sort by frequency
  return [...patternMap.values()].filter((p) => p.count >= minCount).sort((a, b) => b.count - a.count);
}

// Suppress unused warning - kept for potential future use
void _detectPatterns;

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze a project for Tailwind usage
 */
export async function analyzeProject(
  cwd: string,
  tailwind: TailwindContext,
  panda: PandaContext,
  options: AnalyzeOptions = {},
): Promise<ProjectAnalysis> {
  const { shorthands = false, minPatternCount = 2 } = options;
  const { mergeCss } = createMergeCss(Object.assign({}, panda, { hash: false }));

  // Get files to analyze
  const filePaths = getFilesToAnalyze(cwd, options);

  // Analyze each file
  const fileAnalyses: FileAnalysis[] = [];
  const allTokens = new Map<string, TokenUsage>();
  const classPatterns = new Map<string, ExtractedPattern>();

  for (const filePath of filePaths) {
    try {
      const relativePath = relative(cwd, filePath);
      const { classes, converted, unconverted } = extractClassesFromFile(filePath, tailwind);

      // Convert classes to Panda styles for token extraction
      if (converted.length > 0) {
        const classList = new Set(converted);
        const styles = twClassListToPandaStyles(classList, tailwind, panda);

        if (styles.length > 0) {
          const merged = mergeCss(...styles.map((s) => s.styles));
          const finalStyles = shorthands ? mapToShorthands(merged, panda) : merged;

          // Extract token usage
          extractTokensFromStyles(finalStyles, relativePath, allTokens);

          // Track class patterns
          const patternId = generatePatternId(converted);
          const existing = classPatterns.get(patternId);

          if (existing) {
            existing.count++;
            if (!existing.files.includes(relativePath)) {
              existing.files.push(relativePath);
            }
          } else {
            classPatterns.set(patternId, {
              id: patternId,
              classes: converted,
              styles: finalStyles,
              count: 1,
              files: [relativePath],
              locations: [],
            });
          }
        }
      }

      fileAnalyses.push({
        filePath: relativePath,
        classes,
        convertedClasses: converted,
        unconvertedClasses: unconverted,
        patterns: [],
      });
    } catch (error) {
      // Skip files that can't be processed
      console.warn(`Warning: Could not analyze ${filePath}: ${error}`);
    }
  }

  // Get patterns meeting minimum count threshold
  const patterns = [...classPatterns.values()]
    .filter((p) => p.count >= minPatternCount)
    .sort((a, b) => b.count - a.count);

  // Calculate summary (use Sets to count unique classes)
  const allClasses = fileAnalyses.flatMap((f) => f.classes);
  const uniqueClasses = new Set(allClasses);
  const uniqueConverted = new Set(fileAnalyses.flatMap((f) => f.convertedClasses));
  const uniqueUnconverted = new Set(fileAnalyses.flatMap((f) => f.unconvertedClasses));

  // Estimate effort: ~1 minute per unconverted class, ~30 seconds per pattern to review
  const estimatedMinutes = uniqueUnconverted.size * 1 + patterns.length * 0.5;
  const estimatedHours = Math.ceil((estimatedMinutes / 60) * 10) / 10;

  return {
    files: fileAnalyses,
    tokens: [...allTokens.values()].sort((a, b) => b.count - a.count),
    patterns,
    summary: {
      totalFiles: fileAnalyses.length,
      totalClasses: allClasses.length,
      uniqueClasses: uniqueClasses.size,
      convertedClasses: uniqueConverted.size,
      unconvertedClasses: uniqueUnconverted.size,
      detectedPatterns: patterns.length,
      estimatedEffortHours: estimatedHours,
    },
  };
}

// ============================================================================
// Token Config Generation
// ============================================================================

/**
 * Generate a minimal Panda theme config with only used tokens
 */
export function generateTokenConfig(analysis: ProjectAnalysis): string {
  // Group tokens by category
  const tokensByCategory = new Map<string, TokenUsage[]>();

  for (const token of analysis.tokens) {
    const existing = tokensByCategory.get(token.category) || [];
    existing.push(token);
    tokensByCategory.set(token.category, existing);
  }

  // Build nested token structure
  const buildTokenTree = (tokens: TokenUsage[]): Record<string, unknown> => {
    const tree: Record<string, unknown> = {};

    for (const token of tokens) {
      const parts = token.path.split(".");
      let current: Record<string, unknown> = tree;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part) {
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }
      }

      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        current[lastPart] = { value: token.value || `{${token.category}.${token.path}}` };
      }
    }

    return tree;
  };

  // Generate config
  const themeTokens: Record<string, unknown> = {};

  for (const [category, tokens] of tokensByCategory) {
    themeTokens[category] = buildTokenTree(tokens);
  }

  const configCode = `import { defineConfig } from "@pandacss/dev";

/**
 * Panda CSS config with tokens extracted from Tailwind usage
 * Generated by tw2panda
 *
 * Summary:
 * - ${analysis.summary.uniqueClasses} unique classes analyzed
 * - ${analysis.tokens.length} tokens extracted
 */
export default defineConfig({
  // Core settings
  preflight: true,
  include: ["./src/**/*.{js,jsx,ts,tsx}"],
  exclude: [],

  // Extracted theme
  theme: {
    extend: {
      tokens: ${JSON.stringify(themeTokens, null, 2)
        .split("\n")
        .map((l, i) => (i === 0 ? l : "      " + l))
        .join("\n")}
    }
  },

  // Output directory
  outdir: "styled-system",
});
`;

  return configCode;
}

// ============================================================================
// Migration Report Generation
// ============================================================================

/**
 * Generate a markdown migration report
 */
export function generateMigrationReport(analysis: ProjectAnalysis): string {
  const { summary, tokens, patterns, files } = analysis;

  // Get unconverted classes with file locations
  const unconvertedByClass = new Map<string, string[]>();
  for (const file of files) {
    for (const cls of file.unconvertedClasses) {
      const existing = unconvertedByClass.get(cls) || [];
      existing.push(file.filePath);
      unconvertedByClass.set(cls, existing);
    }
  }

  const unconvertedList = [...unconvertedByClass.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20); // Top 20

  // Format report
  const report = `# Tailwind to Panda CSS Migration Report

Generated by tw2panda on ${new Date().toISOString().split("T")[0]}

## Summary

| Metric | Value |
|--------|-------|
| Files Scanned | ${summary.totalFiles} |
| Total Class Usages | ${summary.totalClasses} |
| Unique Classes | ${summary.uniqueClasses} |
| Successfully Converted | ${summary.convertedClasses} (${Math.round(
    (summary.convertedClasses / summary.totalClasses) * 100,
  )}%) |
| Needs Manual Work | ${summary.unconvertedClasses} |
| Detected Patterns | ${summary.detectedPatterns} |
| **Estimated Effort** | **${summary.estimatedEffortHours} hours** |

## Conversion Status

\`\`\`
${(() => {
  const ratio = Math.min(1, summary.uniqueClasses > 0 ? summary.convertedClasses / summary.uniqueClasses : 0);
  const filled = Math.round(ratio * 40);
  return "█".repeat(filled) + "░".repeat(40 - filled) + ` ${Math.round(ratio * 100)}%`;
})()}
\`\`\`

## Unconverted Classes

These classes need manual conversion or custom utility definitions:

| Class | Files | Suggestion |
|-------|-------|------------|
${unconvertedList
  .map(([cls, files]) => {
    const suggestion = getSuggestionForClass(cls);
    return `| \`${cls}\` | ${files.length} | ${suggestion} |`;
  })
  .join("\n")}

${
  unconvertedList.length < unconvertedByClass.size
    ? `\n*...and ${unconvertedByClass.size - unconvertedList.length} more*\n`
    : ""
}

## Detected Patterns

These repeated patterns could be converted to Panda recipes:

${patterns
  .slice(0, 10)
  .map(
    (p, i) => `
### Pattern ${i + 1}: Used ${p.count} times

**Classes:** \`${p.classes.slice(0, 5).join(" ")}${p.classes.length > 5 ? " ..." : ""}\`

**Files:** ${p.files.slice(0, 3).join(", ")}${p.files.length > 3 ? ` (+${p.files.length - 3} more)` : ""}

\`\`\`ts
// Suggested recipe
const pattern${i + 1} = css(${JSON.stringify(p.styles, null, 2)});
\`\`\`
`,
  )
  .join("\n")}

## Token Usage

Top tokens used in this project:

| Token | Category | Usage Count |
|-------|----------|-------------|
${tokens
  .slice(0, 15)
  .map((t) => `| \`${t.category}.${t.path}\` | ${t.category} | ${t.count} |`)
  .join("\n")}

## Next Steps

1. **Run conversion**: \`tw2panda rewrite "src/**/*.tsx" -w -s\`
2. **Generate theme**: \`tw2panda tokens ./src -o panda.config.ts\`
3. **Handle unconverted classes**: Create custom utilities or recipes
4. **Extract patterns**: Convert detected patterns to recipes

## Files Analyzed

<details>
<summary>Click to expand (${files.length} files)</summary>

| File | Classes | Converted | Unconverted |
|------|---------|-----------|-------------|
${files
  .slice(0, 50)
  .map((f) => `| ${f.filePath} | ${f.classes.length} | ${f.convertedClasses.length} | ${f.unconvertedClasses.length} |`)
  .join("\n")}
${files.length > 50 ? `\n*...and ${files.length - 50} more files*` : ""}

</details>
`;

  return report;
}

/**
 * Get suggestion for handling an unconverted class
 */
function getSuggestionForClass(cls: string): string {
  // Animation classes
  if (cls.startsWith("animate-")) {
    return "Add to `keyframes` in panda config";
  }

  // Custom colors
  if (cls.match(/^(bg|text|border|ring)-[a-z]+-/i) && !cls.match(/-(50|100|200|300|400|500|600|700|800|900|950)$/)) {
    return "Add custom color token";
  }

  // Arbitrary values
  if (cls.includes("[") && cls.includes("]")) {
    return "Convert to token or inline style";
  }

  // Plugin classes
  if (cls.startsWith("prose") || cls.startsWith("form-")) {
    return "Tailwind plugin - needs manual recreation";
  }

  // Container queries
  if (cls.startsWith("@")) {
    return "Container query - use Panda conditions";
  }

  // Variants
  if (cls.includes(":")) {
    return "Check if condition exists in Panda";
  }

  return "Create custom utility";
}

// ============================================================================
// Variant Inference
// ============================================================================

export interface InferredVariant {
  /** Variant dimension name (e.g., "size", "variant") */
  name: string;
  /** Possible values */
  values: Record<string, StyleObject>;
}

export interface InferredRecipe {
  /** Recipe name */
  name: string;
  /** Base styles (common across all variants) */
  base: StyleObject;
  /** Inferred variants */
  variants: Record<string, Record<string, StyleObject>>;
  /** Source patterns */
  sourcePatterns: ExtractedPattern[];
  /** Generated code */
  code: string;
}

/**
 * Infer recipe variants from similar patterns
 */
export function inferVariants(patterns: ExtractedPattern[]): InferredRecipe[] {
  if (patterns.length < 2) {
    return [];
  }

  const recipes: InferredRecipe[] = [];

  // Group patterns by similarity (shared base classes)
  const groups = groupSimilarPatterns(patterns);

  for (const group of groups) {
    if (group.length < 2) continue;

    // Find common styles (base)
    const base = findCommonStyles(group.map((p) => p.styles));

    // Find differing styles (variants)
    const variants = inferVariantDimensions(group, base);

    if (Object.keys(variants).length > 0) {
      const recipe: InferredRecipe = {
        name: inferRecipeName(group),
        base,
        variants,
        sourcePatterns: group,
        code: "",
      };

      recipe.code = generateRecipeCode(recipe);
      recipes.push(recipe);
    }
  }

  return recipes;
}

/**
 * Group patterns by similarity
 */
function groupSimilarPatterns(patterns: ExtractedPattern[]): ExtractedPattern[][] {
  const groups: ExtractedPattern[][] = [];
  const used = new Set<string>();

  for (const pattern of patterns) {
    if (used.has(pattern.id)) continue;

    const group: ExtractedPattern[] = [pattern];
    used.add(pattern.id);

    // Find similar patterns
    for (const other of patterns) {
      if (used.has(other.id)) continue;

      const similarity = calculateSimilarity(pattern.classes, other.classes);
      if (similarity > 0.5) {
        group.push(other);
        used.add(other.id);
      }
    }

    if (group.length >= 2) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Calculate Jaccard similarity between two class sets
 */
function calculateSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);

  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;

  return union > 0 ? intersection / union : 0;
}

/**
 * Find common styles across patterns
 */
function findCommonStyles(stylesList: StyleObject[]): StyleObject {
  if (stylesList.length === 0) return {};
  if (stylesList.length === 1) return stylesList[0] || {};

  const common: StyleObject = {};
  const first = stylesList[0];

  if (!first) return {};

  for (const [key, value] of Object.entries(first)) {
    // Check if all patterns have the same value for this key
    const allHaveSame = stylesList.every((styles) => {
      const v = styles[key];
      return JSON.stringify(v) === JSON.stringify(value);
    });

    if (allHaveSame) {
      common[key] = value;
    }
  }

  return common;
}

/**
 * Infer variant dimensions from patterns
 */
function inferVariantDimensions(
  patterns: ExtractedPattern[],
  base: StyleObject,
): Record<string, Record<string, StyleObject>> {
  const variants: Record<string, Record<string, StyleObject>> = {};

  // Collect all differing properties
  const diffs: Array<{ pattern: ExtractedPattern; diff: StyleObject }> = [];

  for (const pattern of patterns) {
    const diff: StyleObject = {};

    for (const [key, value] of Object.entries(pattern.styles)) {
      if (JSON.stringify(base[key]) !== JSON.stringify(value)) {
        diff[key] = value;
      }
    }

    if (Object.keys(diff).length > 0) {
      diffs.push({ pattern, diff });
    }
  }

  // Try to categorize diffs into variant dimensions
  // Look for common patterns like size (padding, fontSize) or visual (bg, color)
  const sizeProps = ["padding", "paddingX", "paddingY", "p", "px", "py", "fontSize", "height", "width", "gap"];
  const visualProps = ["backgroundColor", "bg", "bgColor", "color", "borderColor"];

  const sizeVariants: Record<string, StyleObject> = {};
  const visualVariants: Record<string, StyleObject> = {};
  const otherVariants: Record<string, StyleObject> = {};

  for (let i = 0; i < diffs.length; i++) {
    const { diff } = diffs[i] || {};
    if (!diff) continue;

    const sizeDiff: StyleObject = {};
    const visualDiff: StyleObject = {};
    const otherDiff: StyleObject = {};

    for (const [key, value] of Object.entries(diff)) {
      if (sizeProps.some((p) => key.includes(p))) {
        sizeDiff[key] = value;
      } else if (visualProps.some((p) => key.includes(p))) {
        visualDiff[key] = value;
      } else {
        otherDiff[key] = value;
      }
    }

    if (Object.keys(sizeDiff).length > 0) {
      sizeVariants[`size${i + 1}`] = sizeDiff;
    }
    if (Object.keys(visualDiff).length > 0) {
      visualVariants[`variant${i + 1}`] = visualDiff;
    }
    if (Object.keys(otherDiff).length > 0) {
      otherVariants[`style${i + 1}`] = otherDiff;
    }
  }

  if (Object.keys(sizeVariants).length > 1) {
    variants["size"] = sizeVariants;
  }
  if (Object.keys(visualVariants).length > 1) {
    variants["variant"] = visualVariants;
  }
  if (Object.keys(otherVariants).length > 1) {
    variants["style"] = otherVariants;
  }

  return variants;
}

/**
 * Infer a recipe name from patterns
 */
function inferRecipeName(patterns: ExtractedPattern[]): string {
  // Look for common class prefixes
  const allClasses = patterns.flatMap((p) => p.classes);
  const prefixes = new Map<string, number>();

  for (const cls of allClasses) {
    const prefix = cls.split("-")[0];
    if (prefix && prefix.length > 2) {
      prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
    }
  }

  // Find most common prefix
  let maxPrefix = "component";
  let maxCount = 0;

  for (const [prefix, count] of prefixes) {
    if (count > maxCount) {
      maxPrefix = prefix;
      maxCount = count;
    }
  }

  return maxPrefix;
}

/**
 * Generate recipe code from inferred recipe
 */
function generateRecipeCode(recipe: InferredRecipe): string {
  const formatStyles = (styles: StyleObject): string => {
    return JSON.stringify(styles, null, 2).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, "$1:");
  };

  const variantsStr = Object.entries(recipe.variants)
    .map(([name, values]) => {
      const valuesStr = Object.entries(values)
        .map(
          ([key, styles]) =>
            `      ${key}: ${formatStyles(styles)
              .split("\n")
              .map((l, i) => (i === 0 ? l : "      " + l))
              .join("\n")}`,
        )
        .join(",\n");
      return `    ${name}: {\n${valuesStr}\n    }`;
    })
    .join(",\n");

  return `import { cva } from "../styled-system/css";

/**
 * ${recipe.name} recipe
 * Inferred from ${recipe.sourcePatterns.length} similar patterns
 */
export const ${recipe.name}Recipe = cva({
  base: ${formatStyles(recipe.base)
    .split("\n")
    .map((l, i) => (i === 0 ? l : "  " + l))
    .join("\n")},
  variants: {
${variantsStr}
  },
  defaultVariants: {
    ${Object.keys(recipe.variants)
      .map((name) => `${name}: "${Object.keys(recipe.variants[name] || {})[0] || ""}"`)
      .join(",\n    ")}
  },
});
`;
}
