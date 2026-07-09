// Tailwind v4 DesignSystem type
// This is the main context type returned by __unstable__loadDesignSystem
export interface TailwindContext {
  /** Get CSS for a list of class names */
  candidatesToCss(classes: string[]): (string | null)[];

  /** Parse a candidate class name */
  parseCandidate(candidate: string): readonly TailwindCandidate[];

  /** Parse a variant */
  parseVariant(variant: string): TailwindVariant | null;

  /** Get the order of classes for sorting */
  getClassOrder(classes: string[]): [string, bigint | null][];

  /** Get all available classes */
  getClassList(): ClassEntry[];

  /** Get all available variants */
  getVariants(): VariantEntry[];

  /** Resolve a theme value by path */
  resolveThemeValue(path: string): string | undefined;

  /** Check if a candidate is invalid */
  invalidCandidates: Set<string>;

  /** Whether important mode is enabled */
  important: boolean;

  /** Theme values */
  theme: unknown;

  /** Utilities registry */
  utilities: unknown;

  /** Variants registry */
  variants: unknown;

  /** Compile AST nodes for a candidate */
  compileAstNodes(candidate: TailwindCandidate): unknown[];

  /** Get variant order */
  getVariantOrder(): Map<TailwindVariant, number>;
}

// Use a more permissive type for candidates since the exact structure varies
export interface TailwindCandidate {
  kind: string;
  root?: string;
  property?: string;
  variants: TailwindVariant[];
  important: boolean;
  raw: string;
  value?: unknown;
  modifier?: unknown;
}

export interface TailwindVariant {
  kind: string;
  name?: string;
  root?: string;
  value?: unknown;
  modifier?: unknown;
}

export interface ClassEntry {
  name: string;
  modifiers: string[];
}

export interface VariantEntry {
  name: string;
  isArbitrary: boolean;
  values: string[];
  hasDash: boolean;
  selectors: (options: { modifier?: string; value?: string }) => string[];
}

export type TailwindMatchOptions = {
  preserveSource?: boolean;
  respectPrefix?: boolean;
  respectImportant?: boolean;
  values?: Record<string, string>;
};
