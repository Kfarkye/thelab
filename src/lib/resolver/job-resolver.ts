import { getRecruitingDb } from "@/lib/spanner-pool";
import { type HubResponse } from "./candidate-resolver";

export async function resolveJob(identifier: string): Promise<HubResponse> {
  const db = getRecruitingDb();
  
  // Clean up identifier for searching
  const query = identifier.trim();
  
  // Try exact match by ID first
  const [exactRows] = await db.run({
    sql: `SELECT job_order_id, title, profession, specialty, city, state, employment_type, 
                 shift, pay_rate_min, pay_rate_max, urgent, status, (openings - filled) as open_count
          FROM job_orders 
          WHERE job_order_id = @query`,
    params: { query },
    types: { query: { type: "string" } },
  });

  let jobRow = exactRows.length > 0 ? exactRows[0] : null;

  // If no exact match by ID, maybe they searched by title or specialty
  if (!jobRow) {
    const [fuzzyRows] = await db.run({
      sql: `SELECT job_order_id, title, profession, specialty, city, state, employment_type, 
                   shift, pay_rate_min, pay_rate_max, urgent, status, (openings - filled) as open_count
            FROM job_orders 
            WHERE LOWER(title) LIKE LOWER(@pattern)
               OR LOWER(specialty) LIKE LOWER(@pattern)
            LIMIT 5`,
      params: { pattern: `%${query}%` },
      types: { pattern: { type: "string" } },
    });

    if (fuzzyRows.length === 0) {
      return {
        type: "job",
        status: "not_found",
        summary: `No job matched "${identifier}".`,
        data: null,
        links: {},
      };
    }
    
    if (fuzzyRows.length > 1) {
      return {
        type: "job",
        status: "ambiguous",
        summary: `Multiple jobs matched "${identifier}". Please clarify.`,
        data: null,
        links: {},
        alternatives: fuzzyRows.map((r: any) => {
          const doc = r.toJSON();
          const title = String(doc.title || "Unknown Job");
          const loc = [doc.city, doc.state].filter(Boolean).join(", ");
          return {
            id: String(doc.job_order_id),
            name: `${title} - ${loc}`,
            status: String(doc.status),
            nova_id: null,
            specialty: String(doc.specialty),
            confidence: 50,
          };
        }),
      };
    }
    
    jobRow = fuzzyRows[0];
  }

  const job = jobRow.toJSON();
  const id = String(job.job_order_id);
  const title = String(job.title || "Unknown Job Title");
  const loc = [job.city, job.state].filter(Boolean).join(", ");
  const pay = (job.pay_rate_min && job.pay_rate_max) 
    ? `$${job.pay_rate_min}-$${job.pay_rate_max}`
    : (job.pay_rate_min ? `$${job.pay_rate_min}` : 'Pay TBD');
  
  return {
    type: "job",
    id,
    status: "resolved",
    summary: `${title} | ${loc} | ${pay} | Status: ${job.status}`,
    data: {
      id,
      title,
      profession: job.profession ? String(job.profession) : null,
      specialty: job.specialty ? String(job.specialty) : null,
      city: job.city ? String(job.city) : null,
      state: job.state ? String(job.state) : null,
      employment_type: job.employment_type ? String(job.employment_type) : null,
      shift: job.shift ? String(job.shift) : null,
      pay_rate_min: job.pay_rate_min !== null ? Number(job.pay_rate_min) : null,
      pay_rate_max: job.pay_rate_max !== null ? Number(job.pay_rate_max) : null,
      urgent: job.urgent !== null ? Boolean(job.urgent) : false,
      status: job.status ? String(job.status) : null,
    },
    links: {
      self: `/api/hub/jobs/${id}`,
      facility: `/api/hub/facilities?job_id=${id}`,
      actions: {
        "view-job-details": `Use internal tooling to view full job description for ${id}`,
        "match-candidates": `Run matchmaking for job ${id}`
      }
    },
  };
}
