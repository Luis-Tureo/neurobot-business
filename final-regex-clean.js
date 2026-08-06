import fs from 'node:fs';

function cleanFile(file, replacements) {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    for (let i = 0; i < replacements.length; i += 2) {
        content = content.replace(replacements[i], replacements[i+1]);
    }
    if (content !== original) {
        fs.writeFileSync(file, content);
        console.log(`Cleaned ${file}`);
    }
}

// 1. types.ts
cleanFile('src/domain/types.ts', [
    /export type GroupListSource.*?\n/g, '',
    /export type GroupStatus.*?\n/g, '',
    /listSource\?: GroupListSource;/g, '',
    /status: GroupStatus;/g, '',
    /previousStatus: GroupStatus;/g, ''
]);

// 2. bot-instance.ts
cleanFile('src/core/bot-instance.ts', [
    /import \{ GroupDiscoveryService \} from '\.\.\/group-discovery\/group-discovery-service\.js';\n/g, '',
    /import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '',
    /import \{ PollRepository \}.*?\n/g, '',
    /import \{ PollService \}.*?\n/g, '',
    /import \{ PollScheduler \}.*?\n/g, '',
    /public readonly discovery: GroupDiscoveryService,\n\s*/g, '',
    /public readonly moderation: ModerationService,\n\s*/g, '',
    /public readonly pollRepository: PollRepository,\n\s*/g, '',
    /public readonly pollService: PollService,\n\s*/g, '',
    /public readonly pollScheduler: PollScheduler,\n\s*/g, '',
    /discovery: this\.discovery\.snapshot\(\),\n\s*/g, ''
]);

// 3. multi-bot-manager.ts
cleanFile('src/core/multi-bot-manager.ts', [
    /private readonly moderationService: ModerationService,\n\s*/g, '',
    /private readonly pollRepository: PollRepository,\n\s*/g, '',
    /private readonly pollService: PollService,\n\s*/g, '',
    /private readonly pollScheduler: PollScheduler,\n\s*/g, '',
    /this\.moderationService,\n\s*/g, '',
    /this\.pollRepository,\n\s*/g, '',
    /this\.pollService,\n\s*/g, '',
    /this\.pollScheduler,\n\s*/g, '',
    /import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '',
    /import \{ PollRepository \}.*?\n/g, '',
    /import \{ PollService \}.*?\n/g, '',
    /import \{ PollScheduler \}.*?\n/g, ''
]);

// 4. message-processor.ts
cleanFile('src/core/message-processor.ts', [
    /import \{ ModerationService \} from '\.\.\/moderation\/moderation-service\.js';\n/g, '',
    /private readonly moderationService: ModerationService,\n\s*/g, '',
    /if \(message\.fromGroupId\) \{\n\s*if \(\!this\.database\.canBotSendToGroup\(this\.botId, message\.fromGroupId\)\) \{\n\s*return;\n\s*\}\n\s*\}/g, ''
]);

// 5. maintenance-service.ts
cleanFile('src/core/maintenance-service.ts', [
    /import \{ GroupDiscoveryService \} from '\.\.\/group-discovery\/group-discovery-service\.js';\n/g, '',
    /private readonly groupDiscoveryService: GroupDiscoveryService,\n\s*/g, '',
    /const botGroups = this\.database\.listGroups\(botId\);\n\s*for \(const group of botGroups\) \{\n\s*const hash = this\.hash\(group\.id\);\n\s*if \(!this\.database\.getGroupWelcome\(hash, botId\)\) \{\n\s*this\.database\.initializeGroupWelcome\(hash, group\.id, botId\);\n\s*\}\n\s*\}/g, '',
    /for \(const group of this\.database\.listGroups\(this\.botId\)\) \{\n\s*const dbGroup = this\.database\.getGroupById\(group\.id\);\n\s*if \(\!dbGroup\) continue;\n\s*\}\n/g, ''
]);

// 6. conversation-flow-service.ts
cleanFile('src/core/conversation-flow-service.ts', [
    /if \(capabilities\.pollsAsMenusEnabled\) \{\n.*?\n\s*\}/g, '',
    /if \(\!capabilities\.pollsAsMenusEnabled\) \{\n\s*return false;\n\s*\}/g, ''
]);

// 7. rule-based-response-provider.ts
cleanFile('src/core/rule-based-response-provider.ts', [
    /const operationalGroups = this\.database\.listPublicOperationalGroups\(botId\)\.map\(group => `\$\{group\.name\}: \$\{group\.inviteLink \?\? 'Sin enlace'\} \(\$\{group\.description \?\? 'Sin descripción'\}\)`\)\.join\('\\n'\);\n/g, ''
]);

// 8. index.ts
cleanFile('src/index.ts', [
    /groupDiscovery: multiBotManager\['discoveryService'\],\n\s*/g, ''
]);

// 9. simulated-client.ts
cleanFile('src/messaging/simulated-client.ts', [
    /public readonly groupListSource: GroupListSource;\n\s*/g, '',
    /public onGroupJoin\?: \(groupId: string, participantId: string\) => void;\n\s*/g, '',
    /public onGroupChanged\?: \(groupId: string\) => void;\n\s*/g, ''
]);

// 10. whatsapp-adapter.ts
cleanFile('src/messaging/whatsapp-adapter.ts', [
    /private readonly groupListSource: GroupListSource;\n\s*/g, '',
    /this\.selectableMenuPolls\.set.*?\n/g, '',
    /this\.selectableMenuPolls\.delete.*?\n/g, '',
    /this\.selectableMenuPolls\.clear\(\);\n/g, '',
    /public onGroupChanged\?: \(groupId: string\) => void;\n/g, '',
    /this\.onGroupChanged \? this\.onGroupChanged\(groupId\) : undefined;/g, ''
]);

// 11. automatic-message-service.ts (strip welcome completely)
let ams = fs.readFileSync('src/core/automatic-message-service.ts', 'utf8');
ams = ams.replace(/private welcomeBatches = new Map<string, .*?>\(\);\n\s*/g, '');
ams = ams.replace(/private welcomeReconciliationTimer: NodeJS\.Timeout \| null = null;\n\s*/g, '');
ams = ams.replace(/import \{.*?Welcome.*?\} from '.*?';\n/g, '');
// Delete flushWelcome
ams = ams.replace(/private async flushWelcome.*?\}\n\s*\}\n\s*\}/s, '');
// Delete buildWelcomeMessages
ams = ams.replace(/private buildWelcomeMessages.*?\}\n\s*\}/s, '');
// Delete processWelcomeBatch
ams = ams.replace(/private async processWelcomeBatch.*?\n\s*\}/s, '');
fs.writeFileSync('src/core/automatic-message-service.ts', ams);

console.log('Regex clean complete!');
