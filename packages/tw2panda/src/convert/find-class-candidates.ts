import { NoSubstitutionTemplateLiteral, Node, StringLiteral, TemplateHead } from "ts-morph";
import { parseSourceFile } from "./parse-source-file";

/** Finds all tailwind class candidates in a file
 * -> returns the list of all StringLiteral AST nodes */
export function findTwClassCandidates(content: string) {
  const nodes = new Set<StringLike | TemplateHead>();

  const sourceFile = parseSourceFile("App.tsx", content);

  sourceFile.forEachDescendant((node, traversal) => {
    // quick win
    if (Node.isImportDeclaration(node) || Node.isExportDeclaration(node)) {
      traversal.skip();
      return;
    }

    if (Node.isTemplateExpression(node)) {
      const head = node.getHead();
      const string = getStringLiteralText(head);
      if (!string) return;

      nodes.add(head);

      return;
    }

    if (isStringLike(node)) {
      const string = getStringLiteralText(node);
      if (!string) return;

      nodes.add(node);
    }
  });

  return { sourceFile, nodes };
}

export type StringLike = StringLiteral | NoSubstitutionTemplateLiteral;
export const isStringLike = (node: Node): node is StringLike => {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node);
};

export const getStringLiteralText = (node: StringLike | TemplateHead): string | undefined =>
  (node.getLiteralText() ?? "").trim();
