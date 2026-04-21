export type SandboxPanelMode = "closed" | "sources" | "sandbox";

export type SandboxTaskStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed";

export type SandboxOutputType = "document" | "db_write" | "api_call" | "email_draft" | "agent_handoff";

export type CommitAction =
  | {
      type: "publish_preview";
      fixtureId: string;
      writeupUrl: string;
      writeupTitle?: string | null;
    }
  | {
      type: "spanner_write";
      database: string;
      table: string;
      operation: "INSERT" | "UPDATE" | "DELETE";
      params: Record<string, unknown>;
    }
  | {
      type: "api_fetch";
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
    }
  | {
      type: "create_email_draft";
      templateId: string;
      candidateId: string;
      jobId?: string;
      toEmail: string;
      cc: string[];
      subject: string;
      body: string;
      noteContent?: string;
    }
  | {
      type: "send_email_now";
      templateId: string;
      candidateId: string;
      jobId?: string;
      toEmail: string;
      cc: string[];
      subject: string;
      body: string;
      noteContent?: string;
    }
  | {
      type: "log_candidate_note";
      candidateId: string;
      content: string;
      noteType?: string;
    }
  | {
      type: "create_agent_handoff_task";
      targetUrl: string;
      sourceSurface?: string;
      goal: string;
      instructions: string[];
      expectedReturnSchema: Record<string, unknown>;
      context?: Record<string, unknown> | null;
      autoLaunch?: boolean;
    };

export type SandboxPreview =
  | { type: "document"; markdown: string; renderedHtml?: string }
  | {
      type: "db_write";
      table: string;
      operation: "INSERT" | "UPDATE" | "DELETE";
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
    }
  | {
      type: "api_call";
      method: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }
  | {
      type: "email_draft";
      templateId: string;
      toEmail: string;
      cc: string[];
      subject: string;
      body: string;
      candidateId?: string;
      jobId?: string;
      noteContent?: string;
      allowSendNow?: boolean;
    }
  | {
      type: "agent_handoff";
      targetUrl: string;
      sourceSurface: string;
      goal: string;
      instructions: string[];
      expectedReturnSchema: Record<string, unknown>;
      context?: Record<string, unknown> | null;
      autoLaunch?: boolean;
    };

export interface SandboxTask {
  taskId: string;
  status: SandboxTaskStatus;
  outputType: SandboxOutputType;
  title: string;
  preview: SandboxPreview;
  commitAction: CommitAction;
  feedback: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  error: string | null;
  conversationId: string;
  mode: string;
  messageId?: string;
}
