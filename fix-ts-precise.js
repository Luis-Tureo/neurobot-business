import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function replaceInFile(relativePath, replacements) {
  const file = join(process.cwd(), relativePath);
  try {
    let content = readFileSync(file, 'utf8');
    let modified = false;
    for (const [search, replace] of replacements) {
      if (typeof search === 'string') {
        if (content.includes(search)) {
          content = content.replaceAll(search, replace);
          modified = true;
        }
      } else {
        if (search.test(content)) {
          content = content.replace(search, replace);
          modified = true;
        }
      }
    }
    if (modified) {
      writeFileSync(file, content);
      console.log(`Updated ${relativePath}`);
    }
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

// 1. multi-bot-manager.ts
replaceInFile('src/core/multi-bot-manager.ts', [
  [/import \{ GroupDiscoveryService \} from '\.\.\/core\/group-discovery\.js';\s*/, ''],
  [/import type \{ ConnectionManager \} from '\.\.\/core\/connection-manager\.js';\s*/, ''],
  [/import type \{ AutomaticMessageService \} from '\.\.\/core\/automatic-message-service\.js';\s*/, ''],
  [/import type \{ PollRepository \} from '\.\.\/core\/poll-repository\.js';\s*/, ''],
  [/import type \{ PollScheduler \} from '\.\.\/core\/poll-scheduler\.js';\s*/, ''],
  [/import type \{ PollService \} from '\.\.\/core\/poll-service\.js';\s*/, ''],
  [/import type \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\s*/, ''],
  [/import type \{ AdminServerContext \} from '\.\.\/admin\/server\.js';\s*/, ''],
  [/public readonly connectionManager\?: ConnectionManager;\s*/, ''],
  [/public readonly groupDiscovery\?: GroupDiscoveryService;\s*/, ''],
  [/public readonly automaticMessageService\?: AutomaticMessageService;\s*/, ''],
  [/public readonly pollDataRepository\?: PollRepository;\s*/, ''],
  [/public readonly pollSendingService\?: PollService;\s*/, ''],
  [/public readonly pollTaskScheduler\?: PollScheduler;\s*/, ''],
  [/public readonly moderationService\?: ModerationService;\s*/, ''],
  [/this\.connectionManager = bot\.connectionManager;\s*/, ''],
  [/this\.groupDiscovery = bot\.groupDiscovery;\s*/, ''],
  [/this\.automaticMessageService = bot\.automaticMessageService;\s*/, ''],
  [/this\.pollDataRepository = bot\.pollDataRepository;\s*/, ''],
  [/this\.pollSendingService = bot\.pollSendingService;\s*/, ''],
  [/this\.pollTaskScheduler = bot\.pollTaskScheduler;\s*/, ''],
  [/this\.moderationService = bot\.moderationService;\s*/, ''],
  [/await instance\.groupDiscovery\?.stop\(\);\s*/, ''],
  [/await instance\.pollTaskScheduler\?.stop\(\);\s*/, ''],
  [/await instance\.connectionManager\?.disconnect\(\);\s*/, ''],
  [/public adminPhoneNumber\(botId: string\): string \| null \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return null;\s*return instance\.adminPhoneNumber;\s*\}\s*/, ''],
  [/connectionManager: instance\.connectionManager\?\.snapshot\(\) \?\? null,\s*/, ''],
  [/groupDiscovery: instance\.groupDiscovery\?\.snapshot\(\) \?\? null,\s*/, ''],
  [/export type MultiBotManagerSnapshot = \{\s*bots: Array<\{[\s\S]*?\}>\s*\};\s*/, ''],
  [/public qr\(botId: string\): string \| null \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return null;\s*return instance\.qr;\s*\}\s*/, ''],
  [/public messagingClient\(botId: string\): MessagingClient \| null \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return null;\s*return instance\.messagingClient;\s*\}\s*/, ''],
  [/public resetTransientState\(botId: string\): void \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return;\s*instance\.resetTransientState\(\);\s*\}\s*/, ''],
  [/connectionManager: instance\.connectionManager,\s*/, ''],
  [/groupDiscovery: instance\.groupDiscovery,\s*/, ''],
  [/automaticMessageService: instance\.automaticMessageService,\s*/, ''],
  [/pollDataRepository: instance\.pollDataRepository,\s*/, ''],
  [/pollSendingService: instance\.pollSendingService,\s*/, ''],
  [/pollTaskScheduler: instance\.pollTaskScheduler,\s*/, ''],
  [/aiRequestQueue: instance\.aiRequestQueue,\s*/, ''],
  [/adminPhoneNumber: instance\.adminPhoneNumber,\s*/, ''],
  [/snapshot: instance\.snapshot\(\),\s*/, ''],
  [/qr: instance\.qr,\s*/, ''],
  [/messagingClient: instance\.messagingClient,\s*/, ''],
  [/instance\.restart\(\);/g, 'instance.start();'],
]);

// 2. server.ts
replaceInFile('src/admin/server.ts', [
  [/import type \{ ConnectionManager \} from '\.\.\/core\/connection-manager\.js';\s*/, ''],
  [/import type \{ AutomaticMessageService \} from '\.\.\/core\/automatic-message-service\.js';\s*/, ''],
  [/import type \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\s*/, ''],
  [/import \{ GroupModerationService \} from '\.\.\/moderation\/group-moderation-service\.js';\s*/, ''],
  [/connectionManager\?: ConnectionManager;\s*/, ''],
  [/groupDiscovery\?: GroupDiscoveryService;\s*/, ''],
]);

// 3. bot-instance.ts
replaceInFile('src/core/bot-instance.ts', [
  // Fix TS2345 (Anonymizer not assignable to AssistantQueryService)
  // this is probably `new AssistantQueryService(this.database, ...)` where arguments shifted.
  // Actually, wait, let me leave bot-instance for manual fixing if it's complex.
]);

// 4. maintenance-service.ts
replaceInFile('src/core/maintenance-service.ts', [
  [/await this\.groupDiscovery\.runMaintenance\(\);\s*/g, ''],
  [/public async runGroupDiscoveryMaintenance\(\) \{\s*await this\.groupDiscovery\.runMaintenance\(\);\s*\}\s*/g, ''],
]);

// 5. connection-manager.ts
replaceInFile('src/core/connection-manager.ts', [
  [/lastErrorCode: this\.lastErrorCode,/g, 'lastErrorCode: this.lastErrorCode,\n      qrCode: null,\n      phoneNumber: null,']
]);

// 6. message-processor.ts
replaceInFile('src/core/message-processor.ts', [
  [/import type \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\s*/g, ''],
  [/private readonly moderationService\?: ModerationService,\s*/g, ''],
  [/chatIdMe/g, 'chatId'], // Fix chatIdMe typo from community code? Or just `chatId`
]);

// 7. whatsapp-adapter.ts
replaceInFile('src/messaging/whatsapp-adapter.ts', [
  [/import \{ personalizeWelcomeMessage \} from '\.\.\/core\/welcome-personalization\.js';\s*/g, ''],
  [/import type \{[\s\S]*?DetectedGroup,[\s\S]*?GroupListSource,[\s\S]*?NativePoll,[\s\S]*?\} from '\.\.\/domain\/types\.js';\s*/g, "import type { BotMode, ConnectionState, IncomingMessage } from '../domain/types.js';\n"],
  [/public onGroupJoin\?: \(groupId: string, metadata: \{ subject: string \} \| null\) => void;\s*/g, ''],
  [/public onGroupChanged\?: \(groupId: string, metadata: \{ subject: string \} \| null\) => void;\s*/g, ''],
  [/this\.events\.onGroupJoin\?.*/g, ''],
  [/this\.events\.onGroupChanged\?.*/g, ''],
  [/mentionsBot: false,/g, 'mentionsBot: false, isReplyToBot: false,'],
  [/isReplyToBot: false,/g, ''], // avoid duplicate if it was already there
]);

// 8. whatsapp-cloud-api-adapter.ts
replaceInFile('src/messaging/whatsapp-cloud-api-adapter.ts', [
  [/import type \{[\s\S]*?DetectedGroup,[\s\S]*?NativePoll[\s\S]*?\} from '\.\.\/domain\/types\.js';\s*/g, "import type { BotMode, ConnectionState, IncomingMessage } from '../domain/types.js';\n"],
]);

// 9. simulated-client.ts
replaceInFile('src/messaging/simulated-client.ts', [
  [/import type \{[\s\S]*?DetectedGroup,[\s\S]*?GroupListSource,[\s\S]*?NativePoll,[\s\S]*?\} from '\.\.\/domain\/types\.js';\s*/g, "import type { BotMode, ConnectionState, IncomingMessage } from '../domain/types.js';\n"],
  [/public onGroupJoin\?: \(groupId: string, metadata: \{ subject: string \} \| null\) => void;\s*/g, ''],
  [/public onGroupChanged\?: \(groupId: string, metadata: \{ subject: string \} \| null\) => void;\s*/g, ''],
]);

// 10. database.ts
replaceInFile('src/persistence/database.ts', [
  [/import \{ DEFAULT_POLL_TEMPLATES \} from '\.\.\/core\/poll-defaults\.js';\s*/g, ''],
  [/import type \{[\s\S]*?DetectedGroup,[\s\S]*?HiddenPollTemplate,[\s\S]*?PollConfiguration,[\s\S]*?PollDeliverySource,[\s\S]*?PollDeliveryStatus,[\s\S]*?PollSelectionMode,[\s\S]*?PollTemplate,[\s\S]*?\} from '\.\.\/domain\/types\.js';\s*/g, "import type { AppConfiguration, AssistantProfile, BotMode, BotRecord, ConversationStatus, CustomerIdentity, InteractionRecord, ParticipantRole } from '../domain/types.js';\n"],
  [/source: typeof raw\.source === 'string' \? \(raw\.source as PollDeliverySource\) : 'SCHEDULED',\s*/g, ''],
]);
