const fs = require('fs');

const errors = fs.readFileSync('tsc-errors.txt', 'utf8').split('\n');
const fileFixes = {};

for (const line of errors) {
  const match = line.match(/^(.+?)\((\d+),\d+\): error TS/);
  if (match) {
    const file = match[1];
    const lineNum = parseInt(match[2], 10);
    if (!fileFixes[file]) fileFixes[file] = [];
    fileFixes[file].push(lineNum);
  }
}

for (const file in fileFixes) {
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const toComment = new Set(fileFixes[file]);
    
    for (let i = 0; i < lines.length; i++) {
      if (toComment.has(i + 1)) {
        if (lines[i].startsWith('// ')) {
          lines[i] = lines[i].substring(3); // remove '// '
        }
      }
    }
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`Uncommented ${toComment.size} lines in ${file}`);
  }
}
