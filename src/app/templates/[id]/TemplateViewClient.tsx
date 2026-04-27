"use client";

import { useMemo, useState } from "react";
import { Braces, Check, Copy, ExternalLink, FileText, Mail, Route } from "lucide-react";
import styles from "./template-view.module.css";

export type TemplateViewModel = {
  id: string;
  name: string;
  category: string;
  messageType: string;
  internalOnly: boolean;
  requiredFields: string[];
  source: string;
  version: number;
  blueprint: {
    subject: string;
    body: string;
    to?: string;
    cc?: string;
  };
  urls: {
    page: string;
    api: string;
    hubPostBody: string;
  };
};

type CopyKey = "subject" | "body" | "all" | "api" | "payload";

function CopyButton({
  value,
  label,
  copyKey,
  copied,
  onCopied,
}: {
  value: string;
  label: string;
  copyKey: CopyKey;
  copied: CopyKey | null;
  onCopied: (key: CopyKey, value: string) => void;
}) {
  const isCopied = copied === copyKey;
  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={() => onCopied(copyKey, value)}
      aria-label={label}
      title={label}
    >
      {isCopied ? <Check size={15} /> : <Copy size={15} />}
      <span>{isCopied ? "Copied" : label}</span>
    </button>
  );
}

export function TemplateViewClient({ template }: { template: TemplateViewModel }) {
  const [copied, setCopied] = useState<CopyKey | null>(null);

  const fullDraft = useMemo(() => {
    const lines = [
      template.blueprint.to ? `To: ${template.blueprint.to}` : "",
      template.blueprint.cc ? `Cc: ${template.blueprint.cc}` : "",
      `Subject: ${template.blueprint.subject}`,
      "",
      template.blueprint.body,
    ];
    return lines.filter((line, index) => index === 3 || line.trim().length > 0).join("\n");
  }, [template.blueprint.body, template.blueprint.cc, template.blueprint.subject, template.blueprint.to]);

  const copyValue = (key: CopyKey, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1600);
    });
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.kickerRow}>
            <span className={styles.kicker}>{template.category}</span>
            <span className={styles.kicker}>{template.messageType}</span>
            {template.internalOnly && <span className={styles.kicker}>Internal</span>}
          </div>
          <h1>{template.name}</h1>
          <p>{template.id}</p>
        </div>
        <div className={styles.heroActions} aria-label="Template actions">
          <CopyButton
            value={fullDraft}
            label="Copy Draft"
            copyKey="all"
            copied={copied}
            onCopied={copyValue}
          />
          <a className={styles.openButton} href={template.urls.api} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} />
            <span>Open API</span>
          </a>
        </div>
      </section>

      <section className={styles.layout} aria-label="Template workspace">
        <aside className={styles.rail}>
          <div className={styles.railBlock}>
            <h2>
              <Route size={15} />
              URLs
            </h2>
            <div className={styles.endpointList}>
              <div className={styles.endpointRow}>
                <span>Page</span>
                <code>{template.urls.page}</code>
              </div>
              <div className={styles.endpointRow}>
                <span>API</span>
                <code>{template.urls.api}</code>
              </div>
            </div>
            <CopyButton
              value={template.urls.api}
              label="Copy API URL"
              copyKey="api"
              copied={copied}
              onCopied={copyValue}
            />
          </div>

          <div className={styles.railBlock}>
            <h2>
              <Braces size={15} />
              Hub Body
            </h2>
            <pre className={styles.payload}>{template.urls.hubPostBody}</pre>
            <CopyButton
              value={template.urls.hubPostBody}
              label="Copy Payload"
              copyKey="payload"
              copied={copied}
              onCopied={copyValue}
            />
          </div>

          <div className={styles.railBlock}>
            <h2>
              <FileText size={15} />
              Fields
            </h2>
            <div className={styles.fieldList}>
              {template.requiredFields.length > 0 ? (
                template.requiredFields.map((field) => <code key={field}>{field}</code>)
              ) : (
                <span className={styles.emptyText}>No required fields</span>
              )}
            </div>
          </div>
        </aside>

        <article className={styles.preview} aria-label="Email template preview">
          <header className={styles.previewHeader}>
            <div>
              <span className={styles.previewLabel}>
                <Mail size={15} />
                Email Preview
              </span>
              <h2>{template.blueprint.subject || "Untitled draft"}</h2>
            </div>
            <CopyButton
              value={template.blueprint.subject}
              label="Copy Subject"
              copyKey="subject"
              copied={copied}
              onCopied={copyValue}
            />
          </header>

          <div className={styles.emailMeta}>
            {template.blueprint.to && (
              <div>
                <span>To</span>
                <code>{template.blueprint.to}</code>
              </div>
            )}
            {template.blueprint.cc && (
              <div>
                <span>Cc</span>
                <code>{template.blueprint.cc}</code>
              </div>
            )}
            <div>
              <span>Source</span>
              <code>{template.source} v{template.version}</code>
            </div>
          </div>

          <div className={styles.bodyToolbar}>
            <span>Body</span>
            <CopyButton
              value={template.blueprint.body}
              label="Copy Body"
              copyKey="body"
              copied={copied}
              onCopied={copyValue}
            />
          </div>

          <pre className={styles.emailBody}>{template.blueprint.body}</pre>
        </article>
      </section>
    </main>
  );
}
