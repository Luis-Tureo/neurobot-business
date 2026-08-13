import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const styles = readFileSync('src/admin/panel.css', 'utf8');
const app = readFileSync('public/app.js', 'utf8');

describe('arquitectura moderna del panel empresarial', () => {
  it('usa una sola hoja generada y un único punto de entrada JavaScript', () => {
    expect(html).toContain('<link rel="stylesheet" href="/panel.css" />');
    expect(html).toContain('<script type="module" src="/app.js"></script>');
    expect(html.match(/rel="stylesheet"/gu)).toHaveLength(1);
    expect(html.match(/<script type="module"/gu)).toHaveLength(1);
    expect(existsSync('public/friendly-panel.js')).toBe(false);
    expect(existsSync('public/friendly-panel.css')).toBe(false);
    expect(existsSync('public/community-design.css')).toBe(false);
    expect(existsSync('public/styles.css')).toBe(false);
  });

  it('separa panel general, negocio, automatización y operación', () => {
    for (const label of [
      'Mis asistentes',
      'Papelera',
      'Administradores',
      'WhatsApp',
      'Perfil',
      'Conocimiento',
      'Centro de pruebas',
      'Historial',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Buscar una opción');
    expect(html).not.toContain('Sistema y respaldos');
    expect(html).not.toContain('data-section="maintenance"');
  });

  it('divide las responsabilidades JavaScript sin capas que reescriban el DOM', () => {
    expect(app).toContain("import { api, clearCsrfToken, setCsrfToken } from './js/api-client.js'");
    expect(app).toContain("import { createNavigation } from './js/navigation.js'");
    expect(app).toContain("import { createAssistantPanel } from './multibot-panel.js'");
    expect(app).not.toContain('MutationObserver');
  });

  it('incluye navegación móvil real y adaptación desde 320 px', () => {
    expect(html).toContain('id="mobile-menu-button"');
    expect(html).toContain('id="mobile-nav-overlay"');
    expect(styles).not.toContain('min-width: 320px');
    expect(styles).toContain('@media (max-width: 820px)');
    expect(styles).toContain('@media (max-width: 430px)');
    expect(styles).toContain('overflow-x: hidden');
  });
});
