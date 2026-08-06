import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

function isBad(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.includes('poll') || lower.includes('moderation') || lower.includes('groupdiscovery') || lower.includes('welcomepersonalization') || lower === 'grouplistsource' || lower === 'groupstatus';
}

function cleanFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
  });

  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      if (src.includes('poll') || src.includes('group-discovery') || src.includes('moderation') || src.includes('welcome-personalization')) {
        path.remove();
      } else {
        path.node.specifiers = path.node.specifiers.filter(spec => {
          const name = spec.imported ? spec.imported.name : spec.local.name;
          if (name && isBad(name)) return false;
          return true;
        });
        if (path.node.specifiers.length === 0) path.remove();
      }
    },
    ClassProperty(path) {
      const name = path.node.key.name;
      if (isBad(name) || name === 'communityServicesEnabled' || name === 'selectableMenuPolls' || name === 'sentPolls' || (name && (name.includes('welcome') || name.includes('Welcome')))) {
        path.remove();
      }
    },
    ClassMethod(path) {
      const name = path.node.key.name;
      if (name === 'processAutomaticGroupMessage' || name === 'getGroupRejection' || name === 'sendPoll' || name === 'getGroupList' || name === 'handleGroupNotification' || name === 'notifyGroupChanged') {
        path.remove();
      }
      if (name.includes('Welcome') || name.includes('welcome')) {
         if (name !== 'sendWelcomeTest' && name !== 'previewWelcome' && name !== 'scheduleWelcomeReconciliation') {
            path.remove();
         } else {
            path.remove(); // Actually remove all of them.
         }
      }
      if (name === 'syncBotGroups') {
        path.get('body').replaceWithSourceString('{ return { syncedGroups: 0 }; }');
      }
      if (name === 'deleteBotOrphanData') {
        path.get('body').replaceWithSourceString("{ return { status: 'SUCCESS' }; }");
      }
      if (name === 'buildPrompt' && filePath.includes('rule-based-response-provider.ts')) {
        path.get('body').replaceWithSourceString('{ return this.formatBasePrompt(botId, capabilities); }');
      }
    },
    TSPropertySignature(path) {
      const name = path.node.key.name;
      if (isBad(name) || name === 'onGroupJoin' || name === 'onGroupLeave' || name === 'onGroupChanged' || name === 'communityPollVotesNoAction' || name === 'pollsAsMenusEnabled' || name === 'pollsForCommunityEngagementEnabled') {
        path.remove();
      }
    },
    ObjectProperty(path) {
      const name = path.node.key.name;
      if (name === 'onGroupJoin' || name === 'onGroupLeave' || name === 'onGroupChanged' || name === 'communityPollVotesNoAction' || name === 'discovery' || name === 'moderation' || name === 'pollsAsMenusEnabled' || name === 'pollsForCommunityEngagementEnabled' || name === 'polls_as_menus_enabled' || name === 'polls_for_community_engagement_enabled') {
        path.remove();
      }
    },
    CallExpression(path) {
      if (path.node.callee.type === 'MemberExpression' && path.node.callee.property.name === 'sendMessageWithMentions') {
        path.node.callee.property.name = 'sendMessage';
      }
      if (path.node.callee.type === 'MemberExpression' && path.node.callee.property.name === 'get') {
         if (path.node.callee.object.type === 'Identifier' && path.node.callee.object.name === 'app') {
            const arg = path.node.arguments[0];
            if (arg && arg.value === '/api/admin/bot/:botId/groups/:identifier/resolve') {
               path.parentPath.remove();
            }
         }
      }
    },
    ExpressionStatement(path) {
      const code = generate(path.node).code;
      if (code.includes('this.discovery =') || code.includes('this.pollRepository =') || code.includes('this.pollService =') || code.includes('this.pollScheduler =') || code.includes('this.moderation =') || code.includes('this.communityServicesEnabled =')) {
        path.remove();
      }
      if (code.includes('this.pollScheduler.start') || code.includes('this.pollScheduler.stop') || code.includes('this.pollScheduler.reconfigure')) {
        path.remove();
      }
      if (code.includes('this.discovery.start') || code.includes('this.discovery.stop')) {
        path.remove();
      }
      if (code.includes('this.moderationService.evaluateMessage')) {
        path.remove();
      }
      if (code.includes('this.selectableMenuPolls.set') || code.includes('this.selectableMenuPolls.delete')) {
        path.remove();
      }
      if (code.includes('this.notifyGroupChanged')) {
        path.remove();
      }
      if (code.includes('this.whatsapp.on(\'group_join') || code.includes('this.whatsapp.on(\'group_leave') || code.includes('this.whatsapp.on(\'group_update')) {
        path.remove();
      }
      if (code.includes('setAutomaticGroupBackoff')) {
        path.remove();
      }
    },
    VariableDeclaration(path) {
      const code = generate(path.node).code;
      if (code.includes('pollSelector =') || code.includes('pollSender =')) {
        path.remove();
      }
    },
    IfStatement(path) {
      const code = generate(path.node).code;
      if (code.includes('this.communityServicesEnabled') || code.includes('pollsAsMenusEnabled')) {
        path.remove();
      }
      if (code.includes('message.fromGroupId') && (code.includes('canBotSendToGroup') || code.includes('processAutomaticGroupMessage'))) {
        path.remove();
      }
      if (code.includes('isSupportedGroupId') || code.includes('notifyGroupChanged') || code.includes('communityPollVotesNoAction')) {
        path.remove();
      }
      if (code.includes('this.moderationService')) {
         if (code.includes('evaluateMessage')) path.remove();
      }
      if (code.includes('msg.type === \'poll_creation\'')) {
        path.remove();
      }
      if (code.includes('message.type === \'vcard\'')) {
         if (code.includes('welcomePersonalization')) path.remove();
      }
      if (code.includes('chat.isGroup') || code.includes('isGroup')) {
        path.remove();
      }
      if (code.includes('expectedPollBody')) {
        path.remove();
      }
    },
    FunctionDeclaration(path) {
       const name = path.node.id ? path.node.id.name : '';
       if (name.includes('Welcome') || name.includes('welcome')) {
          path.remove();
       }
    },
    TSTypeAliasDeclaration(path) {
      const name = path.node.id.name;
      if (isBad(name) || name === 'GroupDiscoveryState' || name === 'GroupDiscoverySnapshot' || name === 'PollSelectionMode' || name === 'HiddenPollTemplate' || name === 'PollConfiguration' || name === 'PollSendHistoryRecord' || name === 'PollDateOverride') {
        path.remove();
      }
    }
  });

  const newCode = generate(ast, { retainLines: false }).code;
  writeFileSync(filePath, newCode);
  console.log(`Cleaned ${filePath}`);
}

const files = [
  'src/core/automatic-message-service.ts',
  'src/core/bot-instance.ts',
  'src/core/multi-bot-manager.ts',
  'src/core/message-processor.ts',
  'src/core/maintenance-service.ts',
  'src/core/rule-based-response-provider.ts',
  'src/core/conversation-flow-service.ts',
  'src/core/connection-manager.ts',
  'src/index.ts',
  'src/messaging/simulated-client.ts',
  'src/messaging/whatsapp-adapter.ts',
  'src/messaging/whatsapp-cloud-api-adapter.ts',
  'src/domain/types.ts',
  'src/admin/server.ts',
  'src/persistence/database.ts'
];

for (const f of files) {
  try {
    cleanFile(f);
  } catch (e) {
    console.error(`Error processing ${f}:`, e.message);
  }
}
