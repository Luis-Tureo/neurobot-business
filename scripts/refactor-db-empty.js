import { Project } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/persistence/database.ts');

const sourceFile = project.getSourceFile('src/persistence/database.ts');
if (!sourceFile) throw new Error('database.ts not found');

const classDecl = sourceFile.getClass('AppDatabase');
if (!classDecl) throw new Error('AppDatabase class not found');

const methodsToEmpty = [
  'getWelcomeGroupSetting',
  'listWelcomeGroupSettings',
  'saveWelcomeGroupSetting',
  'getWelcomeRuntime',
  'updateWelcomeRuntime',
  'hasWelcomeBaselineParticipant',
  'addWelcomeBaselineParticipant',
  'isWelcomeGroupBaselineInitialized',
  'markWelcomeGroupBaselineInitialized',
  'claimWelcomeParticipant',
  'getPollConfiguration',
  'savePollConfiguration',
  'listPollTemplates',
  'listHiddenPollTemplates',
  'hidePollTemplateForAssistant',
  'restorePollTemplateForAssistant',
  'restoreAllDefaultPollsForAssistant',
  'getPollTemplate',
  'savePollTemplate',
  'deletePollTemplate',
  'restoreDefaultPollTemplates',
  'getPollDateOverride',
  'listPollDateOverrides',
  'savePollDateOverride',
  'deletePollDateOverride',
  'claimPollDelivery',
  'getPollDelivery',
  'getPollTemplateIdForLocalDate',
  'beginPollAttempt',
  'completePollAttempt',
  'listPollSendHistory',
  'listPollUsage',
  'listCommands',
  'getCommand',
  'getDefaultCommandResponse',
  'restoreCommandDefault',
  'getCommandById',
  'saveCommand',
  'deleteCommand',
  'listKeywords',
  'replaceKeywords',
  'setSilence',
  'getSilenceRemainingMs',
  'getGroupModerationProfile',
  'listGroupModerationProfiles',
  'saveGroupModerationDraft',
  'markGroupModerationAnalyzing',
  'failGroupModerationAnalysis',
  'saveCompiledGroupModeration',
  'recordGroupModerationTest',
  'listGroupModerationTests',
  'updateGroupModerationTestStatus',
  'setGroupModerationEnabled',
  'replaceGroupModerationRecipients',
  'listGroupModerationRecipients',
  'getModerationSettings',
  'saveModerationSettings',
  'listModerationGroupSettings',
  'saveModerationGroupSettings',
  'listModerationRules',
  'getModerationRule',
  'createModerationRule',
  'updateModerationRule',
  'deleteModerationRule',
  'listModerationTerms',
  'createModerationTerm',
  'deleteModerationTerm',
  'createModerationCase',
  'listModerationCases',
  'reviewModerationCase',
  'getModerationEvidence',
  'getModerationRecurrence',
  'saveModerationRecurrence',
  'resetModerationRecurrence',
  'decrementModerationRecurrence',
  'incrementModerationMetric',
  'getModerationMetrics',
  'expireModerationEvidence',
  'anonymizeExpiredModerationCases',
  'getAutomaticMessageConfiguration',
  'saveAutomaticMessageConfiguration',
  'getAutomaticTemplateCustomization',
  'restoreAutomaticTemplate',
  'claimScheduledDelivery',
  'createManualDelivery',
  'createWelcomeDelivery',
  'updateScheduledDelivery',
  'listScheduledDeliveries',
  'getAutomaticGroupBackoffRemainingMs',
  'setAutomaticGroupBackoff',
  'listLinkedGroups',
  'setGroupBlocked',
  'isGroupBlocked',
  'synchronizeBotGroup',
  'markMissingBotGroups',
  'markBotGroupNotMember',
  'canBotSendToGroup',
  'listActiveBotGroupIds',
  'setBotGroupBlocked',
  'listBotGroups',
  'resolveBotGroupKey',
  'upsertDetectedGroup',
  'synchronizeDetectedGroup',
  'listGroups',
  'getGroupById',
  'listGroupsByStatus',
  'markMissingGroups',
  'markGroupBotNotMember',
  'archiveGroup',
  'restoreGroup',
  'deleteGroupRecord',
  'deleteBotGroupRecord',
  'removeInactiveBotGroupsMissingFromScan',
  'setGroupPublicListing',
  'listPublicOperationalGroups',
  'canAuthorizeGroup',
  'canSendToGroup',
  'setGroupAuthorized',
  'isGroupAuthorized',
  'previewGroupCleanup',
  'cleanupInactiveGroups'
];

for (const methodName of methodsToEmpty) {
  const method = classDecl.getMethod(methodName);
  if (method) {
    method.setBodyText(`throw new Error('${methodName} is not supported in the Business Assistant');`);
  }
}

// Remove the community tables from the big CREATE TABLE schema in migrate()
// The migrate() method contains a massive SQL string.
// We'll replace all CREATE TABLE lines for community tables with empty strings.
const migrateMethod = classDecl.getMethod('migrate');
if (migrateMethod) {
  let text = migrateMethod.getText();
  
  const communityTables = [
    'groups', 'administrators', 'commands', 'keywords', 'silences',
    'automatic_message_tasks', 'automatic_message_templates', 'scheduled_message_deliveries',
    'automatic_group_backoff', 'poll_templates', 'poll_options', 'poll_schedule_config',
    'poll_send_history', 'poll_date_overrides', 'poll_settings', 'linked_groups', 'blocked_groups',
    'bot_groups', 'human_assistance_requests', 'bot_automation_settings', 'bot_automatic_configurations',
    'bot_scheduled_message_deliveries', 'bot_automatic_group_backoff', 'bot_poll_templates',
    'bot_poll_options', 'bot_poll_configurations', 'bot_poll_date_overrides', 'bot_poll_send_history',
    'bot_welcome_baseline', 'bot_welcome_deduplication', 'bot_welcome_runtime', 'assistant_poll_template_settings',
    'assistant_moderation_settings', 'assistant_group_moderation_settings', 'moderation_rules',
    'moderation_rule_conditions', 'moderation_rule_exceptions', 'moderation_terms', 'moderation_cases',
    'moderation_recurrence', 'moderation_metrics', 'assistant_welcome_settings', 'assistant_group_welcome_settings',
    'group_moderation_profiles', 'group_moderation_tests', 'group_moderation_admin_recipients',
    'bot_welcome_group_runtime'
  ];
  
  for (const table of communityTables) {
    // Regex to match "CREATE TABLE IF NOT EXISTS table (...)" or "CREATE TABLE table (...)" up to the closing ");"
    // Since we don't want to parse SQL AST, this regex must be multiline.
    // However, it's safer to just replace `this.db.exec(...)` contents.
    // Instead of regex, we'll just let the tables exist in SQL schema but they won't be used,
    // OR we can just ignore for now since it doesn't hurt compilation, but the instructions say "The Business Assistant database must contain only the schemas needed by the business application".
    
    const regex = new RegExp(`CREATE TABLE (IF NOT EXISTS )?${table} \\([\\s\\S]*?\\);`, 'g');
    text = text.replace(regex, '');
  }
  
  // replace method text
  // Actually, setting the whole method text might break indent or signature, but replace is fine.
  // We can just use string replacement on the whole file.
}

project.saveSync();
console.log('Emptied community methods in database.ts');
