import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function replaceInFile(relativePath, replacer) {
  const file = join(process.cwd(), relativePath);
  try {
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, replacer(content));
    console.log(`Updated ${relativePath}`);
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

// 1. bot-instance.ts
replaceInFile('src/core/bot-instance.ts', (content) => {
  content = content.replace(/import \{ AutomaticMessageService \} from '\.\/automatic-message-service\.js';\n/g, '');
  content = content.replace(/import type \{ GroupJoinEvent \} from '\.\.\/messaging\/messaging-client\.js';\n/g, '');
  content = content.replace(/\s*private readonly automaticMessages: AutomaticMessageService;/g, '');
  content = content.replace(/\s*this\.automaticMessages = new AutomaticMessageService\([^)]+\);/g, '');
  content = content.replace(/this\.automaticMessages\.start\(\);/g, '');
  content = content.replace(/this\.automaticMessages\.stop\(\);/g, '');
  content = content.replace(/client\.on\('qr_ready', \(qr\) => \{\n\s*this\.updateState\('qr_ready', qr\);\n\s*\}\);/g, `client.on('qr_ready' as any, (qr) => {\n      this.updateState('connecting', qr as any);\n    });`);
  content = content.replace(/qrCode: snapshot\.qrCode,/g, '');
  return content;
});

// 2. multi-bot-manager.ts
replaceInFile('src/core/multi-bot-manager.ts', (content) => {
  content = content.replace(/import type \{ AutomaticMessageService \} from '\.\/automatic-message-service\.js';\n/g, '');
  content = content.replace(/\s*public automaticMessages\(botId: string\): AutomaticMessageService \| null \{\n\s*return this\.instances\.get\(botId\)\?.automaticMessages \?\? null;\n\s*\}/g, '');
  content = content.replace(/qrCode: state\.qrCode,/g, '');
  return content;
});

// 3. message-processor.ts
replaceInFile('src/core/message-processor.ts', (content) => {
  content = content.replace(/\s*private readonly queryService: SemanticQueryService,/g, '');
  content = content.replace(/\s*const safeSend = (.*?)\n/g, '');
  return content;
});

// 4. whatsapp-adapter.ts
replaceInFile('src/messaging/whatsapp-adapter.ts', (content) => {
  content = content.replace(/canonicalPhoneIdentity,\n\s*classifyWhatsAppId,\n\s*isParticipantId,\n/g, '');
  content = content.replace(/describeMessageIdStructure,\n/g, '');
  content = content.replace(/import \{ messageIdentityResolver \} from '\.\.\/utils\/identity\.js';\n/g, '');
  content = content.replace(/\s*anonymizer: Anonymizer,\n/g, '');
  return content;
});

// 5. database.ts
replaceInFile('src/persistence/database.ts', (content) => {
  content = content.replace(/import \{ DEFAULT_POLL_CONFIGURATION \} from '\.\.\/core\/poll-defaults\.js';\n/g, '');
  content = content.replace(/\(option, index\) =>/g, '(option: string, index: number) =>');
  return content;
});

// 6. tests/whatsapp-adapter.test.ts
replaceInFile('tests/whatsapp-adapter.test.ts', (content) => {
  content = content.replace(/,\n\s*mockAnonymizer/g, '');
  content = content.replace(/adapter\.on\('group_join'.*?\n/g, '');
  content = content.replace(/adapter\.onGroupJoin\(event\).*?\n/g, '');
  content = content.replace(/adapter\.onGroupChanged\(event\).*?\n/g, '');
  return content;
});
