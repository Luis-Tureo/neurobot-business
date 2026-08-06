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

replaceInFile('src/admin/server.ts', (content) => {
  // Delete all lines from line 2272 to 2808
  const lines = content.split('\n');
  const newLines = [];
  
  let inAutomaticMessagesOrPollsBlock = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("app.get('/api/automatic-messages'")) {
      inAutomaticMessagesOrPollsBlock = true;
    }
    
    if (line.includes("app.post(") && lines[i+1]?.includes("'/api/connection/restart'")) {
      inAutomaticMessagesOrPollsBlock = false;
    }
    
    if (!inAutomaticMessagesOrPollsBlock) {
      newLines.push(line);
    }
  }
  
  content = newLines.join('\n');
  
  // Fix 'automatic-message-service.js'
  content = content.replace(/import type \{ AutomaticMessageService \} from '\.\.\/core\/automatic-message-service\.js';\n/, '');
  
  return content;
});

replaceInFile('src/core/bot-instance.ts', (content) => {
  // Fix unused vars
  content = content.replace(/import \{ canonicalPhoneIdentity \} from '\.\.\/domain\/phone\.js';\n/, '');
  content = content.replace(/const normalizedIdentity = [\s\S]*?;\n/, '');
  content = content.replace(/private readonly client: MessagingClient,/, 'client: MessagingClient,');
  content = content.replace(/private readonly logger: Logger,/, 'logger: Logger,');
  content = content.replace(/onQrCode: \(qr\) => \{\n\s*this\.updateState\('connecting'\);\n\s*\},\n/g, '');
  content = content.replace(/this\.updateState\('qr_ready'\)/g, 'this.updateState(\'waiting_qr\')');
  content = content.replace(/this\.updateState\('connecting'\)/g, 'this.updateState(\'reconnecting\')');
  content = content.replace(/qrCode: null,\n/g, '');
  return content;
});

replaceInFile('src/core/message-processor.ts', (content) => {
  content = content.replace(/const safeSend = /g, 'const _safeSend = ');
  return content;
});

replaceInFile('src/core/multi-bot-manager.ts', (content) => {
  content = content.replace(/sessionPath: 'disabled',\n/g, '');
  content = content.replace(/botId: string/g, 'botId: string = ""');
  return content;
});

replaceInFile('src/messaging/simulated-client.ts', (content) => {
  content = content.replace(/onGroupJoin: \(\) => \{\},\n/g, '');
  content = content.replace(/onGroupChanged: \(\) => \{\},\n/g, '');
  return content;
});

replaceInFile('src/messaging/whatsapp-adapter.ts', (content) => {
  content = content.replace(/import type \{ Anonymizer \} from '\.\.\/core\/anonymizer\.js';\n/g, '');
  content = content.replace(/import \{ canonicalPhoneIdentity, classifyWhatsAppId \} from '\.\.\/domain\/phone\.js';\n/g, '');
  content = content.replace(/import \{ isParticipantId \} from '\.\.\/domain\/types\.js';\n/g, '');
  content = content.replace(/import \{ describeMessageIdStructure \} from '\.\.\/domain\/metadata\.js';\n/g, '');
  content = content.replace(/private readonly messageIdentityResolver/g, 'public messageIdentityResolver');
  content = content.replace(/private readonly anonymizer: any,/g, 'anonymizer: any,');
  content = content.replace(/this\.anonymizer\.hashPhoneNumber/g, 'anonymizer.hashPhoneNumber');
  content = content.replace(/this\.registerHandlers\(this\.client, this\.generation\);/g, 'this.registerHandlers(client, generation);');
  content = content.replace(/this\.client\.removeListener/g, 'client.removeListener');
  return content;
});

replaceInFile('src/persistence/database.ts', (content) => {
  content = content.replace(/import \{ DEFAULT_POLL_CONFIGURATION \} from '\.\.\/core\/poll-defaults\.js';\n/g, '');
  return content;
});
