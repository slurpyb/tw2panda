import { PandaContext } from "./panda-context";
import { parseTwClassName } from "./tw-parser";
import { TailwindContext } from "./tw-types";
import { MatchingToken, StyleObject } from "./types";

const kebabToCamel = (str: string) => str.replace(/(-\w)/g, (group) => (group[1] ?? "").toUpperCase());

export interface ParsedCssProperty {
  propName: string;
  /** The token path (e.g., "gray.500") */
  tokenPath: string;
  /** The original/resolved CSS value (e.g., "#6b7280") */
  rawValue: string;
}

/**
 * Resolve a CSS variable reference to its actual value using Tailwind's theme
 * var(--text-xs) -> "0.75rem"
 * var(--color-gray-500) -> "oklch(0.551 0.027 264.364)"
 */
function resolveCssVariable(value: string, tailwind: TailwindContext): string {
  // Extract all var(--xxx) references and resolve them
  const varRegex = /var\(([^)]+)\)/g;
  let resolved = value;
  let match;

  while ((match = varRegex.exec(value)) !== null) {
    const varName = match[1]?.trim();
    if (!varName) continue;

    // Try to resolve the variable
    const resolvedValue = tailwind.resolveThemeValue?.(varName);
    if (resolvedValue && !resolvedValue.includes("var(")) {
      resolved = resolved.replace(match[0], resolvedValue);
    }
  }

  return resolved;
}

/**
 * Extract token path from a CSS variable name
 * --color-gray-500 -> "gray.500"
 * --text-xs -> "xs"
 * --leading-relaxed -> "relaxed"
 */
function varNameToTokenPath(varName: string): string {
  // Remove leading --
  let name = varName.replace(/^--/, "");

  // Map common prefixes to token categories
  const prefixMappings: [RegExp, string][] = [
    [/^color-/, ""],
    [/^text-/, ""],
    [/^leading-/, ""],
    [/^tracking-/, ""],
    [/^font-weight-/, ""],
    [/^font-size-/, ""],
    [/^radius-/, ""],
    [/^shadow-/, ""],
    [/^container-/, ""],
    [/^spacing-/, ""],
  ];

  for (const [pattern, replacement] of prefixMappings) {
    if (pattern.test(name)) {
      name = name.replace(pattern, replacement);
      break;
    }
  }

  // Convert remaining dashes to dots for token path
  return name.replace(/-/g, ".");
}

/**
 * Parse CSS string to extract property-value pairs.
 * Handles both flat CSS and nested CSS (v4 style).
 * Returns both the token path and the resolved raw value.
 */
function parseCssProperties(css: string, tailwind: TailwindContext): ParsedCssProperty[] {
  const properties: ParsedCssProperty[] = [];

  // Find all CSS property declarations (property: value;) anywhere in the CSS
  const declarationRegex = /([a-z-]+)\s*:\s*([^;{}]+);/gi;
  let match;

  while ((match = declarationRegex.exec(css)) !== null) {
    const propName = match[1]?.trim();
    const originalValue = match[2]?.trim();

    if (!propName || !originalValue) continue;

    // Skip CSS variables declarations
    if (propName.startsWith("--")) continue;

    // Skip @property descriptor properties
    if (propName === "syntax" || propName === "inherits" || propName === "initial-value") continue;

    let tokenPath = originalValue;
    let rawValue = originalValue;

    // Handle calc() with spacing multiplier: calc(var(--spacing) * 4) -> "4", "1rem"
    const spacingCalcMatch = originalValue.match(/calc\(var\(--spacing\)\s*\*\s*(\d+(?:\.\d+)?)\)/);
    if (spacingCalcMatch?.[1]) {
      tokenPath = spacingCalcMatch[1];
      const baseSpacing = tailwind.resolveThemeValue?.("--spacing");
      if (baseSpacing) {
        const multiplier = parseFloat(spacingCalcMatch[1]);
        const baseValue = parseFloat(baseSpacing);
        if (!isNaN(multiplier) && !isNaN(baseValue)) {
          rawValue = `${baseValue * multiplier}rem`;
        }
      }
    }
    // Handle simple var() references
    else if (originalValue.includes("var(--")) {
      // Extract the first var() for the token path
      const varMatch = originalValue.match(/var\(([^)]+)\)/);
      if (varMatch?.[1]) {
        tokenPath = varNameToTokenPath(varMatch[1]);
      }

      // Resolve ALL var() references in the value to get the raw value
      rawValue = resolveCssVariable(originalValue, tailwind);
    }

    properties.push({ propName, tokenPath, rawValue });
  }

  return properties;
}

/** Map CSS property names to Panda token categories */
const PROP_TO_TOKEN_CATEGORY: Record<string, string> = {
  color: "colors",
  backgroundColor: "colors",
  borderColor: "colors",
  borderTopColor: "colors",
  borderRightColor: "colors",
  borderBottomColor: "colors",
  borderLeftColor: "colors",
  outlineColor: "colors",
  fill: "colors",
  stroke: "colors",
  caretColor: "colors",
  accentColor: "colors",
  textDecorationColor: "colors",
  fontSize: "fontSizes",
  fontWeight: "fontWeights",
  fontFamily: "fonts",
  lineHeight: "lineHeights",
  letterSpacing: "letterSpacings",
  width: "sizes",
  height: "sizes",
  minWidth: "sizes",
  minHeight: "sizes",
  maxWidth: "sizes",
  maxHeight: "sizes",
  padding: "spacing",
  paddingTop: "spacing",
  paddingRight: "spacing",
  paddingBottom: "spacing",
  paddingLeft: "spacing",
  paddingInline: "spacing",
  paddingBlock: "spacing",
  margin: "spacing",
  marginTop: "spacing",
  marginRight: "spacing",
  marginBottom: "spacing",
  marginLeft: "spacing",
  marginInline: "spacing",
  marginBlock: "spacing",
  gap: "spacing",
  rowGap: "spacing",
  columnGap: "spacing",
  top: "spacing",
  right: "spacing",
  bottom: "spacing",
  left: "spacing",
  inset: "spacing",
  borderRadius: "radii",
  borderTopLeftRadius: "radii",
  borderTopRightRadius: "radii",
  borderBottomLeftRadius: "radii",
  borderBottomRightRadius: "radii",
  borderWidth: "borderWidths",
  borderTopWidth: "borderWidths",
  borderRightWidth: "borderWidths",
  borderBottomWidth: "borderWidths",
  borderLeftWidth: "borderWidths",
  boxShadow: "shadows",
  opacity: "opacity",
  zIndex: "zIndex",
  transitionDuration: "durations",
  transitionTimingFunction: "easings",
  animationDuration: "durations",
  animationTimingFunction: "easings",
};

/**
 * Check if a value is a usable CSS value (not a CSS variable reference)
 * Usable values: hex colors, rgb/hsl/oklch, rem/em/px units, numbers, keywords
 */
function isResolvableValue(value: string): boolean {
  // CSS variable references are NOT usable as fallbacks
  if (value.includes("var(--")) return false;

  // These are usable values
  const usablePatterns = [
    /^#[0-9a-fA-F]{3,8}$/, // hex colors
    /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/, // color functions
    /^-?[\d.]+(%|px|rem|em|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|deg|rad|turn|s|ms)?$/, // numbers with units
    /^(auto|none|inherit|initial|unset|revert|normal|bold|italic|block|inline|flex|grid|hidden|visible|absolute|relative|fixed|sticky|static)$/, // keywords
    /^(left|right|center|top|bottom|baseline|stretch|start|end|space-between|space-around|space-evenly)$/, // alignment
    /^(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)$/, // border styles
    /^(uppercase|lowercase|capitalize|none)$/, // text transform
    /^(wrap|nowrap|wrap-reverse)$/, // flex wrap
    /^(row|column|row-reverse|column-reverse)$/, // flex direction
    /^(cover|contain|auto)$/, // background size
    /^url\(/, // url()
    /^calc\(/, // calc() - only if it doesn't contain var()
  ];

  return usablePatterns.some((pattern) => pattern.test(value.trim()));
}

/**
 * Format a value with token() syntax if it's a token reference AND we have a usable fallback
 * e.g., "gray.500" with raw "#6b7280" becomes "token(colors.gray.500, #6b7280)"
 * But "lg" with raw "var(--container-lg)" just becomes "var(--container-lg)" (unusable fallback)
 */
function formatTokenValue(propName: string, tokenName: string, rawValue: string): string {
  // If tokenName equals rawValue, it's a literal value, not a token
  if (tokenName === rawValue) {
    return rawValue;
  }

  // If the raw value is not resolvable (still a CSS variable), just use it directly
  // No point wrapping in token() if the fallback won't work
  if (!isResolvableValue(rawValue)) {
    return rawValue;
  }

  // We have a usable fallback, wrap in token()
  const category = PROP_TO_TOKEN_CATEGORY[propName];
  if (category) {
    return `token(${category}.${tokenName}, ${rawValue})`;
  }

  // For properties without a known category, just use the raw value
  return rawValue;
}

/**
 * Takes a list of Tailwind class names and convert them to a list of Panda style objects
 */
export const twClassListToPandaStyles = (classList: Set<string>, tailwind: TailwindContext, panda: PandaContext) => {
  const styles = [] as Array<{ match: MatchingToken; styles: StyleObject }>;

  classList.forEach((className) => {
    const tokens = getMatchingTwCandidates(className, tailwind, panda);

    tokens.forEach((match) => {
      const { propName, tokenName, rawValue, classInfo } = match;

      // Format the value with token() syntax if applicable
      const formattedValue = formatTokenValue(propName, tokenName, rawValue);

      // dark:text-sky-400 -> { _dark: { color: "token(colors.sky.400, #38bdf8)" } }
      // md:p-4 -> { md: { padding: "token(spacing.4, 1rem)" } }
      const nested = classInfo.modifiers?.reduce(
        (acc, modifier) => {
          const camelModifier = kebabToCamel(modifier);
          const prefixed = "_" + camelModifier;
          // Check if it's a prefixed condition (like _dark, _hover) or a breakpoint (like md, lg)
          const isPrefixedCondition = panda.conditions.values[prefixed];
          const isBreakpointCondition = panda.conditions.values[camelModifier];

          const conditionValue = isPrefixedCondition ? prefixed : isBreakpointCondition ? camelModifier : modifier;

          return { [conditionValue]: acc } as StyleObject;
        },
        { [propName]: formattedValue },
      );
      styles.push({ match, styles: nested });
    });
  });

  return styles;
};

function getMatchingTwCandidates(className: string, tailwind: TailwindContext, panda: PandaContext) {
  const tokens = [] as MatchingToken[];
  const classInfo = parseTwClassName(className);
  if (!classInfo) return tokens;

  if (!classInfo.value && !classInfo.permutations) {
    return tokens;
  }

  // Use v4 API to get CSS for the class
  const cssResults = tailwind.candidatesToCss([className]);
  const css = cssResults[0];

  if (!css) return tokens;

  // Parse the CSS to extract property names, token paths, and raw values
  const propNameList = parseCssProperties(css, tailwind).map((prop) => ({
    cssPropName: prop.propName,
    propName: kebabToCamel(prop.propName),
    tokenPath: prop.tokenPath,
    rawValue: prop.rawValue,
  }));

  propNameList.forEach((ruleProp) => {
    const { propName, tokenPath, rawValue } = ruleProp;
    const prop = panda.config.utilities?.[propName];
    const propValues = prop && panda.utility["getPropertyValues"](prop);

    let tokenName = tokenPath;

    // Check if the token path is a valid utility name or if we don't have prop values
    const candidates = tailwind.parseCandidate(tokenPath);
    if (candidates.length > 0 || !propValues) {
      // Use token path as-is
    } else {
      // bg-red-500 => red.500
      tokenName = (classInfo.value ?? "").replace("-", ".");
    }
    if (!tokenName) return;

    let finalRawValue = rawValue;
    if (classInfo.isImportant) {
      tokenName += "!";
      finalRawValue += " !important";
    }

    tokens.push({ propName, tokenName, rawValue: finalRawValue, classInfo });
  });

  return tokens;
}
