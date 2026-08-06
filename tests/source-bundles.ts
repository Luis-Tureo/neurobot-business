import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readAdminServerSource(): string {
  return readSourceFiles([
    resolve('src', 'admin', 'server.ts'),
    resolve('src', 'admin', 'server-base.ts'),
  ]);
}

export function readFriendlyPanelSource(): string {
  return readSourceFiles([
    resolve('public', 'friendly-panel.js'),
    resolve('public', 'friendly-panel-base.js'),
    resolve('public', 'meta-commercial-panel.js'),
    resolve('public', 'meta-commercial-create.js'),
    resolve('public', 'meta-commercial-section.js'),
  ]);
}

function readSourceFiles(paths: string[]): string {
  return paths.map((path) => readFileSync(path, 'utf8')).join('\n');
}
