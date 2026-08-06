import { readFileSync, writeFileSync } from 'node:fs';

function replace(file, searchValue, replaceValue) {
  let content = readFileSync(file, 'utf8');
  content = content.replaceAll(searchValue, replaceValue);
  writeFileSync(file, content);
}

// 1. automatic-message-service.ts
let autoMsg = readFileSync('src/core/automatic-message-service.ts', 'utf8');
autoMsg = autoMsg.replace(/  public async processAutomaticGroupMessage\([\s\S]*?\n  \}\n/m, '');
autoMsg = autoMsg.replace(/    if \(message\.fromGroupId\) \{\n      await this\.processAutomaticGroupMessage\(message\);\n      return;\n    \}\n/m, '');
writeFileSync('src/core/automatic-message-service.ts', autoMsg);

// 2. bot-instance.ts
let bot = readFileSync('src/core/bot-instance.ts', 'utf8');
bot = bot.replace(/import \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
bot = bot.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
bot = bot.replace(/import \{ PollRepository \} from '\.\/poll-repository\.js';\n/g, '');
bot = bot.replace(/import \{ PollScheduler \} from '\.\/poll-scheduler\.js';\n/g, '');
bot = bot.replace(/import \{ PollSender \} from '\.\/poll-sender\.js';\n/g, '');
bot = bot.replace(/import \{ PollService \} from '\.\/poll-service\.js';\n/g, '');
bot = bot.replace(/import \{ PollTemplateSelector \} from '\.\/poll-template-selector\.js';\n/g, '');

bot = bot.replace(/  private readonly discovery: GroupDiscoveryService;\n/g, '');
bot = bot.replace(/  private readonly pollRepository: PollRepository;\n/g, '');
bot = bot.replace(/  private readonly pollService: PollService;\n/g, '');
bot = bot.replace(/  private readonly pollScheduler: PollScheduler;\n/g, '');
bot = bot.replace(/  private readonly moderation: ModerationService \| null;\n/g, '');
bot = bot.replace(/  private readonly communityServicesEnabled: boolean;\n/g, '');

bot = bot.replace(/    this\.communityServicesEnabled = bot\.groupChannelEnabled;\n/g, '');
bot = bot.replace(/    this\.discovery = new GroupDiscoveryService\([\s\S]*?\n    \);\n/m, '');
bot = bot.replace(/    this\.moderation = bot\.groupChannelEnabled\n      \? new ModerationService\(database, this\.outboundQueue, logger, bot\.id, options\.secretVault\)\n      : null;\n/m, '');
bot = bot.replace(/    this\.pollRepository = new PollRepository\(database, bot\.id\);\n    const pollSelector = new PollTemplateSelector\(this\.pollRepository\);\n    const pollSender = new PollSender\(this\.pollRepository, database, client, logger, anonymizer\);\n    this\.pollService = new PollService\(\n      this\.pollRepository,\n      pollSelector,\n      pollSender,\n      database,\n      client,\n      logger,\n      anonymizer,\n      options\.isPaused === undefined \? \{\} : \{ isPaused: options\.isPaused \},\n    \);\n    this\.pollScheduler = new PollScheduler\(this\.pollService, logger\);\n/m, '');
bot = bot.replace(/      this\.moderation \?\? undefined,\n/g, '');

bot = bot.replace(/      onGroupJoin: async \(event\) => \{\n[\s\S]*?      \},\n/m, '');
bot = bot.replace(/      onGroupLeave: async \(event\) => \{\n[\s\S]*?      \},\n/m, '');
bot = bot.replace(/      onGroupChanged: async \(event\) => \{\n[\s\S]*?      \},\n/m, '');

bot = bot.replace(/    if \(this\.communityServicesEnabled\) this\.discovery\.startPeriodic\(\);\n/g, '');
bot = bot.replace(/    if \(this\.communityServicesEnabled\) this\.pollScheduler\.start\(\);\n    else \{\n      this\.logger\.info\(\{\n        operation: 'POLL_SERVICE_NOT_REQUIRED',\n        botId: this\.bot\.id,\n      \}, 'Los servicios comunitarios no son necesarios para este asistente'\);\n    \}\n/m, '');
bot = bot.replace(/      if \(this\.communityServicesEnabled\) this\.discovery\.stop\(\);\n/g, '');
bot = bot.replace(/      if \(this\.communityServicesEnabled\) this\.pollScheduler\.stop\(\);\n/g, '');
bot = bot.replace(/    if \(this\.communityServicesEnabled\) this\.discovery\.stop\(\);\n/g, '');
bot = bot.replace(/    if \(this\.communityServicesEnabled\) this\.pollScheduler\.stop\(\);\n/g, '');

bot = bot.replace(/    discovery: ReturnType<GroupDiscoveryService\['snapshot'\]>;\n/g, '');
bot = bot.replace(/      discovery: this\.discovery\.snapshot\(\),\n/g, '');

bot = bot.replace(/      if \(this\.communityServicesEnabled\) this\.pollScheduler\.reconfigure\(config\);\n/g, '');

writeFileSync('src/core/bot-instance.ts', bot);

// 3. multi-bot-manager.ts
let mbm = readFileSync('src/core/multi-bot-manager.ts', 'utf8');
mbm = mbm.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
mbm = mbm.replace(/import \{ PollRepository \} from '\.\/poll-repository\.js';\n/g, '');
mbm = mbm.replace(/import \{ PollScheduler \} from '\.\/poll-scheduler\.js';\n/g, '');
mbm = mbm.replace(/import \{ PollService \} from '\.\/poll-service\.js';\n/g, '');
mbm = mbm.replace(/      communityPollVotesNoAction: true,\n/g, '');
writeFileSync('src/core/multi-bot-manager.ts', mbm);

// 4. message-processor.ts
let mp = readFileSync('src/core/message-processor.ts', 'utf8');
mp = mp.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
mp = mp.replace(/    private readonly moderationService\?: ModerationService,\n/g, '');
mp = mp.replace(/    if \(this\.moderationService\) \{\n      await this\.moderationService\.evaluateMessage\(message\);\n    \}\n/m, '');
mp = mp.replace(/    if \(message\.fromGroupId && \!this\.database\.canBotSendToGroup\(this\.botId, message\.fromGroupId\)\) \{\n      this\.logger\.warn\(\{ botId: this\.botId, groupId: message\.fromGroupId \}, 'Ignorando mensaje de grupo no autorizado'\);\n      return;\n    \}\n/m, '');
writeFileSync('src/core/message-processor.ts', mp);

// 5. maintenance-service.ts
let ms = readFileSync('src/core/maintenance-service.ts', 'utf8');
ms = ms.replace(/import \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
ms = ms.replace(/    private readonly discovery: GroupDiscoveryService,\n/g, '');
ms = ms.replace(/  public async syncBotGroups\(botId: string\): Promise<\{[\s\S]*?    return \{ syncedGroups: 0 \};\n  \}\n/m, '');
writeFileSync('src/core/maintenance-service.ts', ms);

// 6. rule-based-response-provider.ts
let rbp = readFileSync('src/core/rule-based-response-provider.ts', 'utf8');
rbp = rbp.replace(/    const groupChannels = await this\.database\.listPublicOperationalGroups\(botId\);\n    if \(groupChannels && groupChannels\.length > 0\) \{\n      const groupList = groupChannels\.map\(group => `\n      - Nombre: \$\{group\.name\}\n      - Descripción: \$\{group\.description || 'Sin descripción'\}\n      - Enlace: \$\{group\.invite_link || 'No disponible'\}`\)\.join\(''\);\n      prompt \+= `\\nCanales comunitarios de este asistente: \$\{groupList\}`;\n    \}\n/m, '');
writeFileSync('src/core/rule-based-response-provider.ts', rbp);

// 7. conversation-flow-service.ts
let cfs = readFileSync('src/core/conversation-flow-service.ts', 'utf8');
cfs = cfs.replace(/      if \(\!capabilities\.pollsAsMenusEnabled\) \{\n        return;\n      \}\n/g, '');
cfs = cfs.replace(/    if \(\!capabilities\.pollsAsMenusEnabled\) return false;\n/g, '');
writeFileSync('src/core/conversation-flow-service.ts', cfs);

// 8. simulated-client.ts
let sc = readFileSync('src/messaging/simulated-client.ts', 'utf8');
sc = sc.replace(/import \{ NativePoll, GroupListSource \} from '\.\.\/domain\/types\.js';\n/g, '');
sc = sc.replace(/import \{ NativePoll \} from '\.\.\/domain\/types\.js';\n/g, '');
sc = sc.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n[\s\S]*?  \}\n/m, '');
sc = sc.replace(/  public async getGroupList\(source: GroupListSource\): Promise<DetectedGroup\[\]> \{\n[\s\S]*?  \}\n/m, '');
sc = sc.replace(/  private sentPolls: Array<\{ to: string, poll: NativePoll, id: string \}> = \[\];\n/g, '');
sc = sc.replace(/      onGroupJoin: async \(event\) => \{\},\n      onGroupLeave: async \(event\) => \{\},\n      onGroupChanged: async \(event\) => \{\},\n/m, '');
writeFileSync('src/messaging/simulated-client.ts', sc);

// 9. whatsapp-adapter.ts
let wa = readFileSync('src/messaging/whatsapp-adapter.ts', 'utf8');
wa = wa.replace(/import \{ GroupListSource, NativePoll \} from '\.\.\/domain\/types\.js';\n/g, '');
wa = wa.replace(/  private selectableMenuPolls = new Map<string, string>\(\);\n/g, '');
wa = wa.replace(/  communityPollVotesNoAction\?: boolean;\n/g, '');
wa = wa.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/  public async getGroupList\(source: GroupListSource\): Promise<DetectedGroup\[\]> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/  private async handleGroupNotification\(notification: GroupNotification\): Promise<void> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/  private async notifyGroupChanged\(groupChat: GroupChat\): Promise<void> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/    const groupChat = await chat\.getChat\(\);\n    if \(groupChat\.isGroup\) \{\n      await this\.notifyGroupChanged\(groupChat as GroupChat\);\n    \}\n/m, '');
wa = wa.replace(/      if \(chat\.isGroup\) \{\n        const participant = chat\.participants\.find\(p => p\.id\._serialized === message\.author\);\n        if \(participant\) \{\n          authorName = await this\.getContactName\(participant\.id\._serialized, true\);\n        \}\n      \}\n/m, '');
wa = wa.replace(/        authorName,\n/g, '');
wa = wa.replace(/    if \(!message\.fromMe && chat\.isGroup && !isSupportedGroupId\(chat\.id\._serialized\)\) \{\n      this\.logger\.debug\(\{ botId: this\.botId, groupId: chat\.id\._serialized \}, 'Ignorando mensaje de un grupo no soportado\.'\);\n      return;\n    \}\n/m, '');
wa = wa.replace(/    if \(isGroup\) \{\n      await this\.notifyGroupChanged\(chat as GroupChat\);\n    \}\n/m, '');
wa = wa.replace(/    if \(this\.options\.communityPollVotesNoAction && msg\.type === 'poll_creation'\) return;\n/m, '');
wa = wa.replace(/      this\.selectableMenuPolls\.set\(msg\.id\.id, body\);\n/g, '');
wa = wa.replace(/    const expectedPollBody = this\.selectableMenuPolls\.get\(msg\.selectedPollOption\.pollCreationMessageId\);\n    if \(expectedPollBody\) \{\n      msg\.body = expectedPollBody;\n      this\.selectableMenuPolls\.delete\(msg\.selectedPollOption\.pollCreationMessageId\);\n    \}\n/m, '');
wa = wa.replace(/    this\.whatsapp\.on\('group_join', async \(notification\) => \{\n      await this\.handleGroupNotification\(notification\);\n    \}\);\n    this\.whatsapp\.on\('group_leave', async \(notification\) => \{\n      await this\.handleGroupNotification\(notification\);\n    \}\);\n    this\.whatsapp\.on\('group_update', async \(notification\) => \{\n      await this\.handleGroupNotification\(notification\);\n    \}\);\n/m, '');
writeFileSync('src/messaging/whatsapp-adapter.ts', wa);

// 10. whatsapp-cloud-api-adapter.ts
let wca = readFileSync('src/messaging/whatsapp-cloud-api-adapter.ts', 'utf8');
wca = wca.replace(/import \{ NativePoll \} from '\.\.\/domain\/types\.js';\n/g, '');
wca = wca.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n[\s\S]*?  \}\n/m, '');
writeFileSync('src/messaging/whatsapp-cloud-api-adapter.ts', wca);

// 11. types.ts
let t = readFileSync('src/domain/types.ts', 'utf8');
t = t.replace(/export type GroupStatus.*?;/s, '');
t = t.replace(/export type GroupListSource.*?;/s, '');
t = t.replace(/export type PollDeliverySource.*?;/s, '');
t = t.replace(/export type PollDeliveryStatus.*?;/s, '');
t = t.replace(/export type NativePoll.*?;/s, '');
t = t.replace(/export type PollTemplate.*?;/s, '');
t = t.replace(/  onGroupJoin\?: \(event: GroupEvent\) => void;\n/g, '');
t = t.replace(/  onGroupLeave\?: \(event: GroupEvent\) => void;\n/g, '');
t = t.replace(/  onGroupChanged\?: \(event: GroupEvent\) => void;\n/g, '');
writeFileSync('src/domain/types.ts', t);

// 12. connection-manager.ts
let cm = readFileSync('src/core/connection-manager.ts', 'utf8');
cm = cm.replace(/      qrCode: this\.currentQrCode,\n/g, '');
writeFileSync('src/core/connection-manager.ts', cm);

// 13. server.ts
let srv = readFileSync('src/admin/server.ts', 'utf8');
srv = srv.replace(/  app\.get\('\/api\/admin\/bot\/:botId\/groups\/:identifier\/resolve', async \(req, res\) => \{\n[\s\S]*?  \}\);\n/m, '');
writeFileSync('src/admin/server.ts', srv);

// 14. database.ts
let db = readFileSync('src/persistence/database.ts', 'utf8');
db = db.replace(/import \{ DEFAULT_POLL_CONFIGURATION \} from '\.\.\/core\/poll-defaults\.js';\n/g, '');
db = db.replace(/      pollsAsMenusEnabled: capabilities\.polls_as_menus_enabled === 1,\n      pollsForCommunityEngagementEnabled: capabilities\.polls_for_community_engagement_enabled === 1,\n/g, '');
db = db.replace(/    polls_as_menus_enabled: input\.pollsAsMenusEnabled \? 1 : 0,\n    polls_for_community_engagement_enabled: input\.pollsForCommunityEngagementEnabled \? 1 : 0,\n/g, '');
db = db.replace(/      polls_as_menus_enabled = \?,\n      polls_for_community_engagement_enabled = \?,\n/g, '');
db = db.replace(/      pollsAsMenusEnabled: false,\n      pollsForCommunityEngagementEnabled: false,\n/g, '');
db = db.replace(/export type PollDeliverySource.*?;/s, '');
db = db.replace(/export type PollDeliveryStatus.*?;/s, '');
writeFileSync('src/persistence/database.ts', db);

console.log('Fix all done!');
