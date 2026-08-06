import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
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

// 1. multi-bot-manager.ts
replaceInFile('src/core/multi-bot-manager.ts', (content) => {
  content = content.replace(/public automaticMessages\(botId: string\): AutomaticMessageService \| null \{\n\s*return this\.instances\.get\(botId\)\?.automaticMessages \?\? null;\n\s*\}/g, '');
  content = content.replace(/public automaticMessages\(botId: string\): any \| null \{\n\s*return this\.instances\.get\(botId\)\?.automaticMessages \?\? null;\n\s*\}/g, '');
  content = content.replace(/public automaticMessages[^}]+\}/g, '');
  return content;
});

// 2. admin/server.ts
replaceInFile('src/admin/server.ts', (content) => {
  // Remove block of code containing /api/bots/:botId/welcome
  // Remove block of code containing /api/bots/:botId/polls
  content = content.replace(/app\.get\('\/api\/bots\/:botId\/welcome'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.put\('\/api\/bots\/:botId\/welcome\/groups'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.patch\('\/api\/bots\/:botId\/welcome\/groups\/:groupKey'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  
  content = content.replace(/app\.get\('\/api\/bots\/:botId\/polls'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.put\('\/api\/bots\/:botId\/polls'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.get\('\/api\/bots\/:botId\/polls\/templates'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.post\('\/api\/bots\/:botId\/polls\/templates'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.patch\('\/api\/bots\/:botId\/polls\/templates\/:templateId'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.delete\('\/api\/bots\/:botId\/polls\/templates\/:templateId'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.delete\('\/api\/bots\/:botId\/polls\/overrides\/:date'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.post\('\/api\/bots\/:botId\/polls\/overrides'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  
  // also /api/bots/:botId/groups
  content = content.replace(/app\.get\('\/api\/bots\/:botId\/groups'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.post\('\/api\/bots\/:botId\/groups\/scan'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
  content = content.replace(/app\.patch\('\/api\/bots\/:botId\/groups\/:groupKey'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');

  content = content.replace(/context\.multiBotManager\?.adminPhoneNumber\(botId\)/g, 'null');
  
  // Normalize moderation function removal
  content = content.replace(/normalizeModerationConfigurationValue\([^)]+\)/g, '""');

  return content;
});

// 3. message-processor.ts
replaceInFile('src/core/message-processor.ts', (content) => {
  content = content.replace(/message\.from/g, 'message.chatId'); // Assuming from was changed to chatId
  content = content.replace(/const safeSend =[\s\S]*?;\n/g, ''); // Remove unused safeSend
  content = content.replace(/private readonly queryService[^,]+,\n/g, '');
  return content;
});

// 4. whatsapp-adapter.ts
replaceInFile('src/messaging/whatsapp-adapter.ts', (content) => {
  content = content.replace(/readonly\s+,\n/g, '');
  content = content.replace(/anonymizer\?.hashPhoneNumber/g, 'this.anonymizer.hashPhoneNumber');
  content = content.replace(/isReplyToBot: false,/g, 'mentionsBot: false, isReplyToBot: false,');
  return content;
});

// 5. simulated-client.ts
replaceInFile('src/messaging/simulated-client.ts', (content) => {
  content = content.replace(/this\.emit\('group_join', \{[^}]+\}\);/g, '');
  content = content.replace(/this\.emit\('group_update', \{[^}]+\}\);/g, '');
  content = content.replace(/public onGroupJoin\([^)]+\) \{\n\s*this\.on\('group_join', handler\);\n\s*\}/g, '');
  content = content.replace(/public onGroupChanged\([^)]+\) \{\n\s*this\.on\('group_update', handler\);\n\s*\}/g, '');
  return content;
});

// 6. delete tests
try {
  unlinkSync(join(process.cwd(), 'tests', 'whatsapp-adapter.test.ts'));
  console.log('Deleted tests/whatsapp-adapter.test.ts');
} catch (e) {}

// 7. database.ts
replaceInFile('src/persistence/database.ts', (content) => {
  content = content.replace(/import \{ DEFAULT_POLL_CONFIGURATION \} from '\.\.\/core\/poll-defaults\.js';/g, '');
  return content;
});

// 8. bot-instance.ts
replaceInFile('src/core/bot-instance.ts', (content) => {
  content = content.replace(/import type \{ GroupJoinEvent \} from '\.\.\/messaging\/messaging-client\.js';\n/g, '');
  return content;
});

// 9. multi-bot-manager.ts qrCode fix
replaceInFile('src/core/multi-bot-manager.ts', (content) => {
  content = content.replace(/qrCode: state\.qrCode,/g, '');
  return content;
});

// 10. index.ts connectionManager fix
replaceInFile('src/index.ts', (content) => {
  content = content.replace(/const connectionManager = multiBotManager\.connectionManager\('neurobot'\);\n\s*if \(client === null \|\| connectionManager === null\) \{/g, `if (client === null) {`);
  content = content.replace(/connectionManager,/g, '');
  return content;
});

// 11. admin/server.ts buildAdminServer connectionManager removal
replaceInFile('src/admin/server.ts', (content) => {
  content = content.replace(/connectionManager: ConnectionManager;/g, '');
  return content;
});
