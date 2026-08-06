import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const script = readFileSync('public/friendly-panel.js', 'utf8');
const styles = readFileSync('public/friendly-panel.css', 'utf8');

describe('panel empresarial amigable y ordenado', () => {
  it('carga la capa de navegación después del panel principal', () => {
    expect(html).toContain('<link rel="stylesheet" href="/friendly-panel.css" />');
    expect(html).toContain('<script type="module" src="/friendly-panel.js"></script>');
    expect(html.indexOf('/friendly-panel.js')).toBeGreaterThan(html.indexOf('/multibot-panel.js'));
  });

  it('ordena únicamente módulos útiles para negocios', () => {
    [
      'Inicio',
      'Identidad y respuestas',
      'Contenido y atención',
      'Seguimiento y administración',
    ].forEach((label) => expect(script).toContain(label));
    expect(script).toContain("label: 'Preguntas frecuentes'");
    expect(script).toContain('Buscar una opción');
    expect(script).not.toContain('Comunidad y automatización');
    expect(script).not.toContain("label: 'Mensajes automáticos'");
  });

  it('separa configuraciones principales y secundarias', () => {
    [
      'profile-messages',
      'profile-branding',
      'knowledge-categories',
      'menu-options',
      'catalog-categories',
      'cached-answer-editor',
      'statistics-events',
      'maintenance-danger',
    ].forEach((group) => expect(script).toContain(group));
    expect(script).toContain('friendly-collapsible-card');
    expect(script).toContain('makeCardCollapsible');
    expect(script).not.toContain('automatic-history');
    expect(script).not.toContain('poll-history');
  });

  it('incluye diseño adaptable y sin desplazamiento horizontal', () => {
    expect(styles).toContain('FRIENDLY_PANEL_V1');
    expect(styles).toContain('grid-template-columns: 285px minmax(0, 1fr)');
    expect(styles).toContain('.friendly-nav-search');
    expect(styles).toContain('@media (max-width: 820px)');
    expect(styles).toContain('@media (max-width: 640px)');
    expect(styles).not.toContain('overflow-x: auto');
  });
});
