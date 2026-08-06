import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

const toRemove = [];

const waAdapterFile = project.getSourceFile('src/messaging/whatsapp-adapter.ts');
if (waAdapterFile) {
  const classDecl = waAdapterFile.getClass('WhatsAppAdapter');
  if (classDecl) {
    for (const method of classDecl.getMethods()) {
      const name = method.getName();
      if (name.includes('Group') || name.includes('Poll') || name.includes('Mentions') || name.includes('unarchive') || name.includes('resolvePublicWhatsAppName')) {
        toRemove.push(method);
      }
    }
  }
}

console.log('Found nodes to remove:', toRemove.length);
toRemove.forEach(node => {
  console.log('Removing:', node.getText().slice(0, 50));
  node.remove();
});

project.saveSync();
console.log('Done');
