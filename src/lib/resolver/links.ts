// ── HATEOAS Link Generator ───────────────────────────────────────
// Produces action links for resolved resources.
// The AI reads these to know what execution tools are available.

export type HubLinks = {
  self: string;
  nova?: string;
  api?: string;
  public?: string;
  writeup?: string;
  actions: Record<string, string>;
};

/**
 * Build HATEOAS links for a resolved candidate.
 * The `actions` field tells the AI exactly what tool to call and with what parameters.
 */
export function buildCandidateLinks(
  internalId: string,
  novaId: string | null,
  novaUrl: string | null,
): HubLinks {
  const links: HubLinks = {
    self: `/api/hub/candidates/${internalId}`,
    actions: {
      email: `Use prepare_email_draft with candidate_id="${internalId}"`,
      add_note: `Use add_candidate_note with candidate_id="${internalId}"`,
      update_status: `Use update_candidate_status with candidate_id="${internalId}"`,
      update_profession: `Use update_candidate_profession with candidate_id="${internalId}"`,
      get_grounding: `Use get_internal_grounding_context with candidate_id="${internalId}"`,
    },
  };

  if (novaUrl) {
    links.nova = novaUrl;
  }

  if (novaId) {
    links.actions.nova_profile = `Nova profile: https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about`;
    links.actions.nova_notes = `Nova notes: https://nova.ayahealthcare.com/#/recruiting/candidates/${novaId}/new-profile/about (scroll to Notes)`;
  }

  return links;
}

/**
 * Build HATEOAS links for a resolved template.
 */
export function buildTemplateLinks(
  templateId: string,
  category: string,
): HubLinks {
  return {
    self: `/api/hub/templates/${templateId}`,
    api: `/api/hub/templates/${templateId}`,
    public: `/templates/${templateId}`,
    actions: {
      draft: `Use prepare_email_draft with template_id="${templateId}"`,
      preview: `Template is ready for drafting. Resolve a candidate first, then use prepare_email_draft with both IDs.`,
      open_template: `Open /templates/${templateId} for the canonical template view.`,
      resolve_again: `Use access_hub with path="templates/${templateId}" to re-ground this template.`,
    },
  };
}

/**
 * Build HATEOAS links for a resolved game.
 */
export function buildGameLinks(
  gameId: string,
  options: { writeupUrl?: string | null } = {},
): HubLinks {
  const encodedId = encodeURIComponent(gameId);
  const links: HubLinks = {
    self: `/api/hub/games/${encodedId}`,
    api: `/api/sports/games/${encodedId}`,
    public: `/sports/games/${encodedId}`,
    actions: {
      view_api: `Open /api/sports/games/${encodedId} for canonical game data.`,
      resolve_again: `Use access_hub with path="games/${gameId}" to re-ground this game.`,
    },
  };

  if (options.writeupUrl) {
    links.writeup = options.writeupUrl;
    links.actions.preview = `Open preview writeup: ${options.writeupUrl}`;
  }

  return links;
}

/**
 * Build HATEOAS links for a resolved pick.
 */
export function buildPickLinks(
  pickId: string,
  options: { briefId?: string | null } = {},
): HubLinks {
  const encodedId = encodeURIComponent(pickId);
  const briefUrl = options.briefId
    ? `/brief/${encodeURIComponent(options.briefId)}#pick-${encodedId}`
    : `/brief/picks/${encodedId}`;

  return {
    self: `/api/hub/picks/${encodedId}`,
    api: `/api/sports/picks/${encodedId}`,
    public: briefUrl,
    actions: {
      view_api: `Open /api/sports/picks/${encodedId} for canonical pick ledger data.`,
      grade_status: `Check grading_status and event_status from /api/sports/picks/${encodedId}.`,
      resolve_again: `Use access_hub with path="picks/${pickId}" to re-ground this pick.`,
    },
  };
}
