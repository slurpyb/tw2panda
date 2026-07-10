import { Project, SourceFile } from "ts-morph";

/**
 * Parse a source string into a ts-morph `SourceFile` using tw2panda's OWN ts-morph.
 *
 * We deliberately do NOT reuse `panda.project` for this. Since Panda 1.x, `@pandacss/parser`
 * bundles a newer ts-morph (v28) than tw2panda's own (v18), and the two ship different
 * TypeScript versions whose `SyntaxKind` enums are numbered differently. A node produced by
 * Panda's project therefore fails our `Node.is*` guards (they compare kinds against v18's
 * numbering), which silently misidentifies nodes — e.g. `Node.isCallExpression` returning true
 * for the wrong kind, then crashing on `node.getExpression()`. Parsing with our own project
 * keeps every node on the same ts-morph as the guards that inspect it.
 */
export function parseSourceFile(filePath: string, content: string): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(filePath, content, { overwrite: true });
}
