// ── Verter AI Tools — Function-calling schema for auto-improve ──
// Tool declarations consumed by the auto-improve API route.
// The model uses these to read repo files and propose code changes.

export const ReadRepoFileTool = {
  name: "read_repo_file",
  description:
    "Read the full contents from the repository. Use this for context gathering before proposing any code changes.",
  parameters: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Repository-relative file path." },
      branch: { type: "string" as const, description: "Optional branch name. Defaults to configured base branch." },
    },
    required: ["path"],
  },
} as const;

export const ProcessCodeChangeTool = {
  name: "process_code_change",
  description:
    "Create a dedicated branch, commit proposed file changes, and open a Pull Request for review. Only call this when a safe change is warranted.",
  parameters: {
    type: "object" as const,
    properties: {
      branch: {
        type: "string" as const,
        description: "Branch name for proposed changes.",
      },
      commit_message: {
        type: "string" as const,
        description: "Commit message describing the change.",
      },
      file_patches: {
        type: "array" as const,
        description: "Full file payloads to create/update.",
        items: {
          type: "object" as const,
          properties: {
            path: { type: "string" as const, description: "Repository-relative file path." },
            content: { type: "string" as const, description: "Full target file content." },
          },
          required: ["path", "content"],
        },
      },
      pr_title: { type: "string" as const, description: "Pull request title." },
      review_status: {
        type: "string" as const,
        description: "Optional: manual review status or validation notes for reviewers.",
      },
    },
    required: ["branch", "commit_message", "file_patches"],
  },
} as const;

export const AUTO_IMPROVE_TOOLS = [ReadRepoFileTool, ProcessCodeChangeTool] as const;
