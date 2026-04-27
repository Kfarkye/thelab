import fs from "fs";
import path from "path";

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.next') && !file.includes('.git')) {
        results = results.concat(walk(file));
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.mjs')) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('gemini-2.5')) {
        results.push(file);
      }
    }
  });
  return results;
}

const res = walk("src");
const res2 = walk("scripts");
console.log("Sources of gemini-2.5:");
console.log(res.concat(res2).join("\\n"));
