"use client";

import { useEffect, useMemo, useState } from "react";

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapHtmlDocument(body: string, title = "Sandbox Preview"): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 24px;
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f1f1c;
      background: #fdfbf7;
      line-height: 1.55;
    }
    #root { min-height: 1px; }
  </style>
</head>
<body>
  <div id="root">${body}</div>
</body>
</html>`;
}

function extractCodeFence(markdown: string): { lang: string; code: string } | null {
  const match = String(markdown || "").match(/```([A-Za-z0-9_-]+)?\n([\s\S]*?)```/);
  if (!match) return null;
  return {
    lang: String(match[1] || "").toLowerCase(),
    code: String(match[2] || "").trim(),
  };
}

function toExecutableReactSource(source: string): string {
  let code = String(source || "");
  let defaultExportName = "";

  code = code
    .replace(/^\s*import\s+.+?;?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/m, (_match, name: string) => {
      defaultExportName = name;
      return `function ${name}`;
    })
    .replace(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m, (_match, name: string) => {
      defaultExportName = name;
      return "";
    })
    .replace(/\bexport\s+(const|function|class)\b/g, "$1")
    .trim();

  const functionMatch = code.match(/\bfunction\s+([A-Z][A-Za-z0-9_$]*)\s*\(/);
  const constComponentMatch = code.match(/\bconst\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
  const rootComponent = defaultExportName || functionMatch?.[1] || constComponentMatch?.[1] || "App";
  const hasRenderCall = /createRoot\s*\(|ReactDOM\.render\s*\(/.test(code);

  const bootstrap = hasRenderCall
    ? ""
    : `\nconst __mountNode = document.getElementById("root");\nif (__mountNode) {\n  ReactDOM.createRoot(__mountNode).render(<${rootComponent} />);\n}\n`;

  return `${code}${bootstrap}`;
}

function buildReactPreviewDocument(source: string): string {
  const executable = toExecutableReactSource(source);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React Sandbox Preview</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 24px;
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f1f1c;
      background: #fdfbf7;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="typescript,react">
${executable}
  </script>
</body>
</html>`;
}

function buildBlobDocument(markdown: string, renderedHtml?: string): string {
  const html = String(renderedHtml || "").trim();
  if (html) {
    if (/<html[\s>]/i.test(html) || /<!doctype/i.test(html)) return html;
    return wrapHtmlDocument(html);
  }

  const codeFence = extractCodeFence(markdown);
  if (codeFence && ["jsx", "tsx", "js", "ts", "javascript", "typescript"].includes(codeFence.lang)) {
    return buildReactPreviewDocument(codeFence.code);
  }

  const fallback = `<pre style="white-space: pre-wrap; font-family: 'SF Mono', Menlo, monospace; font-size: 12px;">${escapeHtml(markdown)}</pre>`;
  return wrapHtmlDocument(fallback);
}

export function DocumentPreview({
  markdown,
  renderedHtml,
}: {
  markdown: string;
  renderedHtml?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const blobDocument = useMemo(() => buildBlobDocument(markdown, renderedHtml), [markdown, renderedHtml]);
  const isolatedSrcDoc = useMemo(() => {
    if (!renderedHtml) return "";
    const html = blobDocument;
    return html;
  }, [blobDocument, renderedHtml]);

  useEffect(() => {
    if (!blobDocument) {
      setBlobUrl(null);
      return;
    }
    const blob = new Blob([blobDocument], { type: "text/html" });
    const objectUrl = URL.createObjectURL(blob);
    setBlobUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blobDocument]);

  const copyBlobUrl = async () => {
    if (!blobUrl) return;
    try {
      await navigator.clipboard.writeText(blobUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can fail in restricted browser contexts. Keep UI passive.
    }
  };

  return (
    <div className="sb-document-wrap">
      {blobUrl && (
        <div className="sb-document-actions">
          <a
            className="sb-document-link"
            href={blobUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Blob Preview
          </a>
          <button type="button" className="sb-document-copy" onClick={copyBlobUrl}>
            {copied ? "Copied" : "Copy Blob URL"}
          </button>
        </div>
      )}

      {renderedHtml ? (
        <iframe
          title="Sandbox document preview"
          className="sb-document-frame"
          sandbox=""
          srcDoc={isolatedSrcDoc}
        />
      ) : (
        <pre className="sb-document-raw">
          <code>{markdown}</code>
        </pre>
      )}
    </div>
  );
}
