const fs = require('fs');
const file = 'src/app/api/summary/route.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/\.filter\(\(item\) =>/g, '.filter((item: any) =>');
content = content.replace(/\.filter\(\(r\) =>/g, '.filter((r: any) =>');
content = content.replace(/\.reduce\(\(acc, r\)/g, '.reduce((acc: any, r: any)');

fs.writeFileSync(file, content);
console.log('Fixed more implicitly any in summary/route.ts');
