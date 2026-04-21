const fs = require('fs');

const log = fs.readFileSync('tsc-errors.txt', 'utf8');
const lines = log.split('\n');

const edits = {};

for (const line of lines) {
  const match = line.match(/^([a-zA-Z0-9_./-]+)\((\d+),(\d+)\): error TS7006:/);
  if (match) {
    const file = match[1];
    const row = parseInt(match[2], 10) - 1;
    const col = parseInt(match[3], 10) - 1;

    if (!edits[file]) edits[file] = [];
    edits[file].push({ row, col });
  }
}

for (const file of Object.keys(edits)) {
  if (!fs.existsSync(file)) continue;

  let content = fs.readFileSync(file, 'utf8');
  let fileLines = content.split('\n');

  // Sort edits by row (descending) and col (descending) to avoid offsets
  edits[file].sort((a, b) => b.row - a.row || b.col - a.col);

  for (const edit of edits[file]) {
    const { row, col } = edit;
    if (row >= fileLines.length) continue;

    let targetLine = fileLines[row];

    // Find the parameter name at that location.
    // We expect it's something like "r" or "(r)"
    // We will inject ": any" after the parameter name.
    
    // Find the end of the word/identifier starting at col
    let i = col;
    while (i < targetLine.length && /[\w]/.test(targetLine[i])) {
      i++;
    }

    // Insert ': any' right after the identifier
    targetLine = targetLine.substring(0, i) + ': any' + targetLine.substring(i);
    fileLines[row] = targetLine;
  }

  fs.writeFileSync(file, fileLines.join('\n'));
  console.log(`Fixed ${edits[file].length} errors in ${file}`);
}
