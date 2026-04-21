/**
 * Portal Template Engine
 *
 * Handlebars-lite renderer used by both /studio preview and /p/[slug] SSR.
 * Deterministic, no eval, HTML-escaping by default.
 *
 * Syntax (the whole language):
 *   {{path.to.value}}           — escaped interpolation
 *   {{{path.to.value}}}         — raw (unescaped) interpolation, use sparingly
 *   {{#each arrayPath}}...{{/each}}   — iterate; inner scope = item + parent
 *   {{#if path}}...{{/if}}      — render inner only if truthy
 *
 * Truthiness: non-null, non-undefined, non-empty-string, non-zero, non-empty-array.
 *
 * Intentional omissions: partials, helpers, else branches, nested lookups
 * across loop iterations beyond `_parent`. Keep it small and auditable.
 */

type TemplateData = Record<string, unknown>;

/* ─────────────────────────────────────────────────────────
 * HTML escape — default for {{value}} to prevent XSS when
 * candidate data contains characters like < > & " '.
 * ───────────────────────────────────────────────────────── */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/* ─────────────────────────────────────────────────────────
 * Path resolution
 * ───────────────────────────────────────────────────────── */

function resolve(path: string, ctx: TemplateData): unknown {
  if (!path) return '';
  if (path === '.') return ctx;
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? '';
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

/* ─────────────────────────────────────────────────────────
 * Render pipeline — each pass handles one construct type.
 * Processed deepest-first via simple regex loops so nested
 * blocks collapse correctly in a single call.
 * ───────────────────────────────────────────────────────── */

const EACH_RE   = /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/;
const IF_RE     = /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/;
const RAW_RE    = /\{\{\{([\w.]+)\}\}\}/g;
const VALUE_RE  = /\{\{([\w.]+)\}\}/g;

export function render(template: string, data: TemplateData): string {
  let out = template;

  // Loop until no more block constructs remain (handles nested blocks)
  let safety = 0;
  while (safety++ < 50) {
    const eachMatch = out.match(EACH_RE);
    const ifMatch   = out.match(IF_RE);

    // Process whichever appears first in the template
    if (eachMatch && (!ifMatch || (eachMatch.index ?? 0) < (ifMatch.index ?? 0))) {
      const [full, path, inner] = eachMatch;
      const arr = resolve(path, data);
      if (!Array.isArray(arr)) {
        out = out.replace(full, '');
      } else {
        const rendered = arr
          .map((item) =>
            render(inner, {
              ...data,
              ...(typeof item === 'object' && item !== null ? item : { value: item }),
              _parent: data,
            })
          )
          .join('');
        out = out.replace(full, rendered);
      }
      continue;
    }

    if (ifMatch) {
      const [full, path, inner] = ifMatch;
      const v = resolve(path, data);
      out = out.replace(full, isTruthy(v) ? render(inner, data) : '');
      continue;
    }

    break;
  }

  // Raw (unescaped) interpolation — must run before the escaped one
  // because {{{x}}} would otherwise be chewed by the {{x}} regex.
  out = out.replace(RAW_RE, (_, path) => String(resolve(path, data) ?? ''));

  // Escaped interpolation — default case
  out = out.replace(VALUE_RE, (_, path) => escapeHtml(resolve(path, data)));

  return out;
}

/* ─────────────────────────────────────────────────────────
 * Wrap rendered HTML with the template's CSS, for full-page
 * output in both preview and production.
 * ───────────────────────────────────────────────────────── */

export function buildPage(opts: {
  title?: string;
  html: string;
  css: string;
  data: TemplateData;
  noindex?: boolean;
}): string {
  const body = render(opts.html, opts.data);
  const title = escapeHtml(opts.title ?? 'Your Assignment Hub');
  const robots = opts.noindex ? '<meta name="robots" content="noindex, nofollow">' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${robots}
<style>
body { margin: 0; padding: 0; }
${opts.css ?? ''}
</style>
</head>
<body>
${body}
</body>
</html>`;
}
