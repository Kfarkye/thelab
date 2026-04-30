// src/app/api/threads/ingest/route.ts
import { requireAuth } from '@/lib/middleware/auth';
import { getDb } from '@/lib/spanner-pool';
import { resolveCandidate, normalizePhone } from '@/lib/ingest/matcher';
import { IngestPayloadSchema } from '@/lib/ingest/schema';
import { Spanner } from '@google-cloud/spanner';

function jsonResponse(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export async function POST(req: Request): Promise<Response> {
  let actorId = 'UNAUTHENTICATED';
  let threadCount = 0;

  try {
    const { user, response } = await requireAuth(req);
    if (response) return response;
    actorId = user.uid;

    const body: unknown = await req.json();
    if (
      body &&
      typeof body === 'object' &&
      Array.isArray((body as { threads?: unknown }).threads)
    ) {
      threadCount = (body as { threads: unknown[] }).threads.length;
    }

    const parseResult = IngestPayloadSchema.safeParse(body);
    if (!parseResult.success) {
      return jsonResponse(
        {
          error: 'INVALID_INGEST_PAYLOAD',
          message: 'Invalid thread ingest payload.',
          issues: parseResult.error.issues,
        },
        400,
      );
    }

    const payload = parseResult.data;
    threadCount = payload.threads.length;
    const db = getDb('recruitingdb');

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

    return jsonResponse({ ok: true, summary: { total: results.length }, threads: results }, 200);

  } catch (error: unknown) {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message: errorStack(error) || errorMessage(error),
      '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
      route: '/api/threads/ingest',
      actor_id: actorId,
      thread_count: threadCount,
      timestamp: new Date().toISOString(),
    }));
    return jsonResponse(
      {
        error: 'INGEST_FAILED',
        message: 'Failed to process ingest request. The error has been logged.',
      },
      500,
    );
  }
}
