import { Project, SyntaxKind, Node } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths('src/**/*.ts');

// 2. Refactor Admin Server
const serverFile = project.getSourceFile('src/admin/server.ts');
if (serverFile) {
  const calls = serverFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  const stmtsToRemove = [];
  for (const call of calls) {
    if (call.wasForgotten()) continue;
    const text = call.getText();
    if (text.includes("'/api/groups'") || 
        text.includes("'/api/polls'") || 
        text.includes("'/api/rules'") || 
        text.includes("'/api/moderation'") || 
        text.includes("'/api/welcome'") || 
        text.includes("'/api/commands'") || 
        text.includes("'/api/keywords'") ||
        text.includes("'/api/silences'")) {
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
  
  const buildFunc = serverFile.getFunction('buildAdminServer');
  if (buildFunc) {
    const params = buildFunc.getParameters();
    if (params.length > 0) {
      const typeRef = params[0].getTypeNode();
      if (typeRef && Node.isTypeLiteral(typeRef)) {
        typeRef.getProperty('groupDiscovery')?.remove();
        typeRef.getProperty('automaticMessages')?.remove();
        typeRef.getProperty('pollRepository')?.remove();
        typeRef.getProperty('pollService')?.remove();
        typeRef.getProperty('pollScheduler')?.remove();
      }
    }
  }
  
  serverFile.fixUnusedIdentifiers();
}

project.saveSync();
console.log('Successfully stripped community routes from server.ts');
