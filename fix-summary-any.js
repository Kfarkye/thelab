const fs = require('fs');
const file = 'src/app/api/summary/route.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace .map((r) => with .map((r: any) =>
content = content.replace(/\.map\(\(r\) =>/g, '.map((r: any) =>');
content = content.replace(/\.map\(\(item\) =>/g, '.map((item: any) =>');
content = content.replace(/\.map\(\(obj\) =>/g, '.map((obj: any) =>');
content = content.replace(/\.sort\(\(a, b\)/g, '.sort((a: any, b: any)');
content = content.replace(/\.map\(\(a, b\)/g, '.map((a: any, b: any)'); // Actually sort 

fs.writeFileSync(file, content);
console.log('Fixed implicitly any in summary/route.ts via regex.');
