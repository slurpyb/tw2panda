---
"tw2panda": patch
---

Make Tailwind v4 conversion produce valid, lossless Panda output.

- Handle absolute file paths in `rewrite`/`extract`/`css`/`components` (`resolve` instead of `join`).
- Fix the project-analysis glob so root-level files are no longer silently skipped by `tokens`/`report`/`infer`.
- Rename `VariantProps` usages (not just the import) to `RecipeVariantProps` so converted files type-check.
- Preserve unconvertible custom classes as annotations instead of dropping them or emitting invalid raw strings inside `cva()`; leave `defaultVariants`/`compoundVariants` condition references untouched and rename `compoundVariants` `class`/`className` keys to `css`.
- Resolve or drop leaked Tailwind v4 internal `--tw-*` plumbing (line-height, border-style, transition defaults, ring/shadow) instead of emitting broken `var(--tw-*)` values.
- Wire the previously-ignored `--tw <file>` option through so a project's `@theme` resolves custom tokens (e.g. shadcn's `bg-primary`).
