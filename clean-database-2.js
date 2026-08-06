import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const file = 'src/persistence/database.ts';
let code = readFileSync(file, 'utf8');

const ast = parse(code, {
  sourceType: 'module',
  plugins: ['typescript'],
});

traverse(ast, {
  ClassMethod(path) {
    const name = path.node.key.name;
    if (!name) return;
    const lower = name.toLowerCase();
    if (lower.includes('group') || lower.includes('moderation') || lower.includes('poll')) {
      // Remove the method safely
      path.remove();
    }
  }
});

const newCode = generate(ast, { retainLines: false }).code;
writeFileSync(file, newCode);
console.log('Cleaned database.ts using AST.');
