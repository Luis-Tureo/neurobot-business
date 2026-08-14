import { readFileSync } from 'node:fs';

describe('interfaz empresarial simplificada', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const styles = readFileSync('src/admin/panel.css', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const apiClient = readFileSync('public/js/api-client.js', 'utf8');

  it('agrupa la navegación por tareas y usa un drawer en smartphone', () => {
    expect(html).toContain('class="panel-sidebar"');
    for (const section of ['Panel general', 'General', 'Negocio', 'Automatización', 'Operación']) {
      expect(html).toContain(section);
    }
    expect(html).toContain('aria-controls="panel-sidebar"');
    expect(html).toContain('aria-expanded="false"');
    expect(styles).toContain('.panel-sidebar.open');
    expect(styles).toContain('@media (max-width: 820px)');
    expect(html).not.toContain('<select id="mobile-navigation"');
  });

  it('ofrece solo la navegación empresarial esperada', () => {
    for (const section of [
      'bots',
      'whatsapp',
      'profile',
      'knowledge',
      'menus',
      'catalog',
      'hours',
    ]) {
      expect(html).toContain(`data-section="${section}"`);
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

  it('guarda un contrato empresarial mínimo', () => {
    expect(panel).toContain(
      'continuedConversationsEnabled: form.elements.continuedConversationsEnabled.checked',
    );
    expect(panel).toContain('menuType: form.elements.menuType.value');
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
