import { PandaContext } from "../panda/context";
import { TailwindContext } from "../tailwind/types";
import { prettify } from "../shared/maybe-pretty";
import MagicString from "magic-string";
import { CallExpression, Node, SourceFile, ts } from "ts-morph";
import { RewriteOptions, StyleObject, TwResultItem } from "../shared/types";
import { twClassListToPandaStyles } from "./class-list-to-styles";
import { mapToShorthands } from "../panda/map-to-shorthands";
import { getStringLiteralText, isStringLike } from "./find-class-candidates";
import { join, relative } from "pathe";

/**
 * Tailwind marker classes that don't generate CSS but are needed for variants
 * - `group` / `group/{name}` - for group-hover:, group-focus:, etc.
 * - `peer` / `peer/{name}` - for peer-checked:, peer-focus:, etc.
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
 * Classify a string literal found inside a `cva()` call so the converter treats it
 * correctly:
 * - "variant-ref": a variant-name reference, not a class list. Covers `defaultVariants`
 *   values (`variant: "default"`) and the condition keys of `compoundVariants`
 *   (`{ variant: "default", size: "lg", class: "..." }`). Left untouched.
 * - "class-list": the `class`/`className` value of a `compoundVariants` entry — a real
 *   class list whose key must also be renamed to Panda's `css`.
 * - "normal": base styles and ordinary variant values — the default conversion.
 */
type CvaStringRole = "variant-ref" | "class-list" | "normal";

function getCvaStringRole(node: Node): CvaStringRole {
  const immediate = node.getParent();
  const immediateKey = Node.isPropertyAssignment(immediate) ? immediate.getName() : undefined;

  let current: Node | undefined = immediate;
  while (current && !Node.isCallExpression(current)) {
    if (Node.isPropertyAssignment(current)) {
      const name = current.getName();
      if (name === "defaultVariants") return "variant-ref";
      if (name === "compoundVariants") {
        return immediateKey === "class" || immediateKey === "className" ? "class-list" : "variant-ref";
      }
    }
    current = current.getParent();
  }
  return "normal";
}

/**
 * Rename a `compoundVariants` entry's `class`/`className` key to Panda's `css`, so the
 * converted style object sits under the key Panda expects.
 */
function renameCompoundVariantKey(node: Node, magicStr: MagicString): void {
  const parent = node.getParent();
  if (Node.isPropertyAssignment(parent)) {
    const nameNode = parent.getNameNode();
    magicStr.update(nameNode.getStart(), nameNode.getEnd(), "css");
  }
}

/**
 * Separate a class list into Tailwind utilities, marker classes, and custom classes
 */
function categorizeClasses(
  classList: Set<string>,
  tailwind: TailwindContext,
): { twClasses: Set<string>; markerClasses: string[]; customClasses: string[] } {
  const twClasses = new Set<string>();
  const markerClasses: string[] = [];
  const customClasses: string[] = [];

  classList.forEach((cls) => {
    // Check for Tailwind marker classes (group, peer) - keep these
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

  return { twClasses, markerClasses, customClasses };
}

type CvaNode = { node: CallExpression; start: number; end: number; base: Node | undefined; variantsConfig: Node };

const importFrom = (values: string[], mod: string) => `import { ${values.join(", ")} } from '${mod}';`;

/**
 * A comment flagging classes that couldn't be converted (custom utilities not in the
 * resolved theme, e.g. shadcn's `bg-primary`). Keeps them visible for manual work
 * instead of silently dropping them or leaving an invalid raw string in the output.
 */
const unconvertedComment = (classes: string[]) => `/* TODO(tw2panda): unconverted -> ${classes.join(" ")} */`;

/**
 * Build a valid cva value, appending an "unconverted" annotation when some classes
 * in the original string couldn't be converted. Panda cva values must be style
 * objects, never raw class strings.
 */
const cvaValueWithUnconverted = (serialized: string, unconverted: string[]) => {
  if (!unconverted.length) return serialized;
  const comment = unconvertedComment(unconverted);
  if (serialized === "{}") return `{ ${comment} }`;
  return serialized.replace(/\}\s*$/, ` ${comment} }`);
};

/**
 * Parse a file content, replace Tailwind classes with Panda styles object
 * and return the new content. (Does not write to disk)
 */
export function rewriteTwFileContentToPanda(
  content: string,
  filePath: string,
  tailwind: TailwindContext,
  panda: PandaContext,
  mergeCss: (...styles: StyleObject[]) => StyleObject,
  options: RewriteOptions = { shorthands: true },
) {
  const sourceFile = panda.project.addSourceFile(filePath, content) as any as SourceFile;

  const code = sourceFile.getFullText();
  const magicStr = new MagicString(code);
  const resultList = [] as TwResultItem[];

  let cvaNode: undefined | CvaNode;
  let isInsideCx = false;

  const imports = new Set(["css"]);

  sourceFile.forEachDescendant((node, traversal) => {
    // out of selection range, ignore
    if (options.range) {
      if (options.range.start > node.getStart() && node.getEnd() > options.range.end) {
        return;
      }
    }

    // quick win
    if (Node.isExportDeclaration(node)) {
      traversal.skip();
      return;
    }

    // Replace `import { VariantProps } from "class-variance-authority"` with `import { RecipeVariantProps } from "styled-system/css"`
    if (Node.isImportDeclaration(node)) {
      const moduleSpecifier = node.getModuleSpecifierValue();
      if (moduleSpecifier === "class-variance-authority") {
        const moduleSpecifierNode = node.getModuleSpecifier();
        magicStr.update(moduleSpecifierNode.getStart(), moduleSpecifierNode.getEnd(), "'styled-system/css'");

        const importClause = node.getImportClause();
        if (importClause) {
          const namedBindings = importClause.getNamedBindings();
          if (Node.isNamedImports(namedBindings)) {
            const elements = namedBindings.getElements();
            const VariantPropsNode = elements.find((e) => e.getName() === "VariantProps");
            if (VariantPropsNode) {
              magicStr.update(VariantPropsNode.getStart(), VariantPropsNode.getEnd(), "type RecipeVariantProps");
              // Rename usages too (e.g. `VariantProps<typeof buttonVariants>`), otherwise the
              // converted file references a name that is no longer imported.
              const nameNode = VariantPropsNode.getNameNode();
              nameNode.findReferencesAsNodes().forEach((ref) => {
                // Skip the import specifier declaration itself
                if (ref.getStart() >= node.getStart() && ref.getEnd() <= node.getEnd()) return;
                magicStr.update(ref.getStart(), ref.getEnd(), "RecipeVariantProps");
              });
            }
          }
        }
      }
    }

    if (Node.isCallExpression(node)) {
      const name = node.getExpression().getText();
      if (name === "cva") {
        const args = node.getArguments();
        cvaNode = { node, start: node.getStart(), end: node.getEnd(), base: args[0], variantsConfig: args[1]! };
      }

      return;
    }

    if (Node.isTemplateHead(node)) {
      const string = getStringLiteralText(node);
      if (!string) return;

      const classList = new Set(string.split(" ").filter(Boolean));
      if (!classList.size) return;

      const { twClasses, markerClasses, customClasses } = categorizeClasses(classList, tailwind);
      const classesToKeep = [...markerClasses, ...customClasses];

      if (!twClasses.size) return;

      const styles = twClassListToPandaStyles(twClasses, tailwind, panda);
      if (!styles.length) return;

      const merged = mergeCss(...styles.map((s) => s.styles));
      const styleObject = options?.shorthands ? mapToShorthands(merged, panda) : merged;
      resultList.push({ classList: twClasses, styles: styleObject, node });

      const serializedStyles = JSON.stringify(styleObject, null);

      // Include marker classes (group/peer) in the cx() call if present
      const keptClassesStr = classesToKeep.map((c) => `"${c}"`).join(", ");
      const cxArgs = keptClassesStr ? `css(${serializedStyles}), ${keptClassesStr},` : `css(${serializedStyles}),`;

      magicStr.update(node.getStart(), node.getEnd(), `cx(${cxArgs}`);
      isInsideCx = true;
      imports.add("cx");
    }

    if (isInsideCx && Node.isTemplateTail(node)) {
      magicStr.update(node.getStart(), node.getEnd(), ")");
      isInsideCx = false;
    }

    if (isStringLike(node)) {
      const string = getStringLiteralText(node);
      if (!string) return;

      const classList = new Set(string.split(" ").filter(Boolean));
      if (!classList.size) return;

      const { twClasses, markerClasses, customClasses } = categorizeClasses(classList, tailwind);
      const classesToKeep = [...markerClasses, ...customClasses];

      const isInsideCva = Boolean(cvaNode && node.getStart() > cvaNode.start && node.getEnd() < cvaNode.end);
      const isBaseArg = cvaNode?.base === node;
      const cvaRole = isInsideCva && !isBaseArg ? getCvaStringRole(node) : "normal";

      // Variant-name references (defaultVariants values, compoundVariants conditions)
      // are not class lists — leave them exactly as they are.
      if (cvaRole === "variant-ref") return;

      // If no Tailwind utilities, but we have classes to keep, leave them as-is
      if (!twClasses.size) {
        if (isInsideCva && !isBaseArg && customClasses.length > 0) {
          // A cva value must be a style object, not a raw class string. Emit an empty
          // object annotated with the classes that need manual conversion; for a
          // compoundVariants `class`/`className` entry, also rename the key to `css`.
          if (cvaRole === "class-list") renameCompoundVariantKey(node, magicStr);
          magicStr.update(node.getStart(), node.getEnd(), cvaValueWithUnconverted("{}", customClasses));
          return;
        }
        if (classesToKeep.length > 0) {
          // Keep the string with just the marker/custom classes
          const parent = node.getParent();
          const replacement = `"${classesToKeep.join(" ")}"`;
          if (Node.isJsxAttribute(parent)) {
            magicStr.update(node.getStart(), node.getEnd(), replacement);
          }
        }
        return;
      }

      const styles = twClassListToPandaStyles(twClasses, tailwind, panda);
      if (!styles.length) return;

      const merged = mergeCss(...styles.map((s) => s.styles));
      const styleObject = options?.shorthands ? mapToShorthands(merged, panda) : merged;
      resultList.push({ classList: twClasses, styles: styleObject, node });

      const parent = node.getParent();
      const serializedStyles = JSON.stringify(styleObject, null);

      // Build the replacement based on context
      let replacement: string;

      if (isInsideCva) {
        // Inside cva call, omit the css() wrapper; annotate any dropped custom classes
        replacement = cvaValueWithUnconverted(serializedStyles, customClasses);
        // compoundVariants: rename the `class`/`className` key to Panda's `css`
        if (cvaRole === "class-list") renameCompoundVariantKey(node, magicStr);
      } else if (classesToKeep.length > 0) {
        // Has marker classes (group/peer) or custom classes - use cx()
        imports.add("cx");
        const keptClassesStr = classesToKeep.map((c) => `"${c}"`).join(", ");
        replacement = `cx(css(${serializedStyles}), ${keptClassesStr})`;
      } else {
        // Pure Tailwind utilities - use css() directly
        replacement = `css(${serializedStyles})`;
      }

      // if the string is inside a JSX attribute or expression, wrap it in {}
      if (!isInsideCx && Node.isJsxAttribute(parent)) {
        replacement = `{${replacement}}`;
      }

      // easy way, just replace the string
      // <div class="text-slate-700 dark:text-slate-500" /> => <div css={css({ color: "slate.700", dark: { color: "slate.500" } })} />
      // (equivalent to `!isBaseArg`, but this form narrows cvaNode to defined for the code below)
      if (cvaNode?.base !== node) {
        magicStr.update(node.getStart(), node.getEnd(), replacement);
        return;
      }

      // if the string is the 1st arg (cvaNode.base) of a cva call, move it to a new `base` key inside the 2nd arg (cvaNode.variantsConfig)
      const variantsConfig = cvaNode.variantsConfig;
      if (!Node.isObjectLiteralExpression(variantsConfig)) return;

      const prev = variantsConfig.getPreviousSibling();

      // rm trailing comma
      if (prev && prev.getKind() === ts.SyntaxKind.CommaToken) {
        magicStr.remove(prev.getStart(), prev.getEnd());
      }

      // merge 1st arg of `class-variance-authority` with its 2nd arg, move 1st arg inside panda's cva `base` key
      magicStr.appendLeft(
        variantsConfig.getStart() + 1,
        `base: ${cvaValueWithUnconverted(serializedStyles, customClasses)}, `,
      );

      // rm trailing comma
      magicStr.remove(node.getStart(), node.getEnd());
    }
  });

  if (imports.size) {
    const relativeFile = relative(panda.config.cwd, filePath);
    const outdirCssPath = join(panda.config.cwd, `${panda.config.outdir}/css`);
    const from = relative(relativeFile, outdirCssPath);
    magicStr.prepend(importFrom(Array.from(imports), from) + "\n\n");
  }

  return { sourceFile, output: prettify(magicStr.toString()), resultList, magicStr };
}
