import { readFileSync } from 'node:fs';

describe('interfaz empresarial simplificada', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const styles = readFileSync('public/styles.css', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const friendly = readFileSync('public/friendly-panel.js', 'utf8');

  it('organiza la administración en acordeones de negocio', () => {
    expect(html).toContain('class="panel-sidebar"');
    expect(html).toContain('<summary>Estado y conexión</summary>');
    expect(html).toContain('<summary>Información del negocio</summary>');
    expect(html).toContain('<summary>Atención automática</summary>');
    expect(html).toContain('<summary>Atención humana</summary>');
    expect(html).toContain('<summary>Configuración avanzada</summary>');
    expect(styles).toContain('.sidebar-accordion');
  });

  it('no ofrece navegación comunitaria', () => {
    expect(html).not.toContain('<option value="automatic-messages"');
    expect(html).not.toContain('<option value="polls"');
    expect(html).not.toContain('<option value="moderation"');
    expect(friendly).not.toContain("id: 'community'");
    expect(friendly).not.toContain('minimal-community-panel.js');
  });

  it('mantiene la tarjeta inicial estrictamente minimalista', () => {
    expect(panel).toContain("node('h3', bot.botName)");
    expect(panel).toContain('Número: ${phoneText} • Estado: ${statusText}');
    expect(panel).toContain("actionButton('Administrar'");
    expect(panel).not.toContain("node('p', bot.organizationName || 'Sin organización', 'bot-org')");
  });

  it('guarda siempre una configuración privada de negocio', () => {
    expect(panel).toContain("mode: 'business'");
    expect(panel).toContain('groupsEnabled: false');
    expect(panel).toContain('privateMessagesEnabled: true');
    expect(panel).toContain('realMentionRequired: false');
    expect(panel).toContain("payload.connectorType = 'WHATSAPP_CLOUD_API'");
  });

  it('carga datos actualizados sin exigir Ctrl más F5', () => {
    expect(panel).toContain("cache: 'no-store'");
    expect(panel).toContain("'Cache-Control': 'no-cache, no-store, must-revalidate'");
    expect(panel).toContain('requestMultibotInitialization(true)');
  });
});
