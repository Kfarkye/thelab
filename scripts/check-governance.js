const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const bannedPolicy = JSON.parse(
  fs.readFileSync(path.join(root, "governance/banned-patterns.json"), "utf8"),
);

const sourceDirs = ["src"];
const ignoredDirs = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
]);
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }

  return files;
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

const packageJson = readPackageJson();
const declaredPackages = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
  ...packageJson.peerDependencies,
};

let failed = false;

for (const packageName of bannedPolicy.sdk_banned_imports) {
  if (Object.prototype.hasOwnProperty.call(declaredPackages, packageName)) {
    console.error(`Governance violation: banned package ${packageName} in package.json`);
    failed = true;
  }
}

for (const sourceDir of sourceDirs) {
  const absoluteSourceDir = path.join(root, sourceDir);
  if (!fs.existsSync(absoluteSourceDir)) continue;

  for (const file of walk(absoluteSourceDir)) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);

    for (const importName of bannedPolicy.sdk_banned_imports) {
      if (text.includes(importName)) {
        console.error(`Governance violation: banned SDK import ${importName} found in ${relative}`);
        failed = true;
      }
    }

    for (const callName of bannedPolicy.sdk_banned_calls) {
      const callPattern = new RegExp(`\\b${callName}\\s*\\(`);
      const memberPattern = new RegExp(`\\.${callName}\\s*\\(`);
      if (callPattern.test(text) || memberPattern.test(text)) {
        console.error(`Governance violation: banned SDK call ${callName} found in ${relative}`);
        failed = true;
      }
    }

    for (const suppression of bannedPolicy.typescript_banned_suppressions) {
      if (text.includes(suppression)) {
        console.error(`Governance violation: banned TypeScript suppression ${suppression} found in ${relative}`);
        failed = true;
      }
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log("Governance checks passed.");

