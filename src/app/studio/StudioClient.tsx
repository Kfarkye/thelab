'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { render as renderTemplate } from '@/lib/portal-template';

/* ─────────────────────────────────────────────────────────
 * Types matching the API
 * ───────────────────────────────────────────────────────── */

type Template = {
  template_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  template_html: string;
  template_css: string | null;
  schema_json: unknown;
  published_version: number | null;
};

type CandidateSummary = {
  id: string;
  first_name: string;
  last_name: string;
  specialty: string | null;
  profession: string | null;
  home_state: string | null;
  submittal_count: number;
};

type Viewport = 'mobile' | 'tablet' | 'desktop';

/* ─────────────────────────────────────────────────────────
 * Authed fetch wrapper
 * ───────────────────────────────────────────────────────── */

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser ?? (await waitForSignedInUser());
  if (!user) throw new Error('not_authenticated');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

function waitForSignedInUser(timeoutMs = 10_000): Promise<User | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(user);
    });
  });
}

/* ─────────────────────────────────────────────────────────
 * Component
 * ───────────────────────────────────────────────────────── */

export default function StudioClient() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [candidateData, setCandidateData] = useState<Record<string, unknown> | null>(null);

  const [html, setHtml] = useState('');
  const [css, setCss] = useState('');
  const [editorTab, setEditorTab] = useState<'html' | 'css'>('html');
  const [viewport, setViewport] = useState<Viewport>('mobile');
  const [showData, setShowData] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: 'idle' | 'live' | 'error' }>(
    { text: 'idle', kind: 'idle' }
  );
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' | '' } | null>(null);

  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /* ── Effect: initial load ───────────────────────────── */

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setStatus({ text: 'loading templates…', kind: 'idle' });
        const tRes = await authedFetch('/api/studio/templates');
        if (!tRes.ok) throw new Error((await tRes.json()).error ?? 'Load failed');
        const tData = await tRes.json();
        if (!alive) return;
        setTemplates(tData.templates);
        if (tData.templates[0]) setActiveTemplateId(tData.templates[0].template_id);

        setStatus({ text: 'loading candidates…', kind: 'idle' });
        const cRes = await authedFetch('/api/studio/candidates?limit=50');
        if (!cRes.ok) throw new Error((await cRes.json()).error ?? 'Load failed');
        const cData = await cRes.json();
        if (!alive) return;
        setCandidates(cData.candidates);
        if (cData.candidates[0]) setActiveCandidateId(cData.candidates[0].id);

        setStatus({ text: 'ready', kind: 'live' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Load failed';
        setStatus({ text: msg, kind: 'error' });
        showToast(msg, 'error');
      }
    })();
    return () => { alive = false; };
  }, []);

  /* ── Effect: load template content when activeTemplateId changes ─ */

  useEffect(() => {
    if (!activeTemplateId) return;
    const t = templates.find(x => x.template_id === activeTemplateId);
    if (!t) return;
    setHtml(t.template_html ?? '');
    setCss(t.template_css ?? '');
    setDirty(false);
  }, [activeTemplateId, templates]);

  /* ── Effect: fetch candidate data when activeCandidateId changes ─ */

  useEffect(() => {
    if (!activeCandidateId) return;
    let alive = true;
    (async () => {
      try {
        setStatus({ text: 'fetching data…', kind: 'idle' });
        const r = await authedFetch(
          `/api/studio/candidate-data?id=${encodeURIComponent(activeCandidateId)}`
        );
        if (!r.ok) throw new Error((await r.json()).error ?? 'Data load failed');
        const d = await r.json();
        if (!alive) return;
        setCandidateData(d.data);
        setStatus({ text: 'data loaded', kind: 'live' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Data load failed';
        setStatus({ text: msg, kind: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [activeCandidateId]);

  /* ── Effect: debounced preview render ───────────────── */

  useEffect(() => {
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      renderPreview();
    }, 150);
    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, css, candidateData]);

  const renderPreview = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const data = candidateData ?? {};
    const body = renderTemplate(html, data);
    const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{margin:0;padding:0;}${css ?? ''}</style></head><body>${body}</body></html>`;
    frame.srcdoc = doc;
  }, [html, css, candidateData]);

  /* ── Save ──────────────────────────────────────────── */

  const save = useCallback(async (publish = false) => {
    if (!activeTemplateId) return;
    setStatus({ text: publish ? 'publishing…' : 'saving…', kind: 'idle' });
    try {
      const r = await authedFetch(
        `/api/studio/templates/${activeTemplateId}${publish ? '?publish=true' : ''}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            template_html: html,
            template_css: css,
          }),
        }
      );
      if (!r.ok) throw new Error((await r.json()).error ?? 'Save failed');
      const data = await r.json();
      setDirty(false);
      setStatus({ text: publish ? `published v${data.version}` : `saved v${data.version}`, kind: 'live' });
      showToast(publish ? 'Published' : 'Saved', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setStatus({ text: msg, kind: 'error' });
      showToast(msg, 'error');
    }
  }, [activeTemplateId, html, css]);

  /* ── Cmd+S ─────────────────────────────────────────── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  /* ── Toast ─────────────────────────────────────────── */

  function showToast(msg: string, kind: 'success' | 'error' | '' = '') {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  }

  /* ── Monaco onMount — sets font + scroll behavior ──── */

  const onEditorMount: OnMount = (editor) => {
    editor.updateOptions({
      fontFamily: 'JetBrains Mono, SF Mono, Menlo, monospace',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
    });
  };

  const activeTemplate = useMemo(
    () => templates.find(t => t.template_id === activeTemplateId) ?? null,
    [templates, activeTemplateId]
  );

  const activeCandidate = useMemo(
    () => candidates.find(c => c.id === activeCandidateId) ?? null,
    [candidates, activeCandidateId]
  );

  /* ── Render ────────────────────────────────────────── */

  return (
    <div style={shell}>
      {/* Top bar */}
      <div style={topbar}>
        <div style={logo}>
          PORTAL<span style={{ color: '#4a9eff' }}>.STUDIO</span>
        </div>

        <div style={group}>
          <span style={label}>Template</span>
          <select
            value={activeTemplateId ?? ''}
            onChange={e => setActiveTemplateId(e.target.value)}
            style={input}
          >
            {templates.map(t => (
              <option key={t.template_id} value={t.template_id}>
                {t.name} {t.status === 'draft' ? '(draft)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={group}>
          <span style={label}>Candidate</span>
          <select
            value={activeCandidateId ?? ''}
            onChange={e => setActiveCandidateId(e.target.value)}
            style={input}
          >
            {candidates.map(c => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name}
              </option>
            ))}
          </select>
        </div>

        <div style={group}>
          <span style={{
            ...dot,
            background: status.kind === 'live' ? '#22c55e' :
                        status.kind === 'error' ? '#ef4444' : '#6a6a70',
            boxShadow: status.kind === 'live' ? '0 0 8px #22c55e' : 'none',
          }} />
          <span style={label}>{status.text}</span>
        </div>

        <div style={{ flex: 1 }} />

        <button style={btn} onClick={() => setShowData(s => !s)}>Data</button>
        <button style={btn} onClick={() => save(false)} disabled={!dirty && !activeTemplate}>
          Save
        </button>
        <button style={{ ...btn, ...btnPrimary }} onClick={() => save(true)}>
          Publish
        </button>
      </div>

      {/* Main split */}
      <div style={main}>
        {/* Sidebar */}
        <div style={sidebar}>
          <div style={sideLabel}>Sample Candidates</div>
          {candidates.map(c => (
            <div
              key={c.id}
              onClick={() => setActiveCandidateId(c.id)}
              style={{
                ...sideItem,
                ...(c.id === activeCandidateId ? sideItemActive : {}),
              }}
            >
              <span>{c.first_name} {c.last_name}</span>
              <span style={sideMeta}>{c.submittal_count}</span>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div style={editorPane}>
          <div style={tabs}>
            <div
              style={{ ...tab, ...(editorTab === 'html' ? tabActive : {}) }}
              onClick={() => setEditorTab('html')}
            >HTML</div>
            <div
              style={{ ...tab, ...(editorTab === 'css' ? tabActive : {}) }}
              onClick={() => setEditorTab('css')}
            >CSS</div>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, display: editorTab === 'html' ? 'block' : 'none' }}>
              <Editor
                height="100%"
                language="html"
                theme="vs-dark"
                value={html}
                onChange={v => { setHtml(v ?? ''); setDirty(true); }}
                onMount={onEditorMount}
              />
            </div>
            <div style={{ position: 'absolute', inset: 0, display: editorTab === 'css' ? 'block' : 'none' }}>
              <Editor
                height="100%"
                language="css"
                theme="vs-dark"
                value={css}
                onChange={v => { setCss(v ?? ''); setDirty(true); }}
                onMount={onEditorMount}
              />
            </div>
          </div>
          {showData && (
            <div style={dataPanel}>
              <div style={{ color: '#6a6a70', marginBottom: 8 }}>
                Available data for {activeCandidate?.first_name ?? '—'}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {JSON.stringify(candidateData, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Preview */}
        <div style={previewPane}>
          <div style={previewBar}>
            <span>Rendered · {html.length} chars html · {css.length} chars css</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              {(['mobile', 'tablet', 'desktop'] as Viewport[]).map(v => (
                <button
                  key={v}
                  onClick={() => setViewport(v)}
                  style={{
                    ...vpBtn,
                    ...(viewport === v ? vpBtnActive : {}),
                  }}
                >{v}</button>
              ))}
            </div>
          </div>
          <div style={previewContainer}>
            <div style={{
              ...frameWrap,
              ...(viewport === 'mobile' ? { width: 390, height: 844 } : {}),
              ...(viewport === 'tablet' ? { width: 768, height: 1024 } : {}),
              ...(viewport === 'desktop' ? { width: '100%', height: '100%', maxWidth: 1200 } : {}),
            }}>
              <iframe
                ref={iframeRef}
                sandbox="allow-same-origin"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                title="preview"
              />
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          ...toastBase,
          borderColor: toast.kind === 'success' ? '#22c55e' : toast.kind === 'error' ? '#ef4444' : '#2a2a2f',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * Inline styles — keeps this component self-contained
 * and avoids CSS Modules overhead for a single page
 * ───────────────────────────────────────────────────────── */

const shell: React.CSSProperties = {
  background: '#0f0f10',
  color: '#e8e8ea',
  height: '100vh',
  overflow: 'hidden',
  fontFamily: 'Inter, -apple-system, sans-serif',
  fontSize: 13,
};
const topbar: React.CSSProperties = {
  height: 48,
  background: '#17171a',
  borderBottom: '1px solid #2a2a2f',
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  gap: 16,
};
const logo: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.1em',
};
const group: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const label: React.CSSProperties = {
  fontSize: 11,
  color: '#9a9aa0',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};
const input: React.CSSProperties = {
  background: '#1e1e22',
  color: '#e8e8ea',
  border: '1px solid #2a2a2f',
  padding: '6px 10px',
  fontSize: 12,
  borderRadius: 4,
};
const btn: React.CSSProperties = {
  ...input,
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  background: '#4a9eff',
  borderColor: '#4a9eff',
  color: '#fff',
  fontWeight: 600,
};
const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
};
const main: React.CSSProperties = {
  display: 'flex',
  height: 'calc(100vh - 48px)',
};
const sidebar: React.CSSProperties = {
  width: 220,
  background: '#17171a',
  borderRight: '1px solid #2a2a2f',
  overflowY: 'auto',
  padding: '12px 0',
};
const sideLabel: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  color: '#6a6a70',
};
const sideItem: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  color: '#9a9aa0',
  cursor: 'pointer',
  borderLeft: '2px solid transparent',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const sideItemActive: React.CSSProperties = {
  background: '#1e1e22',
  color: '#e8e8ea',
  borderLeftColor: '#4a9eff',
};
const sideMeta: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 10,
  color: '#6a6a70',
};
const editorPane: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  borderRight: '1px solid #2a2a2f',
};
const tabs: React.CSSProperties = {
  height: 32,
  background: '#17171a',
  borderBottom: '1px solid #2a2a2f',
  display: 'flex',
};
const tab: React.CSSProperties = {
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  fontSize: 12,
  color: '#9a9aa0',
  cursor: 'pointer',
  borderRight: '1px solid #2a2a2f',
  fontFamily: 'JetBrains Mono, monospace',
};
const tabActive: React.CSSProperties = { background: '#0f0f10', color: '#e8e8ea' };
const dataPanel: React.CSSProperties = {
  height: 200,
  background: '#17171a',
  borderTop: '1px solid #2a2a2f',
  overflowY: 'auto',
  padding: '12px 16px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
  color: '#9a9aa0',
};
const previewPane: React.CSSProperties = {
  width: '45%',
  minWidth: 360,
  display: 'flex',
  flexDirection: 'column',
  background: '#17171a',
};
const previewBar: React.CSSProperties = {
  height: 32,
  background: '#17171a',
  borderBottom: '1px solid #2a2a2f',
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  gap: 8,
  fontSize: 11,
  color: '#9a9aa0',
  fontFamily: 'JetBrains Mono, monospace',
};
const previewContainer: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  background: '#2a2a2f',
  padding: 16,
  overflow: 'auto',
};
const frameWrap: React.CSSProperties = {
  background: '#fff',
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  transition: 'width 0.2s, height 0.2s',
};
const vpBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2a2a2f',
  color: '#6a6a70',
  padding: '3px 8px',
  fontSize: 10,
  fontFamily: 'JetBrains Mono, monospace',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  borderRadius: 3,
  textTransform: 'uppercase',
};
const vpBtnActive: React.CSSProperties = {
  background: '#1e1e22',
  color: '#e8e8ea',
  borderColor: '#6a6a70',
};
const toastBase: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  right: 24,
  background: '#1e1e22',
  border: '1px solid #2a2a2f',
  padding: '12px 16px',
  borderRadius: 6,
  fontSize: 12,
  zIndex: 100,
};
