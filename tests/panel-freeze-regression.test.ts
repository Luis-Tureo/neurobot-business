import { existsSync, readFileSync } from 'node:fs';

describe('estabilidad del panel empresarial', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const friendly = readFileSync('public/friendly-panel.js', 'utf8');

  it('no carga la antigua capa de refinamiento comunitario', () => {
    expect(existsSync('public/panel-refinement.js')).toBe(false);
    expect(existsSync('public/panel-refinement.css')).toBe(false);
    expect(html).not.toContain('/panel-refinement.js');
    expect(html).not.toContain('/panel-refinement.css');
  });

  it('evita inicializaciones duplicadas', () => {
    expect(panel).toContain('let initializationPromise = null');
    expect(panel).toContain('if (initializationPromise !== null) return initializationPromise');
    expect(panel).toContain('let configured = false');
    expect(panel).toContain('requestMultibotInitialization');
  });

  it('no observa ni reescribe todo el documento en un ciclo permanente', () => {
    expect(panel).not.toContain("observe(document.body, { childList: true, subtree: true })");
    expect(friendly).not.toContain("observe(document.body, { childList: true, subtree: true })");
  });

  it('mantiene la carga de datos sin caché obsoleta', () => {
    expect(panel).toContain("cache: 'no-store'");
    expect(panel).toContain("'Cache-Control': 'no-cache, no-store, must-revalidate'");
  });
});
