import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

const filesToClean = [
  'src/admin/server.ts',
  'src/core/bot-instance.ts',
  'src/core/maintenance-service.ts',
  'src/core/message-processor.ts',
  'src/core/multi-bot-manager.ts',
  'src/messaging/whatsapp-adapter.ts'
];

for (const path of filesToClean) {
  const file = project.getSourceFile(path);
  if (file) {
    file.fixUnusedIdentifiers();
    // For bot-instance and multi-bot-manager, remove properties related to community
    const classes = file.getClasses();
    for (const cls of classes) {
      cls.getProperty('groupDiscovery')?.remove();
      cls.getProperty('automaticMessages')?.remove();
      cls.getProperty('pollRepository')?.remove();
      cls.getProperty('pollScheduler')?.remove();
      cls.getProperty('pollSender')?.remove();
      cls.getProperty('pollService')?.remove();
      cls.getProperty('moderationService')?.remove();

      // also remove from constructor
      const ctors = cls.getConstructors();
      for (const ctor of ctors) {
        const params = ctor.getParameters();
        for (const p of params) {
          const name = p.getName();
          if (['groupDiscovery', 'automaticMessages', 'pollRepository', 'pollScheduler', 'pollSender', 'pollService', 'moderationService'].includes(name)) {
            p.remove();
          }
        }
      }
    }
  }
}

// WhatsApp adapter fix missing resolvePublicWhatsAppName
const waAdapter = project.getSourceFile('src/messaging/whatsapp-adapter.ts');
if (waAdapter) {
  waAdapter.addFunction({
    name: 'resolvePublicWhatsAppName',
    parameters: [{ name: 'contact', type: 'any' }],
    returnType: 'string',
    statements: 'return contact.pushname || contact.name || "Usuario";'
  });
}

// For AppDatabase remaining failing methods, let's just add them back as empty stubs so it compiles for now,
// or we can remove the code calling them. Since there are many scattered calls, let's remove the calls.
const dbFile = project.getSourceFile('src/persistence/database.ts');
if (dbFile) {
  dbFile.fixUnusedIdentifiers();
  
  // Remove missing default imports
  const imports = dbFile.getImportDeclarations();
  for (const imp of imports) {
    const spec = imp.getModuleSpecifierValue();
    if (spec.includes('automatic-message-defaults') || spec.includes('brief-message-defaults') || spec.includes('poll-defaults')) {
      imp.remove();
    }
  }
}

project.saveSync();
