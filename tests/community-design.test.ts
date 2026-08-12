import { readFileSync } from 'node:fs';

describe('lenguaje visual de Neurobot Community en Business', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const styles = readFileSync('public/community-design.css', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');

  it('carga la capa visual después de las hojas existentes', () => {
    expect(html).toContain('<link rel="stylesheet" href="/community-design.css" />');
    expect(html.indexOf('/community-design.css')).toBeGreaterThan(
      html.indexOf('/friendly-panel.css'),
    );
  });

  it('define los tokens, el canvas y la estructura responsive especificados', () => {
    expect(styles).toContain('--color-primary: #4f46e5');
    expect(styles).toContain('--color-accent: #06b6d4');
    expect(styles).toContain('--content-max-width: 1380px');
    expect(styles).toContain('--sidebar-width: 250px');
    expect(styles).toContain('radial-gradient(circle at 8% 0%, rgba(79, 70, 229, 0.12)');
    expect(styles).toContain('@media (max-width: 820px)');
    expect(styles).toContain('@media (max-width: 640px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('estiliza controles y estados sin reemplazar contratos funcionales', () => {
    expect(styles).toContain('button.secondary');
    expect(styles).toContain('button.danger-primary');
    expect(styles).toContain("input[type='checkbox']");
    expect(styles).toContain('dialog::backdrop');
    expect(styles).toContain('table {');
    expect(styles).toContain('#login-view');
    expect(styles).toContain("content: 'Inactivo'");
    expect(styles).toContain("content: 'Activo'");
    expect(html).toContain('name="bot_enabled" type="checkbox" role="switch"');
    expect(app).toContain("await api('/api/auth/login'");
    expect(panel).toContain("mode: 'business'");
    expect(panel).toContain('privateMessagesEnabled: true');
  });
});
