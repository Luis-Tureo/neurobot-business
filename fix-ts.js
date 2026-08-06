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
    } else {
      console.log(`No changes made to ${relativePath}`);
    }
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

// 1. types.ts
replaceInFile('src/domain/types.ts', (c) => {
  c = c.replace(/export type DetectedGroup = \{[\s\S]*?\};/g, '');
  c = c.replace(/export type DailyPollInteraction = \{[\s\S]*?\};/g, '');
  return c;
});

// 2. server.ts
replaceInFile('src/admin/server.ts', (c) => {
  // Remove missing module
  c = c.replace(/import \{ toLocalDateTime \} from '\.\.\/core\/automatic-message-service\.js';\n/g, '');
  
  // Remove missing variable
  c = c.replace(/const groupModeration = new GroupModerationService\(context\.database\);\n/g, '');
  
  // Fix TS2869
  c = c.replace(/qrCode: true !== null \?\? false,/g, 'qrCode: context.multiBotManager.qr(bot.id) !== null,');
  
  // Fix TS2871
  c = c.replace(/let enabled = null !== null \?\? true;\n/g, 'let enabled = true;\n');
  c = c.replace(/let reviewThreshold = null !== null \?\? 100;\n/g, 'let reviewThreshold = 100;\n');
  c = c.replace(/let warningThreshold = null !== null \?\? 50;\n/g, 'let warningThreshold = 50;\n');
  c = c.replace(/let applyToAll = null !== null \?\? false;\n/g, 'let applyToAll = false;\n');

  return c;
});

// 3. maintenance-service.ts
replaceInFile('src/core/maintenance-service.ts', (c) => {
  // TS2304: Cannot find name 'GroupDiscoveryService'
  // Remove block
  c = c.replace(/const groupDiscovery = new GroupDiscoveryService\(this\.database, this\.multiBotManager\);\n\s*await groupDiscovery\.triggerScheduledDiscovery\(\);\n/g, '');
  return c;
});

// 4. multi-bot-manager.ts
replaceInFile('src/core/multi-bot-manager.ts', (c) => {
  // sessionPath does not exist in Logger
  c = c.replace(/logger = new Logger\(\{ sessionPath: this\.options\.sessionPath \}\);/g, 'logger = new Logger();');
  // qrCode access is fine once types.ts is fixed, but let's check
  return c;
});

// 5. simulated-client.ts
replaceInFile('src/messaging/simulated-client.ts', (c) => {
  c = c.replace(/GroupListSource,\n/g, '');
  c = c.replace(/NativePoll,\n/g, '');
  c = c.replace(/public onGroupJoin\(\) \{\}\n/g, '');
  c = c.replace(/public onGroupChanged\(\) \{\}\n/g, '');
  return c;
});

// 6. whatsapp-adapter.ts
replaceInFile('src/messaging/whatsapp-adapter.ts', (c) => {
  // Add mentionsBot, isReplyToBot to the fake message in getMockMessage
  c = c.replace(/isBroadcast: false,/g, 'isBroadcast: false,\n      mentionsBot: false,\n      isReplyToBot: false,');
  return c;
});

// 7. whatsapp-cloud-api-adapter.ts
replaceInFile('src/messaging/whatsapp-cloud-api-adapter.ts', (c) => {
  c = c.replace(/, NativePoll/g, '');
  return c;
});

// 8. persistence/database.ts
replaceInFile('src/persistence/database.ts', (c) => {
  c = c.replace(/import \{ DEFAULT_POLL_TEMPLATES \} from '\.\.\/core\/poll-defaults\.js';\n/g, '');
  
  // Remove missing types from imports
  c = c.replace(/HiddenPollTemplate,\n/g, '');
  c = c.replace(/PollConfiguration,\n/g, '');
  c = c.replace(/PollDeliverySource,\n/g, '');
  c = c.replace(/PollDeliveryStatus,\n/g, '');
  c = c.replace(/PollSelectionMode,\n/g, '');
  c = c.replace(/PollTemplate,\n/g, '');
  
  // Remove method returning them
  c = c.replace(/public getPollTemplates\([\s\S]*?\}\n/g, '');
  c = c.replace(/public deletePollTemplate\([\s\S]*?\}\n/g, '');
  
  return c;
});
