// Rule: No valid URL, no valid work.
export const RouteLaws = {
  candidate: {
    pattern: /^\/candidates\/([a-zA-Z0-9-]+)$/,
    canonical: (id: string) => `/candidates/${id}`,
    object_prefix: "AYA.CAND.",
    allowed_actions: ["draft_outreach", "vet_candidate"]
  },
  job: {
    pattern: /^\/jobs\/([a-zA-Z0-9-]+)$/,
    canonical: (id: string) => `/jobs/${id}`,
    object_prefix: "AYA.JOB.",
    allowed_actions: ["match_candidates", "close_job"]
  }
} as const;
