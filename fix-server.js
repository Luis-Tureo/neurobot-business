import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'src', 'admin', 'server.ts');
let content = readFileSync(file, 'utf8');

// Remove imports
content = content.replace(/import \{[^}]+\}\s+from '\.\.\/core\/welcome-personalization\.js';/g, '');
content = content.replace(/import \{ LocalModerationEngine \} from '\.\.\/moderation\/local-moderation-engine\.js';/g, '');
content = content.replace(/import \{ normalizeModerationConfigurationValue \} from '\.\.\/moderation\/moderation-service\.js';/g, '');
content = content.replace(/import \{ GroupModerationService \} from '\.\.\/moderation\/group-moderation-service\.js';/g, '');

// Remove multiBotManager.forgetAdminPhoneNumber
content = content.replace(/context\.multiBotManager\?.forgetAdminPhoneNumber\(botId\);/g, '');
content = content.replace(/context\.multiBotManager\.adminPhoneNumber\(botId\)/g, 'null');

// Fix qrAvailable
content = content.replace(/runtime\?\.qrAvailable/g, 'runtime?.qrCode !== null');

// Remove moderationService, pollRepository, pollService, pollScheduler
content = content.replace(/const service=context\.multiBotManager\?\.moderationService\(botId\);/g, 'const service = null;');
content = content.replace(/const repository = context\.multiBotManager\?\.pollRepository\(botId\) \?\?[\s\S]*?null\);/g, 'const repository = null;');
content = content.replace(/const service = context\.multiBotManager\?\.pollService\(botId\);/g, 'const service = null;');
content = content.replace(/const scheduler = context\.multiBotManager\?\.pollScheduler\(botId\);/g, 'const scheduler = null;');

// Fix schema usages
content = content.replace(/validateWelcomeTemplate/g, '((v: string) => true)');
content = content.replace(/sanitizeWhatsAppDisplayName/g, '((v: string) => v)');

writeFileSync(file, content);
console.log('Fixed server.ts');
