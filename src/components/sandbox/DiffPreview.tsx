function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

export function DiffPreview({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}) {
  return (
    <div className="sb-diff">
      <div className="sb-diff-pane sb-diff-before">
        <div className="sb-diff-label">Before</div>
        <pre>
          <code>{prettyJson(before)}</code>
        </pre>
      </div>
      <div className="sb-diff-pane sb-diff-after">
        <div className="sb-diff-label">After</div>
        <pre>
          <code>{prettyJson(after)}</code>
        </pre>
      </div>
    </div>
  );
}

