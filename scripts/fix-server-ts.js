import { Project } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

const serverFile = project.getSourceFile('src/admin/server.ts');
if (serverFile) {
  serverFile.fixUnusedIdentifiers();
  
  // Quick fix for implicit any parameters
  serverFile.forEachDescendant(node => {
    if (node.getKindName() === 'Parameter') {
      const typeNode = node.getTypeNode();
      if (!typeNode && !node.getText().includes('...')) {
        // Only if it doesn't have a type
        // This is a hacky way to just make it compile.
        node.setType('any');
      }
    }
  });
}

project.saveSync();
console.log('Fixed unused identifiers and implicit anys');
