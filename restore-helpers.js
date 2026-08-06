import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

// 1. Append helpers from original
const origLines = readFileSync('C:/Users/lture/Documents/GitHub/asistente-comunidad-neurodivergente/src/persistence/database.ts', 'utf8').split('\n');
const idx = origLines.findIndex(l => l.includes('function mapGroupModerationProfile'));

let helpersStr = origLines.slice(idx).join('\n');

const currentDbPath = 'src/persistence/database.ts';
let currentDb = readFileSync(currentDbPath, 'utf8');

// The file currently ends with `\n}\n`. We append helpersStr after it.
currentDb += '\n' + helpersStr;

// 2. Clean with Babel
const ast = parse(currentDb, {
  sourceType: 'module',
  plugins: ['typescript'],
});

traverse(ast, {
  FunctionDeclaration(path) {
    const name = path.node.id?.name;
    if (!name) return;
    const lower = name.toLowerCase();
    if (lower.includes('group') || lower.includes('moderation') || lower.includes('poll')) {
      path.remove();
    }
  }
});

const newCode = generate(ast, { retainLines: false }).code;
writeFileSync(currentDbPath, newCode);
console.log('Helpers restored and cleaned.');
