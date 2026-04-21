// src/app/api/threads/ingest/route.ts
import { requireAuth } from '@/lib/middleware/auth';
import { getDb } from '@/lib/spanner-pool';
import { resolveCandidate, normalizePhone } from '@/lib/ingest/matcher';
import { IngestPayloadSchema } from '@/lib/ingest/schema';
import { Spanner } from '@google-cloud/spanner';

export async function POST(req: Request) {
  const { user, response } = await requireAuth(req);
  if (response) return response;

  const parseResult = IngestPayloadSchema.safeParse(await req.json());
  if (!parseResult.success) {
    return new Response(JSON.stringify({ error: parseResult.error }), { status: 400 });
  }
  
  const payload = parseResult.data;
  const db = getDb('recruitingdb');

  try {
    const resolvedThreads = await Promise.all(
      payload.threads.map(async (t) => ({
        thread: t,
        match: await resolveCandidate(t),
        normPhone: normalizePhone(t.candidate_phone)
      }))
    );

    const results: any[] = [];

    await db.runTransactionAsync(async (transaction: any) => {
      const threadIds = payload.threads.map(t => t.thread_id);
      const keySet = threadIds.map(id => [id]);

      const [existingRows] = await transaction.read('Threads', {
        keys: keySet,
        columns: ['thread_id']
      });
      const existingIds = new Set(existingRows.map((r: any) => r.toJSON().thread_id));

      const threadMutations = [];
      const auditMutations = [];

      for (const { thread, match, normPhone } of resolvedThreads) {
        const isNew = !existingIds.has(thread.thread_id);
        
        const threadRecord: any = {
          thread_id: thread.thread_id,
          thread_url: thread.thread_url || null,
          candidate_name_raw: thread.candidate_name || null,
          candidate_phone_raw: thread.candidate_phone || null,
          normalized_phone: normPhone,
          location: thread.location || null,
          facility_name: thread.facility_name || null,
          intent_tags_json: JSON.stringify(thread.intent_tags),
          recommended_next_step: thread.recommended_next_step || null,
          
          candidate_match_status: match.status,
          matched_candidate_id: match.id,
          matched_candidate_name: match.name,
          match_score: match.score,
          match_reason: match.reason,
          candidate_match_candidates_json: JSON.stringify(match.alternatives),
          
          last_seen_at: Spanner.COMMIT_TIMESTAMP
        };

        if (isNew) {
          threadRecord.first_seen_at = Spanner.COMMIT_TIMESTAMP;
        }

        threadMutations.push(threadRecord);

        auditMutations.push({
          match_event_id: crypto.randomUUID(),
          thread_id: thread.thread_id,
          candidate_id: match.id,
          match_status: match.status,
          match_score: match.score,
          match_reason: match.reason,
          created_by: 'SYSTEM',
          created_at: Spanner.COMMIT_TIMESTAMP
        });

        results.push({ thread_id: thread.thread_id, status: match.status, is_new: isNew });
      }

      transaction.insertOrUpdate('Threads', threadMutations);
      transaction.insert('ThreadCandidateMatchEvents', auditMutations);
    }); 

    return new Response(JSON.stringify({ ok: true, summary: { total: results.length }, threads: results }), { status: 200 });

  } catch (error) {
    console.error(JSON.stringify({ severity: 'ERROR', error }));
    return new Response('Ingestion failed', { status: 500 });
  }
}
