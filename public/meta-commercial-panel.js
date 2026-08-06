import { installCreatePlanFields } from './meta-commercial-create.js';
import {
  hideLegacyQrInterface,
  installCommercialNavigation,
  installCommercialSection,
  loadCommercialPlan,
} from './meta-commercial-section.js';

function installStyles() {
  if (document.querySelector('#meta-commercial-styles')) return;
  const style = document.createElement('style');
  style.id = 'meta-commercial-styles';
  style.textContent = `
    .commercial-plan-choice { display: grid; gap: .8rem; margin: 1rem 0; }
    .commercial-plan-choice label { border: 1px solid var(--border, #d8dee8); border-radius: 14px; padding: 1rem; display: grid; grid-template-columns: auto 1fr; gap: .75rem; align-items: start; cursor: pointer; }
    .commercial-plan-choice label:has(input:checked) { border-color: var(--primary, #2563eb); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary, #2563eb) 18%, transparent); }
    .commercial-plan-choice strong, .commercial-template-card strong { display: block; margin-bottom: .25rem; }
    .commercial-price-note { padding: .9rem 1rem; border-radius: 12px; background: color-mix(in srgb, var(--primary, #2563eb) 8%, white); }
    .commercial-template-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .commercial-template-card { border: 1px solid var(--border, #d8dee8); border-radius: 14px; padding: 1rem; background: var(--surface, white); }
    .commercial-template-body { white-space: pre-wrap; margin: .75rem 0; padding: .8rem; border-radius: 10px; background: var(--surface-muted, #f6f8fb); }
    .commercial-badge { display: inline-flex; padding: .25rem .55rem; border-radius: 999px; font-size: .78rem; font-weight: 700; background: color-mix(in srgb, var(--primary, #2563eb) 12%, white); }
    .commercial-warning { border-left: 4px solid #d97706; padding: .8rem 1rem; background: #fffbeb; border-radius: 8px; }
    .commercial-success { border-left: 4px solid #16a34a; padding: .8rem 1rem; background: #f0fdf4; border-radius: 8px; }
  `;
  document.head.append(style);
}

function installMobileNavigationHandler() {
  const select = document.querySelector('#section-select');
  if (!select || select.dataset.commercialHandlerReady === 'true') return;
  select.dataset.commercialHandlerReady = 'true';
  select.addEventListener('change', () => {
    if (select.value !== 'commercial') return;
    document.querySelector('button[data-section="commercial"]')?.click();
  });
}

function install() {
  installStyles();
  installCreatePlanFields();
  installCommercialSection();
  installCommercialNavigation();
  installMobileNavigationHandler();
  hideLegacyQrInterface();
}

window.addEventListener('bot-services-load', (event) => {
  install();
  const botId = event.detail?.botId;
  if (typeof botId === 'string') void loadCommercialPlan(botId).catch(() => {});
});

const observer = new window.MutationObserver(() => install());
observer.observe(document.documentElement, { childList: true, subtree: true });
install();
