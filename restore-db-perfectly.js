import { copyFileSync } from 'node:fs';
import { execSync } from 'child_process';
function run(cmd) { console.log(cmd); execSync(cmd, { stdio: 'inherit' }); }
try {
  copyFileSync('C:\\Users\\lture\\Documents\\GitHub\\asistente-comunidad-neurodivergente\\src\\persistence\\database.ts', 'src\\persistence\\database.ts');
  run('node fix-db-syntax.js');
  run('node restore-helpers.js');
  run('node clean-database-2.js');
  run('node clean-database-imports.js');
  console.log('database.ts cleanly restored!');
} catch(e) {
  console.error(e);
}
