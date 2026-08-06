import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const currentDbPath = 'src/persistence/database.ts';
let currentDb = readFileSync(currentDbPath, 'utf8');

const ast = parse(currentDb, {
  sourceType: 'module',
  plugins: ['typescript'],
});

traverse(ast, {
  ImportDeclaration(path) {
    if (path.node.source.value === '../domain/types.js') {
      path.node.specifiers = path.node.specifiers.filter(spec => {
        const name = spec.imported ? spec.imported.name : spec.local.name;
        if (name.includes('Poll') || name.includes('Group') || name.includes('Moderation')) {
          return false;
        }
        return true;
      });
    }
  },
  CallExpression(path) {
    if (path.node.callee.type === 'MemberExpression') {
      const prop = path.node.callee.property.name;
      if (prop === 'seedPolls' || prop === 'seedBotPollTemplates') {
        path.parentPath.remove();
      }
    }
  }
});

const newCode = generate(ast, { retainLines: false }).code;
writeFileSync(currentDbPath, newCode);
console.log('database.ts cleaned of poll usages and imports.');
