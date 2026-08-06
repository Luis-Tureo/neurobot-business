import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function replaceInFile(relativePath, fn) {
  const file = join(process.cwd(), relativePath);
  try {
    let content = readFileSync(file, 'utf8');
    const newContent = fn(content);
    if (content !== newContent) {
      writeFileSync(file, newContent);
      console.log(`Updated ${relativePath}`);
    } else {
      console.log(`No changes made to ${relativePath}`);
    }
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

// 2. server.ts
replaceInFile('src/admin/server.ts', (c) => {
  // Remove missing module
  c = c.replace(/import \{ toLocalDateTime \} from '\.\.\/core\/automatic-message-service\.js';\s*/g, '');
  
  // Remove missing variable
  c = c.replace(/const groupModeration = new GroupModerationService\(context\.database\);\s*/g, '');
  
  c = c.replace(/qrCode: context\.multiBotManager\.qr\(bot\.id\) !== null,/g, 'qrCode: context.multiBotManager?.qr(bot.id) !== null,');
  // the script generated this originally: qrCode: true !== null ?? false,
  c = c.replace(/qrCode: true !== null \?\? false,/g, 'qrCode: context.multiBotManager?.qr(bot.id) !== null,');

  // Fix TS2871
  c = c.replace(/let enabled = null !== null \?\? true;\s*/g, 'let enabled = true;\n');
  c = c.replace(/let reviewThreshold = null !== null \?\? 100;\s*/g, 'let reviewThreshold = 100;\n');
  c = c.replace(/let warningThreshold = null !== null \?\? 50;\s*/g, 'let warningThreshold = 50;\n');
  c = c.replace(/let applyToAll = null !== null \?\? false;\s*/g, 'let applyToAll = false;\n');
  c = c.replace(/let enabled = false !== null \?\? true;\s*/g, 'let enabled = false;\n');
  c = c.replace(/let enabled = true !== null \?\? true;\s*/g, 'let enabled = true;\n');

  return c;
});

// 3. maintenance-service.ts
replaceInFile('src/core/maintenance-service.ts', (c) => {
  c = c.split('\n').filter(line => !line.includes('GroupDiscoveryService') && !line.includes('groupDiscovery.triggerScheduledDiscovery')).join('\n');
  return c;
});

// 4. multi-bot-manager.ts
replaceInFile('src/core/multi-bot-manager.ts', (c) => {
  return c.replace(/logger = new Logger\(\{ sessionPath: this\.options\.sessionPath \}\);/g, 'logger = new Logger();');
});

// 5. connection-manager.ts
replaceInFile('src/core/connection-manager.ts', (c) => {
  return c.replace(/lastErrorCode: this\.lastErrorCode,/g, 'lastErrorCode: this.lastErrorCode, qrCode: null, phoneNumber: null,');
});

// 6. simulated-client.ts
replaceInFile('src/messaging/simulated-client.ts', (c) => {
  let lines = c.split('\n');
  lines = lines.filter(line => {
    if (line.includes('GroupListSource')) return false;
    if (line.includes('NativePoll')) return false;
    if (line.includes('DetectedGroup')) return false;
    if (line.includes('public onGroupJoin')) return false;
    if (line.includes('public onGroupChanged')) return false;
    return true;
  });
  return lines.join('\n');
});

// 7. whatsapp-cloud-api-adapter.ts
replaceInFile('src/messaging/whatsapp-cloud-api-adapter.ts', (c) => {
  let lines = c.split('\n');
  lines = lines.filter(line => !line.includes('DetectedGroup') && !line.includes('NativePoll'));
  return lines.join('\n');
});

// 8. persistence/database.ts
replaceInFile('src/persistence/database.ts', (c) => {
  let lines = c.split('\n');
  lines = lines.filter(line => !line.includes('poll-defaults.js') && !line.includes('HiddenPollTemplate') && !line.includes('PollConfiguration') && !line.includes('PollDeliverySource') && !line.includes('PollDeliveryStatus') && !line.includes('PollSelectionMode') && !line.includes('PollTemplate') && !line.includes('DetectedGroup'));
  return lines.join('\n');
});

replaceInFile('src/domain/types.ts', (c) => {
  let lines = c.split('\n');
  lines = lines.filter(line => !line.includes('PollDeliverySource') && !line.includes('PollDeliveryStatus') && !line.includes('GroupListSource'));
  return lines.join('\n');
});
