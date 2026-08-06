import { Project, SyntaxKind } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

const toRemove = [];

// Remove ANY statement in ANY file that calls these dead methods/properties
const deadSignatures = [
  'cleanupSelectableMenuPolls',
  'notifyGroupChanged',
  'seedAutomaticMessages',
  'seedPolls',
  'getAutomaticMessageConfiguration',
  'saveAutomaticMessageConfiguration',
  'seedBotPollTemplates',
  'getCommand',
  'getCommandById',
  'onGroupJoin',
  'onGroupChanged',
  'registerCommunityInteraction',
  'listPublicOperationalGroups',
  'listCommands',
  'listKeywords'
];

for (const file of project.getSourceFiles()) {
  
  // Remove dead imports
  const imports = file.getImportDeclarations();
  for (const imp of imports) {
    const text = imp.getText();
    if (text.includes('poll-scheduler') || text.includes('poll-service') || text.includes('moderation-service') || text.includes('poll-defaults') || text.includes('welcome-personalization')) {
      toRemove.push(imp);
    }
    
    // Remove dead type imports from types.js
    if (imp.getModuleSpecifierValue().includes('types.js')) {
      for (const named of imp.getNamedImports()) {
        const name = named.getName();
        if (['GroupListSource', 'NativePoll', 'HiddenPollTemplate', 'PollConfiguration', 'PollDeliverySource', 'PollDeliveryStatus', 'PollSelectionMode', 'PollTemplate'].includes(name)) {
          toRemove.push(named);
        }
      }
    }
  }

  // Remove dead statements and properties and methods
  file.forEachDescendant(node => {
    if (node.getKind() === SyntaxKind.MethodDeclaration || node.getKind() === SyntaxKind.PropertyDeclaration) {
       const name = node.getName();
       if (deadSignatures.some(d => name === d)) {
           toRemove.push(node);
       }
    }
    
    if (node.getKind() === SyntaxKind.ExpressionStatement || node.getKind() === SyntaxKind.VariableStatement || node.getKind() === SyntaxKind.ReturnStatement || node.getKind() === SyntaxKind.IfStatement) {
       const text = node.getText();
       if (deadSignatures.some(d => text.includes(d))) {
           // careful not to remove the whole class if it matches somehow
           if (node.getParent() && (node.getParent().getKind() === SyntaxKind.Block || node.getParent().getKind() === SyntaxKind.SourceFile)) {
              toRemove.push(node);
           }
       }
    }
  });
}

// Special case: tests/answer-cache.test.ts
const testFile = project.getSourceFile('tests/answer-cache.test.ts');
if (testFile) {
    testFile.forEachDescendant(node => {
        if (node.getKind() === SyntaxKind.ExpressionStatement && node.getText().includes('registerCommunityInteraction')) {
            toRemove.push(node);
        }
    });
}

// Safe removal
const uniqueToRemove = [...new Set(toRemove)];
uniqueToRemove.forEach(node => {
  try {
    if (!node.wasForgotten()) {
      node.remove();
    }
  } catch (e) {
    // ignore
  }
});

project.saveSync();
console.log('Final AST sweep complete.');
