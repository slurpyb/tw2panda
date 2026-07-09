import { findTwClassCandidates } from "./find-class-candidates";
import { PandaContext } from "../panda/context";
import { mapToShorthands } from "../panda/map-to-shorthands";
import { TailwindContext } from "../tailwind/types";
import { RewriteOptions, StyleObject, TwResultItem } from "../shared/types";
import { twClassListToPandaStyles } from "./class-list-to-styles";

/**
 *  Returns a list of `TwResultItem`, which is a mapping of:
 * - `classList` - the original class list
 * - `styles` - the classList converted to a Panda style object
 * - `node` - the StringLiteral AST node that contains the class list
 */
export const extractTwFileClassList = (
  content: string,
  tailwind: TailwindContext,
  panda: PandaContext,
  mergeCss: (...styles: StyleObject[]) => StyleObject,
  options: RewriteOptions = { shorthands: true },
) => {
  const { nodes } = findTwClassCandidates(content, panda);
  const resultList = [] as TwResultItem[];
  if (!nodes.size) return resultList;

  nodes.forEach((node) => {
    const string = node.getLiteralText();
    const classList = new Set(string.split(" "));

    const styles = twClassListToPandaStyles(classList, tailwind, panda);
    if (!styles.length) return;

    const merged = mergeCss(...styles.map((s) => s.styles));
    const styleObject = options?.shorthands ? mapToShorthands(merged, panda) : merged;
    resultList.push({ classList: new Set(classList), styles: styleObject, node });
  });

  return resultList;
};
