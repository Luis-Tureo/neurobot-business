import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const panel = readFileSync('public/multibot-panel.js', 'utf8');

describe('conocimiento del negocio con edición guiada', () => {
  it('separa categorías, contenido y formularios enfocados', () => {
    expect(html).toContain('<h2 id="knowledge-title">Conocimiento</h2>');
    expect(html).toContain('id="new-knowledge-entry"');
    expect(html).toContain('id="toggle-knowledge-categories"');
    expect(html).toContain('id="knowledge-category-form" class="inline-editor hidden"');
    expect(html).toMatch(/id="knowledge-entry-form"\s+class="editor-panel hidden"/u);
  });

  it('abre los formularios solo al crear o editar', () => {
    expect(panel).toContain('function editKnowledgeCategory(category = null)');
    expect(panel).toContain('function openKnowledgeEntry(entry = null)');
    expect(panel).toContain('showPanel(form, { focus: true })');
    expect(panel).toContain("hidePanel(document.querySelector('#knowledge-entry-form'))");
  });

  it('usa una prioridad comprensible y mantiene oculta la fuente técnica', () => {
    expect(html).toContain('name="priority" type="range" min="-100" max="100"');
    expect(html).toContain('id="knowledge-priority-label">Normal');
    expect(html).toContain('<input name="internalSource" type="hidden" />');
    expect(html).not.toContain('Fuente interna opcional');
    expect(panel).toContain('function knowledgePriorityLabel');
    for (const label of ['Muy baja', 'Baja', 'Normal', 'Alta', 'Muy alta']) {
      expect(panel).toContain(label);
    }
  });

  it('explica el contenido en lenguaje humano', () => {
    expect(html).toContain(
      'Agrega información oficial que el asistente puede usar para responder.',
    );
    expect(html).not.toMatch(/grounding|embeddings|contexto de inferencia/iu);
  });
});
