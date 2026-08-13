import { api, clearCsrfToken, setCsrfToken } from './js/api-client.js';
import { createNavigation } from './js/navigation.js';
import {
  actionButton,
  bindAsyncForm,
  confirmAction,
  listRow,
  notify,
  renderEmpty,
  setLoading,
  withBusy,
} from './js/ui.js';
import { createAssistantPanel } from './multibot-panel.js';

const loginView = document.querySelector('#login-view');
const panelView = document.querySelector('#panel-view');
const logoutButton = document.querySelector('#logout');
const menuButton = document.querySelector('#mobile-menu-button');
const sessionUser = document.querySelector('#session-user');
const navigation = createNavigation();
const assistantPanel = createAssistantPanel({ navigation });
let authenticated = false;

function showAuthenticated(value, username = '') {
  authenticated = value;
  loginView.classList.toggle('hidden', value);
  panelView.classList.toggle('hidden', !value);
  logoutButton.classList.toggle('hidden', !value);
  menuButton.classList.toggle('hidden', !value);
  sessionUser.classList.toggle('hidden', !value || !username);
  sessionUser.textContent = username ? `Sesión: ${username}` : '';
  if (!value) {
    navigation.setContext('global');
    document.title = 'Neurobot Business';
    document.querySelector('#application-title').textContent = 'Business';
    document.querySelector('#application-subtitle').textContent =
      'Atención inteligente para cada negocio.';
  }
}

async function loadAdministrators() {
  const target = document.querySelector('#administrators-list');
  setLoading(target, 'Cargando administradores…');
  const { administrators } = await api('/api/administrators');
  if (administrators.length === 0) {
    renderEmpty(
      target,
      'Todavía no hay administradores',
      'Agrega un número autorizado para comenzar.',
    );
    return;
  }

  target.replaceChildren();
  for (const administrator of administrators) {
    const row = listRow(administrator.masked, 'Número autorizado para administrar por WhatsApp.');
    row.append(
      actionButton('Eliminar', 'danger', async () => {
        const confirmation = await confirmAction({
          title: 'Eliminar administrador',
          description: `El número ${administrator.masked} dejará de estar autorizado.`,
          confirmLabel: 'Eliminar',
          danger: true,
        });
        if (!confirmation) return;
        await api(`/api/administrators/${encodeURIComponent(administrator.key)}`, {
          method: 'DELETE',
        });
        await loadAdministrators();
        notify('Administrador eliminado.');
      }),
    );
    target.append(row);
  }
}

bindAsyncForm('#administrator-form', async (_event, form) => {
  await api('/api/administrators', {
    method: 'POST',
    body: JSON.stringify({ number: form.elements.number.value }),
  });
  form.reset();
  await loadAdministrators();
  notify('Administrador agregado.');
});

navigation.setHandler(async (section, options) => {
  if (navigation.context === 'global') {
    await assistantPanel.enterGlobal(section, options);
    if (section === 'administrators') await loadAdministrators();
    return;
  }
  await assistantPanel.enterSection(section, options);
});

bindAsyncForm('#login-form', async (_event, form) => {
  const data = new FormData(form);
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(Object.fromEntries(data)),
  });
  setCsrfToken(result.csrfToken);
  showAuthenticated(true, String(data.get('username') || 'admin'));
  await assistantPanel.initialize({ force: true });
  notify('Sesión iniciada.');
});

logoutButton.addEventListener('click', () => {
  void withBusy(
    logoutButton,
    async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        // La sesión puede haber expirado antes de solicitar el cierre.
      }
      clearCsrfToken();
      assistantPanel.reset();
      showAuthenticated(false);
      loginView.querySelector('input[name="password"]').value = '';
      loginView.querySelector('input[name="username"]').focus();
    },
    'Saliendo…',
  );
});

window.addEventListener('panel:session-expired', () => {
  if (!authenticated) return;
  clearCsrfToken();
  assistantPanel.reset();
  showAuthenticated(false);
  notify('Tu sesión expiró. Ingresa nuevamente.', 'warning');
});

async function bootstrap() {
  try {
    const session = await api('/api/auth/session');
    setCsrfToken(session.csrfToken);
    showAuthenticated(true, session.username);
    await assistantPanel.initialize();
  } catch {
    clearCsrfToken();
    showAuthenticated(false);
  }
}

void bootstrap();
