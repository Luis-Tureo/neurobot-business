import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function fixFile(relativePath, replacements) {
  const file = join(process.cwd(), relativePath);
  try {
    let content = readFileSync(file, 'utf8');
    for (const [search, replace] of replacements) {
      if (typeof search === 'string') {
        content = content.replaceAll(search, replace);
      } else {
        content = content.replace(search, replace);
      }
    }
    writeFileSync(file, content);
    console.log(`Updated ${relativePath}`);
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

// 1. src/core/bot-instance.ts
// `new AssistantQueryService(this.database, this.aiProvider, this.anonymizer, this.logger);` or similar
fixFile('src/core/bot-instance.ts', [
  [/new AssistantQueryService\([\s\S]*?\)/, "new AssistantQueryService(this.database, this.aiProvider, this.anonymizer, this.logger)"],
]);

// 2. src/core/maintenance-service.ts
fixFile('src/core/maintenance-service.ts', [
  [/await this\.groupDiscovery\.runMaintenance\(\);\s*/g, ''],
  [/public async runGroupDiscoveryMaintenance\(\) \{\s*await this\.groupDiscovery\.runMaintenance\(\);\s*\}\s*/g, ''],
]);

// 3. src/core/message-processor.ts
fixFile('src/core/message-processor.ts', [
  [/import type \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\s*/g, ''],
  [/private readonly moderationService\?: ModerationService,\s*/g, ''],
  [/if \(this\.moderationService\) \{\s*await this\.moderationService\.processMessage\(message, metadata\);\s*\}\s*/g, ''],
]);

// 4. src/core/multi-bot-manager.ts
fixFile('src/core/multi-bot-manager.ts', [
  [/import \{ GroupDiscoveryService \} from '\.\.\/core\/group-discovery\.js';\s*/g, ''],
  [/import type \{ ConnectionManager \} from '\.\.\/core\/connection-manager\.js';\s*/g, ''],
  [/import type \{ AutomaticMessageService \} from '\.\.\/core\/automatic-message-service\.js';\s*/g, ''],
  [/import type \{ PollRepository \} from '\.\.\/core\/poll-repository\.js';\s*/g, ''],
  [/import type \{ PollScheduler \} from '\.\.\/core\/poll-scheduler\.js';\s*/g, ''],
  [/import type \{ PollService \} from '\.\.\/core\/poll-service\.js';\s*/g, ''],
  [/import type \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\s*/g, ''],
  [/public readonly connectionManager\?: ConnectionManager;\s*/g, ''],
  [/public readonly groupDiscovery\?: GroupDiscoveryService;\s*/g, ''],
  [/public readonly automaticMessageService\?: AutomaticMessageService;\s*/g, ''],
  [/public readonly pollDataRepository\?: PollRepository;\s*/g, ''],
  [/public readonly pollSendingService\?: PollService;\s*/g, ''],
  [/public readonly pollTaskScheduler\?: PollScheduler;\s*/g, ''],
  [/public readonly moderationService\?: ModerationService;\s*/g, ''],
  [/this\.connectionManager = bot\.connectionManager;\s*/g, ''],
  [/this\.groupDiscovery = bot\.groupDiscovery;\s*/g, ''],
  [/this\.automaticMessageService = bot\.automaticMessageService;\s*/g, ''],
  [/this\.pollDataRepository = bot\.pollDataRepository;\s*/g, ''],
  [/this\.pollSendingService = bot\.pollSendingService;\s*/g, ''],
  [/this\.pollTaskScheduler = bot\.pollTaskScheduler;\s*/g, ''],
  [/this\.moderationService = bot\.moderationService;\s*/g, ''],
  [/await instance\.groupDiscovery\?.stop\(\);\s*/g, ''],
  [/await instance\.pollTaskScheduler\?.stop\(\);\s*/g, ''],
  [/await instance\.connectionManager\?.disconnect\(\);\s*/g, ''],
  [/public adminPhoneNumber\(botId: string\): string \| null \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return null;\s*return instance\.adminPhoneNumber;\s*\}\s*/g, ''],
  [/connectionManager: instance\.connectionManager\?\.snapshot\(\) \?\? null,\s*/g, ''],
  [/groupDiscovery: instance\.groupDiscovery\?\.snapshot\(\) \?\? null,\s*/g, ''],
  [/public qr\(botId: string\): string \| null \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return null;\s*return instance\.qr;\s*\}\s*/g, ''],
  [/public messagingClient\(botId: string\): MessagingClient \| null \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return null;\s*return instance\.messagingClient;\s*\}\s*/g, ''],
  [/public resetTransientState\(botId: string\): void \{\s*const instance = this\.instances\.get\(botId\);\s*if \(\!instance\) return;\s*instance\.resetTransientState\(\);\s*\}\s*/g, ''],
  [/connectionManager: instance\.connectionManager,\s*/g, ''],
  [/groupDiscovery: instance\.groupDiscovery,\s*/g, ''],
  [/automaticMessageService: instance\.automaticMessageService,\s*/g, ''],
  [/pollDataRepository: instance\.pollDataRepository,\s*/g, ''],
  [/pollSendingService: instance\.pollSendingService,\s*/g, ''],
  [/pollTaskScheduler: instance\.pollTaskScheduler,\s*/g, ''],
  [/aiRequestQueue: instance\.aiRequestQueue,\s*/g, ''],
  [/adminPhoneNumber: instance\.adminPhoneNumber,\s*/g, ''],
  [/snapshot: instance\.snapshot\(\),\s*/g, ''],
  [/qr: instance\.qr,\s*/g, ''],
  [/messagingClient: instance\.messagingClient,\s*/g, ''],
  [/instance\.restart\(\);/g, 'instance.start();'],
]);

// 5. src/index.ts
fixFile('src/index.ts', [
  [/connectionManager,\s*groupDiscovery,\s*/g, ''],
]);

// 6. src/messaging/simulated-client.ts
fixFile('src/messaging/simulated-client.ts', [
  [/body: string;/g, 'text: string;'],
  [/body, /g, 'text, '],
  [/chatId, text, replyToMessageId/g, 'chatId, text, ...(replyToMessageId === undefined ? {} : { replyToMessageId })'],
]);

// 7. src/messaging/whatsapp-adapter.ts
fixFile('src/messaging/whatsapp-adapter.ts', [
  [/import \{ personalizeWelcomeMessage \} from '\.\.\/core\/welcome-personalization\.js';\s*/g, ''],
  [/import type \{\s*BotMode,\s*ConnectionState,\s*DetectedGroup,\s*GroupListSource,\s*IncomingMessage,\s*NativePoll,\s*\} from '\.\.\/domain\/types\.js';\s*/g, "import type { BotMode, ConnectionState, IncomingMessage } from '../domain/types.js';\n"],
  [/public onGroupJoin\?: \(groupId: string, metadata: \{ subject: string \} \| null\) => void;\s*/g, ''],
  [/public onGroupChanged\?: \(groupId: string, metadata: \{ subject: string \} \| null\) => void;\s*/g, ''],
  [/this\.events\.onGroupJoin\?.*/g, ''],
  [/this\.events\.onGroupChanged\?.*/g, ''],
  [/mentionsBot: false,/g, 'mentionsBot: false, isReplyToBot: false,'],
]);

// 8. src/persistence/database.ts
fixFile('src/persistence/database.ts', [
  [/import \{ DEFAULT_POLL_TEMPLATES \} from '\.\.\/core\/poll-defaults\.js';\s*/g, ''],
  [/import type \{\s*AppConfiguration,\s*AssistantProfile,\s*BotMode,\s*BotRecord,\s*ConversationStatus,\s*CustomerIdentity,\s*DetectedGroup,\s*HiddenPollTemplate,\s*InteractionRecord,\s*ParticipantRole,\s*PollConfiguration,\s*PollDeliverySource,\s*PollDeliveryStatus,\s*PollSelectionMode,\s*PollTemplate,\s*\} from '\.\.\/domain\/types\.js';\s*/g, "import type { AppConfiguration, AssistantProfile, BotMode, BotRecord, ConversationStatus, CustomerIdentity, InteractionRecord, ParticipantRole } from '../domain/types.js';\n"],
  [/source: typeof raw\.source === 'string' \? \(raw\.source as PollDeliverySource\) : 'SCHEDULED',\s*/g, ''],
]);

