# AGENTS.md - tw2panda

Tailwind CSS to Panda CSS migration tool. Monorepo with CLI, web playground, and VS Code extension.

---

## Project Structure

```
tw2panda/
├── packages/
│   ├── tw2panda/     # Core library + CLI (main package)
│   ├── web/          # Playground UI (Vite + React)
│   └── vscode/       # VS Code extension
├── demo-code-sample.ts
└── package.json      # Root workspace config
```

### Core package layout (`packages/tw2panda/src`)

Organized by role in the Tailwind → Panda pipeline. `index.ts`, `cli.ts`, and
`config.ts` are the build entry points (tsup) and stay at the `src/` root.

```
src/
├── index.ts            # public API barrel
├── cli.ts              # CLI definition (cac); bin.js -> dist/cli.js
├── config.ts           # `tw2panda/config` entry
├── tailwind/           # Tailwind input: design-system context, parser, theme
│   ├── context.ts      # loads the v4 design system, resolves classes -> CSS
│   ├── parser.ts       # parses tw class syntax (modifiers, values, arbitrary)
│   ├── generate-theme-css.ts
│   ├── default-constants.ts · eval-theme.ts · types.ts
├── panda/              # Panda output
│   ├── context.ts      # sets up Panda for output generation
│   └── map-to-shorthands.ts
├── convert/            # core tw -> panda conversion
│   ├── class-list-to-styles.ts   # class list -> Panda style object
│   ├── rewrite-file.ts           # rewrite a file's classes + cva (ts-morph AST)
│   ├── to-panda.ts · css.ts · extract-class-list.ts
│   └── find-class-candidates.ts · postcss-find-rule-props.ts
├── html/               # HTML/JSX -> Panda TSX
│   └── to-jsx.ts · rewrite.ts · extract-components.ts
├── analyze/            # project analysis (tokens / report / infer)
│   └── project.ts
├── commands/           # CLI orchestration
│   └── batch.ts · watch.ts · interactive.ts
├── config/             # panda/tailwind config loading
│   └── find-config.ts · load-context.ts
└── shared/             # cross-cutting primitives
    └── types.ts · maybe-pretty.ts · resolve-utils.ts · create-project.ts · bundle.ts
```

---

## Commands

### Build

```bash
pnpm build              # Build tw2panda core
pnpm build:all          # Build all packages
pnpm format             # Prettier format all packages
```

### Test (Vitest)

```bash
# Run all tests
pnpm test

# Run single test file
cd packages/tw2panda && pnpm vitest run tw-parser.test.ts

# Run tests matching pattern
cd packages/tw2panda && pnpm vitest run -t "variant with value"

# Watch mode
cd packages/tw2panda && pnpm vitest

# Update snapshots
cd packages/tw2panda && pnpm vitest run -u
```

### Type Check

```bash
cd packages/tw2panda && pnpm typecheck
```

### Package-Specific

```bash
# tw2panda core
cd packages/tw2panda
pnpm dev          # Watch mode (tsup)
pnpm build        # Production build
pnpm start        # Run CLI from dist

# web playground
cd packages/web
pnpm dev          # Vite dev server
pnpm build        # Production build

# vscode extension
cd packages/vscode
pnpm build        # Build extension
pnpm release      # Publish to marketplace
```

---

## Code Style

### Formatting (Prettier)

- **Double quotes** for strings
- **Semicolons** required
- **120 char** line width
- **Trailing commas** everywhere
- **2 space** indentation

### TypeScript

Strictest config enabled:

```typescript
// Always handle undefined from array/object access
const item = array[0]; // item: T | undefined
if (item) {
  /* use item */
}

// Exact optional properties
interface Opts {
  flag?: boolean; // Must be boolean | undefined, NOT boolean | null
}

// Use @ts-expect-error for intentional type violations
// @ts-expect-error Types added below
import { createContext } from "tailwindcss/lib/lib/setupContextUtils";
```

### Imports

```typescript
// Named imports, sorted alphabetically
import { createMergeCss } from "@pandacss/shared";
import { cac } from "cac";
import { readFileSync } from "fs";
import { join, resolve } from "pathe"; // Use pathe, not path

// Type imports when only using types
import type { Config } from "tailwindcss";
import type { TailwindContext, TailwindMatch } from "./tw-types";

// Relative imports for local modules
import { extractTwFileClassList } from "./extract-tw-class-list";
```

### Exports

```typescript
// Barrel exports in index.ts
export * from "./extract-tw-class-list";
export * from "./tw-parser";

// Named exports preferred
export const parseTwClassName = (className: string) => { ... };
export interface TailwindClass { ... }
```

### Naming

- **camelCase**: functions, variables, parameters
- **PascalCase**: types, interfaces, classes
- **kebab-case**: file names (`class-list-to-styles.ts`, `map-to-shorthands.ts`)
- **Directory namespacing**: group by role (`tailwind/`, `panda/`, `convert/`, `html/`, `analyze/`, `commands/`, `config/`, `shared/`) instead of filename prefixes — a file's directory says whether it's Tailwind or Panda side

### Functions

```typescript
// Arrow functions preferred
export const createTailwindContext = (config: string | Config) => {
  // Early returns for type narrowing
  if (typeof config === "string") {
    return evalTheme(config);
  }
  return config;
};

// Options object for multiple optional params
export const parseTwClassName = (
  className: string,
  options?: { allowedModifiers: string[]; allowedCandidates: string[] },
) => { ... };

// Destructure with defaults
const { allowedModifiers = TW_MODIFIERS_LIST } = options ?? {};
```

### Types

```typescript
// Use interface for object shapes
export interface TailwindClass {
  className: string;
  variant: string;
  modifiers: string[];
  utility?: string;
  value?: string | undefined;
  isImportant?: boolean;
  kind?: string;
}

// Use type for unions/aliases
export type StyleObject = Record<string, any>;
export type StringLike = StringLiteral | NoSubstitutionTemplateLiteral;

// Zod for runtime validation
const rewriteFlags = z
  .object({
    tailwind: z.string(),
    write: z.boolean(),
    shorthands: z.boolean(),
  })
  .partial();
```

---

## Testing Patterns

### Vitest + Inline Snapshots

```typescript
import { test, expect, describe } from "vitest";

test("variant with value", () => {
  expect(parseTailwindClasses("flex-1 bg-slate-100")).toMatchInlineSnapshot(`
    [
      {
        "className": "flex-1",
        "utility": "flex",
        "value": "1",
      },
    ]
  `);
});

describe("rewrite-tw-file-content-to-panda", () => {
  test("samples/button.ts", () => {
    // Setup contexts
    const tailwind = createTailwindContext(config);
    const panda = createPandaContext();

    // Execute
    const { output } = rewriteTwFileContentToPanda(input, file, ...);

    // Assert with snapshot
    expect(output).toMatchInlineSnapshot(`...`);
  });
});
```

### Custom Serializers (tests-setup.ts)

```typescript
import { Node } from "ts-morph";
import { expect } from "vitest";

expect.addSnapshotSerializer({
  serialize(value) {
    return value.getKindName();
  },
  test(val) {
    return Node.isNode(val);
  },
});
```

---

## Key Dependencies

| Package       | Purpose                                |
| ------------- | -------------------------------------- |
| `tailwindcss` | Parse Tailwind classes, resolve config |
| `@pandacss/*` | Panda CSS utilities and types          |
| `ts-morph`    | TypeScript AST manipulation            |
| `zod`         | Runtime validation                     |
| `cac`         | CLI framework                          |
| `pathe`       | Cross-platform path utils              |
| `vitest`      | Testing framework                      |
| `tsup`        | Build tool                             |

---

## Architecture Notes

The pipeline flows Tailwind input → conversion → Panda output. Each layer is a
directory under `src/` (see Core package layout above):

1. **Tailwind Context** (`tailwind/context.ts`): Loads the v4 design system and resolves class names to CSS
2. **Parser** (`tailwind/parser.ts`): Parses Tailwind class syntax (modifiers, values, arbitrary values)
3. **Panda Context** (`panda/context.ts`): Sets up Panda CSS for output generation
4. **Conversion core** (`convert/`): `class-list-to-styles.ts` turns resolved classes into Panda style objects; `rewrite-file.ts` rewrites file content + `cva` via ts-morph AST
5. **Surfaces** (`html/`, `analyze/`, `commands/`): HTML→TSX conversion, project analysis, and CLI orchestration built on top of the core

Dependency direction: `commands` → `convert`/`html`/`analyze` → `tailwind`/`panda` → `shared`. Nothing in `tailwind`/`panda`/`shared` imports upward.

---

## Changeset Workflow

```bash
# After making changes
pnpm changeset          # Follow prompts to describe changes
git add .changeset/     # Commit the changeset
git push

# Release (maintainers)
pnpm release            # Publishes to npm
```
