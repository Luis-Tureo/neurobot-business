const { Project } = require('ts-morph');
const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

const sourceFiles = project.getSourceFiles();

for (const sourceFile of sourceFiles) {
  let changed = false;

  // Admin server: remove API routes that error
  if (sourceFile.getFilePath().endsWith('admin/server.ts')) {
    const serverFunction = sourceFile.getFunction('buildAdminServer');
    if (serverFunction) {
      serverFunction.getStatements().forEach(stmt => {
        const text = stmt.getText();
        if (text.includes('app.get(\'/groups') || text.includes('app.post(\'/groups') || text.includes('app.put(\'/groups') || text.includes('app.delete(\'/groups') || text.includes('app.get(\'/moderation') || text.includes('app.post(\'/moderation') || text.includes('app.delete(\'/moderation') || text.includes('app.get(\'/polls') || text.includes('app.post(\'/polls') || text.includes('app.get(\'/bot/welcome') || text.includes('app.put(\'/bot/welcome')) {
          stmt.remove();
          changed = true;
        }
      });
    }
  }

  // Conversation flow: remove polls stuff
  if (sourceFile.getFilePath().endsWith('conversation-flow-service.ts')) {
    const cls = sourceFile.getClass('ConversationFlowService');
    if (cls) {
      const determine = cls.getMethod('determineFlowAndProcess');
      if (determine) {
        determine.getStatements().forEach(stmt => {
          if (stmt.getText().includes('pollsAsMenusEnabled')) {
            stmt.remove();
            changed = true;
          }
        });
      }
    }
  }
  
  if (sourceFile.getFilePath().endsWith('assistant-module-visibility-service.ts')) {
      const cls = sourceFile.getClass('AssistantModuleVisibilityService');
      if (cls) {
          const m = cls.getMethod('refreshVisibilities');
          if (m) {
              m.getStatements().forEach(stmt => {
                  if (stmt.getText().includes('pollsForCommunityEngagementEnabled')) {
                      stmt.remove();
                      changed = true;
                  }
              });
          }
      }
  }

  // Maintenance service: remove group syncing
  if (sourceFile.getFilePath().endsWith('maintenance-service.ts')) {
    const cls = sourceFile.getClass('MaintenanceService');
    if (cls) {
      const syncGroups = cls.getMethod('syncGroups');
      if (syncGroups) {
        syncGroups.remove();
        changed = true;
      }
      const constructor = cls.getConstructors()[0];
      if (constructor) {
          constructor.getStatements().forEach(stmt => {
              if (stmt.getText().includes('this.groupDiscovery')) {
                  stmt.remove();
                  changed = true;
              }
          })
      }
      ['maintenanceTick', 'repairState'].forEach(methodName => {
        const method = cls.getMethod(methodName);
        if (method) {
          method.getStatements().forEach(stmt => {
            if (stmt.getText().includes('syncGroups') || stmt.getText().includes('listGroups') || stmt.getText().includes('groupDiscovery')) {
              stmt.remove();
              changed = true;
            }
          });
        }
      });
    }
  }

  // Rule-based response provider
  if (sourceFile.getFilePath().endsWith('rule-based-response-provider.ts')) {
    const cls = sourceFile.getClass('RuleBasedResponseProvider');
    if (cls) {
      const prepare = cls.getMethod('preparePublicMenus');
      if (prepare) {
        prepare.getStatements().forEach(stmt => {
          if (stmt.getText().includes('listPublicOperationalGroups')) {
            stmt.remove();
            changed = true;
          }
        });
      }
    }
  }

  // Bot instance
  if (sourceFile.getFilePath().endsWith('bot-instance.ts')) {
    const cls = sourceFile.getClass('BotInstance');
    if (cls) {
      const getQrCode = cls.getMethod('getQrCode');
      if (getQrCode) {
        getQrCode.remove();
        changed = true;
      }
    }
  }
  
  // Connection snapshot
  if (sourceFile.getFilePath().endsWith('connection-manager.ts')) {
      const cls = sourceFile.getClass('ConnectionManager');
      if (cls) {
          const snapshot = cls.getMethod('snapshot');
          if (snapshot) {
              snapshot.getStatements().forEach(stmt => {
                  if (stmt.getText().includes('qrCode:')) {
                      stmt.replaceWithText('return { status: this.status, connectionTime: this.connectionTime, disconnections: this.disconnections, isRecovering: this.isRecovering, displayReady: this.displayReady };');
                      changed = true;
                  }
              })
          }
      }
  }

  // Simulated client
  if (sourceFile.getFilePath().endsWith('simulated-client.ts')) {
    const cls = sourceFile.getClass('SimulatedMessagingClient');
    if (cls) {
      const constructor = cls.getConstructors()[0];
      if (constructor) {
        constructor.getParameters().forEach(p => {
          if (p.getName() === 'groupListSource') {
            p.remove();
            changed = true;
          }
        });
      }
      const getters = cls.getGetAccessors();
      getters.forEach(g => {
        if (g.getName() === 'groupListSource') {
          g.remove();
          changed = true;
        }
      });
      const emitJoin = cls.getMethod('simulateGroupJoin');
      if (emitJoin) {
        emitJoin.remove();
        changed = true;
      }
      const emitChange = cls.getMethod('simulateGroupChange');
      if (emitChange) {
        emitChange.remove();
        changed = true;
      }
    }
  }

  // WhatsApp adapter
  if (sourceFile.getFilePath().endsWith('whatsapp-adapter.ts')) {
    const cls = sourceFile.getClass('WhatsAppWebAdapter');
    if (cls) {
      const getters = cls.getGetAccessors();
      getters.forEach(g => {
        if (g.getName() === 'groupListSource' || g.getName() === 'selectableMenuPolls') {
          g.remove();
          changed = true;
        }
      });
      const constructor = cls.getConstructors()[0];
      if (constructor) {
        constructor.getStatements().forEach(stmt => {
          if (stmt.getText().includes('this.groupListSource') || stmt.getText().includes('this.selectableMenuPolls')) {
            stmt.remove();
            changed = true;
          }
        });
      }
      // Also the type error about string | null assignable to string
      // Let's just fix it by replacing the offending lines.
      const processMessage = cls.getMethod('processMessage');
      if (processMessage) {
        processMessage.getStatements().forEach(stmt => {
            const text = stmt.getText();
            if (text.includes('const name = await this.client.getContactById(message.from)')) {
                stmt.replaceWithText(`
                const contact = await this.client.getContactById(message.from);
                const name = contact.name ?? contact.pushname ?? 'Desconocido';
                `);
                changed = true;
            }
        });
      }
    }
  }

  // Database
  if (sourceFile.getFilePath().endsWith('database.ts')) {
    const cls = sourceFile.getClass('AppDatabase');
    if (cls) {
      const methods = [
        'mergeWelcomeSettings',
        'saveAssistantWelcomeSettings'
      ];
      methods.forEach(m => {
        const method = cls.getMethod(m);
        if (method) {
          method.remove();
          changed = true;
        }
      });
      // also the 'bot_capabilities' triggers:
      ['getBot', 'addBot', 'updateBot'].forEach(m => {
          const method = cls.getMethod(m);
          if (method) {
              method.getStatements().forEach(stmt => {
                  const text = stmt.getText();
                  if (text.includes('pollsAsMenusEnabled') || text.includes('pollsForCommunityEngagementEnabled')) {
                      stmt.replaceWithText(text.replace(/pollsAsMenusEnabled:.*?,/g, '').replace(/pollsForCommunityEngagementEnabled:.*?(,|(?=\n))/g, ''));
                      changed = true;
                  }
              });
          }
      })
    }
  }

  if (changed) {
    sourceFile.saveSync();
  }
}
console.log('Done cleaning with ts-morph');
