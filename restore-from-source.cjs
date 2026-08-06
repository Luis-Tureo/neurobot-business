/**
 * restore-from-source.cjs
 * Restores damaged files by copying from the community repo source and removing community-only code.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = 'C:\\Users\\lture\\Documents\\GitHub\\asistente-comunidad-neurodivergente';
const TARGET = 'C:\\Users\\lture\\Documents\\GitHub\\neurobot-business';

function copy(relPath) {
  const src = path.join(SOURCE, relPath);
  const dst = path.join(TARGET, relPath);
  if (!fs.existsSync(src)) {
    console.log(`SKIP (not found in source): ${relPath}`);
    return;
  }
  const content = fs.readFileSync(src, 'utf8');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, content, 'utf8');
  console.log(`COPIED: ${relPath}`);
  return content;
}

// Files to restore from source (community → business, then strip community features)
const filesToRestore = [
  'src/core/connection-manager.ts',
  'src/core/conversation-flow-service.ts',
  'src/core/bot-instance.ts',
  'src/core/maintenance-service.ts',
  'src/core/message-processor.ts',
  'src/messaging/whatsapp-adapter.ts',
  'src/messaging/whatsapp-cloud-api-adapter.ts',
  'src/ai/assistant-query-service.ts',
];

for (const f of filesToRestore) {
  copy(f);
}

console.log('\nDone. Now run npm run typecheck to see remaining errors.');
