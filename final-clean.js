import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

function isBad(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower.includes('automatic')) return false; // KEEP automatic messages
  return lower.includes('poll') || lower.includes('moderation') || lower.includes('groupdiscovery') || lower.includes('communityservices') || lower === 'groupstatus' || lower === 'grouplistsource';
}

function cleanFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      if (src.includes('poll') || src.includes('group-discovery') || src.includes('moderation')) {
        path.remove();
      } else {
        path.node.specifiers = path.node.specifiers.filter(spec => {
          const name = spec.imported ? spec.imported.name : spec.local.name;
          if (name && (isBad(name) || name.includes('GroupListSource') || name.includes('NativePoll') || name.includes('welcomePersonalization'))) return false;
          return true;
        });
        if (path.node.specifiers.length === 0) path.remove();
      }
    },
    ClassProperty(path) {
      if (isBad(path.node.key.name)) path.remove();
    },
    TSPropertySignature(path) {
      if (isBad(path.node.key.name) || path.node.key.name === 'onGroupJoin' || path.node.key.name === 'onGroupChanged' || path.node.key.name === 'onGroupLeave') {
        path.remove();
      }
    },
    ObjectProperty(path) {
      const name = path.node.key.name;
      if (name === 'onGroupJoin' || name === 'onGroupChanged' || name === 'onGroupLeave') {
        path.remove();
      }
    },
    ExpressionStatement(path) {
      const code = generate(path.node).code;
      if (code.includes('this.discovery =') || code.includes('this.pollRepository =') || code.includes('this.pollService =') || code.includes('this.pollScheduler =') || code.includes('this.moderation =') || code.includes('this.communityServicesEnabled =')) {
        path.remove();
      }
      if (code.includes('this.pollScheduler.start') || code.includes('this.pollScheduler.stop') || code.includes('this.pollScheduler.reconfigure')) {
        path.remove();
      }
      if (code.includes('this.discovery.start') || code.includes('this.discovery.stop')) {
        path.remove();
      }
      if (code.includes('this.moderationService.evaluateMessage')) {
        path.remove();
      }
      if (code.includes('this.selectableMenuPolls.set') || code.includes('this.selectableMenuPolls.delete')) {
        path.remove();
      }
      if (code.includes('this.notifyGroupChanged')) {
        path.remove();
      }
    },
    VariableDeclaration(path) {
      const code = generate(path.node).code;
      if (code.includes('pollSelector =') || code.includes('pollSender =')) {
        path.remove();
      }
    },
    IfStatement(path) {
      const code = generate(path.node).code;
      if (code.includes('this.communityServicesEnabled')) {
        path.remove();
      }
      if (code.includes('message.fromGroupId') && code.includes('canBotSendToGroup')) {
        path.remove();
      }
      if (code.includes('isSupportedGroupId') || code.includes('notifyGroupChanged')) {
        path.remove();
      }
      if (code.includes('this.moderationService')) {
         if (code.includes('evaluateMessage')) path.remove();
      }
      if (code.includes('msg.type === \'poll_creation\'')) {
        path.remove();
      }
      if (code.includes('message.type === \'vcard\'')) {
         // Some vcard handle is fine, but welcomePersonalization was removed
         if (code.includes('welcomePersonalization')) path.remove();
      }
    }
  });

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
