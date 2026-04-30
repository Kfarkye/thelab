import fs from "node:fs/promises";
import path from "node:path";

export async function loadGovernanceJson<T>(relativePath: string): Promise<T> {
  const root = process.cwd();
  const filePath = path.join(root, relativePath);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

