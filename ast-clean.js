import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

function cleanFile(fileName) {
  const file = project.getSourceFile(fileName);
  if (!file) return;
  
  // Clean imports of missing modules
  const imports = file.getImportDeclarations();
  for (const imp of imports) {
    const modSpecifier = imp.getModuleSpecifierValue();
    if (modSpecifier.includes('poll-defaults.js') || modSpecifier.includes('moderation-service.js') || modSpecifier.includes('group-discovery.js') || modSpecifier.includes('group-moderation-service.js') || modSpecifier.includes('automatic-message-service.js') || modSpecifier.includes('poll-repository.js') || modSpecifier.includes('poll-scheduler.js') || modSpecifier.includes('poll-service.js') || modSpecifier.includes('welcome-personalization.js')) {
      imp.remove();
      continue;
    }
  }

  // Find types that are missing from types.ts and remove them from imports
  const badTypes = [
    'DetectedGroup', 'HiddenPollTemplate', 'PollConfiguration', 'PollDeliverySource', 'PollDeliveryStatus', 'PollSelectionMode', 'PollTemplate', 'PollSendHistoryRecord', 'GroupListSource', 'NativePoll', 'GroupJoinEvent', 'GroupChangeEvent'
  ];
  for (const imp of file.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue().includes('types.js')) {
      for (const namedImport of imp.getNamedImports()) {
        if (badTypes.includes(namedImport.getName())) {
          namedImport.remove();
        }
      }
    }
  }
}

['src/persistence/database.ts', 'src/core/multi-bot-manager.ts', 'src/core/bot-instance.ts', 'src/core/message-processor.ts', 'src/core/maintenance-service.ts', 'src/messaging/whatsapp-adapter.ts', 'src/messaging/whatsapp-cloud-api-adapter.ts', 'src/messaging/simulated-client.ts'].forEach(cleanFile);

// For database.ts
const dbFile = project.getSourceFile('src/persistence/database.ts');
if (dbFile) {
  const classDecl = dbFile.getClass('AppDatabase');
  if (classDecl) {
    const methods = classDecl.getMethods();
    for (const method of methods) {
      const name = method.getName();
      if (
        name.includes('Poll') ||
        name.includes('Group') ||
        name.includes('Moderation') ||
        name.includes('Community') ||
        name.includes('Command') ||
        name.includes('Keyword') ||
        name.includes('AutomaticMessage')
      ) {
        method.remove();
      }
    }
  }
}

// For multi-bot-manager.ts
const multiBotFile = project.getSourceFile('src/core/multi-bot-manager.ts');
if (multiBotFile) {
  const classDecl = multiBotFile.getClass('MultiBotManager');
  if (classDecl) {
    for (const prop of classDecl.getProperties()) {
      const name = prop.getName();
      if (name.includes('poll') || name.includes('group') || name.includes('moderation') || name.includes('automatic')) {
        prop.remove();
      }
    }
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('poll') || name.includes('group') || name.includes('moderation') || name.includes('automatic')) {
        method.remove();
      }
    }
  }
}

// For bot-instance.ts
const botInstanceFile = project.getSourceFile('src/core/bot-instance.ts');
if (botInstanceFile) {
  const classDecl = botInstanceFile.getClass('BotInstance');
  if (classDecl) {
    for (const prop of classDecl.getProperties()) {
      const name = prop.getName();
      if (name.includes('poll') || name.includes('group') || name.includes('moderation') || name.includes('automatic')) {
        prop.remove();
      }
    }
  }
}

// For whatsapp-adapter.ts
const waAdapterFile = project.getSourceFile('src/messaging/whatsapp-adapter.ts');
if (waAdapterFile) {
  const classDecl = waAdapterFile.getClass('WhatsAppAdapter');
  if (classDecl) {
    for (const prop of classDecl.getProperties()) {
      if (prop.getName().includes('onGroup')) prop.remove();
    }
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive')) {
        method.setBodyText('return Promise.resolve() as any;');
      }
    }
  }
}

// For whatsapp-cloud-api-adapter.ts
const waCloudAdapterFile = project.getSourceFile('src/messaging/whatsapp-cloud-api-adapter.ts');
if (waCloudAdapterFile) {
  const classDecl = waCloudAdapterFile.getClass('WhatsAppCloudAPIAdapter');
  if (classDecl) {
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive')) {
        method.setBodyText('return Promise.resolve() as any;');
      }
    }
  }
}

// For simulated-client.ts
const simClientFile = project.getSourceFile('src/messaging/simulated-client.ts');
if (simClientFile) {
  const classDecl = simClientFile.getClass('SimulatedMessagingClient');
  if (classDecl) {
    for (const prop of classDecl.getProperties()) {
      if (prop.getName().includes('group') || prop.getName().includes('poll')) prop.remove();
    }
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive')) {
        method.setBodyText('return Promise.resolve() as any;');
      }
    }
  }
}

project.saveSync();
console.log('AST clean complete.');

