import { defineConfig } from "tsup";

export default defineConfig({
  entryPoints: ["src/cli.ts", "src/index.ts", "src/config.ts"],
  outDir: "dist",
  dts: true,
  clean: true,
  format: ["cjs", "esm"],
  // Inject working shims so `createRequire(import.meta.url)` resolves in both
  // the ESM output (native import.meta) and the CJS output (import.meta.url
  // shimmed from __filename). Without this the CLI throws
  // `__require.resolve is not a function` when loading Tailwind.
  shims: true,
});
