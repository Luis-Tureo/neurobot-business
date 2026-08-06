import { readFileSync, writeFileSync } from 'node:fs';

function replace(file, searchValue, replaceValue) {
  let content = readFileSync(file, 'utf8');
  content = content.replaceAll(searchValue, replaceValue);
  writeFileSync(file, content);
}

// 1. Types
let typesTs = readFileSync('src/domain/types.ts', 'utf8');
typesTs = typesTs.replace(/export type GroupStatus.*?;/s, '');
typesTs = typesTs.replace(/export type PollDeliverySource.*?;/s, '');
typesTs = typesTs.replace(/export type PollDeliveryStatus.*?;/s, '');
typesTs = typesTs.replace(/export type GroupListSource.*?;/s, '');
writeFileSync('src/domain/types.ts', typesTs);

// 2. bot-instance.ts
let botInstance = readFileSync('src/core/bot-instance.ts', 'utf8');
botInstance = botInstance.replace(/    if \(this\.communityServicesEnabled\) \{\}\n    if \(this\.communityServicesEnabled\) \{\} else \{\n      this\.logger\.info\(\{\n        operation: 'POLL_SERVICE_NOT_REQUIRED',\n        botId: this\.bot\.id\n      \}, 'Los servicios comunitarios no son necesarios para este asistente'\);\n    \}\n/m, '');
botInstance = botInstance.replace(/      if \(this\.communityServicesEnabled\) \{\}\n      if \(this\.communityServicesEnabled\) \{\}\n/m, '');
botInstance = botInstance.replace(/    if \(this\.communityServicesEnabled\) \{\}\n    if \(this\.communityServicesEnabled\) \{\}\n/m, '');
botInstance = botInstance.replace(/    this\.aiQueue\.shutdown\(\);\n    if \(this\.communityServicesEnabled\) \{\}\n    if \(this\.communityServicesEnabled\) \{\}\n/m, '    this.aiQueue.shutdown();\n');
botInstance = botInstance.replace(/    discovery: ReturnType<GroupDiscoveryService\['snapshot'\]>;\n/m, '');
botInstance = botInstance.replace(/      discovery: this\.discovery\.snapshot\(\),\n/m, '');
botInstance = botInstance.replace(/    this\.communityServicesEnabled = bot\.groupChannelEnabled;\n/m, '');
botInstance = botInstance.replace(/  private readonly communityServicesEnabled: boolean;\n/m, '');
writeFileSync('src/core/bot-instance.ts', botInstance);

// 3. message-processor.ts
let msgProc = readFileSync('src/core/message-processor.ts', 'utf8');
msgProc = msgProc.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
msgProc = msgProc.replace(/    private readonly moderationService\?: ModerationService,\n/g, '');
writeFileSync('src/core/message-processor.ts', msgProc);

// 4. maintenance-service.ts
let maint = readFileSync('src/core/maintenance-service.ts', 'utf8');
maint = maint.replace(/import \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
maint = maint.replace(/    private readonly discovery: GroupDiscoveryService,\n/g, '');
// replace maintenance methods that use groups
maint = maint.replace(/  public async syncBotGroups\(botId: string\): Promise<\{[\s\S]*?    return \{ syncedGroups: 0 \};\n  \}\n/m, '');
writeFileSync('src/core/maintenance-service.ts', maint);

// 5. multi-bot-manager.ts
let multiBot = readFileSync('src/core/multi-bot-manager.ts', 'utf8');
multiBot = multiBot.replace(/      communityPollVotesNoAction: true,\n/g, '');
writeFileSync('src/core/multi-bot-manager.ts', multiBot);

// 6. whatsapp-adapter.ts
let wa = readFileSync('src/messaging/whatsapp-adapter.ts', 'utf8');
wa = wa.replace(/import \{ welcomePersonalization \} from '\.\.\/core\/welcome-personalization\.js';\n/g, '');
wa = wa.replace(/  communityPollVotesNoAction\?: boolean;\n/g, '');
wa = wa.replace(/  private selectableMenuPolls = new Map<string, string>\(\);\n/g, '');
wa = wa.replace(/    const groupChat = await chat\.getChat\(\);\n    if \(groupChat\.isGroup\) \{\n      await this\.notifyGroupChanged\(groupChat as GroupChat\);\n    \}\n/m, '');
wa = wa.replace(/    if \(!message\.fromMe && chat\.isGroup && \!isSupportedGroupId\(chat\.id\._serialized\)\) \{\n      this\.logger\.debug\(\{ botId: this\.botId, groupId: chat\.id\._serialized \}, 'Ignorando mensaje de un grupo no soportado\.'\);\n      return;\n    \}\n/m, '');
wa = wa.replace(/    if \(isGroup\) \{\n      await this\.notifyGroupChanged\(chat as GroupChat\);\n    \}\n/m, '');
wa = wa.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/  public async getGroupList\(source: GroupListSource\): Promise<DetectedGroup\[\]> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/  private async handleGroupNotification\(notification: GroupNotification\): Promise<void> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/  private async notifyGroupChanged\(groupChat: GroupChat\): Promise<void> \{\n[\s\S]*?  \}\n/m, '');
wa = wa.replace(/      if \(message\.type === 'vcard' && !chat\.isGroup\) \{\n        await welcomePersonalization\.handleVCard\(this\.botId, message\);\n      \}\n/m, '');
wa = wa.replace(/      if \(chat\.isGroup\) \{\n        const participant = chat\.participants\.find\(p => p\.id\._serialized === message\.author\);\n        if \(participant\) \{\n          authorName = await this\.getContactName\(participant\.id\._serialized, true\);\n        \}\n      \}\n/m, '');
wa = wa.replace(/        authorName,\n/g, '');
wa = wa.replace(/      if \(chat\.isGroup && !isSupportedGroupId\(chat\.id\._serialized\)\) return;\n/m, '');
wa = wa.replace(/      if \(chat\.isGroup && \!isSupportedGroupId\(chat\.id\._serialized\)\) return;\n/m, '');
wa = wa.replace(/      this\.selectableMenuPolls\.set\(msg\.id\.id, body\);\n/g, '');
wa = wa.replace(/    const expectedPollBody = this\.selectableMenuPolls\.get\(msg\.selectedPollOption\.pollCreationMessageId\);\n    if \(expectedPollBody\) \{\n      msg\.body = expectedPollBody;\n      this\.selectableMenuPolls\.delete\(msg\.selectedPollOption\.pollCreationMessageId\);\n    \}\n/m, '');
wa = wa.replace(/    this\.whatsapp\.on\('group_join', async \(notification\) => \{\n      await this\.handleGroupNotification\(notification\);\n    \}\);\n    this\.whatsapp\.on\('group_leave', async \(notification\) => \{\n      await this\.handleGroupNotification\(notification\);\n    \}\);\n    this\.whatsapp\.on\('group_update', async \(notification\) => \{\n      await this\.handleGroupNotification\(notification\);\n    \}\);\n/m, '');
wa = wa.replace(/  communityPollVotesNoAction\?: boolean;\n/m, '');
wa = wa.replace(/    if \(this\.options\.communityPollVotesNoAction && msg\.type === 'poll_creation'\) return;\n/m, '');
writeFileSync('src/messaging/whatsapp-adapter.ts', wa);

// 7. simulated-client.ts
let sim = readFileSync('src/messaging/simulated-client.ts', 'utf8');
sim = sim.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n[\s\S]*?  \}\n/m, '');
sim = sim.replace(/  public async getGroupList\(source: GroupListSource\): Promise<DetectedGroup\[\]> \{\n[\s\S]*?  \}\n/m, '');
sim = sim.replace(/  private sentPolls: Array<\{ to: string, poll: NativePoll, id: string \}> = \[\];\n/m, '');
writeFileSync('src/messaging/simulated-client.ts', sim);

// 8. database.ts
let db = readFileSync('src/persistence/database.ts', 'utf8');
db = db.replace(/import \{ DEFAULT_POLL_CONFIGURATION \} from '\.\.\/core\/poll-defaults\.js';\n/g, '');
db = db.replace(/      pollsAsMenusEnabled: capabilities\.polls_as_menus_enabled === 1,\n      pollsForCommunityEngagementEnabled: capabilities\.polls_for_community_engagement_enabled === 1,\n/g, '');
db = db.replace(/    polls_as_menus_enabled: input\.pollsAsMenusEnabled \? 1 : 0,\n    polls_for_community_engagement_enabled: input\.pollsForCommunityEngagementEnabled \? 1 : 0,\n/g, '');
db = db.replace(/      polls_as_menus_enabled = \?,\n      polls_for_community_engagement_enabled = \?,\n/g, '');
db = db.replace(/      pollsAsMenusEnabled: false,\n      pollsForCommunityEngagementEnabled: false,\n/g, '');
writeFileSync('src/persistence/database.ts', db);

console.log('Done cleaning!');
