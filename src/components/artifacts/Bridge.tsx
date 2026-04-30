"use client";

import { useEffect } from "react";

const ALLOWED_CHILD_ORIGINS = new Set(["https://artifacts.verdict.internal"]);
const MAX_ARTIFACT_CONTENT_CHARS = 250_000;
const ALLOWED_TYPES = new Set(["tsx", "ts", "js", "json", "md", "html", "css"]);

const ACTIONS = {
  GET_ARTIFACT: {
    method: "GET",
    origin: "https://api.verdict.internal",
    path: (id: string) => `/api/v1/artifacts/${encodeURIComponent(id)}`,
  },
  SAVE_ARTIFACT: {
    method: "POST",
    origin: "https://api.verdict.internal",
    path: () => "/api/v1/artifacts",
  },
} as const;

type BridgeAction = keyof typeof ACTIONS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBridgeAction(value: unknown): value is BridgeAction {
  return typeof value === "string" && value in ACTIONS;
}

function isValidSavePayload(payload: unknown): payload is { content: string; type: string } {
  if (!isRecord(payload)) return false;
  const { content, type } = payload;
  return (
    typeof content === "string" &&
    content.length <= MAX_ARTIFACT_CONTENT_CHARS &&
    typeof type === "string" &&
    ALLOWED_TYPES.has(type)
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown bridge error");
}

function postBridgeMessage(event: MessageEvent, message: Record<string, unknown>): void {
  const source = event.source as Window | null;
  source?.postMessage(message, event.origin);
}

export function Bridge(props: {
  srcDoc?: string;
  sandbox?: string;
}): React.ReactElement | null {
  useEffect(() => {
    const onMessage = async (event: MessageEvent): Promise<void> => {
      if (!ALLOWED_CHILD_ORIGINS.has(event.origin)) return;

      const data = isRecord(event.data) ? event.data : {};
      const action = data.action;
      const id = data.id;
      const payload = data.payload;

      if (!isBridgeAction(action)) return;
      if (action === "GET_ARTIFACT" && typeof id !== "string") return;
      if (action === "SAVE_ARTIFACT" && !isValidSavePayload(payload)) return;

      const config = ACTIONS[action];

      try {
        const res = await fetch(`${config.origin}${config.path(typeof id === "string" ? id : "")}`, {
          method: config.method,
          headers: { "Content-Type": "application/json" },
          body: config.method === "POST" ? JSON.stringify(payload) : undefined,
          credentials: "omit",
        });

        postBridgeMessage(event, {
          type: "BRIDGE_RESPONSE",
          action,
          status: res.status,
          body: await res.text(),
        });
      } catch (error: unknown) {
        postBridgeMessage(event, {
          type: "BRIDGE_ERROR",
          action,
          error: readErrorMessage(error),
        });
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!props.srcDoc) return null;

  return (
    <iframe
      title="Artifact preview"
      srcDoc={props.srcDoc}
      sandbox={props.sandbox || "allow-scripts"}
      style={{ width: "100%", height: "100%", border: 0, background: "#fdfdfc" }}
    />
  );
}
