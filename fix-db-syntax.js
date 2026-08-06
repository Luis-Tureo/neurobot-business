import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dbPath = join(process.cwd(), 'src/persistence/database.ts');
let content = readFileSync(dbPath, 'utf8');

const startStr = 'public getGroupModerationProfile(';
const startIndex = content.indexOf(startStr);

if (startIndex === -1) {
  console.log('Could not find start index');
  process.exit(1);
}

// Slice from the start up to the moderation functions, and close the class!
let newContent = content.substring(0, startIndex);
newContent += '}\n';

writeFileSync(dbPath, newContent);
console.log('database.ts cleanly sliced to remove all moderation methods.');
