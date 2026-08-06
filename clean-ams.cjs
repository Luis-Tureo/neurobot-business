const { Project } = require('ts-morph');
const project = new Project();
project.addSourceFileAtPath('src/core/automatic-message-service.ts');
const sourceFile = project.getSourceFile('src/core/automatic-message-service.ts');
const cls = sourceFile.getClass('AutomaticMessageService');

const methodsToRemove = [
  'handleGroupJoin',
  'flushWelcome',
  'scheduleWelcomeReconciliation',
  'reconcileWelcomeBatches',
  'markWelcomeListenerRegistered'
];

methodsToRemove.forEach(name => {
  const method = cls.getMethod(name);
  if (method) method.remove();
});

const propsToRemove = [
  'welcomeReconciliationTimer',
  'welcomeBatches',
  'joinEvents',
  'joinedParticipants'
];

propsToRemove.forEach(name => {
  const prop = cls.getProperty(name);
  if (prop) prop.remove();
});

// Also in constructor, remove joinEvents and joinedParticipants initialization
const constructor = cls.getConstructors()[0];
constructor.getStatements().forEach(stmt => {
  const text = stmt.getText();
  if (text.includes('welcomeTtl') || text.includes('joinEvents') || text.includes('joinedParticipants')) {
    stmt.remove();
  }
});

// Also remove from stop() and reconfigure() and start()
['start', 'stop', 'reconfigure'].forEach(name => {
  const method = cls.getMethod(name);
  if (method) {
    method.getStatements().forEach(stmt => {
      const text = stmt.getText();
      if (text.includes('Welcome') || text.includes('welcome') || text.includes('joinEvents') || text.includes('joinedParticipants')) {
        stmt.remove();
      }
    });
  }
});

// Also we need to clean sendToGroup (it might have taskType === 'WELCOME')
const sendToGroup = cls.getMethod('sendToGroup');
if (sendToGroup) {
  sendToGroup.getStatements().forEach(stmt => {
    if (stmt.getText().includes('taskType === \'WELCOME\'') || stmt.getText().includes('taskType === "WELCOME"')) {
      stmt.remove();
    }
  });
}

sourceFile.saveSync();
console.log('Cleaned automatic-message-service.ts');
