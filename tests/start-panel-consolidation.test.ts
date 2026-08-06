import { readFileSync } from 'node:fs';
import { readFriendlyPanelSource } from './source-bundles.js';

describe('inicio empresarial consolidado', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const multibot = readFileSync('public/multibot-panel.js', 'utf8');
  const friendly = readFriendlyPanelSource();
  const styles = readFileSync('public/styles.css', 'utf8');

  it('presenta un inicio centrado en estado y conexión', () => {
    expect(friendly).toContain("label: 'Inicio'");
    expect(friendly).toContain("description: 'Estado y conexión'");
    expect(friendly).not.toContain('Estado, conexión y grupos');
  });

  it('muestra categorías desplegables en la barra lateral', () => {
    expect(styles).toContain('.sidebar-accordion');
    expect(styles).toContain('.sidebar-accordion summary');
  });

  it('no carga módulos comunitarios al seleccionar un negocio', () => {
    expect(multibot).toContain("!['automatic-messages', 'polls', 'moderation'].includes(module)");
    expect(multibot).not.toContain('loaders.push(loadModeration())');
  });

  it('mantiene la carga automática sin inicializaciones duplicadas', () => {
    expect(app).toContain("window.dispatchEvent(new window.CustomEvent('multibot-panel-load'))");
    expect(multibot).toContain('let initializationPromise = null');
    expect(multibot).toContain('requestMultibotInitialization');
    expect(multibot).toContain('assistantsEmpty');
  });
});
