import { createMergeCss } from "@pandacss/shared";

import { createPandaContext } from "../panda/context";
import { mapToShorthands } from "../panda/map-to-shorthands";
import { createTailwindContext } from "../tailwind/context";
import { twClassListToPandaStyles } from "./class-list-to-styles";
import { RewriteOptions, StyleObject } from "../shared/types";

export async function twClassListToPanda(
  classListString: string,
  options: RewriteOptions = { shorthands: true },
): Promise<StyleObject | undefined> {
  const classList = new Set(classListString.split(" "));

  const tw = await createTailwindContext();
  const tailwind = tw.context;

  const panda = await createPandaContext();
  const { mergeCss } = createMergeCss({
    utility: panda.utility,
    conditions: panda.conditions,
    hash: false,
  });

  const styles = twClassListToPandaStyles(classList, tailwind, panda);
  if (!styles.length) return;

  const merged = mergeCss(...styles.map((s) => s.styles));
  return options?.shorthands ? mapToShorthands(merged, panda) : merged;
}
