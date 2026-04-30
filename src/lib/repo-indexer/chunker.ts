import { createHash } from "node:crypto";
import ts from "typescript";

export type RepoChunk = {
  ChunkId: string;
  Repo: string;
  Branch: string;
  CommitSha: string;
  SourceBlobSha: string;
  Path: string;
  LineStart: number;
  LineEnd: number;
  ChunkType: string;
  Language: string | null;
  Symbol: string | null;
  Content: string;
  ContentHash: string;
  GovernanceRefs: string[];
};

export type CommitChunkInput = {
  repo: string;
  branch: string;
  commitSha: string;
  path: string;
  sourceBlobSha: string;
  content: string;
};

type ChunkSpan = {
  lineStart: number;
  lineEnd: number;
  chunkType: string;
  language: string | null;
  symbol: string | null;
  content: string;
};

const MAX_FILE_BYTES = 100 * 1024;
const JSON_WHOLE_FILE_LIMIT_BYTES = 5 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".sql",
  ".yaml",
  ".yml",
  ".txt",
]);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryDocumentId(value: string): string {
  return `r-${hash(value).slice(0, 61)}`;
}

function extensionForPath(path: string): string {
  const match = path.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function isAllowedRepoFile(path: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionForPath(path));
}

export function isWithinRepoFileSizeLimit(content: string): boolean {
  return Buffer.byteLength(content, "utf8") <= MAX_FILE_BYTES;
}

function lineStartsForText(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineNumberAtPosition(lineStarts: number[], position: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= position) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(1, high + 1);
}

function contentForLines(lines: string[], lineStart: number, lineEnd: number): string {
  return lines.slice(lineStart - 1, lineEnd).join("\n").trim();
}

function makeWholeFileChunk(content: string, language: string | null): ChunkSpan[] {
  const lines = content.split("\n");
  return [{
    lineStart: 1,
    lineEnd: Math.max(1, lines.length),
    chunkType: "file",
    language,
    symbol: null,
    content: content.trim(),
  }];
}

function nodeSymbol(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name?.getText() ?? null;
  }

  if (ts.isVariableStatement(node)) {
    const names = node.declarationList.declarations
      .map((declaration) => declaration.name.getText())
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : null;
  }

  if (ts.isExportAssignment(node)) return "default export";
  return null;
}

function nodeChunkType(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isModuleDeclaration(node)) return "module";
  if (ts.isVariableStatement(node)) return "variable";
  if (ts.isExportAssignment(node)) return "export";
  return null;
}

function isChunkableTsNode(node: ts.Node): boolean {
  return nodeChunkType(node) !== null;
}

function scriptKindForPath(path: string): ts.ScriptKind {
  const ext = extensionForPath(path);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function chunkTsLikeFile(path: string, content: string): ChunkSpan[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKindForPath(path));
  const lineStarts = lineStartsForText(content);
  const lines = content.split("\n");
  const chunks: ChunkSpan[] = [];

  for (const statement of source.statements) {
    if (!isChunkableTsNode(statement)) continue;
    const lineStart = lineNumberAtPosition(lineStarts, statement.getFullStart());
    const lineEnd = lineNumberAtPosition(lineStarts, statement.getEnd());
    chunks.push({
      lineStart,
      lineEnd,
      chunkType: nodeChunkType(statement) ?? "declaration",
      language: extensionForPath(path).slice(1),
      symbol: nodeSymbol(statement),
      content: contentForLines(lines, lineStart, lineEnd),
    });
  }

  return chunks.length > 0 ? chunks : makeWholeFileChunk(content, extensionForPath(path).slice(1));
}

function chunkJsonFile(content: string): ChunkSpan[] {
  if (Buffer.byteLength(content, "utf8") <= JSON_WHOLE_FILE_LIMIT_BYTES) {
    return makeWholeFileChunk(content, "json");
  }

  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return makeWholeFileChunk(content, "json");
  }

  return Object.entries(parsed as Record<string, unknown>).map(([key, value], index) => ({
    lineStart: index + 1,
    lineEnd: index + 1,
    chunkType: "json_key",
    language: "json",
    symbol: key,
    content: JSON.stringify({ [key]: value }, null, 2),
  }));
}

function chunkSqlFile(content: string): ChunkSpan[] {
  const lines = content.split("\n");
  const chunks: ChunkSpan[] = [];
  let start = 1;
  let current: string[] = [];

  lines.forEach((line, index) => {
    if (current.length === 0 && !line.trim()) {
      start = index + 2;
      return;
    }
    current.push(line);
    if (line.trim().endsWith(";")) {
      const text = current.join("\n").trim();
      if (text) {
        chunks.push({
          lineStart: start,
          lineEnd: index + 1,
          chunkType: /^CREATE\b/i.test(text) ? "sql_create" : /^ALTER\b/i.test(text) ? "sql_alter" : "sql_statement",
          language: "sql",
          symbol: text.match(/(?:TABLE|INDEX)\s+([A-Za-z0-9_]+)/i)?.[1] ?? null,
          content: text,
        });
      }
      current = [];
      start = index + 2;
    }
  });

  const tail = current.join("\n").trim();
  if (tail) {
    chunks.push({
      lineStart: start,
      lineEnd: lines.length,
      chunkType: "sql_statement",
      language: "sql",
      symbol: null,
      content: tail,
    });
  }

  return chunks.length > 0 ? chunks : makeWholeFileChunk(content, "sql");
}

function chunkMarkdownFile(content: string): ChunkSpan[] {
  const lines = content.split("\n");
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^#{1,2}\s+/.test(line));

  if (headings.length === 0) return makeWholeFileChunk(content, "markdown");

  return headings.map((heading, idx) => {
    const next = headings[idx + 1];
    const lineStart = heading.index + 1;
    const lineEnd = next ? next.index : lines.length;
    return {
      lineStart,
      lineEnd,
      chunkType: "markdown_section",
      language: "markdown",
      symbol: heading.line.replace(/^#{1,2}\s+/, "").trim(),
      content: contentForLines(lines, lineStart, lineEnd),
    };
  });
}

function chunkYamlFile(content: string): ChunkSpan[] {
  const lines = content.split("\n");
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^[A-Za-z0-9_-]+:\s*/.test(line));

  if (starts.length === 0) return makeWholeFileChunk(content, "yaml");

  return starts.map((start, idx) => {
    const next = starts[idx + 1];
    const lineStart = start.index + 1;
    const lineEnd = next ? next.index : lines.length;
    return {
      lineStart,
      lineEnd,
      chunkType: "yaml_key",
      language: "yaml",
      symbol: start.line.split(":")[0]?.trim() ?? null,
      content: contentForLines(lines, lineStart, lineEnd),
    };
  });
}

function extractGovernanceRefs(path: string, content: string): string[] {
  const refs = new Set<string>();
  const explicitPattern = /governance:\s*([A-Za-z0-9_.-]+)/gi;
  let match = explicitPattern.exec(content);
  while (match) {
    refs.add(match[1]);
    match = explicitPattern.exec(content);
  }

  if (path.startsWith("governance/")) {
    refs.add(path.replace(/^governance\//, "").replace(/\.[^.]+$/, ""));
  }

  if (path.startsWith("docs/adr/")) {
    refs.add(path.replace(/^docs\/adr\//, "").replace(/\.[^.]+$/, ""));
  }

  return Array.from(refs).sort();
}

function chunksForFile(path: string, content: string): ChunkSpan[] {
  const ext = extensionForPath(path);
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) return chunkTsLikeFile(path, content);
  if (ext === ".json") return chunkJsonFile(content);
  if (ext === ".sql") return chunkSqlFile(content);
  if (ext === ".md") return chunkMarkdownFile(content);
  if (ext === ".yaml" || ext === ".yml") return chunkYamlFile(content);
  return makeWholeFileChunk(content, ext ? ext.slice(1) : null);
}

export function computeCommitChunks(input: CommitChunkInput): RepoChunk[] {
  if (!isAllowedRepoFile(input.path) || !isWithinRepoFileSizeLimit(input.content)) {
    return [];
  }

  const spans = chunksForFile(input.path, input.content).filter((chunk) => chunk.content.trim());

  return spans.map((span) => {
    const contentHash = hash(span.content);
    const idPayload = [
      input.repo,
      input.branch,
      input.commitSha,
      input.path,
      span.lineStart,
      span.lineEnd,
      contentHash,
    ].join("\n");

    return {
      ChunkId: discoveryDocumentId(idPayload),
      Repo: input.repo,
      Branch: input.branch,
      CommitSha: input.commitSha,
      SourceBlobSha: input.sourceBlobSha,
      Path: input.path,
      LineStart: span.lineStart,
      LineEnd: span.lineEnd,
      ChunkType: span.chunkType,
      Language: span.language,
      Symbol: span.symbol,
      Content: span.content,
      ContentHash: contentHash,
      GovernanceRefs: extractGovernanceRefs(input.path, span.content),
    };
  });
}
