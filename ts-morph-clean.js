import pkg from 'ts-morph';
const { Project, SyntaxKind, Node } = pkg;

const project = new Project({
  tsConfigFilePath: 'tsconfig.json'
});

const badServices = ['GroupDiscoveryService', 'ModerationService', 'PollRepository', 'PollService', 'PollScheduler', 'PollSender', 'PollTemplateSelector'];
const badProps = ['discovery', 'pollRepository', 'pollService', 'pollScheduler', 'moderation', 'communityServicesEnabled'];

function isBadType(typeName) {
  return typeName.includes('GroupStatus') || typeName.includes('GroupListSource') || 
         typeName.includes('PollDeliverySource') || typeName.includes('PollDeliveryStatus') || 
         typeName.includes('NativePoll') || typeName.includes('PollTemplate');
}

for (const sf of project.getSourceFiles()) {
  let changed = false;

  // 1. Remove bad imports
  for (const dec of sf.getImportDeclarations()) {
    const src = dec.getModuleSpecifierValue();
    if (src.includes('poll') || src.includes('group-discovery') || src.includes('moderation') || src.includes('welcome-personalization')) {
      dec.remove();
      changed = true;
      continue;
    }
    const named = dec.getNamedImports();
    for (const n of named) {
      const name = n.getName();
      if (badServices.includes(name) || isBadType(name) || name === 'welcomePersonalization') {
        n.remove();
        changed = true;
      }
    }
    if (dec.getNamedImports().length === 0 && !dec.getDefaultImport()) {
      dec.remove();
      changed = true;
    }
  }

  // 2. Remove bad properties and methods from Classes
  for (const cls of sf.getClasses()) {
    for (const prop of cls.getProperties()) {
      if (badProps.includes(prop.getName()) || prop.getName() === 'selectableMenuPolls' || prop.getName() === 'sentPolls') {
        prop.remove();
        changed = true;
      }
    }
    for (const method of cls.getMethods()) {
      const name = method.getName();
      if (name === 'processAutomaticGroupMessage' || name === 'getGroupRejection' || name === 'sendPoll' || name === 'getGroupList' || name === 'handleGroupNotification' || name === 'notifyGroupChanged') {
        method.remove();
        changed = true;
      }
    }
    for (const ctor of cls.getConstructors()) {
      // Remove bad parameters
      for (const param of ctor.getParameters()) {
        const typeNode = param.getTypeNode();
        if (typeNode) {
          const typeName = typeNode.getText();
          if (badServices.some(s => typeName.includes(s))) {
            param.remove();
            changed = true;
          }
        }
      }
      // Remove statements assigning to bad properties
      ctor.getStatements().forEach(stmt => {
        const text = stmt.getText();
        if (badProps.some(p => text.includes(`this.${p} =`))) {
          stmt.remove();
          changed = true;
        } else if (text.includes('new PollRepository') || text.includes('new PollTemplateSelector') || text.includes('new PollSender') || text.includes('new PollService') || text.includes('new PollScheduler')) {
          stmt.remove();
          changed = true;
        }
      });
    }
  }

  // 3. Remove bad Object properties (like onGroupJoin)
  sf.forEachDescendant(node => {
    if (node.wasForgotten()) return;

    if (Node.isPropertyAssignment(node)) {
      const name = node.getName();
      if (name === 'onGroupJoin' || name === 'onGroupLeave' || name === 'onGroupChanged' || name === 'communityPollVotesNoAction' || name === 'discovery' || name === 'moderation') {
        if (!node.wasForgotten()) {
           node.remove();
           changed = true;
        }
      }
      if (name === 'pollsAsMenusEnabled' || name === 'pollsForCommunityEngagementEnabled' || name === 'polls_as_menus_enabled' || name === 'polls_for_community_engagement_enabled') {
        if (!node.wasForgotten()) {
          node.remove();
          changed = true;
        }
      }
    }
    
    // Remove if statements checking communityServicesEnabled
    if (Node.isIfStatement(node) && !node.wasForgotten()) {
      const condition = node.getExpression().getText();
      if (condition.includes('communityServicesEnabled') || condition.includes('pollsAsMenusEnabled')) {
        node.remove();
        changed = true;
      } else if (condition.includes('message.fromGroupId') && condition.includes('canBotSendToGroup')) {
        node.remove();
        changed = true;
      } else if (condition.includes('isSupportedGroupId') || condition.includes('communityPollVotesNoAction')) {
        node.remove();
        changed = true;
      } else if (condition.includes('message.type === \'vcard\'')) {
        node.remove();
        changed = true;
      } else if (condition.includes('chat.isGroup') || condition.includes('isGroup')) {
        node.remove();
        changed = true;
      } else if (condition.includes('this.moderationService')) {
        node.remove();
        changed = true;
      } else if (condition.includes('expectedPollBody')) {
        node.remove();
        changed = true;
      }
    }

    if (Node.isExpressionStatement(node) && !node.wasForgotten()) {
      const text = node.getText();
      if (text.includes('this.whatsapp.on(\'group_join') || text.includes('this.whatsapp.on(\'group_leave') || text.includes('this.whatsapp.on(\'group_update')) {
        node.remove();
        changed = true;
      } else if (text.includes('this.selectableMenuPolls')) {
        node.remove();
        changed = true;
      } else if (text.includes('setAutomaticGroupBackoff')) {
        node.remove();
        changed = true;
      } else if (text.includes('syncBotGroups')) {
        node.remove();
        changed = true;
      }
    }
    
    // Replace sendMessageWithMentions
    if (Node.isCallExpression(node) && !node.wasForgotten()) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        if (expr.getName() === 'sendMessageWithMentions') {
           expr.getNameNode().replaceWithText('sendMessage');
           changed = true;
        }
      }
    }
  });

  // 4. Remove types
  for (const ta of sf.getTypeAliases()) {
    if (isBadType(ta.getName()) || ta.getName() === 'GroupDiscoveryState' || ta.getName() === 'GroupDiscoverySnapshot' || ta.getName() === 'PollSelectionMode' || ta.getName() === 'HiddenPollTemplate' || ta.getName() === 'PollConfiguration' || ta.getName() === 'PollSendHistoryRecord' || ta.getName() === 'PollDateOverride') {
      ta.remove();
      changed = true;
    }
  }

  // 5. Remove interface properties
  for (const intf of sf.getInterfaces()) {
    for (const prop of intf.getProperties()) {
      const name = prop.getName();
      if (name === 'onGroupJoin' || name === 'onGroupLeave' || name === 'onGroupChanged' || name === 'communityPollVotesNoAction' || name === 'pollsAsMenusEnabled' || name === 'pollsForCommunityEngagementEnabled') {
        prop.remove();
        changed = true;
      }
    }
  }

  // 6. Fix AppDatabase calls in maintenance service
  if (sf.getBaseName() === 'maintenance-service.ts') {
    const syncBotGroups = sf.getClass('MaintenanceService')?.getMethod('syncBotGroups');
    if (syncBotGroups) {
      syncBotGroups.setBodyText('return { syncedGroups: 0 };');
      changed = true;
    }
    const deleteMethod = sf.getClass('MaintenanceService')?.getMethod('deleteBotOrphanData');
    if (deleteMethod) {
       // Just delete the whole method body if it has group references, and replace it
       deleteMethod.setBodyText('return { status: \'SUCCESS\' };');
       changed = true;
    }
  }

  // 7. Fix RuleBasedResponseProvider
  if (sf.getBaseName() === 'rule-based-response-provider.ts') {
    const buildPrompt = sf.getClass('RuleBasedResponseProvider')?.getMethod('buildPrompt');
    if (buildPrompt) {
       buildPrompt.setBodyText('return this.formatBasePrompt(botId, capabilities);');
       changed = true;
    }
  }

  // 8. Fix Admin Server resolve route
  if (sf.getBaseName() === 'server.ts') {
    const expressCalls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of expressCalls) {
      if (call.getText().includes('\'/api/admin/bot/:botId/groups/:identifier/resolve\'')) {
        call.remove();
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    sf.saveSync();
    console.log(`Saved ${sf.getFilePath()}`);
  }
}
