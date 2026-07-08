---
"tw2panda": patch
---

Make the library entry point browser-safe. The CLI-only modules `analyze-project`,
`batch-processor`, `watch` (chokidar) and `interactive` (readline) pull in Node
built-ins that cannot be bundled for the browser, so they are no longer re-exported
from the package root. The CLI imports them directly, so `tw2panda` on the command
line is unaffected; only deep imports of those symbols from the package root need to
switch to importing the CLI build. This unblocks consuming `createTailwindContext`,
`rewriteTwFileContentToPanda`, etc. from a browser bundle (e.g. the web playground).
