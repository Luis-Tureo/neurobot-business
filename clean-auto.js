import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

copyFileSync('C:\\Users\\lture\\Documents\\GitHub\\asistente-comunidad-neurodivergente\\src\\core\\automatic-message-service.ts', 'src\\core\\automatic-message-service.ts');

function cleanFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  traverse(ast, {
    ClassMethod(path) {
      const name = path.node.key.name;
      if (name === 'getGroupRejection' || name === 'processAutomaticGroupMessage') {
        path.remove();
      }
    },
    IfStatement(path) {
      const code = generate(path.node).code;
      if (code.includes('message.fromGroupId') && code.includes('processAutomaticGroupMessage')) {
        path.remove();
      }
    },
    ExpressionStatement(path) {
      const code = generate(path.node).code;
      if (code.includes('setAutomaticGroupBackoff')) {
        path.remove();
      }
    },
    CallExpression(path) {
      // Replace sendMessageWithMentions with sendMessage
      if (path.node.callee.type === 'MemberExpression' && path.node.callee.property.name === 'sendMessageWithMentions') {
        path.node.callee.property.name = 'sendMessage';
      }
    }
  });

  const newCode = generate(ast, { retainLines: false }).code;
  writeFileSync(filePath, newCode);
  console.log(`Cleaned ${filePath}`);
}

cleanFile('src/core/automatic-message-service.ts');
