"use client";

import { useState } from "react";
import { Bridge } from "@/components/artifacts/Bridge";
import styles from "./ArtifactCard.module.css";

type ArtifactCardProps = {
  artifact: {
    artifact_id: string;
    preview_html: string;
    violations?: string[];
  };
};

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const [status, setStatus] = useState<"idle" | "busy" | "done">("idle");
  const hasViolations = Boolean(artifact.violations?.length);

  const onApprove = async (): Promise<void> => {
    setStatus("busy");
    navigator.vibrate?.(4);
    const res = await fetch(`/api/artifacts/${artifact.artifact_id}/approve`, { method: "POST" });
    if (res.ok) {
      setStatus("done");
    } else {
      setStatus("idle");
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.label}>
          Artifact / {artifact.artifact_id.split("-")[0]}
        </span>
      </div>

      <div className={styles.preview}>
        <Bridge srcDoc={artifact.preview_html} sandbox="allow-scripts" />
      </div>

      <div className={styles.body}>
        {hasViolations ? (
          <div className={styles.block}>
            <p className={styles.blockTitle}>Action restricted</p>
            <ul className={styles.violations}>
              {artifact.violations?.map((violation: string) => <li key={violation}>{violation}</li>)}
            </ul>
          </div>
        ) : null}

        <button
          disabled={hasViolations || status !== "idle"}
          onClick={onApprove}
          className={styles.button}
        >
          {status === "busy" ? "Updating files..." : status === "done" ? "Updated" : "Update Files"}
        </button>
      </div>
    </div>
  );
}
