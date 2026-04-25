// ── Market Data Normalizer ────────────────────────────────────────
// Shared parsing utilities for the SEO crawler and SSRS ingest pipelines.
// Converts raw ATOM/XML entries and URL-encoded job parameters into
// structured records ready for Spanner writes.
//
// ARCHITECTURE: This module is stateless and pure. It does NOT touch
// Spanner or make network calls. All I/O belongs in the route handlers.

// ── Types ────────────────────────────────────────────────────────

export interface NormalizedJob {
  /** Unique compound key from the source system (e.g., "1078768-701676") */
  source_job_id: string;
  /** Which staffing company this job belongs to */
  source_company: "aya" | "medical_solutions" | "amn" | "host" | "cross_country";
  /** travel | local | permanent */
  job_type: string;
  /** Normalized title: rn, lpn, pt, ot, surgical-tech, etc. */
  job_title: string;
  /** Nursing specialty: icu, er, or, telemetry, med-surg, etc. */
  specialty: string;
  /** City (lowercase, hyphenated from URL or parsed from text) */
  city: string;
  /** Two-letter state code (uppercase) */
  state: string;
  /** day | night | evening | all | rotate */
  shift: string;
  /** Weekly rate in cents (null if not available) */
  weekly_rate_cents: number | null;
  /** Raw rate string as found in source (e.g., "$2,400.00/wk") */
  weekly_rate_raw: string | null;
  /** ISO timestamp of when the source last modified this listing */
  source_last_modified: string | null;
  /** The canonical URL for this job listing */
  source_url: string;
}

export interface NormalizedSalaryPage {
  /** Specialty slug from URL */
  specialty: string;
  /** State slug from URL */
  state: string;
  /** City slug (if present) */
  city: string | null;
  /** Average weekly rate in cents */
  avg_weekly_rate_cents: number | null;
  /** Min weekly rate in cents */
  min_weekly_rate_cents: number | null;
  /** Max weekly rate in cents */
  max_weekly_rate_cents: number | null;
  /** Raw rate text */
  avg_weekly_rate_raw: string | null;
  /** Number of active jobs referenced */
  active_job_count: number | null;
  /** Source URL */
  source_url: string;
}

export interface ATOMEntry {
  /** Candidate name (if present in ATOM entry) */
  candidate_name: string | null;
  /** email */
  email: string | null;
  /** phone */
  phone: string | null;
  /** Job ID that triggered the interest click */
  job_id: string | null;
  /** Timestamp of the click/interest event */
  clicked_at: string | null;
  /** Additional fields extracted from ATOM content */
  raw_fields: Record<string, string>;
}

// ── Rate Parsing ─────────────────────────────────────────────────

/**
 * Parses a rate string like "$2,400.00/wk" or "$1,850/wk" into cents.
 * Returns null if the string doesn't match a recognizable rate pattern.
 */
export function parseWeeklyRateCents(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Match patterns: $1,234.56/wk, $1234/wk, $1,234/week, $2400.00
  const match = raw.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const numericStr = match[1].replace(/,/g, "");
  const dollars = parseFloat(numericStr);
  if (isNaN(dollars) || dollars <= 0 || dollars > 50000) return null;
  return Math.round(dollars * 100);
}

// ── Location Parsing ─────────────────────────────────────────────

/**
 * Splits a hyphenated location slug into city and state.
 * E.g., "asheville-nc" → { city: "asheville", state: "NC" }
 *        "san-luis-obispo-ca" → { city: "san-luis-obispo", state: "CA" }
 */
export function parseLocationSlug(slug: string): { city: string; state: string } {
  const parts = slug.toLowerCase().trim().split("-");
  if (parts.length < 2) return { city: slug, state: "" };
  
  const statePart = parts[parts.length - 1];
  const cityParts = parts.slice(0, -1);
  
  // Validate the state portion is a 2-letter code
  if (statePart.length === 2 && /^[a-z]{2}$/.test(statePart)) {
    return {
      city: cityParts.join("-"),
      state: statePart.toUpperCase(),
    };
  }
  
  // If last part isn't a state code, return as-is
  return { city: slug, state: "" };
}

/**
 * Normalizes a US state name/abbreviation to a 2-letter code.
 */
const STATE_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM",
  "new-york": "NY", "north-carolina": "NC", "north-dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode-island": "RI", "south-carolina": "SC", "south-dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west-virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district-of-columbia": "DC",
  guam: "GU", "virgin-islands": "VI",
};

export function normalizeState(input: string): string {
  const lower = input.toLowerCase().trim();
  if (lower.length === 2 && /^[a-z]{2}$/.test(lower)) return lower.toUpperCase();
  return STATE_MAP[lower] || lower.toUpperCase();
}

// ── Medical Solutions URL Parser ─────────────────────────────────

/**
 * Parses a Medical Solutions job URL into a NormalizedJob.
 * URL format: /jobs/?jobReferenceId=X&jobtype=Y&jobtitle=Z&specialty=W&location=V&shift=U
 */
export function parseMedSolJobUrl(url: string, lastmod: string | null): NormalizedJob | null {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    
    const jobRefId = params.get("jobReferenceId");
    const jobType = params.get("jobtype");
    const jobTitle = params.get("jobtitle");
    const specialty = params.get("specialty");
    const location = params.get("location");
    const shift = params.get("shift");
    
    if (!jobRefId || !location) return null;
    
    const { city, state } = parseLocationSlug(location);
    
    return {
      source_job_id: jobRefId,
      source_company: "medical_solutions",
      job_type: jobType || "unknown",
      job_title: jobTitle || "unknown",
      specialty: specialty || "unknown",
      city,
      state,
      shift: shift || "unknown",
      weekly_rate_cents: null, // MedSol doesn't expose rates in URLs
      weekly_rate_raw: null,
      source_last_modified: lastmod,
      source_url: url,
    };
  } catch {
    return null;
  }
}

// ── Aya Job URL Parser ───────────────────────────────────────────

/**
 * Parses an Aya Healthcare job URL.
 * URL format: /travel-nursing/job/3277638
 * Rate is typically in the page title, not the URL.
 */
export function parseAyaJobUrl(url: string, lastmod: string | null): NormalizedJob | null {
  try {
    const match = url.match(/(?:\-job|\/job)\/(\d{7})/i);
    if (!match) return null;
    
    return {
      source_job_id: match[1],
      source_company: "aya",
      job_type: "travel",
      job_title: "unknown", // Requires page fetch to determine
      specialty: "unknown",
      city: "unknown",
      state: "",
      shift: "unknown",
      weekly_rate_cents: null, // Requires page fetch
      weekly_rate_raw: null,
      source_last_modified: lastmod,
      source_url: url,
    };
  } catch {
    return null;
  }
}

// ── Aya Salary Page Parser ───────────────────────────────────────

/**
 * Parses an Aya salary page URL.
 * URL format: /travel-nursing/salary/registered-nurse/california
 *             /travel-nursing/salary/icu-nurse/texas/houston
 */
export function parseAyaSalaryUrl(url: string): { specialty: string; state: string; city: string | null } | null {
  const match = url.match(/\/salary\/([^/]+)\/([^/]+)(?:\/([^/?]+))?/);
  if (!match) return null;
  
  return {
    specialty: match[1],
    state: normalizeState(match[2]),
    city: match[3] || null,
  };
}

// ── ATOM XML Parser ──────────────────────────────────────────────

/**
 * Extracts <entry> elements from an ATOM/XML response.
 * Uses regex-based extraction since we're running serverless
 * without a heavy DOM parser dependency.
 */
export function parseATOMEntries(xmlText: string): ATOMEntry[] {
  const entries: ATOMEntry[] = [];
  
  // Match each <entry>...</entry> block
  const entryBlocks = xmlText.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi);
  if (!entryBlocks) return entries;
  
  for (const block of entryBlocks) {
    const rawFields: Record<string, string> = {};
    
    // Extract all <d:PropertyName>value</d:PropertyName> patterns (OData format)
    const propMatches = block.matchAll(/<d:(\w+)[^>]*>([^<]*)<\/d:\w+>/gi);
    for (const pm of propMatches) {
      rawFields[pm[1]] = pm[2].trim();
    }
    
    // Also extract <content><m:properties>...</m:properties></content> nested properties
    const mPropMatches = block.matchAll(/<m:(\w+)[^>]*>([^<]*)<\/m:\w+>/gi);
    for (const pm of mPropMatches) {
      if (!rawFields[pm[1]]) {
        rawFields[pm[1]] = pm[2].trim();
      }
    }
    
    // Map common SSRS field names to our structure
    const entry: ATOMEntry = {
      candidate_name:
        rawFields["CandidateName"] ||
        rawFields["Candidate_Name"] ||
        rawFields["candidate_name"] ||
        null,
      email:
        rawFields["Email"] ||
        rawFields["email"] ||
        rawFields["CandidateEmail"] ||
        null,
      phone:
        rawFields["Phone"] ||
        rawFields["phone"] ||
        rawFields["CandidatePhone"] ||
        null,
      job_id:
        rawFields["JobID"] ||
        rawFields["Job_ID"] ||
        rawFields["job_id"] ||
        rawFields["JobId"] ||
        null,
      clicked_at:
        rawFields["ClickDate"] ||
        rawFields["Click_Date"] ||
        rawFields["clicked_at"] ||
        rawFields["InterestDate"] ||
        null,
      raw_fields: rawFields,
    };
    
    entries.push(entry);
  }
  
  return entries;
}

// ── Sitemap XML Parser ───────────────────────────────────────────

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

/**
 * Extracts <url> entries from a sitemap XML string.
 * Handles both sitemapindex (returns sub-sitemap URLs) and urlset (returns page URLs).
 */
export function parseSitemapXml(xmlText: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  
  // Match each <url>...<loc>...</loc>...</url> block
  const urlBlocks = xmlText.match(/<url>[\s\S]*?<\/url>/gi);
  if (!urlBlocks) {
    // Check if this is a sitemapindex with <sitemap> blocks
    const sitemapBlocks = xmlText.match(/<sitemap>[\s\S]*?<\/sitemap>/gi);
    if (sitemapBlocks) {
      for (const block of sitemapBlocks) {
        const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
        const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
        if (locMatch) {
          entries.push({
            loc: locMatch[1].trim(),
            lastmod: modMatch ? modMatch[1].trim() : null,
          });
        }
      }
    }
    return entries;
  }
  
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/i);
    const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
    if (locMatch) {
      entries.push({
        loc: decodeXmlEntities(locMatch[1].trim()),
        lastmod: modMatch ? modMatch[1].trim() : null,
      });
    }
  }
  
  return entries;
}

/**
 * Decodes XML entities in URLs (e.g., &amp; → &)
 */
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Title Parser (for Aya job pages) ─────────────────────────────

/**
 * Parses an Aya job page <title> tag to extract rate, specialty, and location.
 * Example title: "Travel Nurse RN - ICU - $2,400/wk - Asheville, NC | Aya Healthcare"
 */
export function parseAyaJobTitle(title: string): {
  specialty: string | null;
  weekly_rate_cents: number | null;
  weekly_rate_raw: string | null;
  city: string | null;
  state: string | null;
} {
  const result = {
    specialty: null as string | null,
    weekly_rate_cents: null as number | null,
    weekly_rate_raw: null as string | null,
    city: null as string | null,
    state: null as string | null,
  };
  
  // Extract rate
  const rateMatch = title.match(/(\$[\d,]+(?:\.\d{2})?\/wk)/);
  if (rateMatch) {
    result.weekly_rate_raw = rateMatch[1];
    result.weekly_rate_cents = parseWeeklyRateCents(rateMatch[1]);
  }
  
  // Extract location: "City, ST" pattern
  const locationMatch = title.match(/([A-Z][a-zA-Z\s.-]+),\s*([A-Z]{2})/);
  if (locationMatch) {
    result.city = locationMatch[1].trim().toLowerCase();
    result.state = locationMatch[2].toUpperCase();
  }
  
  // Extract specialty: text between "RN - " and " - $" or " |"
  const specMatch = title.match(/(?:RN|LPN|PT|OT|Tech)\s*-\s*([^$|]+?)(?:\s*-\s*\$|\s*\|)/i);
  if (specMatch) {
    result.specialty = specMatch[1].trim().toLowerCase();
  }
  
  return result;
}

// ── Polite Rate Limiter ──────────────────────────────────────────

/**
 * Delays execution for the specified number of milliseconds.
 * Use between fetch calls to be polite to external servers.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a batch of URLs with polite delays between requests.
 * Returns an array of { url, text, ok, status } results.
 */
export async function fetchBatch(
  urls: string[],
  options: {
    delayMs?: number;
    userAgent?: string;
    accept?: string;
    maxConcurrent?: number;
  } = {},
): Promise<Array<{ url: string; text: string; ok: boolean; status: number }>> {
  const {
    delayMs = 200,
    userAgent = "Mozilla/5.0 (compatible; TheLab/1.0)",
    accept = "text/html,application/xhtml+xml,application/xml",
  } = options;
  
  const results: Array<{ url: string; text: string; ok: boolean; status: number }> = [];
  
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": userAgent,
          Accept: accept,
        },
      });
      const text = await resp.text();
      results.push({ url, text, ok: resp.ok, status: resp.status });
    } catch {
      results.push({ url, text: "", ok: false, status: 0 });
    }
    
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }
  
  return results;
}
