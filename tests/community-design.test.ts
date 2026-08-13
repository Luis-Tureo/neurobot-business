import { readFileSync } from 'node:fs';

describe('sistema visual único de Neurobot Business', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const source = readFileSync('src/admin/panel.css', 'utf8');
  const generated = readFileSync('public/panel.css', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('compila Tailwind localmente y no depende de CDN', () => {
    expect(html).toContain('<link rel="stylesheet" href="/panel.css" />');
    expect(html).not.toMatch(/cdn\.tailwindcss\.com|tailwindcss\.com\/script/gu);
    expect(source).toMatch(/@import ['"]tailwindcss['"] source\(none\)/u);
    expect(source).toContain('@source "../../public/index.html"');
    expect(packageJson.devDependencies).toHaveProperty('tailwindcss');
    expect(packageJson.devDependencies).toHaveProperty('@tailwindcss/cli');
    expect(packageJson.scripts.build).toContain('npm run build:css');
    expect(generated.length).toBeGreaterThan(10_000);
  });

  it('define una paleta tranquila y una estructura responsive', () => {
    expect(source).toContain('--color-brand-600: #4f46e5');
    expect(source).toContain('--color-canvas: #f8fafc');
    expect(source).toContain('font-family: var(--font-sans)');
    expect(source).toContain('@media (max-width: 820px)');
    expect(source).toContain('@media (max-width: 430px)');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('incluye foco, controles táctiles, estados y tablas adaptables', () => {
    expect(source).toContain(':focus-visible');
    expect(source).toContain('min-height: 2.75rem');
    expect(source).toContain('.status-badge');
    expect(source).toContain('.toast');
    expect(source).toContain('dialog::backdrop');
    expect(source).toContain('.responsive-table');
    expect(source).toContain('td::before');
  });
});
