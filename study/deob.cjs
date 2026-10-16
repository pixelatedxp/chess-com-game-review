// Deobfuscates an obfuscator.io style bundle using the TypeScript compiler API.
// Usage: node deob.cjs <input.js> <output.js>
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ts = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'typescript'));

const [input, output] = process.argv.slice(2);
const src = fs.readFileSync(input, 'utf8');

// 1. Recover the string decoder by running the bundle's own pieces in a sandbox.
const decoderName = src.match(/function (_0x[0-9a-f]+)\(_0x[0-9a-f]+, _0x[0-9a-f]+\) \{\s*_0x[0-9a-f]+ = _0x[0-9a-f]+ - 0x/)[1];
const arrayFnName = src.match(new RegExp(`const _0x[0-9a-f]+ = (_0x[0-9a-f]+)\\(\\);[\\s\\S]{0,200}?${decoderName}`))?.[1]
  || src.match(/\}\)\((_0x[0-9a-f]+), 0x[0-9a-f]+\);/)[1];

const sf0 = ts.createSourceFile('in.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const pieces = {};
function grab(node) {
  if (ts.isFunctionDeclaration(node) && node.name && [decoderName, arrayFnName].includes(node.name.text)) pieces[node.name.text] = node;
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const args = node.expression.arguments;
    if (args.length === 2 && ts.isIdentifier(args[0]) && args[0].text === arrayFnName) pieces.shuffle = node;
  }
  ts.forEachChild(node, grab);
}
grab(sf0);
if (!pieces[decoderName] || !pieces[arrayFnName] || !pieces.shuffle) throw new Error('Could not locate decoder pieces');
const sandboxCode = [pieces[arrayFnName], pieces[decoderName], pieces.shuffle].map(n => n.getText(sf0)).join('\n') + `\n;globalThis.__decode = ${decoderName};`;
const ctx = vm.createContext({});
vm.runInContext(sandboxCode, ctx, {timeout: 10000});
const decode = ctx.__decode;
const removeNodes = new Set([pieces[decoderName], pieces[arrayFnName], pieces.shuffle]);

// 2. Find every alias of the decoder (const x = decoder; const y = x; ...).
const aliases = new Set([decoderName]);
let grew = true;
while (grew) {
  grew = false;
  (function walk(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer)
        && aliases.has(node.initializer.text) && !aliases.has(node.name.text)) { aliases.add(node.name.text); grew = true; }
    ts.forEachChild(node, walk);
  })(sf0);
}

var validIdent = s => /^[A-Za-z_$][\w$]*$/.test(s) && !['default','class','function','delete','new','in','do','if','for','var','let','const','return','typeof','void','this','switch','case','break','continue','while','with','try','catch','finally','throw','instanceof','super','import','export','extends','yield','enum','null','true','false'].includes(s);
// 3. Pick readable names. Exported names first, then by declaration kind.
const rename = new Map();
const exported = src.match(/globalThis\.PixelReviewRuntime = \{([^}]*)\}/);
if (exported) for (const m of exported[1].matchAll(/(\w+):\s*(_0x[0-9a-f]+)/g)) rename.set(m[2], m[1]);
const counters = {};
function nameFor(id, kind) {
  if (rename.has(id)) return rename.get(id);
  counters[kind] = (counters[kind] || 0) + 1;
  const n = `${kind}${counters[kind]}`;
  rename.set(id, n);
  return n;
}
(function collect(node) {
  const declName = n => n && ts.isIdentifier(n) && /^_0x[0-9a-f]+$/.test(n.text) ? n.text : null;
  let id;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) { if ((id = declName(node.name))) nameFor(id, 'fn'); }
  else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) { if ((id = declName(node.name))) nameFor(id, 'Class'); }
  else if (ts.isParameter(node)) { if ((id = declName(node.name))) nameFor(id, 'arg'); }
  else if (ts.isVariableDeclaration(node)) {
    if ((id = declName(node.name))) {
      const init = node.initializer;
      const kind = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? 'fn'
        : init && ts.isClassExpression(init) ? 'Class' : 'v';
      nameFor(id, kind);
    }
  } else if (ts.isBindingElement(node)) {
    if ((id = declName(node.name))) {
      const prop = node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName.text : null;
      nameFor(id, prop && validIdent(prop) ? prop + '_' : 'v');
    }
  } else if (ts.isCatchClause(node) && node.variableDeclaration) { if ((id = declName(node.variableDeclaration.name))) nameFor(id, 'err'); }
  ts.forEachChild(node, collect);
})(sf0);

// 4. Transform.
const f = ts.factory;
let decoded = 0, failed = 0;
const transformer = context => root => {
  function visit(node) {
    // Drop the decoder machinery and alias declarations.
    if (removeNodes.has(ts.getOriginalNode(node))) return undefined;
    if (ts.isVariableStatement(node)) {
      const keep = node.declarationList.declarations.filter(d => !(ts.isIdentifier(d.name) && aliases.has(d.name.text)));
      if (!keep.length) return undefined;
      if (keep.length !== node.declarationList.declarations.length)
        node = f.updateVariableStatement(node, node.modifiers, f.updateVariableDeclarationList(node.declarationList, keep));
    }
    if (ts.isVariableDeclarationList(node)) {
      const keep = node.declarations.filter(d => !(ts.isIdentifier(d.name) && aliases.has(d.name.text)));
      if (keep.length && keep.length !== node.declarations.length) node = f.updateVariableDeclarationList(node, keep);
    }
    // decoder(0x123) -> "string"
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)
        && node.arguments.length >= 1 && node.arguments.every(a => ts.isNumericLiteral(a) || ts.isStringLiteral(a))) {
      try {
        const v = decode(...node.arguments.map(a => ts.isNumericLiteral(a) ? Number(a.text) : a.text));
        if (typeof v === 'string') { decoded++; return f.createStringLiteral(v); }
      } catch {}
      failed++;
    }
    node = ts.visitEachChild(node, visit, context);
    // obj["prop"] -> obj.prop
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && validIdent(node.argumentExpression.text))
      return f.createPropertyAccessExpression(node.expression, node.argumentExpression.text);
    // { "key": v } -> { key: v }, and class/obj methods named by string
    if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node))
        && node.name && ts.isComputedPropertyName(node.name) && ts.isStringLiteral(node.name.expression) && validIdent(node.name.expression.text)) {
      const name = f.createIdentifier(node.name.expression.text);
      if (ts.isPropertyAssignment(node)) return f.updatePropertyAssignment(node, name, node.initializer);
      if (ts.isMethodDeclaration(node)) return f.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, name, node.questionToken, node.typeParameters, node.parameters, node.type, node.body);
      if (ts.isPropertyDeclaration(node)) return f.updatePropertyDeclaration(node, node.modifiers, name, node.questionToken ?? node.exclamationToken, node.type, node.initializer);
      if (ts.isGetAccessor(node)) return f.updateGetAccessorDeclaration(node, node.modifiers, name, node.parameters, node.type, node.body);
      if (ts.isSetAccessor(node)) return f.updateSetAccessorDeclaration(node, node.modifiers, name, node.parameters, node.body);
    }
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && validIdent(node.name.text))
      return f.updatePropertyAssignment(node, f.createIdentifier(node.name.text), node.initializer);
    // 0x1f -> 31
    if (ts.isNumericLiteral(node) && /^0x/i.test(node.getText?.() ?? '')) return f.createNumericLiteral(Number(node.text));
    if (ts.isNumericLiteral(node)) return f.createNumericLiteral(Number(node.text));
    // !![] -> true, ![] -> false
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const o = node.operand;
      if (ts.isArrayLiteralExpression(o) && o.elements.length === 0) return f.createFalse();
      if (ts.isPrefixUnaryExpression(o) && o.operator === ts.SyntaxKind.ExclamationToken && ts.isArrayLiteralExpression(o.operand) && o.operand.elements.length === 0) return f.createTrue();
    }
    // void 0 -> undefined
    if (ts.isVoidExpression(node) && ts.isNumericLiteral(node.expression) && node.expression.text === '0') return f.createIdentifier('undefined');
    // Rename obfuscated identifiers.
    if (ts.isIdentifier(node) && rename.has(node.text)) return f.createIdentifier(rename.get(node.text));
    return node;
  }
  return ts.visitNode(root, visit);
};
const result = ts.transform(sf0, [transformer]);
const printer = ts.createPrinter({newLine: ts.NewLineKind.LineFeed});
let out = printer.printFile(result.transformed[0]);
out = '// Readable copy of review/runtime.js for local study only.\n// Generated by deob.cjs. Not loaded by the extension. Do not publish.\n\n' + out;
fs.writeFileSync(output, out);
console.log(JSON.stringify({decoderName, arrayFnName, aliases: aliases.size, decoded, failed, renamed: rename.size, leftoverHex: (out.match(/_0x[0-9a-f]+/g) || []).length, lines: out.split('\n').length}));
