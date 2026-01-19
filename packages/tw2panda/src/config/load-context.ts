import { loadConfigAndCreateContext } from "@pandacss/node";
import { PandaContext, createPandaContext } from "../panda-context";
import { ConfigFileOptions, findPandaConfig, findTailwindConfig } from "./find-config";
import { createTailwindContext } from "../tw-context";

/**
 * Load tailwind context from:
 * - configPath when provided
 * - find tailwind.config.js from file or cwd, when provided
 * - create in-memory tailwind context as fallback when no config file is found
 *
 * Note: In Tailwind v4, JS configs are no longer directly supported.
 * The context is now created from CSS with the default Tailwind preset.
 */
export async function loadTailwindContext(options: ConfigFileOptions) {
  const filePath = options.configPath ?? findTailwindConfig({ from: options.file ?? options.cwd });

  // In v4, we always load from the default CSS.
  // JS configs can be referenced via @config directive in CSS if needed.
  const tw = await createTailwindContext();
  return { context: tw.context, filePath };
}

/**
 * Load panda context from:
 * - configPath when provided
 * - find panda.config.js from file or cwd, when provided
 * - create in-memory panda context as fallback when no config file is found
 */
export async function loadPandaContext(options: ConfigFileOptions) {
  const filePath = options.configPath ?? findPandaConfig({ from: options.file ?? options.cwd });

  if (!filePath) {
    return { context: createPandaContext() as PandaContext, filePath };
  }

  return {
    context: (await loadConfigAndCreateContext({ configPath: filePath, cwd: options.cwd })) as any as PandaContext,
    filePath,
  };
}
