import { readFileSync } from 'node:fs';

describe('panel de respuestas guardadas y consumo', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const javascript = readFileSync('public/multibot-panel.js', 'utf8');

  it('incluye navegación móvil y lateral sin un selector gigante', () => {
    expect(html).toContain('data-section="cached-answers"');
    expect(html).toContain('id="section-cached-answers"');
    expect(html).toContain('id="mobile-menu-button"');
    expect(html).not.toContain('<option value="cached-answers"');
  });

  it('muestra búsqueda, creación y acciones administrativas enfocadas', () => {
    expect(html).toContain('id="cached-answer-search"');
    expect(html).toMatch(/id="cached-answer-form"\s+class="editor-panel hidden"/u);
    for (const label of [
      'Aprobar',
      'Editar',
      'Desactivar',
      'Eliminar',
      'Agregar variante',
      'Revisar en la próxima consulta',
      'Ver fuentes',
    ]) {
      expect(javascript).toContain(label);
    }
    expect(javascript).not.toMatch(/window\.(alert|prompt|confirm)\(/gu);
  });

  it('presenta consumo real solamente en Estadísticas', () => {
    expect(html).toContain('id="section-statistics"');
    expect(javascript).toContain('operationalMetrics.localResponses');
    expect(javascript).toContain('operationalMetrics.aiSuccesses');
    expect(javascript).toContain('operationalMetrics.cacheHits');
    expect(javascript).toContain('ai.usage.requests');
  });

  it('protege el restablecimiento de desarrollo con diálogo accesible', () => {
    expect(javascript).toContain("expectedConfirmation: 'RESTABLECER CONTADORES'");
    expect(javascript).toContain('requirePassword: true');
    expect(html).toContain('id="action-dialog"');
  });
});
