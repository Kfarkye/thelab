export type EntityType = 'candidate' | 'job' | 'facility';

export interface RouteContract {
  pathPattern: RegExp;
  entityPrefix: string;
  allowedActions: string[];
  groundingType: EntityType;
}

export const ROUTE_LAWS: Record<EntityType, RouteContract> = {
  candidate: {
    pathPattern: /^\/candidates\/([a-zA-Z0-9-]+)$/,
    entityPrefix: 'AYA.CAND.',
    allowedActions: ['draft_outreach', 'log_vetting'],
    groundingType: 'candidate'
  },
  job: {
    pathPattern: /^\/jobs\/([a-zA-Z0-9-]+)$/,
    entityPrefix: 'AYA.JOB.',
    allowedActions: ['match_candidates', 'close_requisition'],
    groundingType: 'job'
  },
  facility: {
    pathPattern: /^\/facilities\/([a-zA-Z0-9-]+)$/,
    entityPrefix: 'AYA.FAC.',
    allowedActions: ['view_facility'],
    groundingType: 'facility'
  }
};
