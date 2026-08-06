import { readFileSync, writeFileSync } from 'node:fs';

function replace(file, searchValue, replaceValue) {
  let content = readFileSync(file, 'utf8');
  content = content.replaceAll(searchValue, replaceValue);
  writeFileSync(file, content);
}

// 1. types.ts
let typesTs = readFileSync('src/domain/types.ts', 'utf8');
typesTs = typesTs.replace(/export type GroupListSource.*?;/s, '');
typesTs = typesTs.replace(/export type PollDeliverySource.*?;/s, '');
typesTs = typesTs.replace(/export type PollDeliveryStatus.*?;/s, '');
typesTs = typesTs.replace(/export type NativePoll.*?;/s, '');
typesTs = typesTs.replace(/export type PollTemplate.*?;/s, '');
writeFileSync('src/domain/types.ts', typesTs);

// 2. bot-instance.ts
let botInstance = readFileSync('src/core/bot-instance.ts', 'utf8');
botInstance = botInstance.replace(/import \{.*ModerationService.*\} from '\.\.\/moderation\/moderation-service\.js';/, '');
botInstance = botInstance.replace(/import \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';/, '');
botInstance = botInstance.replace(/import \{ PollRepository \} from '\.\/poll-repository\.js';/, '');
botInstance = botInstance.replace(/import \{ PollScheduler \} from '\.\/poll-scheduler\.js';/, '');
botInstance = botInstance.replace(/import \{ PollSender \} from '\.\/poll-sender\.js';/, '');
botInstance = botInstance.replace(/import \{ PollService \} from '\.\/poll-service\.js';/, '');
botInstance = botInstance.replace(/import \{ PollTemplateSelector \} from '\.\/poll-template-selector\.js';/, '');

// Delete properties
botInstance = botInstance.replace(/  private readonly discovery: GroupDiscoveryService;\n/g, '');
botInstance = botInstance.replace(/  private readonly pollRepository: PollRepository;\n/g, '');
botInstance = botInstance.replace(/  private readonly pollService: PollService;\n/g, '');
botInstance = botInstance.replace(/  private readonly pollScheduler: PollScheduler;\n/g, '');
botInstance = botInstance.replace(/  private readonly moderation: ModerationService \| null;\n/g, '');
botInstance = botInstance.replace(/  private readonly communityServicesEnabled: boolean;\n/g, '');
botInstance = botInstance.replace(/    this\.communityServicesEnabled = bot\.groupChannelEnabled;\n/g, '');

// Clean constructor instantiations
botInstance = botInstance.replace(/    this\.discovery = new GroupDiscoveryService\([\s\S]*?\n    \);\n/m, '');
botInstance = botInstance.replace(/    this\.moderation = bot\.groupChannelEnabled\n      \? new ModerationService\(database, this\.outboundQueue, logger, bot\.id, options\.secretVault\)\n      : null;\n/m, '');
botInstance = botInstance.replace(/    this\.pollRepository = new PollRepository\(database, bot\.id\);\n    const pollSelector = new PollTemplateSelector\(this\.pollRepository\);\n    const pollSender = new PollSender\(this\.pollRepository, database, client, logger, anonymizer\);\n    this\.pollService = new PollService\(\n      this\.pollRepository,\n      pollSelector,\n      pollSender,\n      database,\n      client,\n      logger,\n      anonymizer,\n      options\.isPaused === undefined \? \{\} : \{ isPaused: options\.isPaused \},\n    \);\n    this\.pollScheduler = new PollScheduler\(this\.pollService, logger\);\n/m, '');
botInstance = botInstance.replace(/      this\.moderation \?\? undefined,\n/g, '');

// Clean setEvents
botInstance = botInstance.replace(/      onGroupJoin: async \(event\) => \{\n[\s\S]*?      \},\n/m, '');
botInstance = botInstance.replace(/      onGroupLeave: async \(event\) => \{\n[\s\S]*?      \},\n/m, '');
botInstance = botInstance.replace(/      onGroupChanged: async \(event\) => \{\n[\s\S]*?      \},\n/m, '');

// Clean start/stop checks
botInstance = botInstance.replace(/    if \(this\.communityServicesEnabled\) this\.discovery\.startPeriodic\(\);\n/g, '');
botInstance = botInstance.replace(/    if \(this\.communityServicesEnabled\) this\.pollScheduler\.start\(\);\n    else \{\n      this\.logger\.info\(\{\n        operation: 'POLL_SERVICE_NOT_REQUIRED',\n        botId: this\.bot\.id,\n      \}, 'Los servicios comunitarios no son necesarios para este asistente'\);\n    \}\n/m, '');
botInstance = botInstance.replace(/      if \(this\.communityServicesEnabled\) this\.discovery\.stop\(\);\n/g, '');
botInstance = botInstance.replace(/      if \(this\.communityServicesEnabled\) this\.pollScheduler\.stop\(\);\n/g, '');
botInstance = botInstance.replace(/    if \(this\.communityServicesEnabled\) this\.discovery\.stop\(\);\n/g, '');
botInstance = botInstance.replace(/    if \(this\.communityServicesEnabled\) this\.pollScheduler\.stop\(\);\n/g, '');

botInstance = botInstance.replace(/    discovery: ReturnType<GroupDiscoveryService\['snapshot'\]>;\n/g, '');
botInstance = botInstance.replace(/      discovery: this\.discovery\.snapshot\(\),\n/g, '');
writeFileSync('src/core/bot-instance.ts', botInstance);

// 3. message-processor.ts
let msgProc = readFileSync('src/core/message-processor.ts', 'utf8');
msgProc = msgProc.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
msgProc = msgProc.replace(/    private readonly moderationService\?: ModerationService,\n/g, '');
msgProc = msgProc.replace(/    if \(message\.fromGroupId && !this\.database\.canBotSendToGroup\(this\.botId, message\.fromGroupId\)\) \{\n      this\.logger\.warn\(\{ botId: this\.botId, groupId: message\.fromGroupId \}, 'Ignorando mensaje de grupo no autorizado'\);\n      return;\n    \}\n/m, '');
msgProc = msgProc.replace(/    if \(this\.moderationService\) \{\n      await this\.moderationService\.evaluateMessage\(message\);\n    \}\n/m, '');
writeFileSync('src/core/message-processor.ts', msgProc);

console.log('Precise replacements finished!');
