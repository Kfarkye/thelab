// src/lib/ingest/matcher.ts
import { getDb } from '@/lib/spanner-pool';

const INSTANCE_ID = 'workflowos-instance';

export function normalizePhone(phone: string | undefined | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}

export async function resolveCandidate(thread: any) {
  const db = getDb('recruitingdb');
  const normPhone = normalizePhone(thread.candidate_phone);
  const threadName = (thread.candidate_name || '').toLowerCase().trim();
  const threadNameParts = threadName.split(/\s+/);
  const threadFirst = threadNameParts[0] || '';
  const threadLast = threadNameParts.length > 1 ? threadNameParts[threadNameParts.length - 1] : threadFirst;
  const threadLocation = (thread.location || '').toLowerCase().trim();
  const threadFacility = (thread.facility_name || '').toLowerCase().trim();

  const [rows] = await db.run({
    sql: `
      SELECT 
        c.candidate_id, 
        c.full_name,
        c.location,
        c.facility_name,
        (c.normalized_phone = @phone) AS matched_primary_phone,
        EXISTS(
          SELECT 1 FROM CandidatePhoneAliases a 
          WHERE a.candidate_id = c.candidate_id AND a.normalized_phone = @phone
        ) AS matched_alias_phone
      FROM Candidates c
      WHERE c.normalized_phone = @phone 
         OR LOWER(c.full_name) LIKE @nameLike
         OR EXISTS(
           SELECT 1 FROM CandidatePhoneAliases a 
           WHERE a.candidate_id = c.candidate_id AND a.normalized_phone = @phone
         )
    `,
    params: { 
      phone: normPhone || '', 
      nameLike: threadLast ? `%${threadLast}%` : '' 
    },
  });

  const candidates = rows.map((r: any) => r.toJSON());
  
  const scored = candidates.map((c: any) => {
    let score = 0;
    const reasons = [];
    const dbName = (c.full_name || '').toLowerCase().trim();
    const dbNameParts = dbName.split(/\s+/);
    const dbFirst = dbNameParts[0] || '';
    const dbLast = dbNameParts.length > 1 ? dbNameParts[dbNameParts.length - 1] : dbFirst;

    if (c.matched_primary_phone || c.matched_alias_phone) { 
      score += 60; 
      reasons.push('Phone exact match'); 
    }
    
    if (threadName && dbName === threadName) { 
      score += 30; 
      reasons.push('Full name exact match'); 
    } else if (threadLast && dbLast === threadLast && threadFirst && dbFirst.startsWith(threadFirst.substring(0, 3))) {
      score += 20;
      reasons.push('Last exact + first prefix match');
    } else if (threadLast && dbLast === threadLast) {
      score += 10;
      reasons.push('Last name only match');
    }

    if (threadLocation && (c.location || '').toLowerCase().includes(threadLocation)) {
      score += 5;
      reasons.push('Location match');
    }

    if (threadFacility && (c.facility_name || '').toLowerCase().includes(threadFacility)) {
      score += 2;
      reasons.push('Facility context match');
    }

    return { 
      candidate_id: c.candidate_id, 
      full_name: c.full_name, 
      score, 
      reason: reasons.join(' + ') 
    };
  });

  scored.sort((a: any, b: any) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  const tiedTop = second && second.score === top?.score && second.score >= 70;

  if (scored.length === 0 || top.score < 70) {
    return {
      status: 'unmatched', id: null, name: null, score: top?.score || 0,
      reason: 'No matches above threshold', alternatives: scored.slice(0, 3)
    };
  }

  if (tiedTop) {
    return {
      status: 'ambiguous', id: null, name: null, score: top.score,
      reason: `Multiple candidates tied at top score (${top.score})`, 
      alternatives: scored.slice(0, 3)
    };
  }

  if (top.score >= 90) {
    return {
      status: 'matched', id: top.candidate_id, name: top.full_name, score: top.score,
      reason: top.reason, alternatives: []
    };
  }

  return {
    status: 'ambiguous', id: null, name: null, score: top.score,
    reason: `Highest match score ${top.score} requires review`, alternatives: scored.slice(0, 3)
  };
}
