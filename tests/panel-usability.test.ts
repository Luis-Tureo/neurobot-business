import { readFileSync } from 'node:fs';

describe('interfaz empresarial simplificada', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const styles = readFileSync('src/admin/panel.css', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const apiClient = readFileSync('public/js/api-client.js', 'utf8');

  it('agrupa la navegación por tareas y usa un drawer en smartphone', () => {
    expect(html).toContain('class="panel-sidebar"');
    for (const group of ['Panel general', 'General', 'Negocio', 'Automatización', 'Operación']) {
      expect(html).toContain(group);
    }
    expect(html).toContain('aria-controls="panel-sidebar"');
    expect(html).toContain('aria-expanded="false"');
    expect(styles).toContain('.panel-sidebar.open');
    expect(styles).toContain('@media (max-width: 820px)');
    expect(html).not.toContain('<select id="mobile-navigation"');
  });

  it('no ofrece navegación comunitaria ni técnica', () => {
    for (const section of ['automatic-messages', 'polls', 'moderation', 'maintenance', 'system']) {
      expect(html).not.toContain(`data-section="${section}"`);
    }
    expect(html).not.toContain('Sistema y respaldos');
    expect(html).not.toContain('Buscar una opción');
  });

  it('presenta asistentes con jerarquía y pocas acciones', () => {
    expect(panel).toContain("className: 'assistant-card'");
    expect(panel).toContain('text: bot.organizationName || bot.botName');
    expect(panel).toContain('text: bot.botName');
    expect(panel).toContain("actionButton('Administrar'");
    expect(panel).toContain('createMoreMenu([');
    expect(panel).toContain("['WhatsApp', connectionLabels[bot.whatsappStatus]");
    expect(panel).toContain("['Número', bot.maskedNumber");
  });

  it('guarda siempre una configuración privada de negocio', () => {
    expect(panel).toContain("mode: 'business'");
    expect(panel).toContain('groupsEnabled: false');
    expect(panel).toContain('privateMessagesEnabled: true');
    expect(panel).toContain('realMentionRequired: false');
    expect(panel).toContain("connectorType: 'WHATSAPP_CLOUD_API'");
  });

  it('unifica carga, errores y bloqueo de doble envío', () => {
    const ui = readFileSync('public/js/ui.js', 'utf8');
    expect(apiClient).toContain("cache: 'no-store'");
    expect(apiClient).toContain("'Cache-Control': 'no-cache, no-store, must-revalidate'");
    expect(ui).toContain("button.setAttribute('aria-busy', 'true')");
    expect(ui).toContain('returnFocus.focus()');
  });
});
