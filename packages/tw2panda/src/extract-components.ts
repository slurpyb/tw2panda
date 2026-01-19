/**
 * Component extraction from HTML/JSX
 *
 * Identifies component boundaries based on:
 * - Semantic HTML5 elements
 * - Structural patterns (nesting, siblings)
 * - Class naming patterns
 * - ARIA roles
 *
 * Generates Panda slot recipes from extracted components.
 */

import { createMergeCss } from "@pandacss/shared";
import type { PandaContext } from "./panda-context";
import type { TailwindContext } from "./tw-types";
import { twClassListToPandaStyles } from "./tw-class-list-to-panda-styles";
import { mapToShorthands } from "./panda-map-to-shorthands";

/** Slot definition for a component */
export interface ComponentSlot {
  /** Slot name (e.g., "root", "title", "content") */
  name: string;
  /** HTML element type */
  element: string;
  /** Original classes */
  classes: string[];
  /** Depth from component root (0 = root) */
  depth: number;
  /** CSS selector path from root */
  selector: string;
  /** Child slots */
  children: ComponentSlot[];
}

/** Extracted component definition */
export interface ExtractedComponent {
  /** Inferred component name */
  name: string;
  /** Component type (semantic, structural, pattern) */
  type: "semantic" | "structural" | "pattern" | "aria";
  /** Root element type */
  rootElement: string;
  /** All slots in the component */
  slots: ComponentSlot[];
  /** Original HTML */
  html: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/** Options for component extraction */
export interface ExtractComponentsOptions {
  /** Minimum confidence to include (0-1) */
  minConfidence?: number;
  /** Include non-semantic elements as potential roots */
  includeStructural?: boolean;
  /** Maximum depth to analyze */
  maxDepth?: number;
}

/**
 * Semantic HTML5 elements that typically represent component boundaries
 */
const SEMANTIC_ELEMENTS: Record<string, { name: string; confidence: number }> = {
  header: { name: "Header", confidence: 0.9 },
  nav: { name: "Navigation", confidence: 0.9 },
  main: { name: "Main", confidence: 0.8 },
  section: { name: "Section", confidence: 0.7 },
  article: { name: "Article", confidence: 0.85 },
  aside: { name: "Sidebar", confidence: 0.85 },
  footer: { name: "Footer", confidence: 0.9 },
  form: { name: "Form", confidence: 0.9 },
  dialog: { name: "Dialog", confidence: 0.95 },
  details: { name: "Accordion", confidence: 0.8 },
  figure: { name: "Figure", confidence: 0.75 },
  fieldset: { name: "FieldGroup", confidence: 0.8 },
};

/**
 * ARIA roles that suggest component boundaries
 */
const ARIA_ROLE_COMPONENTS: Record<string, { name: string; confidence: number }> = {
  button: { name: "Button", confidence: 0.9 },
  dialog: { name: "Dialog", confidence: 0.95 },
  alertdialog: { name: "AlertDialog", confidence: 0.95 },
  menu: { name: "Menu", confidence: 0.9 },
  menubar: { name: "MenuBar", confidence: 0.9 },
  menuitem: { name: "MenuItem", confidence: 0.85 },
  tab: { name: "Tab", confidence: 0.9 },
  tablist: { name: "TabList", confidence: 0.9 },
  tabpanel: { name: "TabPanel", confidence: 0.9 },
  listbox: { name: "Listbox", confidence: 0.9 },
  option: { name: "Option", confidence: 0.85 },
  combobox: { name: "Combobox", confidence: 0.9 },
  grid: { name: "Grid", confidence: 0.85 },
  tree: { name: "Tree", confidence: 0.85 },
  tooltip: { name: "Tooltip", confidence: 0.9 },
  alert: { name: "Alert", confidence: 0.9 },
  status: { name: "Status", confidence: 0.85 },
  progressbar: { name: "Progress", confidence: 0.9 },
  slider: { name: "Slider", confidence: 0.9 },
  switch: { name: "Switch", confidence: 0.9 },
  checkbox: { name: "Checkbox", confidence: 0.9 },
  radio: { name: "Radio", confidence: 0.9 },
  radiogroup: { name: "RadioGroup", confidence: 0.9 },
  searchbox: { name: "SearchBox", confidence: 0.85 },
  textbox: { name: "TextBox", confidence: 0.8 },
  banner: { name: "Banner", confidence: 0.85 },
  navigation: { name: "Navigation", confidence: 0.9 },
  complementary: { name: "Sidebar", confidence: 0.85 },
  contentinfo: { name: "Footer", confidence: 0.85 },
  region: { name: "Region", confidence: 0.7 },
};

/**
 * Class patterns that suggest component types
 */
const CLASS_PATTERNS: Array<{ pattern: RegExp; name: string; confidence: number }> = [
  // Common component names
  { pattern: /\b(card|Card)\b/, name: "Card", confidence: 0.85 },
  { pattern: /\b(modal|Modal)\b/, name: "Modal", confidence: 0.9 },
  { pattern: /\b(drawer|Drawer)\b/, name: "Drawer", confidence: 0.9 },
  { pattern: /\b(popover|Popover)\b/, name: "Popover", confidence: 0.9 },
  { pattern: /\b(dropdown|Dropdown)\b/, name: "Dropdown", confidence: 0.85 },
  { pattern: /\b(accordion|Accordion)\b/, name: "Accordion", confidence: 0.85 },
  { pattern: /\b(tabs?|Tabs?)\b/, name: "Tabs", confidence: 0.85 },
  { pattern: /\b(carousel|Carousel|slider|Slider)\b/, name: "Carousel", confidence: 0.85 },
  { pattern: /\b(avatar|Avatar)\b/, name: "Avatar", confidence: 0.85 },
  { pattern: /\b(badge|Badge|tag|Tag|chip|Chip)\b/, name: "Badge", confidence: 0.8 },
  { pattern: /\b(alert|Alert|toast|Toast)\b/, name: "Alert", confidence: 0.85 },
  { pattern: /\b(breadcrumb|Breadcrumb)\b/, name: "Breadcrumb", confidence: 0.85 },
  { pattern: /\b(pagination|Pagination)\b/, name: "Pagination", confidence: 0.85 },
  { pattern: /\b(stepper|Stepper)\b/, name: "Stepper", confidence: 0.85 },
  { pattern: /\b(timeline|Timeline)\b/, name: "Timeline", confidence: 0.85 },
  { pattern: /\b(hero|Hero)\b/, name: "Hero", confidence: 0.8 },
  { pattern: /\b(cta|CTA)\b/, name: "CallToAction", confidence: 0.75 },
  { pattern: /\b(testimonial|Testimonial)\b/, name: "Testimonial", confidence: 0.8 },
  { pattern: /\b(pricing|Pricing)\b/, name: "PricingCard", confidence: 0.8 },
  { pattern: /\b(feature|Feature)\b/, name: "FeatureCard", confidence: 0.75 },

  // BEM-style blocks
  { pattern: /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:__|--)?/, name: "$1", confidence: 0.6 },
];

/**
 * Slot naming patterns based on element type and position
 */
const SLOT_NAME_PATTERNS: Record<string, string> = {
  // By element type
  h1: "title",
  h2: "title",
  h3: "title",
  h4: "subtitle",
  h5: "subtitle",
  h6: "subtitle",
  p: "description",
  img: "image",
  picture: "image",
  svg: "icon",
  button: "action",
  a: "link",
  input: "input",
  textarea: "input",
  select: "input",
  label: "label",
  span: "text",
  ul: "list",
  ol: "list",
  li: "item",
  time: "timestamp",
  address: "address",
  blockquote: "quote",
  cite: "citation",
  code: "code",
  pre: "codeBlock",
  table: "table",
  thead: "tableHeader",
  tbody: "tableBody",
  tr: "row",
  th: "headerCell",
  td: "cell",
};

/**
 * Parse HTML string to a simple DOM-like structure
 */
interface ParsedElement {
  tag: string;
  attributes: Record<string, string>;
  classes: string[];
  children: ParsedElement[];
  textContent: string;
  outerHTML: string;
}

/**
 * Simple HTML parser (regex-based, not production-ready for malformed HTML)
 */
function parseHTML(html: string): ParsedElement[] {
  const elements: ParsedElement[] = [];

  // Match opening tags with attributes
  const tagRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*)\s*\/>/g;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1] || match[4] || "";
    const attrString = match[2] || match[5] || "";
    const innerHTML = match[3] || "";

    // Parse attributes
    const attributes: Record<string, string> = {};
    const attrRegex = /(\w+)(?:=["']([^"']*)["'])?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = attrMatch[1];
      const attrValue = attrMatch[2] ?? "";
      if (attrName) {
        attributes[attrName] = attrValue;
      }
    }

    // Extract classes
    const classAttr = attributes["class"] || attributes["className"] || "";
    const classes = classAttr.split(/\s+/).filter(Boolean);

    // Parse children recursively
    const children = innerHTML ? parseHTML(innerHTML) : [];

    // Get text content (excluding nested tags)
    const textContent = innerHTML.replace(/<[^>]+>/g, "").trim();

    elements.push({
      tag: tag.toLowerCase(),
      attributes,
      classes,
      children,
      textContent,
      outerHTML: match[0],
    });
  }

  return elements;
}

/**
 * Generate a slot name for an element
 */
function generateSlotName(
  element: ParsedElement,
  depth: number,
  siblingIndex: number,
  _parentSlotName: string,
): string {
  // Check for explicit slot name patterns
  const patternName = SLOT_NAME_PATTERNS[element.tag];
  if (patternName && depth > 0) {
    return patternName;
  }

  // Check class-based naming
  for (const cls of element.classes) {
    // Look for semantic class names
    const match = cls.match(
      /^(?:.*[-_])?(title|content|body|header|footer|icon|image|text|label|action|trigger|indicator|wrapper|container|inner)$/i,
    );
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  // Root element
  if (depth === 0) {
    return "root";
  }

  // Generic wrapper at depth 1
  if (depth === 1 && element.children.length > 0) {
    return "container";
  }

  // Use tag name as fallback with index if needed
  if (siblingIndex > 0) {
    return `${element.tag}${siblingIndex + 1}`;
  }

  return element.tag;
}

/**
 * Build slot tree from parsed element
 */
function buildSlotTree(
  element: ParsedElement,
  depth: number = 0,
  siblingIndex: number = 0,
  parentSlotName: string = "",
  selectorPath: string = "",
): ComponentSlot {
  const slotName = generateSlotName(element, depth, siblingIndex, parentSlotName);
  const currentSelector = selectorPath ? `${selectorPath} > ${element.tag}` : element.tag;

  // Build children slots
  const childSlots: ComponentSlot[] = [];
  const tagCounts: Record<string, number> = {};

  for (const child of element.children) {
    const count = tagCounts[child.tag] || 0;
    tagCounts[child.tag] = count + 1;

    childSlots.push(buildSlotTree(child, depth + 1, count, slotName, currentSelector));
  }

  return {
    name: slotName,
    element: element.tag,
    classes: element.classes,
    depth,
    selector: currentSelector,
    children: childSlots,
  };
}

/**
 * Flatten slot tree to array with unique names
 */
function flattenSlots(slot: ComponentSlot, usedNames: Set<string> = new Set()): ComponentSlot[] {
  const slots: ComponentSlot[] = [];

  // Ensure unique name
  let name = slot.name;
  let counter = 1;
  while (usedNames.has(name)) {
    name = `${slot.name}${++counter}`;
  }
  usedNames.add(name);

  slots.push({ ...slot, name, children: [] });

  for (const child of slot.children) {
    slots.push(...flattenSlots(child, usedNames));
  }

  return slots;
}

/**
 * Detect component type and confidence from an element
 */
function detectComponentType(element: ParsedElement): {
  name: string;
  type: ExtractedComponent["type"];
  confidence: number;
} {
  // Check ARIA role first (highest specificity)
  const role = element.attributes["role"];
  if (role) {
    const ariaInfo = ARIA_ROLE_COMPONENTS[role];
    if (ariaInfo) {
      return { name: ariaInfo.name, type: "aria", confidence: ariaInfo.confidence };
    }
  }

  // Check semantic elements
  const semanticInfo = SEMANTIC_ELEMENTS[element.tag];
  if (semanticInfo) {
    return { name: semanticInfo.name, type: "semantic", confidence: semanticInfo.confidence };
  }

  // Check class patterns
  const classString = element.classes.join(" ");
  for (const { pattern, name, confidence } of CLASS_PATTERNS) {
    const match = classString.match(pattern);
    if (match) {
      const resolvedName = name.startsWith("$") ? toPascalCase(match[1] || "Component") : name;
      return { name: resolvedName, type: "pattern", confidence };
    }
  }

  // Structural detection based on children
  if (element.children.length > 0) {
    // Has heading child - likely a section
    const hasHeading = element.children.some((c) => /^h[1-6]$/.test(c.tag));
    if (hasHeading) {
      return { name: "Section", type: "structural", confidence: 0.6 };
    }

    // Has image and text - likely a card
    const hasImage = element.children.some((c) => c.tag === "img" || c.tag === "picture");
    const hasText = element.children.some((c) => c.tag === "p" || c.textContent.length > 20);
    if (hasImage && hasText) {
      return { name: "Card", type: "structural", confidence: 0.65 };
    }

    // Multiple similar children - likely a list
    if (element.children.length > 2) {
      const firstChildTag = element.children[0]?.tag;
      const allSameTag = element.children.every((c) => c.tag === firstChildTag);
      if (allSameTag) {
        return { name: "List", type: "structural", confidence: 0.6 };
      }
    }
  }

  // Generic container
  if (element.tag === "div" || element.tag === "span") {
    return { name: "Container", type: "structural", confidence: 0.4 };
  }

  return { name: toPascalCase(element.tag), type: "structural", confidence: 0.3 };
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
}

/**
 * Extract components from HTML string
 */
export function extractComponents(html: string, options: ExtractComponentsOptions = {}): ExtractedComponent[] {
  const { minConfidence = 0.5, includeStructural = true, maxDepth = 10 } = options;
  const components: ExtractedComponent[] = [];

  const elements = parseHTML(html);

  for (const element of elements) {
    const { name, type, confidence } = detectComponentType(element);

    // Skip low-confidence detections
    if (confidence < minConfidence) continue;

    // Skip structural if not requested
    if (!includeStructural && type === "structural") continue;

    // Build slot tree
    const rootSlot = buildSlotTree(element);
    const slots = flattenSlots(rootSlot);

    // Limit depth
    const filteredSlots = slots.filter((s) => s.depth <= maxDepth);

    components.push({
      name,
      type,
      rootElement: element.tag,
      slots: filteredSlots,
      html: element.outerHTML,
      confidence,
    });
  }

  return components;
}

/**
 * Generate a Panda slot recipe from an extracted component
 */
export interface GeneratedRecipe {
  /** Recipe name */
  name: string;
  /** Slot names */
  slots: string[];
  /** Base styles for each slot */
  base: Record<string, Record<string, unknown>>;
  /** Detected variants (if any) */
  variants: Record<string, Record<string, Record<string, Record<string, unknown>>>>;
  /** JSDoc comment */
  description: string;
  /** Code string for the recipe */
  code: string;
}

/**
 * Convert extracted component to Panda slot recipe
 */
export function componentToSlotRecipe(
  component: ExtractedComponent,
  tailwind: TailwindContext,
  panda: PandaContext,
  options: { shorthands?: boolean | undefined } = {},
): GeneratedRecipe {
  const slotNames = component.slots.map((s) => s.name);
  const base: Record<string, Record<string, unknown>> = {};
  const { mergeCss } = createMergeCss(Object.assign({}, panda, { hash: false }));

  // Convert each slot's classes to Panda styles
  for (const slot of component.slots) {
    if (slot.classes.length === 0) {
      base[slot.name] = {};
      continue;
    }

    // Use the proper tw2panda conversion pipeline
    const classList = new Set(slot.classes);
    const styles = twClassListToPandaStyles(classList, tailwind, panda);

    if (styles.length > 0) {
      // Merge all style objects
      const merged = mergeCss(...styles.map((s) => s.styles));
      // Apply shorthands if requested
      const finalStyles = options.shorthands ? mapToShorthands(merged, panda) : merged;
      base[slot.name] = finalStyles;
    } else {
      // Fallback: classes might not be Tailwind, store as-is for reference
      base[slot.name] = {
        // Store original classes as a comment hint
        __originalClasses: slot.classes.join(" "),
      };
    }
  }

  // Generate recipe code
  const code = generateRecipeCode(component.name, slotNames, base, {});

  return {
    name: component.name,
    slots: slotNames,
    base,
    variants: {},
    description: `${component.type} component extracted from HTML`,
    code,
  };
}

/**
 * Generate TypeScript code for a slot recipe
 */
function generateRecipeCode(
  name: string,
  slots: string[],
  base: Record<string, Record<string, unknown>>,
  variants: Record<string, Record<string, Record<string, Record<string, unknown>>>>,
): string {
  const baseStr = JSON.stringify(base, null, 2)
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, "$1:")
    .replace(/"__originalClasses":\s*"[^"]*",?\s*/g, "// TODO: Convert non-Tailwind classes\n    ");

  const variantsStr =
    Object.keys(variants).length > 0
      ? JSON.stringify(variants, null, 2).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, "$1:")
      : "{}";

  return `import { sva } from "../styled-system/css";

export const ${camelCase(name)}Recipe = sva({
  className: "${camelCase(name)}",
  slots: ${JSON.stringify(slots)},
  base: ${baseStr
    .split("\n")
    .map((line, i) => (i === 0 ? line : "  " + line))
    .join("\n")},
  variants: ${variantsStr},
  defaultVariants: {},
});

// Usage:
// const styles = ${camelCase(name)}Recipe();
// <${name} className={styles.root}>
//   <div className={styles.container}>...</div>
// </${name}>
`;
}

/**
 * Convert string to camelCase
 */
function camelCase(str: string): string {
  return str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toLowerCase());
}

/**
 * Extract components and generate recipes from HTML
 */
export function htmlToSlotRecipes(
  html: string,
  tailwind: TailwindContext,
  panda: PandaContext,
  options: ExtractComponentsOptions & { shorthands?: boolean | undefined } = {},
): GeneratedRecipe[] {
  const components = extractComponents(html, options);

  return components.map((component) =>
    componentToSlotRecipe(component, tailwind, panda, { shorthands: options.shorthands }),
  );
}
