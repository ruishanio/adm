/** 检查前端入口与测试可达的源码；命名再导出按实际导入解析，避免空闲组件被 index.ts 掩盖。 */
import ts from 'typescript';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'src');
function files(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? files(path) : /\.(vue|ts)$/.test(path) ? [path] : [];
  });
}
const parsed = new Map(),
  reached = new Set(),
  exportsSeen = new Set(),
  failures = new Set();
function target(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return;
  const base = specifier.startsWith('@/')
    ? resolve(source, 'renderer', specifier.slice(2))
    : resolve(dirname(from), specifier);
  const path = [base, `${base}.ts`, `${base}.vue`, resolve(base, 'index.ts')].find(
    (p) => existsSync(p) && extname(p),
  );
  if (!path) failures.add(`${relative(root, from)} 引用不存在的 ${specifier}`);
  return path;
}
function parse(path) {
  if (parsed.has(path)) return parsed.get(path);
  const raw = readFileSync(path, 'utf8');
  const code = path.endsWith('.vue')
    ? [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
    : raw;
  const tree = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  parsed.set(path, tree);
  return tree;
}
function visit(path, requested = ['*']) {
  if (!/\.(vue|ts)$/.test(path)) return;
  const tree = parse(path);
  if (!reached.has(path)) {
    reached.add(path);
    function inspect(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const next = target(path, node.moduleSpecifier.text);
        const clause = node.importClause;
        const names =
          clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
            ? clause.namedBindings.elements.map((n) => (n.propertyName || n.name).text)
            : ['*'];
        if (clause?.name) names.push('default');
        if (next) visit(next, names);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const next = target(path, node.arguments[0].text);
        if (next) visit(next);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(tree);
  }
  for (const name of requested) {
    const key = `${path}#${name}`;
    if (exportsSeen.has(key)) continue;
    exportsSeen.add(key);
    for (const node of tree.statements) {
      if (!ts.isExportDeclaration(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
        continue;
      const next = target(path, node.moduleSpecifier.text);
      if (!next) continue;
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) visit(next);
      else
        for (const item of node.exportClause.elements) {
          if (name === '*' || item.name.text === name) visit(next, [(item.propertyName || item.name).text]);
        }
    }
  }
}
// 生产入口与现有测试入口均为有效用途，不把测试工具或类型文件误当作无用文件。
for (const entry of [resolve(source, 'renderer/main.ts'), ...files(resolve(root, 'tests/unit'))])
  visit(entry);
for (const path of files(source))
  if (!reached.has(path)) failures.add(`${relative(root, path)} 没有入口或测试引用`);
if (failures.size) {
  console.error([...failures].join('\n'));
  process.exitCode = 1;
} else console.log(`源码引用检查通过：${files(source).length} 个 Vue / TypeScript 文件均可达。`);
