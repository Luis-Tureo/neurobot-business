/**
 * patch-business.cjs
 * Patches restored community files to remove community-only features for neurobot-business.
 */
const fs = require('fs');

function patch(filePath, patches) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [search, replace] of patches) {
    if (typeof search === 'string') {
      if (content.includes(search)) {
        content = content.replaceAll(search, replace);
        changed = true;
      }
    } else {
      // regex
      const newContent = content.replace(search, replace);
      if (newContent !== content) { content = newContent; changed = true; }
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`PATCHED: ${filePath}`);
  } else {
    console.log(`NO CHANGE: ${filePath}`);
  }
}

const BASE = 'C:\\Users\\lture\\Documents\\GitHub\\neurobot-business\\src';

// ---- whatsapp-adapter.ts: remove group/poll imports and callbacks ----
patch(BASE + '\\messaging\\whatsapp-adapter.ts', [
  // Remove DetectedGroup, GroupListSource, NativePoll imports
  [`  DetectedGroup,\n`, ''],
  [`  GroupListSource,\n`, ''],
  [`  NativePoll,\n`, ''],
  // Remove groupListSource parameter from class
  [/private groupListSource[^;]+;\n/g, ''],
  // Remove onGroupJoin event
  [/[ \t]*if \(this\.events\.onGroupJoin[^}]+\}\s*\n/g, ''],
  [/[ \t]*this\.events\.onGroupJoin[^\n]+\n/g, ''],
  // Remove onGroupChanged event
  [/[ \t]*if \(this\.events\.onGroupChanged[^}]+\}\s*\n/g, ''],
  [/[ \t]*this\.events\.onGroupChanged[^\n]+\n/g, ''],
  // Remove groupListSource from constructor calls
  [/,\s*groupListSource[^,\n)]+/g, ''],
  [/groupListSource\s*=\s*[^;]+;\s*\n/g, ''],
]);

// ---- whatsapp-cloud-api-adapter.ts: remove DetectedGroup, NativePoll imports ----
patch(BASE + '\\messaging\\whatsapp-cloud-api-adapter.ts', [
  [`  DetectedGroup,\n`, ''],
  [`  NativePoll,\n`, ''],
]);

// ---- persistence/database.ts: remove community-only imports and capabilities ----
patch(BASE + '\\persistence\\database.ts', [
  // Remove poll-defaults import
  [`import { POLL_DEFAULTS } from '../core/poll-defaults.js';\n`, ''],
  [`import { POLL_DEFAULTS } from \"../core/poll-defaults.js\";\n`, ''],
  [/import \{ POLL_DEFAULTS \}[^\n]+\n/, ''],
  // Remove DetectedGroup import
  [`  DetectedGroup,\n`, ''],
  [`  GroupStatus,\n`, ''],
  [`  HiddenPollTemplate,\n`, ''],
  [`  ModerationGroupMode,\n`, ''],
  [`  ModerationRule,\n`, ''],
  [`  ModerationSettings,\n`, ''],
  [`  ModerationSeverity,\n`, ''],
  [`  PollConfiguration,\n`, ''],
  [`  PollDateOverride,\n`, ''],
  [`  PollDeliverySource,\n`, ''],
  [`  PollDeliveryStatus,\n`, ''],
  [`  PollSelectionMode,\n`, ''],
  [`  PollSendHistoryRecord,\n`, ''],
  [`  PollTemplate,\n`, ''],
  // Fix pollsAsMenusEnabled references
  [/pollsAsMenusEnabled: [^\n]+\n/g, ''],
  [/pollsForCommunityEngagementEnabled: [^\n]+\n/g, ''],
  // Remove status field from group records (GroupStatus was removed)
  [/[ \t]+status: row\.status as GroupStatus,\n/g, ''],
  [/[ \t]+status: 'ACTIVE',\n/g, ''],
  [/[ \t]+status,\n(?=\s+\w)/g, ''],
]);

// ---- core/connection-manager.ts ----
// Restore qrCode from snapshot if present, as the original has it
// The business version removed it — we need to check
const cmContent = fs.readFileSync(BASE + '\\core\\connection-manager.ts', 'utf8');
if (cmContent.includes('qrCode')) {
  patch(BASE + '\\core\\connection-manager.ts', [
    // Remove qrCode from ConnectionSnapshot type if present
    [/\s+qrCode\?: string;\n/, '\n'],
    [/\s+qrCode: [^,\n]+,?\n/g, '\n'],
  ]);
}

// ---- core/maintenance-service.ts: remove groupDiscovery ----
patch(BASE + '\\core\\maintenance-service.ts', [
  // Remove groupDiscovery parameter from constructor
  [/,\s*private readonly groupDiscovery: GroupDiscoveryService/g, ''],
  [/private readonly groupDiscovery: GroupDiscoveryService,?\n/g, ''],
  // Remove GroupDiscoveryService import
  [/import type \{ GroupDiscoveryService \}[^\n]+\n/g, ''],
  // Remove listGroups call
  [/[^\n]*this\.groupDiscovery[^\n]+\n/g, ''],
  [/[^\n]*listGroups[^\n]+\n/g, ''],
  // Remove deleteFactoryResetTargets if not present
  [/[^\n]*deleteFactoryResetTargets[^\n]+\n/g, ''],
]);

// ---- core/bot-instance.ts: remove group-related things ----
patch(BASE + '\\core\\bot-instance.ts', [
  [/import type \{ GroupDiscoveryService \}[^\n]+\n/g, ''],
  [/private groupDiscovery[^\n]+\n/g, ''],
  [/[^\n]*this\.groupDiscovery[^\n]+\n/g, ''],
]);

// ---- core/message-processor.ts: remove group-related things ----
patch(BASE + '\\core\\message-processor.ts', [
  [/import type \{ ModerationEngine \}[^\n]+\n/g, ''],
  [/import type \{ GroupDiscoveryService \}[^\n]+\n/g, ''],
  [/[^\n]*ModerationEngine[^\n]+\n/g, ''],
  [/[^\n]*canBotSendToGroup[^\n]+\n/g, ''],
  [/[^\n]*listActiveBotGroupIds[^\n]+\n/g, ''],
]);

// ---- core/conversation-flow-service.ts: remove pollsAsMenusEnabled ----
patch(BASE + '\\core\\conversation-flow-service.ts', [
  [/[^\n]*pollsAsMenusEnabled[^\n]+\n/g, ''],
  [/[^\n]*selectableMenuPolls[^\n]+\n/g, ''],
]);

// ---- core/automatic-message-service.ts: remove group welcome references ----
patch(BASE + '\\core\\automatic-message-service.ts', [
  [/[^\n]*listActiveBotGroupIds[^\n]+\n/g, ''],
  [/[^\n]*getGroupRejection[^\n]+\n/g, ''],
  [/[^\n]*sendMessageWithMentions[^\n]+\n/g, ''],
  [/[^\n]*updateWelcomeRuntime[^\n]+\n/g, ''],
]);

console.log('\nAll patches applied.');
