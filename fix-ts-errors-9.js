import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function replaceInFile(relativePath, replacer) {
  const file = join(process.cwd(), relativePath);
  try {
    let content = readFileSync(file, 'utf8');
    const newContent = replacer(content);
    if (content !== newContent) {
      writeFileSync(file, newContent);
      console.log(`Updated ${relativePath}`);
    }
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

replaceInFile('src/admin/server.ts', (content) => {
  content = content.replace(/import type \{ AutomaticMessageService \} from '\.\.\/core\/automatic-message-service\.js';\n/g, '');
  content = content.replace(/const groupModeration: GroupModerationService = undefined as any;\n/g, '');
  content = content.replace(/botId: request\.params\.botId \?\? 'neurobot',/g, 'botId: request.params.botId,');
  content = content.replace(/qrCode: connection\?\.qrCode \?\? null,/g, 'qrCode: null,');
  
  // Try to remove lines 2533, 2539, 2541, 2586 (which are probably inside the remaining poll/automatic message routes)
  // Let's just remove the rest of the poll and automatic messages routes that might have been left behind.
  content = content.replace(/app\.patch\(\n\s*'\/api\/polls\/templates\/:id',\n[\s\S]*?(?=\n\s*app\.(get|post|delete|patch|put))/g, '');
  content = content.replace(/app\.post\(\n\s*'\/api\/polls\/templates',\n[\s\S]*?(?=\n\s*app\.(get|post|delete|patch|put))/g, '');
  content = content.replace(/app\.delete\(\n\s*'\/api\/polls\/templates\/:id',\n[\s\S]*?(?=\n\s*app\.(get|post|delete|patch|put))/g, '');
  content = content.replace(/app\.post\(\n\s*'\/api\/polls\/send-test',\n[\s\S]*?(?=\n\s*app\.(get|post|delete|patch|put))/g, '');
  content = content.replace(/app\.post\(\n\s*'\/api\/polls\/send',\n[\s\S]*?(?=\n\s*app\.(get|post|delete|patch|put))/g, '');
  
  return content;
});

replaceInFile('src/core/bot-instance.ts', (content) => {
  content = content.replace(/, qrCode: this\.latestQr/g, '');
  return content;
});

replaceInFile('src/core/maintenance-service.ts', (content) => {
  content = content.replace(/import type \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
  return content;
});

replaceInFile('src/core/multi-bot-manager.ts', (content) => {
  content = content.replace(/sessionPath: 'disabled',\n/g, '');
  content = content.replace(/return state\?\.qrCode \?\? null;/g, 'return null;');
  return content;
});

replaceInFile('src/messaging/simulated-client.ts', (content) => {
  content = content.replace(/onGroupJoin: \(\) => \{\},\n/g, '');
  content = content.replace(/onGroupChanged: \(\) => \{\},\n/g, '');
  return content;
});

replaceInFile('src/messaging/whatsapp-adapter.ts', (content) => {
  content = content.replace(/isBroadcast: false;/g, 'isBroadcast: false, mentionsBot: false, isReplyToBot: false;');
  return content;
});

replaceInFile('src/persistence/database.ts', (content) => {
  content = content.replace(/import \{ DEFAULT_POLL_CONFIGURATION \} from '\.\.\/core\/poll-defaults\.js';\n/g, '');
  return content;
});
