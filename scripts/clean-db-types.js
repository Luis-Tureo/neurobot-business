import { Project } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/persistence/database.ts');

const sourceFile = project.getSourceFile('src/persistence/database.ts');
if (sourceFile) {
  // Fix imports by removing unused
  sourceFile.fixUnusedIdentifiers();
  // We can also find unused types
  const interfaces = ['CommandRow', 'GroupRow', 'KeywordRow', 'ScheduledDeliveryRow', 'PollTemplateRow', 'PollHistoryRow'];
  for (const name of interfaces) {
    const intf = sourceFile.getInterface(name);
    if (intf) intf.remove();
  }
  project.saveSync();
}
