import { Project } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/core/message-processor.ts');

const sourceFile = project.getSourceFile('src/core/message-processor.ts');
if (sourceFile) {
  const classDecl = sourceFile.getClass('MessageProcessor');
  if (classDecl) {
    const methodsToRemove = ['processCommand', 'processRuleBased'];
    for (const name of methodsToRemove) {
      const method = classDecl.getMethod(name);
      if (method) method.remove();
    }
  }
  sourceFile.fixUnusedIdentifiers();
  project.saveSync();
}
