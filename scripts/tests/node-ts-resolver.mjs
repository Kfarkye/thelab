import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(rootDir, "src");
const extensionCandidates = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

function resolveAlias(specifier) {
  if (!specifier.startsWith("@/")) return null;
  const withoutAlias = specifier.slice(2);
  const base = path.join(srcDir, withoutAlias);
  if (path.extname(base)) return fs.existsSync(base) ? base : null;
  for (const ext of extensionCandidates) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of extensionCandidates) {
    const candidate = path.join(base, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveRelative(specifier, parentURL) {
  if (!parentURL) return null;
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) {
    return null;
  }
  const parentDir = path.dirname(fileURLToPath(parentURL));
  const basePath = path.resolve(parentDir, specifier);
  if (path.extname(basePath)) return fs.existsSync(basePath) ? basePath : null;
  for (const ext of extensionCandidates) {
    const candidate = `${basePath}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of extensionCandidates) {
    const candidate = path.join(basePath, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, defaultResolve) {
  const aliasHit = resolveAlias(specifier);
  if (aliasHit) {
    return {
      shortCircuit: true,
      url: pathToFileURL(aliasHit).href,
    };
  }

  const relativeHit = resolveRelative(specifier, context.parentURL || null);
  if (relativeHit) {
    return {
      shortCircuit: true,
      url: pathToFileURL(relativeHit).href,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}
