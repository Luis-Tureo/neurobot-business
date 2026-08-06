import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

function cleanFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      if (src.includes('poll') || src.includes('group-discovery') || src.includes('moderation') || src.includes('automatic-message')) {
        path.remove();
      } else {
        path.node.specifiers = path.node.specifiers.filter(spec => {
          const name = spec.imported ? spec.imported.name : spec.local.name;
          if (!name) return true;
          const lower = name.toLowerCase();
          return !(lower.includes('poll') || lower.includes('moderation') || lower.includes('group') || lower.includes('automaticmessage'));
        });
        if (path.node.specifiers.length === 0) path.remove();
      }
    },
    ClassMethod(path) {
      const name = path.node.key.name;
      if (!name) return;
      const lower = name.toLowerCase();
      if (lower.includes('poll') || lower.includes('moderation') || lower.includes('group') || lower.includes('automaticmessage')) {
        path.remove();
      }
    },
    ExpressionStatement(path) {
      const code = currentCode(path);
      const lower = code.toLowerCase();
      if (lower.includes('this.poll') || lower.includes('this.discovery') || lower.includes('this.moderation') || lower.includes('this.automaticmessages')) {
        path.remove();
      }
    },
    ObjectProperty(path) {
      const key = path.node.key.name;
      if (key === 'onGroupJoin' || key === 'onGroupChanged' || key === 'onGroupLeave') {
        path.remove();
      }
    }
  });

  function currentCode(path) {
    try {
      return generate(path.node).code;
    } catch(e) { return ''; }
  }

  const newCode = generate(ast, { retainLines: false }).code;
  writeFileSync(filePath, newCode);
  console.log(`Cleaned ${filePath}`);
}

const files = [
  'src/core/bot-instance.ts',
  'src/core/multi-bot-manager.ts',
  'src/core/message-processor.ts',
  'src/core/maintenance-service.ts',
  'src/core/rule-based-response-provider.ts',
  'src/index.ts',
  'src/messaging/simulated-client.ts',
  'src/messaging/whatsapp-adapter.ts',
  'src/messaging/whatsapp-cloud-api-adapter.ts',
  'src/domain/types.ts'
];

for (const f of files) {
  try {
    cleanFile(f);
  } catch (e) {
    console.error(`Error processing ${f}:`, e.message);
  }
}
