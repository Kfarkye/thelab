import { getRecruitingDb } from "@/lib/spanner-pool";
import { type HubResponse } from "./candidate-resolver";

export async function resolveFacility(identifier: string): Promise<HubResponse> {
  const db = getRecruitingDb();
  
  // Clean up identifier for searching (case insensitive)
  const query = identifier.trim().toLowerCase();
  
  // Try exact match by ID first
  const [exactRows] = await db.run({
    sql: `SELECT id, name, city, state, vms_platform, msp_provider, emr, beds, is_teaching, trauma_level, accepts_locals, requires_compact 
          FROM hc_facilities 
          WHERE LOWER(id) = @query OR LOWER(name) = @query`,
    params: { query },
    types: { query: { type: "string" } },
  });

  let facilityRow = exactRows.length > 0 ? exactRows[0] : null;

  // If no exact match, try fuzzy search
  if (!facilityRow) {
    const [fuzzyRows] = await db.run({
      sql: `SELECT id, name, city, state, vms_platform, msp_provider, emr, beds, is_teaching, trauma_level, accepts_locals, requires_compact 
            FROM hc_facilities 
            WHERE LOWER(name) LIKE @pattern 
               OR LOWER(city) LIKE @pattern
            LIMIT 5`,
      params: { pattern: `%${query}%` },
      types: { pattern: { type: "string" } },
    });

    if (fuzzyRows.length === 0) {
      return {
        type: "facility",
        status: "not_found",
        summary: `No facility matched "${identifier}".`,
        data: null,
        links: {},
      };
    }
    
    if (fuzzyRows.length > 1) {
      return {
        type: "facility",
        status: "ambiguous",
        summary: `Multiple facilities matched "${identifier}". Please clarify.`,
        data: null,
        links: {},
        alternatives: fuzzyRows.map((r: any) => {
          const doc = r.toJSON();
          return {
            id: String(doc.id),
            name: String(doc.name),
            status: null,
            nova_id: null,
            specialty: null,
            confidence: 50,
          };
        }),
      };
    }
    
    facilityRow = fuzzyRows[0];
  }

  const facility = facilityRow.toJSON();
  const id = String(facility.id);
  const name = String(facility.name || "Unknown Facility");
  const loc = [facility.city, facility.state].filter(Boolean).join(", ");
  
  return {
    type: "facility",
    id,
    status: "resolved",
    summary: `${name} ${loc ? `(${loc})` : ''} | VMS: ${facility.vms_platform || 'N/A'}`,
    data: {
      id,
      name,
      city: facility.city ? String(facility.city) : null,
      state: facility.state ? String(facility.state) : null,
      vms_platform: facility.vms_platform ? String(facility.vms_platform) : null,
      msp_provider: facility.msp_provider ? String(facility.msp_provider) : null,
      emr: facility.emr ? String(facility.emr) : null,
      beds: facility.beds !== null ? Number(facility.beds) : null,
      is_teaching: facility.is_teaching !== null ? Boolean(facility.is_teaching) : null,
      trauma_level: facility.trauma_level ? String(facility.trauma_level) : null,
      accepts_locals: facility.accepts_locals !== null ? Boolean(facility.accepts_locals) : null,
      requires_compact: facility.requires_compact !== null ? Boolean(facility.requires_compact) : null,
    },
    links: {
      self: `/api/hub/facilities/${id}`,
      jobs: `/api/hub/jobs?facility=${id}`,
      actions: {
        "view-facility-policies": `Use the facility-policy internal tooling for ${id}`
      }
    },
  };
}
