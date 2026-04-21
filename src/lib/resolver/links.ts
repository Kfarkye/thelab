// ── HATEOAS Link Generator ───────────────────────────────────────
// Produces action links for resolved resources.
// The AI reads these to know what execution tools are available.

export type HubLinks = {
  self: string;
  nova?: string;
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
    actions: {
      draft: `Use prepare_email_draft with template_id="${templateId}"`,
      preview: `Template is ready for drafting. Resolve a candidate first, then use prepare_email_draft with both IDs.`,
    },
  };
}
