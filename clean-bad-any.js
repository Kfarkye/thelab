const fs = require('fs');

const file = 'src/app/api/summary/route.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace dangling `: any` at the end of a line
content = content.replace(/:\s*any\s*$/gm, '');

// Replace `: any` on a line by itself
content = content.replace(/^\s*:\s*any\s*$/gm, '');

// The script also created `: any: any` on one line:
content = content.replace(/: any: any/g, '');

fs.writeFileSync(file, content);
console.log('Cleaned up corrupted : any strings.');
