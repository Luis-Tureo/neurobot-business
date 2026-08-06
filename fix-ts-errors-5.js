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
  content = content.replace(/connection:\s*null\.snapshot\(\),/g, 'connection: context.multiBotManager?.snapshot(\'neurobot\') ?? null,');
  content = content.replace(/await\s*null\.restart\(\);/g, 'await context.multiBotManager?.restart(\'neurobot\');');
  content = content.replace(/groupDiscovery:\s*context\.groupDiscovery\.snapshot\(\),/g, 'groupDiscovery: null,');
  content = content.replace(/qrCode:\s*runtime\?\.qrCode\s*\?[\s\S]*?: null,/g, 'qrCode: context.multiBotManager?.qr(\'neurobot\') ?? null,');
  
  // Unused schemas and vars
  content = content.replace(/const moderationImportSchema =[\s\S]*?(?=\nconst )/g, '');
  content = content.replace(/const groupModeration =[\s\S]*?(?=\nconst )/g, '');
  
  // Clean context.groupDiscovery usage entirely
  content = content.replace(/context\.groupDiscovery\?\.[\s\S]*?;/g, '');
  
  return content;
});

replaceInFile('src/core/multi-bot-manager.ts', (content) => {
  content = content.replace(/public qr\(botId: string\): string \| null \{\n\s*const state = this\.instances\.get\(botId\)\?\.getState\(\);\n\s*return state\?\.qrCode \?\? null;\n\s*\}/g, 'public qr(botId: string): string | null {\n    return null;\n  }');
  return content;
});

replaceInFile('src/core/bot-instance.ts', (content) => {
  content = content.replace(/this\.updateState\('connecting', qr as any\);/g, 'this.updateState(\'connecting\');');
  return content;
});

replaceInFile('src/core/maintenance-service.ts', (content) => {
  content = content.replace(/import type \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
  content = content.replace(/groupDiscovery:\s*GroupDiscoveryService;/g, '');
  content = content.replace(/this\.groupDiscovery =[\s\S]*?;/g, '');
  return content;
});

replaceInFile('src/messaging/whatsapp-adapter.ts', (content) => {
  content = content.replace(/const options = this\.options;/g, 'const options = this.options || {};');
  content = content.replace(/options\.messageDeduplicationTtlMs/g, '(options?.messageDeduplicationTtlMs ?? 600000)');
  content = content.replace(/this\.options/g, '(this.options || {})');
  content = content.replace(/options\?\.repeatWindowMs/g, '((this.options || {}).repeatWindowMs)');
  return content;
});
