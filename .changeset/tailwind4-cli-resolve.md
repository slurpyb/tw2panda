---
"tw2panda": patch
---

Fix `__require.resolve is not a function` crash in the published CLI. Tailwind
package resolution now uses `createRequire(import.meta.url)` and tsup emits
proper ESM/CJS shims (`shims: true`), so module resolution works both in the ESM
CLI entry (`bin.js`) and the CJS library build.
