import ts from "typescript";

export const sdkName = "@anthropic-ai/claude-agent-sdk";
export const runtimePath =
  "packages/server/src/server/agent/providers/claude/claude-agent-sdk-runtime.ts";

function constantString(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constantString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left);
    const right = constantString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}
function isSdk(node) {
  const value = constantString(node);
  return value === sdkName || value?.startsWith(`${sdkName}/`);
}

function typeOnlyImport(clause) {
  const bindings = clause?.namedBindings;
  return (
    clause?.isTypeOnly ||
    (!clause?.name &&
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((item) => item.isTypeOnly))
  );
}
function typeOnlyExport(node) {
  const clause = node.exportClause;
  return (
    node.isTypeOnly ||
    (clause &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((item) => item.isTypeOnly))
  );
}
function allowedDynamicImport(node, filename) {
  const literal = node.arguments[0];
  return (
    filename === runtimePath &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    ts.isStringLiteral(literal) &&
    literal.text === sdkName
  );
}

/** Only the loader's single literal dynamic import may produce a runtime SDK load. */
export function sdkValueImports(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const hits = [];
  let allowedImports = 0;
  function visit(node) {
    if (ts.isImportTypeNode(node)) return;
    if (ts.isImportDeclaration(node) && isSdk(node.moduleSpecifier)) {
      if (!typeOnlyImport(node.importClause)) hits.push("static import");
      return;
    }
    if (ts.isExportDeclaration(node) && isSdk(node.moduleSpecifier)) {
      if (!typeOnlyExport(node)) hits.push("value re-export");
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isSdk(node.moduleReference.expression)
    ) {
      if (!node.isTypeOnly) hits.push("import equals require");
      return;
    }
    if (ts.isCallExpression(node) && isSdk(node.arguments[0])) {
      if (allowedDynamicImport(node, filename) && ++allowedImports === 1) return;
      hits.push("runtime load");
      return;
    }
    // Do not let assigning the package name to a variable evade the dynamic-import rule.
    if (isSdk(node)) {
      hits.push("indirect SDK reference");
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return hits;
}
