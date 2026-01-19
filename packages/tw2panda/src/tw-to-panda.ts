import { createMergeCss } from "@pandacss/shared";

import { createPandaContext } from "./panda-context";
import { mapToShorthands } from "./panda-map-to-shorthands";
import { createTailwindContext } from "./tw-context";
import { twClassListToPandaStyles } from "./tw-class-list-to-panda-styles";
import { RewriteOptions } from "./types";

export async function twClassListToPanda(classListString: string, options: RewriteOptions = { shorthands: true }) {
  const classList = new Set(classListString.split(" "));

  const tw = await createTailwindContext();
  const tailwind = tw.context;

  const panda = createPandaContext();
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
