import { Project, SyntaxKind, Node } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

// 1. server.ts
const serverFile = project.getSourceFile('src/admin/server.ts');
if (serverFile) {
  const calls = serverFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  const stmtsToRemove = [];
  for (const call of calls) {
    if (call.wasForgotten()) continue;
    const text = call.getText();
    if (text.startsWith("fastify.get('/api/groups") || 
        text.startsWith("fastify.post('/api/groups") ||
        text.startsWith("fastify.put('/api/groups") ||
        text.startsWith("fastify.delete('/api/groups") ||
        text.startsWith("fastify.get('/api/polls") || 
        text.startsWith("fastify.post('/api/polls") ||
        text.startsWith("fastify.put('/api/polls") ||
        text.startsWith("fastify.delete('/api/polls") ||
        text.startsWith("fastify.get('/api/rules") || 
        text.startsWith("fastify.post('/api/rules") ||
        text.startsWith("fastify.put('/api/rules") ||
        text.startsWith("fastify.delete('/api/rules") ||
        text.startsWith("fastify.get('/api/moderation") || 
        text.startsWith("fastify.post('/api/moderation") ||
        text.startsWith("fastify.put('/api/moderation") ||
        text.startsWith("fastify.get('/api/welcome") || 
        text.startsWith("fastify.post('/api/welcome") ||
        text.startsWith("fastify.put('/api/welcome") ||
        text.startsWith("fastify.get('/api/commands") || 
        text.startsWith("fastify.post('/api/commands") ||
        text.startsWith("fastify.put('/api/commands") ||
        text.startsWith("fastify.delete('/api/commands") ||
        text.startsWith("fastify.get('/api/keywords") ||
        text.startsWith("fastify.post('/api/keywords") ||
        text.startsWith("fastify.delete('/api/keywords") ||
        text.startsWith("fastify.post('/api/silences") ||
        text.startsWith("fastify.delete('/api/silences")) {
      const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
      if (stmt && !stmtsToRemove.includes(stmt)) {
        stmtsToRemove.push(stmt);
      }
    }
  }
  for (const stmt of stmtsToRemove) {
    if (!stmt.wasForgotten()) {
      stmt.remove();
    }
  }
}

// 2. index.ts - comment out community services
const indexFile = project.getSourceFile('src/index.ts');
if (indexFile) {
  const mainFunc = indexFile.getFunction('main');
  if (mainFunc) {
    const stmts = mainFunc.getStatements();
    for (const stmt of stmts) {
      const text = stmt.getText();
      if (text.includes('new GroupDiscoveryService') || 
          text.includes('new AutomaticMessagesService') || 
          text.includes('new PollRepository') || 
          text.includes('new PollService') || 
          text.includes('new PollScheduler') ||
          text.includes('new MaintenanceService')) {
        stmt.replaceWithText('// ' + text);
      }
    }
  }
}

// 3. database.ts - remove community tables
const dbFile = project.getSourceFile('src/persistence/database.ts');
if (dbFile) {
  const classDecl = dbFile.getClass('AppDatabase');
  if (classDecl) {
    const migrateMethod = classDecl.getMethod('migrate');
    if (migrateMethod) {
      let text = migrateMethod.getText();
      const tables = [
        'groups', 'administrators', 'commands', 'keywords', 'silences',
        'automatic_message_tasks', 'automatic_message_templates', 'scheduled_message_deliveries',
        'automatic_group_backoff', 'poll_templates', 'poll_options', 'poll_schedule_config',
        'poll_send_history', 'poll_date_overrides', 'poll_settings', 'linked_groups', 'blocked_groups',
        'bot_groups', 'bot_automation_settings', 'bot_automatic_configurations',
        'bot_scheduled_message_deliveries', 'bot_automatic_group_backoff', 'bot_poll_templates',
        'bot_poll_options', 'bot_poll_configurations', 'bot_poll_date_overrides', 'bot_poll_send_history',
        'bot_welcome_baseline', 'bot_welcome_deduplication', 'bot_welcome_runtime', 'assistant_poll_template_settings',
        'assistant_moderation_settings', 'assistant_group_moderation_settings', 'moderation_rules',
        'moderation_rule_conditions', 'moderation_rule_exceptions', 'moderation_terms', 'moderation_cases',
        'moderation_recurrence', 'moderation_metrics', 'assistant_welcome_settings', 'assistant_group_welcome_settings',
        'group_moderation_profiles', 'group_moderation_tests', 'group_moderation_admin_recipients',
        'bot_welcome_group_runtime'
      ];
      for (const table of tables) {
        const regex = new RegExp('CREATE TABLE (IF NOT EXISTS )?\\\\b' + table + '\\\\b\\\\s*\\\\([\\\\s\\\\S]*?\\\\);\\\\s*', 'g');
        text = text.replace(regex, '');
      }
      migrateMethod.setBodyText(text.substring(text.indexOf('{') + 1, text.lastIndexOf('}')));
    }
  }
}

project.saveSync();
console.log('Cleaned up routes, services, and tables');
