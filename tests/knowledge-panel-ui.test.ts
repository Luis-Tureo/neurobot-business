import { readFileSync } from 'node:fs';
import { readFriendlyPanelSource } from './source-bundles.js';

const html = readFileSync('public/index.html', 'utf8');
const panel = readFileSync('public/multibot-panel.js', 'utf8');
const friendly = readFriendlyPanelSource();
const styles = readFileSync('public/friendly-panel.css', 'utf8');

describe('información del negocio con edición guiada', () => {
  it('separa categorías, contenido y formularios de edición', () => {
    expect(html).toContain('<h2>Información del bot</h2>');
    expect(html).toContain('id="new-knowledge-entry"');
    expect(html).toContain('id="toggle-knowledge-categories"');
    expect(html).toContain('id="knowledge-category-form"');
    expect(html).toContain('class="inline-form knowledge-editor hidden"');
    expect(html).toContain('id="knowledge-entry-form"');
    expect(html).toContain('class="card inset knowledge-editor friendly-primary-card hidden"');
  });

  it('abre los formularios solo al crear o editar', () => {
    expect(panel).toContain('openKnowledgeCategoryForm(category)');
    expect(panel).toContain("actionButton('Renombrar categoría'");
    expect(panel).toContain('openNewKnowledgeEntry');
    expect(panel).toContain("actionButton('Editar información'");
    expect(panel).toContain("form.classList.remove('hidden')");
    expect(panel).toContain("form.classList.add('hidden')");
  });

  it('usa una prioridad comprensible y mantiene oculta la fuente técnica', () => {
    expect(html).toContain('name="priority"');
    expect(html).toContain('type="range"');
    expect(html).toContain('min="-100"');
    expect(html).toContain('max="100"');
    expect(html).toContain('id="knowledge-priority-label"');
    expect(html).toContain('<input name="internalSource" type="hidden" />');
    expect(html).not.toContain('Fuente interna opcional');
    expect(panel).toContain('knowledgePriorityLabel');
    expect(panel).toContain('Prioridad normal');
    expect(styles).toContain('KNOWLEDGE_PANEL_FRIENDLY_V2');
  });

  it('mantiene la explicación amigable', () => {
    expect(friendly).toContain('Las categorías sirven únicamente para mantenerlos ordenados.');
    expect(friendly).toContain("data-friendly-group', 'knowledge-categories'");
  });
});
