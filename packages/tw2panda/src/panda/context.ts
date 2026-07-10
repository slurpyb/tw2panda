import { PandaContext as PandaContextClass } from "@pandacss/node";
import { getResolvedConfig } from "@pandacss/config";
import { parseJson, stringifyJson } from "@pandacss/shared";
import { preset as presetBase } from "@pandacss/preset-base";
import { preset as presetPanda } from "@pandacss/preset-panda";
import type { Config } from "@pandacss/types";

// Re-export Panda's own context type — no need to hand-mirror the Generator shape.
export type { PandaContext } from "@pandacss/node";

/**
 * A lightweight, in-memory Panda context that needs no config file on disk — used
 * by the `convert` command and the tests for its `utility`, `conditions`, and
 * resolved `config` (i.e. token/utility resolution and `mergeCss`).
 *
 * This mirrors exactly what Panda's own `loadConfigAndCreateContext` does once it
 * has a config (resolve presets/theme, serialize, then `new PandaContext`), but
 * skips the on-disk config-file lookup so it works from an inline config. Earlier
 * versions hand-built the generator from `@pandacss/generator`/`@pandacss/parser`
 * internals; those APIs changed in Panda 1.x, so we use the supported entry point.
 * Base + panda presets are included by default because `presets` is omitted.
 *
 * Note: do NOT parse user source through `panda.project` — since Panda 1.x its parser
 * bundles a different ts-morph than tw2panda's, and the mismatched `SyntaxKind`
 * numbering breaks our `Node.is*` guards. Parse with `parse-source-file.ts` instead.
 */
export const createPandaContext = async (conf?: { config?: Config }) => {
  const cwd = process.cwd();
  const userConfig: Config = {
    preflight: true,
    include: [],
    outdir: "styled-system",
    cwd,
    // Panda no longer auto-includes its base + panda presets from getResolvedConfig,
    // so add them explicitly (they define the conditions like _hover/_dark, the token
    // scales, utilities, etc.).
    presets: [presetBase, presetPanda as any],
    ...conf?.config,
  };

  const config = await getResolvedConfig(userConfig, cwd);
  const serialized = stringifyJson(Object.assign({}, config, { presets: [] }));
  const deserialize = () => parseJson(serialized);

  return new PandaContextClass({
    path: "",
    config: config as any,
    serialized,
    deserialize,
    dependencies: [],
    hooks: {},
  });
};
