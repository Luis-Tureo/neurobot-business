import { copyFileSync } from 'node:fs';

const filesToRestore = [
  'src/core/bot-instance.ts',
  'src/core/multi-bot-manager.ts',
  'src/core/message-processor.ts',
  'src/core/maintenance-service.ts',
  'src/core/rule-based-response-provider.ts',
  'src/index.ts',
  'src/messaging/simulated-client.ts',
  'src/messaging/whatsapp-adapter.ts',
  'src/messaging/whatsapp-cloud-api-adapter.ts',
  'src/domain/types.ts',
  'src/core/conversation-flow-service.ts'
];

for (const f of filesToRestore) {
  try {
    copyFileSync(`C:\\Users\\lture\\Documents\\GitHub\\asistente-comunidad-neurodivergente\\${f}`, f);
    console.log(`Restored ${f}`);
  } catch(e) {
    console.error(`Error restoring ${f}:`, e.message);
  }
}
