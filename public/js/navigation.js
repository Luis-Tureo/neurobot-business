import { friendlyError, notify } from './ui.js';

export function createNavigation() {
  const sidebar = document.querySelector('#panel-sidebar');
  const overlay = document.querySelector('#mobile-nav-overlay');
  const openButton = document.querySelector('#mobile-menu-button');
  const closeButton = document.querySelector('#mobile-menu-close');
  const currentLabel = document.querySelector('#mobile-current-section');
  let handler = null;
  let context = 'global';
  let activeSection = 'bots';
  let lastFocus = null;

  function isMobile() {
    return window.matchMedia('(max-width: 820px)').matches;
  }

  function syncDrawerAccessibility() {
    if (!sidebar) return;
    if (!isMobile()) {
      sidebar.inert = false;
      sidebar.removeAttribute('aria-hidden');
      return;
    }
    const open = sidebar.classList.contains('open');
    sidebar.inert = !open;
    sidebar.setAttribute('aria-hidden', String(!open));
  }

  function sectionButton(section) {
    return [...document.querySelectorAll(`button[data-section="${section}"]`)].find(
      (button) => !button.closest('[data-context]')?.classList.contains('hidden'),
    );
  }

  function openDrawer() {
    if (!sidebar || window.matchMedia('(min-width: 821px)').matches) return;
    lastFocus = document.activeElement;
    sidebar.classList.add('open');
    overlay?.classList.remove('hidden');
    openButton?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('mobile-nav-open');
    syncDrawerAccessibility();
    const first = sidebar.querySelector('button:not(.hidden):not(:disabled)');
    window.setTimeout(() => first?.focus(), 0);
  }

  function closeDrawer({ restoreFocus = false } = {}) {
    sidebar?.classList.remove('open');
    overlay?.classList.add('hidden');
    openButton?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-nav-open');
    syncDrawerAccessibility();
    if (restoreFocus && typeof lastFocus?.focus === 'function') lastFocus.focus();
  }

  async function navigate(section, options = {}) {
    const button = sectionButton(section);
    const panel = document.querySelector(`#section-${section}`);
    if (
      !button ||
      !panel ||
      button.disabled ||
      button.hidden ||
      button.classList.contains('hidden')
    ) {
      return false;
    }

    document.querySelectorAll('.nav-item').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('.panel-section').forEach((item) => item.classList.add('hidden'));
    panel.classList.remove('hidden');
    activeSection = section;
    const heading = panel.querySelector('h2');
    if (currentLabel) currentLabel.textContent = heading?.textContent || button.textContent.trim();
    closeDrawer();

    if (handler && options.notify !== false) {
      try {
        await handler(section, options);
      } catch (error) {
        notify(friendlyError(error), 'error');
        return false;
      }
    }
    if (options.focus === true) {
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
    }
    if (options.scroll === true) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  function setContext(nextContext) {
    context = nextContext;
    document.querySelectorAll('[data-context]').forEach((node) => {
      node.classList.toggle('hidden', node.dataset.context !== nextContext);
    });
    document
      .querySelector('#assistant-context')
      ?.classList.toggle('hidden', nextContext !== 'assistant');
  }

  function setModuleVisibility(modules) {
    const visible = new Set(modules);
    document.querySelectorAll('[data-module]').forEach((node) => {
      const available = visible.has(node.dataset.module);
      node.classList.toggle('hidden', !available);
      if ('disabled' in node) node.disabled = !available;
    });
    document.querySelectorAll('[data-requires-module]').forEach((node) => {
      node.classList.toggle('hidden', !visible.has(node.dataset.requiresModule));
    });
    const activeButton = sectionButton(activeSection);
    if (activeButton?.disabled || activeButton?.classList.contains('hidden'))
      void navigate('status');
  }

  document.querySelectorAll('button[data-section]').forEach((button) => {
    button.addEventListener('click', () => void navigate(button.dataset.section, { focus: true }));
  });
  document.querySelectorAll('[data-open-section]').forEach((button) => {
    button.addEventListener(
      'click',
      () => void navigate(button.dataset.openSection, { focus: true, scroll: true }),
    );
  });
  openButton?.addEventListener('click', openDrawer);
  closeButton?.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
  overlay?.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
  window.addEventListener('keydown', (event) => {
    if (!sidebar?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer({ restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...sidebar.querySelectorAll('button:not(:disabled)')].filter(
        (button) => button.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  window.addEventListener('resize', () => {
    if (!isMobile()) closeDrawer();
    syncDrawerAccessibility();
  });
  syncDrawerAccessibility();

  return {
    navigate,
    setContext,
    setModuleVisibility,
    setHandler(nextHandler) {
      handler = nextHandler;
    },
    get context() {
      return context;
    },
    get activeSection() {
      return activeSection;
    },
  };
}
