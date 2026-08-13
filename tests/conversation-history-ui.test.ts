import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const panel = readFileSync('public/multibot-panel.js', 'utf8');
const css = readFileSync('src/admin/panel.css', 'utf8');

describe('explorador de conversaciones del Historial', () => {
  it('incluye lista, detalle, filtros útiles, paginación y regreso móvil accesible', () => {
    expect(html).toContain('id="conversation-explorer"');
    expect(html).toContain('id="conversation-list"');
    expect(html).toContain('id="conversation-detail"');
    expect(html).toContain('id="conversation-messages"');
    expect(html).toContain('name="search"');
    expect(html).toContain('name="assistantId"');
    expect(html).toContain('name="from" type="date"');
    expect(html).toContain('name="to" type="date"');
    expect(html).toContain('id="history-previous"');
    expect(html).toContain('id="history-next"');
    expect(html).toContain('id="history-load-older"');
    expect(html).toContain('aria-label="Volver a la lista de conversaciones"');
    expect(html).toContain('aria-label="Mensajes de la conversación"');
    expect(html).not.toContain(
      'Neurobot no almacena el texto de las preguntas ni de las respuestas',
    );
  });

  it('consulta páginas reales del servidor y muestra texto, multimedia y estados con etiquetas', () => {
    expect(panel).toContain('api(`/api/conversations?${conversationQuery()}`)');
    expect(panel).toContain('/messages?page=1&pageSize=50');
    expect(panel).toContain('loadOlderConversationMessages');
    expect(panel).toContain("accepted: 'En proceso'");
    expect(panel).toContain("sent: 'Enviado'");
    expect(panel).toContain("delivered: 'Entregado'");
    expect(panel).toContain("read: 'Leído'");
    expect(panel).toContain("failed: 'Fallido'");
    expect(panel).toContain("image: 'Imagen'");
    expect(panel).toContain("audio: 'Audio'");
    expect(panel).toContain("attributes: { 'aria-label': `Estado:");
    expect(panel).not.toContain('items.slice(start, start + pageSize)');
  });

  it('adapta el explorador a móvil sin reducir toda la interfaz de escritorio', () => {
    expect(css).toContain('.conversation-explorer.is-detail-open .conversation-list-panel');
    expect(css).toContain('.conversation-explorer.is-detail-open .conversation-detail');
    expect(css).toContain('.conversation-back');
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('max-width: 92%');
  });
});
