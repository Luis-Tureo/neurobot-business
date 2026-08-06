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

replaceInFile('src/core/bot-instance.ts', (content) => {
  content = content.replace(/onQrCode:/g, 'onQr:');
  content = content.replace(/'qr_ready'/g, "'waiting_qr'");
  content = content.replace(/'connecting'/g, "'initializing'");
  return content;
});

replaceInFile('src/messaging/whatsapp-adapter.ts', (content) => {
  content = content.replace(/\(options\?\.messageDeduplicationTtlMs \?\? 600000\) \?\? 10 \* 60 \* 1000/g, 'options?.messageDeduplicationTtlMs ?? 600000');
  return content;
});

replaceInFile('src/messaging/simulated-client.ts', (content) => {
  content = content.replace(/onGroupJoin: \(\) => \{\},\n/g, '');
  content = content.replace(/onGroupChanged: \(\) => \{\},\n/g, '');
  return content;
});
