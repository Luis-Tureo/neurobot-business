import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function replaceInFile(relativePath, replacer) {
  const file = join(process.cwd(), relativePath);
  try {
    let content = readFileSync(file, 'utf8');
    const newContent = replacer(content);
    if (content !== newContent) {
      writeFileSync(file, newContent);
      console.log(`Updated ${relativePath}`);
    } else {
      console.log(`No changes made to ${relativePath}`);
    }
  } catch (err) {
    console.error(`Failed to update ${relativePath}:`, err);
  }
}

replaceInFile('public/index.html', (content) => {
  // Replace navigation menu
  const newNav = `<nav class="tabs" aria-label="Secciones del panel">
              <p class="nav-group-title global-only">Panel general</p>
              <button data-section="bots" class="global-only active"><span aria-hidden="true">🤖</span> Mis asistentes</button>
              <button data-section="trash" class="global-only"><span aria-hidden="true">🗑️</span> Papelera</button>
              <button data-section="global-system" class="global-only"><span aria-hidden="true">⚙️</span> Sistema y respaldos</button>
              <button data-section="administrators" class="global-only"><span aria-hidden="true">👥</span> Administradores</button>

              <details class="sidebar-accordion bot-only hidden" open>
                <summary>Estado y conexión</summary>
                <button data-section="status">Inicio e información</button>
                <button data-section="whatsapp">WhatsApp</button>
              </details>

              <details class="sidebar-accordion bot-only hidden">
                <summary>Información del negocio</summary>
                <button data-section="profile">Nombre y perfil</button>
                <button data-section="hours" data-module="hours">Horarios</button>
                <button data-section="media" data-module="media">Imágenes</button>
              </details>

              <details class="sidebar-accordion bot-only hidden">
                <summary>Atención automática</summary>
                <button data-section="menus" data-module="menus">Menú de respuestas</button>
                <button data-section="catalog" data-module="catalog">Productos y servicios</button>
                <button data-section="knowledge">Información del bot</button>
                <button data-section="cached-answers">Respuestas guardadas</button>
                <button data-section="ai">Inteligencia artificial</button>
              </details>

              <details class="sidebar-accordion bot-only hidden">
                <summary>Atención humana</summary>
                <button data-section="requests">Solicitudes de atención</button>
              </details>

              <details class="sidebar-accordion bot-only hidden">
                <summary>Configuración avanzada</summary>
                <button data-section="statistics">Estadísticas</button>
                <button data-section="commands">Comandos</button>
                <button data-section="settings">Ajustes del asistente</button>
                <button data-section="maintenance">Mantenimiento</button>
              </details>
            </nav>`;
            
  content = content.replace(/<nav class="tabs" aria-label="Secciones del panel">[\s\S]*?<\/nav>/, newNav);
  
  // Remove unused sections completely
  content = content.replace(/<section id="section-groups" class="panel-section hidden">[\s\S]*?<\/section>/, '');
  content = content.replace(/<section id="section-moderation" class="panel-section hidden">[\s\S]*?<\/section>/, '');
  content = content.replace(/<section id="section-automatic-messages" class="panel-section hidden">[\s\S]*?<\/section>/, '');
  content = content.replace(/<section id="section-polls" class="panel-section hidden">[\s\S]*?<\/section>/, '');

  return content;
});

replaceInFile('public/multibot-panel.js', (content) => {
  // Fix the bot card to be minimal as requested.
  // The user requested: "ese recuadro no sea tan grande que sea minimalista, conservar solo la opcion administrar y la información del asistente"
  
  const botCardReplacement = `
    const card = node('article', undefined, 'card bot-card minimalist-bot-card');
    const heading = node('div', undefined, 'bot-card-heading');
    heading.append(node('h3', bot.botName));

    const info = node('div', undefined, 'bot-card-info');
    const phoneText = bot.phoneNumber || 'Sin vincular';
    const statusText = botConnectionLabels[bot.whatsappStatus] || bot.whatsappStatus;
    info.append(
      node('p', bot.organizationName || 'Sin organización', 'bot-org'),
      node('p', \`Número: \${phoneText} • Estado: \${statusText}\`, 'muted'),
    );

    const actions = node('div', undefined, 'actions');
    actions.append(actionButton('Administrar', 'primary', async () => selectBot(bot.id, 'status')));

    card.append(heading, info);
    card.append(actions);
    target.append(card);`;
    
  // The original has conflict notice which I will keep if it's there, but the user said "solo la opcion administrar y la información del asistente"
  content = content.replace(/const card = node\('article', undefined, 'card bot-card minimalist-bot-card'\);[\s\S]*?target\.append\(card\);/g, botCardReplacement);
  
  // Disable Community functionality fetching
  content = content.replace(/loadGroupDiscovery\(\)/g, 'Promise.resolve()');
  content = content.replace(/loadPolls\(\)/g, 'Promise.resolve()');
  content = content.replace(/loadAutomaticMessages\(\)/g, 'Promise.resolve()');
  content = content.replace(/loadModeration\(\)/g, 'Promise.resolve()');

  return content;
});

replaceInFile('public/styles.css', (content) => {
  if (!content.includes('sidebar-accordion')) {
    content += `\n
/* Sidebar Accordion Styles */
.sidebar-accordion {
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 0.5rem;
}

.sidebar-accordion summary {
  padding: 0.75rem;
  font-weight: bold;
  cursor: pointer;
  color: var(--text-color);
  list-style: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-accordion summary::-webkit-details-marker {
  display: none;
}

.sidebar-accordion summary::after {
  content: '+';
  font-size: 1.2em;
  font-weight: normal;
}

.sidebar-accordion[open] summary::after {
  content: '−';
}

.sidebar-accordion button {
  padding-left: 1.5rem;
  width: 100%;
  text-align: left;
  border-radius: 0;
}
`;
  }
  return content;
});
