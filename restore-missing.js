import { execSync } from 'child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'fs';
import { join } from 'path';

function restoreMissing(dir) {
  const origDir = join('C:\\Users\\lture\\Documents\\GitHub\\asistente-comunidad-neurodivergente', dir);
  const destDir = join('C:\\Users\\lture\\Documents\\GitHub\\neurobot-business', dir);
  
  if (!existsSync(origDir)) return;
  const files = readdirSync(origDir, { withFileTypes: true });
  for (const f of files) {
    if (f.isDirectory()) {
      restoreMissing(join(dir, f.name));
    } else if (f.name.endsWith('.ts')) {
      const origPath = join(origDir, f.name);
      const destPath = join(destDir, f.name);
      if (!existsSync(destPath) && !f.name.includes('poll') && !f.name.includes('moderation') && !f.name.includes('group')) {
        console.log(`Restoring missing file: ${destPath}`);
        copyFileSync(origPath, destPath);
      }
    }
  }
}

restoreMissing('src');
