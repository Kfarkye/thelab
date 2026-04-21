import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const BASE_URL =
  process.env.THELAB_BASE_URL ||
  "https://gemini3-chat-1049576459547.us-central1.run.app";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const execFileAsync = promisify(execFile);

const createdNoteIds = [];
const createdDraftIds = [];

async function getSeedCandidate() {
  const sql = `SELECT c.id, CAST(c.nova_id AS STRING) AS nova_id, a.status
               FROM hc_candidates c
               JOIN hc_assignments a ON a.candidate_id = c.id
               WHERE c.nova_id IS NOT NULL AND a.status IS NOT NULL
               LIMIT 1`;
  const rows = await runSqlJson(sql);
  assert.ok(rows.length > 0, "No seed candidate with assignment + nova_id found");
  const row = rows[0];
  return {
    id: String(row.id),
    novaId: String(row.nova_id),
    status: String(row.status || "active"),
  };
}

async function runSqlJson(sql) {
  const { stdout } = await execFileAsync("gcloud", [
    "spanner",
    "databases",
    "execute-sql",
    "recruitingdb",
    "--instance=game-data",
    `--project=${PROJECT_ID}`,
    `--sql=${sql}`,
    "--format=json",
  ]);
  const parsed = JSON.parse(stdout || "{}");
  if (Array.isArray(parsed)) return parsed;
  const fields = parsed?.metadata?.rowType?.fields || [];
  const rows = parsed?.rows || [];
  if (!Array.isArray(fields) || !Array.isArray(rows)) return [];
  return rows.map((row) => {
    const record = {};
    for (let i = 0; i < fields.length; i += 1) {
      const fieldName = fields[i]?.name;
      if (!fieldName) continue;
      record[fieldName] = Array.isArray(row) ? row[i] : undefined;
    }
    return record;
  });
}

async function runSql(sql) {
  await execFileAsync("gcloud", [
    "spanner",
    "databases",
    "execute-sql",
    "recruitingdb",
    "--instance=game-data",
    `--project=${PROJECT_ID}`,
    `--sql=${sql}`,
  ]);
}

async function deleteIds(table, keyColumn, ids) {
  if (!ids.length) return;
  const literal = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(", ");
  await runSql(`DELETE FROM ${table} WHERE ${keyColumn} IN (${literal})`);
}

async function callAyaops(prompt) {
  const signal = AbortSignal.timeout(90000);
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      prompt,
      history: [],
      mode: "ayaops",
      modelOverride: "pro",
    }),
  });
  assert.equal(res.ok, true, `HTTP ${res.status} from /api/chat`);
  assert.ok(res.body, "No response body from /api/chat");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === "write_result") return event;
      } catch {
        // ignore malformed chunks in smoke parser
      }
    }
  }

  throw new Error(`No write_result event in stream. Prompt: ${prompt}`);
}

test.after(async () => {
  await deleteIds("activities", "activity_id", createdDraftIds);
  await deleteIds("hc_notes", "id", createdNoteIds);
});

test("add_candidate_note accepts UUID and nova_id", async () => {
  const seed = await getSeedCandidate();
  const contentUuid = `[id-smoke] add note by UUID ${Date.now()}`;
  const contentNova = `[id-smoke] add note by NOVA ${Date.now()}`;

  const byUuid = await callAyaops(
    `Call add_candidate_note with candidate_id "${seed.id}", note_type "general", content "${contentUuid}".`
  );
  assert.equal(byUuid.outcome, "inserted");
  assert.equal(byUuid.code, null);
  assert.equal(byUuid.payload.candidate_id, seed.id);
  assert.equal(String(byUuid.payload.nova_id), seed.novaId);
  assert.ok(byUuid.payload.note?.id);
  createdNoteIds.push(String(byUuid.payload.note.id));

  const byNova = await callAyaops(
    `Call add_candidate_note with candidate_id "${seed.novaId}", note_type "general", content "${contentNova}".`
  );
  assert.equal(byNova.outcome, "inserted");
  assert.equal(byNova.code, null);
  assert.equal(byNova.payload.candidate_id, seed.id);
  assert.equal(String(byNova.payload.nova_id), seed.novaId);
  assert.ok(byNova.payload.note?.id);
  createdNoteIds.push(String(byNova.payload.note.id));
});

test("update_candidate_status accepts UUID and nova_id", async () => {
  const seed = await getSeedCandidate();

  const byUuid = await callAyaops(
    `Call update_candidate_status with candidate_id "${seed.id}" and new_status "${seed.status}".`
  );
  assert.equal(byUuid.code, null);
  assert.equal(byUuid.payload.candidate_id, seed.id);
  assert.equal(String(byUuid.payload.nova_id), seed.novaId);
  assert.equal(byUuid.payload.outcome, "no_change");

  const byNova = await callAyaops(
    `Call update_candidate_status with candidate_id "${seed.novaId}" and new_status "${seed.status}".`
  );
  assert.equal(byNova.code, null);
  assert.equal(byNova.payload.candidate_id, seed.id);
  assert.equal(String(byNova.payload.nova_id), seed.novaId);
  assert.equal(byNova.payload.outcome, "no_change");
});

test("create_com_draft_email accepts UUID and nova_id", async () => {
  const seed = await getSeedCandidate();
  const subjectUuid = `[id-smoke] UUID draft ${Date.now()}`;
  const subjectNova = `[id-smoke] NOVA draft ${Date.now()}`;

  const byUuid = await callAyaops(
    `Call create_com_draft_email with candidate_id "${seed.id}", subject "${subjectUuid}", body "Identity smoke test draft body", to_email "identity-smoke@ayaops.local", save_note_trace false.`
  );
  assert.equal(byUuid.code, null);
  assert.equal(byUuid.payload.candidate_id, seed.id);
  assert.equal(String(byUuid.payload.nova_id), seed.novaId);
  assert.ok(byUuid.payload.draft_id);
  createdDraftIds.push(String(byUuid.payload.draft_id));

  const byNova = await callAyaops(
    `Call create_com_draft_email with candidate_id "${seed.novaId}", subject "${subjectNova}", body "Identity smoke test draft body", to_email "identity-smoke@ayaops.local", save_note_trace false.`
  );
  assert.equal(byNova.code, null);
  assert.equal(byNova.payload.candidate_id, seed.id);
  assert.equal(String(byNova.payload.nova_id), seed.novaId);
  assert.ok(byNova.payload.draft_id);
  createdDraftIds.push(String(byNova.payload.draft_id));
});

test("missing candidate returns CANDIDATE_NOT_FOUND", async () => {
  const impossibleId = `999999999${Date.now()}`;
  const result = await callAyaops(
    `Call add_candidate_note with candidate_id "${impossibleId}" and content "missing-candidate smoke".`
  );
  assert.equal(result.outcome, "failed");
  assert.equal(result.code, "CANDIDATE_NOT_FOUND");
});
