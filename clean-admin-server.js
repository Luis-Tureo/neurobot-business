import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'src/admin/server.ts');
let content = readFileSync(file, 'utf8');

// Remove automatic messages routes entirely
content = content.replace(/app\.get\('\/api\/bots\/:botId\/automatic-messages'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.put\('\/api\/bots\/:botId\/automatic-messages'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.post\('\/api\/bots\/:botId\/automatic-messages\/(welcome|daily-rules)\/templates'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.patch\('\/api\/bots\/:botId\/automatic-messages\/(welcome|daily-rules)\/templates\/:templateId'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.delete\('\/api\/bots\/:botId\/automatic-messages\/(welcome|daily-rules)\/templates\/:templateId'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');

// Also remove test method of moderation
content = content.replace(/app\.post\('\/api\/bots\/:botId\/moderation\/test'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
// And anything left with moderation
content = content.replace(/app\.get\('\/api\/bots\/:botId\/moderation\/export'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.post\('\/api\/bots\/:botId\/moderation\/import'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.delete\('\/api\/bots\/:botId\/moderation\/cases\/:caseId'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.patch\('\/api\/bots\/:botId\/moderation\/cases\/:caseId'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');
content = content.replace(/app\.get\('\/api\/bots\/:botId\/moderation\/cases\/:caseId\/evidence'[\s\S]*?(?=app\.(get|post|delete|patch|put)\('\/api\/bots)/g, '');

content = content.replace(/import type \{ ConnectionManager \} from '\.\.\/core\/connection-manager\.js';\n/g, '');
content = content.replace(/import type \{ AutomaticMessageService \} from '\.\.\/core\/automatic-message-service\.js';\n/g, '');

// Fix QR code access
content = content.replace(/qrAvailable/g, 'qrCode');

writeFileSync(file, content);
console.log('Fixed server.ts');
