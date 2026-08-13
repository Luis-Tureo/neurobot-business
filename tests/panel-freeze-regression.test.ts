import { existsSync, readFileSync } from 'node:fs';

describe('estabilidad del panel empresarial', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const panel = readFileSync('public/multibot-panel.js', 'utf8');
  const apiClient = readFileSync('public/js/api-client.js', 'utf8');
  const navigation = readFileSync('public/js/navigation.js', 'utf8');

  it('no carga capas antiguas de refinamiento', () => {
    for (const file of [
      'public/panel-refinement.js',
      'public/panel-refinement.css',
      'public/friendly-panel.js',
      'public/friendly-panel.css',
    ]) {
      expect(existsSync(file)).toBe(false);
    }
    expect(html).not.toMatch(/panel-refinement|friendly-panel/gu);
  });

  it('evita listeners e inicializaciones duplicadas', () => {
    expect(panel).toContain('let initializationPromise = null');
    expect(panel).toContain('if (initializationPromise) return initializationPromise');
    expect(panel).toContain('if (configured) return');
    expect(panel).toContain('configured = true');
  });

  it('no observa ni reescribe todo el documento', () => {
    expect(panel).not.toContain('MutationObserver');
    expect(navigation).not.toContain('MutationObserver');
    expect(panel).not.toContain('observe(document.body, { childList: true, subtree: true })');
  });

  it('mantiene la carga de datos sin caché obsoleta', () => {
    expect(apiClient).toContain("cache: 'no-store'");
    expect(apiClient).toContain("'Cache-Control': 'no-cache, no-store, must-revalidate'");
  });
});
