import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

const toRemove = [];

// Fix Database leftover methods
const dbFile = project.getSourceFile('src/persistence/database.ts');
if (dbFile) {
  const classDecl = dbFile.getClass('AppDatabase');
  if (classDecl) {
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (
        name.includes('AutomaticMessage') ||
        name.includes('Poll') ||
        name.includes('Community') ||
        name.includes('Group') ||
        name.includes('Moderation') ||
        name.includes('listCommands') ||
        name.includes('getCommand') ||
        name.includes('listKeywords')
      ) {
        toRemove.push(method);
      }
    }
  }
}

// Fix WhatsAppWebAdapter leftovers
const waAdapterFile = project.getSourceFile('src/messaging/whatsapp-adapter.ts');
if (waAdapterFile) {
  const classDecl = waAdapterFile.getClass('WhatsAppWebAdapter');
  if (classDecl) {
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive') || name.includes('resolvePublicWhatsAppName')) {
        toRemove.push(method);
      }
    }
    for (const prop of classDecl.getProperties()) {
      if (prop.getName().includes('onGroup')) {
        toRemove.push(prop);
      }
    }
  }
}

// Fix WhatsAppCloudAPIAdapter leftovers
const waCloudFile = project.getSourceFile('src/messaging/whatsapp-cloud-api-adapter.ts');
if (waCloudFile) {
  const classDecl = waCloudFile.getClass('WhatsAppCloudAPIAdapter');
  if (classDecl) {
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive')) {
        toRemove.push(method);
      }
    }
  }
}

// Fix SimulatedClient leftovers
const simClientFile = project.getSourceFile('src/messaging/simulated-client.ts');
if (simClientFile) {
  const classDecl = simClientFile.getClass('SimulatedMessagingClient');
  if (classDecl) {
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive')) {
        toRemove.push(method);
      }
    }
  }
}

// Fix index.ts
const indexFile = project.getSourceFile('src/index.ts');
if (indexFile) {
  const classDecl = indexFile.getClass('AppServer');
  if (classDecl) {
    const classProp = classDecl.getProperty('instances');
    if (classProp) {
        // Wait, they are in MultiBotManager? Let's check MultiBotManager!
    }
    
    // In MultiBotManager...
    const multiFile = project.getSourceFile('src/core/multi-bot-manager.ts');
    if (multiFile) {
        const mmClass = multiFile.getClass('MultiBotManager');
        if (mmClass) {
            for (const prop of mmClass.getProperties()) {
                const name = prop.getName();
                if (name.includes('group') || name.includes('poll') || name.includes('automaticMessages')) {
                    toRemove.push(prop);
                }
            }
        }
    }

    for (const method of classDecl.getMethods()) {
      if (method.getName() === 'start') {
        for (const stmt of method.getStatements()) {
          if (stmt.getText().includes('groupDiscovery') || stmt.getText().includes('automaticMessages') || stmt.getText().includes('pollRepository') || stmt.getText().includes('pollService') || stmt.getText().includes('pollScheduler')) {
            toRemove.push(stmt);
          }
        }
      }
    }
  }
}

// Remove them all safely!
toRemove.forEach(node => {
  try {
    node.remove();
  } catch (e) {
    console.error('Error removing node:', e.message);
  }
});

// Fix types.ts leftovers
const typesFile = project.getSourceFile('src/domain/types.ts');
if (typesFile) {
  const badExports = ['GroupListSource', 'PollDeliverySource', 'PollDeliveryStatus'];
  for (const exp of typesFile.getTypeAliases()) {
    if (badExports.includes(exp.getName())) {
      exp.remove();
    }
  }
}

project.saveSync();
console.log('ast-clean-2 robust complete.');
