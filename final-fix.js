import { readFileSync, writeFileSync } from 'node:fs';

function replace(file, searchValue, replaceValue) {
  let content = readFileSync(file, 'utf8');
  content = content.replaceAll(searchValue, replaceValue);
  writeFileSync(file, content);
}

// 1. multi-bot-manager.ts
let mbm = readFileSync('src/core/multi-bot-manager.ts', 'utf8');
mbm = mbm.replace(/      communityPollVotesNoAction: bot\.capabilities\.communitySingleTurnMode,\n/g, '');
mbm = mbm.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
mbm = mbm.replace(/import \{ PollRepository \} from '\.\/poll-repository\.js';\n/g, '');
mbm = mbm.replace(/import \{ PollService \} from '\.\/poll-service\.js';\n/g, '');
mbm = mbm.replace(/import \{ PollScheduler \} from '\.\/poll-scheduler\.js';\n/g, '');
writeFileSync('src/core/multi-bot-manager.ts', mbm);

// 2. bot-instance.ts
let bi = readFileSync('src/core/bot-instance.ts', 'utf8');
bi = bi.replace(/      moderation: this\.moderation \?\? undefined,\n/g, '');
bi = bi.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
bi = bi.replace(/import \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
bi = bi.replace(/import \{ PollRepository \} from '\.\/poll-repository\.js';\n/g, '');
bi = bi.replace(/import \{ PollService \} from '\.\/poll-service\.js';\n/g, '');
bi = bi.replace(/import \{ PollScheduler \} from '\.\/poll-scheduler\.js';\n/g, '');
bi = bi.replace(/      discovery: this\.discovery\.snapshot\(\),\n/g, '');
writeFileSync('src/core/bot-instance.ts', bi);

// 3. automatic-message-service.ts
let am = readFileSync('src/core/automatic-message-service.ts', 'utf8');
am = am.replace(/      await this\.client\.sendMessageWithMentions\(groupId, templateBody\);\n/g, '      await this.client.sendMessage(groupId, templateBody);\n');
am = am.replace(/        this\.database\.setAutomaticGroupBackoff\(groupId, configuration\.cooldownMinutes, this\.botId\);\n/g, '');
am = am.replace(/  private async getGroupRejection\(groupId: string, now: Date\): Promise<string \| null> \{\n[\s\S]*?  \}\n/m, '');
am = am.replace(/    if \(message\.fromGroupId\) \{\n      await this\.processAutomaticGroupMessage\(message\);\n      return;\n    \}\n/m, '');
am = am.replace(/  public async processAutomaticGroupMessage\(message: WhatsAppMessage\): Promise<void> \{\n[\s\S]*?  \}\n/m, '');
writeFileSync('src/core/automatic-message-service.ts', am);

// 4. connection-manager.ts
let cm = readFileSync('src/core/connection-manager.ts', 'utf8');
cm = cm.replace(/      qrCode: this\.currentQrCode,\n/g, '');
writeFileSync('src/core/connection-manager.ts', cm);

// 5. maintenance-service.ts
let ms = readFileSync('src/core/maintenance-service.ts', 'utf8');
ms = ms.replace(/import \{ GroupDiscoveryService \} from '\.\/group-discovery-service\.js';\n/g, '');
ms = ms.replace(/    let syncedGroups = 0;\n    const groups = this\.database\.listGroups\(botId\);\n    for \(const group of groups\) \{\n      try \{\n        const chat = await this\.sessions\.getChat\(botId, group\.id\);\n        const name = chat\.name || 'Sin Asunto';\n        const description = chat\.description || null;\n        let inviteLink = group\.invite_link;\n        if \(\!inviteLink\) \{\n          inviteLink = await this\.sessions\.getGroupInviteLink\(botId, group\.id\);\n        \}\n        this\.database\.updateGroup\(botId, group\.id, \{\n          name,\n          description,\n          invite_link: inviteLink,\n        \}\);\n        syncedGroups\+\+;\n      \} catch \(error\) \{\n        this\.logger\.warn\(\{\n          botId,\n          groupId: group\.id,\n          error: error instanceof Error \? error\.message : String\(error\),\n        \}, 'Error al sincronizar grupo'\);\n      \}\n    \}\n/m, '    let syncedGroups = 0;\n');
ms = ms.replace(/    for \(const group of this\.database\.listGroups\(botId\)\) \{\n      if \(!isSupportedGroupId\(group\.id\)\) \{\n        this\.database\.removeGroup\(botId, group\.id\);\n        removed\+\+;\n      \}\n    \}\n/m, '');
writeFileSync('src/core/maintenance-service.ts', ms);

// 6. message-processor.ts
let mp = readFileSync('src/core/message-processor.ts', 'utf8');
mp = mp.replace(/import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '');
mp = mp.replace(/    if \(message\.fromGroupId && !this\.database\.canBotSendToGroup\(this\.botId, message\.fromGroupId\)\) \{\n      this\.logger\.warn\(\{ botId: this\.botId, groupId: message\.fromGroupId \}, 'Ignorando mensaje de grupo no autorizado'\);\n      return;\n    \}\n/m, '');
writeFileSync('src/core/message-processor.ts', mp);

// 7. rule-based-response-provider.ts
let rbp = readFileSync('src/core/rule-based-response-provider.ts', 'utf8');
rbp = rbp.replace(/    const groupChannels = await this\.database\.listPublicOperationalGroups\(botId\);\n    if \(groupChannels && groupChannels\.length > 0\) \{\n      const groupList = groupChannels\.map\(group => `\\n      - Nombre: \$\{group\.name\}\\n      - Descripción: \$\{group\.description \|\| 'Sin descripción'\}\\n      - Enlace: \$\{group\.invite_link \|\| 'No disponible'\}`\)\.join\(''\);\n      prompt \+= `\\nCanales comunitarios de este asistente: \$\{groupList\}`;\n    \}\n/m, '');
writeFileSync('src/core/rule-based-response-provider.ts', rbp);

// 8. simulated-client.ts
let sc = readFileSync('src/messaging/simulated-client.ts', 'utf8');
sc = sc.replace(/import \{ NativePoll, GroupListSource \} from '\.\.\/domain\/types\.js';\n/g, '');
sc = sc.replace(/import \{ NativePoll \} from '\.\.\/domain\/types\.js';\n/g, '');
sc = sc.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n    this\.logger\.info\(\{ to, title: poll\.name \}, 'Simulating poll send'\);\n    const id = `sim-poll-\$\{Date\.now\(\)\}`;\n    this\.sentPolls\.push\(\{ to, poll, id \}\);\n    return id;\n  \}\n/m, '');
sc = sc.replace(/  public async getGroupList\(source: GroupListSource\): Promise<DetectedGroup\[\]> \{\n    return \[\];\n  \}\n/m, '');
sc = sc.replace(/  private sentPolls: Array<\{ to: string, poll: NativePoll, id: string \}> = \[\];\n/g, '');
sc = sc.replace(/      onGroupJoin: async \(event\) => \{\},\n      onGroupLeave: async \(event\) => \{\},\n      onGroupChanged: async \(event\) => \{\},\n/m, '');
writeFileSync('src/messaging/simulated-client.ts', sc);

// 9. whatsapp-adapter.ts
let wa = readFileSync('src/messaging/whatsapp-adapter.ts', 'utf8');
wa = wa.replace(/import \{ GroupListSource, NativePoll \} from '\.\.\/domain\/types\.js';\n/g, '');
wa = wa.replace(/import \{ GroupListSource \} from '\.\.\/domain\/types\.js';\n/g, '');
wa = wa.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n    const chat = await this\.whatsapp\.getChatById\(to\);\n    if \(\!chat\) \{\n      throw new Error\(`Chat \$\{to\} no encontrado para enviar la encuesta`\);\n    \}\n    const wWebPoll = new Poll\(poll\.name, poll\.options, \{\n      messageSecret: poll\.messageSecret,\n      allowMultipleAnswers: poll\.allowMultipleAnswers\n    \}\);\n    const result = await chat\.sendMessage\(wWebPoll\);\n    return result\.id\._serialized;\n  \}\n/m, '');
wa = wa.replace(/    if \(\!message\.fromMe && chat\.isGroup && \!isSupportedGroupId\(chat\.id\._serialized\)\) \{\n      this\.logger\.debug\(\{ botId: this\.botId, groupId: chat\.id\._serialized \}, 'Ignorando mensaje de un grupo no soportado\.'\);\n      return;\n    \}\n/m, '');
wa = wa.replace(/      this\.selectableMenuPolls\.set\(msg\.id\.id, body\);\n/g, '');
wa = wa.replace(/    const expectedPollBody = this\.selectableMenuPolls\.get\(msg\.selectedPollOption\.pollCreationMessageId\);\n    if \(expectedPollBody\) \{\n      msg\.body = expectedPollBody;\n      this\.selectableMenuPolls\.delete\(msg\.selectedPollOption\.pollCreationMessageId\);\n    \}\n/m, '');
wa = wa.replace(/      if \(chat\.isGroup\) \{\n        const participant = chat\.participants\.find\(p => p\.id\._serialized === message\.author\);\n        if \(participant\) \{\n          authorName = await this\.getContactName\(participant\.id\._serialized, true\);\n        \}\n      \}\n/m, '');
wa = wa.replace(/        authorName,\n/g, '');
wa = wa.replace(/  private selectableMenuPolls = new Map<string, string>\(\);\n/g, '');
writeFileSync('src/messaging/whatsapp-adapter.ts', wa);

// 10. whatsapp-cloud-api-adapter.ts
let wca = readFileSync('src/messaging/whatsapp-cloud-api-adapter.ts', 'utf8');
wca = wca.replace(/import \{ NativePoll \} from '\.\.\/domain\/types\.js';\n/g, '');
wca = wca.replace(/  public async sendPoll\(to: string, poll: NativePoll\): Promise<string> \{\n    throw new Error\('Method not implemented\.'\);\n  \}\n/m, '');
writeFileSync('src/messaging/whatsapp-cloud-api-adapter.ts', wca);

// 11. conversation-flow-service.ts
let cfs = readFileSync('src/core/conversation-flow-service.ts', 'utf8');
cfs = cfs.replace(/      if \(\!capabilities\.pollsAsMenusEnabled\) \{\n        return;\n      \}\n/g, '');
cfs = cfs.replace(/    if \(\!capabilities\.pollsAsMenusEnabled\) return false;\n/g, '');
writeFileSync('src/core/conversation-flow-service.ts', cfs);

console.log('Final fixes applied!');
