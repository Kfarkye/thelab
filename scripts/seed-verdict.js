// Seed the first verdict into the ledger
const { Spanner } = require("@google-cloud/spanner");
const { randomUUID } = require("node:crypto");

const spanner = new Spanner({ projectId: "workflowos-a0fbf" });
const db = spanner.instance("game-data").database("recruitingdb");

async function seed() {
  const verdictId = randomUUID();
  
  await db.runTransactionAsync(async (tx) => {
    tx.insert("verdicts", {
      verdict_id: verdictId,
      agent_source: "antigravity",
      category: "architecture",
      status: "accepted",
      title: "URL Hub: Universal Resource Resolver Architecture",
      body: `## Decision\nThe Lab operates as a Headless Operating System. The AI navigates a RESTful Knowledge Graph via one tool (access_hub). It does NOT query databases directly.\n\n## Rationale\n- URLs are Gemini's native coordinate system\n- Five consumers of every Hub URL: LLM, Browser Agent, Human, Public, Other Bots\n- One tool for discovery (access_hub), typed tools for execution\n- Browser agent navigates Nova via canonical URLs returned by the Hub\n\n## Implementation\n- src/lib/resolver/index.ts — Core resolve router\n- src/lib/resolver/candidate-resolver.ts — Spanner fuzzy match\n- src/lib/resolver/template-resolver.ts — Template catalog search\n- src/app/api/hub/route.ts — POST endpoint backing access_hub\n- access_hub tool declaration wired into chat route.ts`,
      risk_zones: ["ID", "SHAPE", "INFRA"],
      files_touched: [
        "src/lib/resolver/index.ts",
        "src/lib/resolver/candidate-resolver.ts",
        "src/lib/resolver/template-resolver.ts",
        "src/lib/resolver/links.ts",
        "src/app/api/hub/route.ts",
        "src/app/api/chat/route.ts",
        "AGENTS.md",
        "HANDOFF.md",
      ],
      refs: [],
      superseded_by: null,
      created_at: Spanner.COMMIT_TIMESTAMP,
      updated_at: Spanner.COMMIT_TIMESTAMP,
    });
    await tx.commit();
  });

  console.log(`✅ Verdict seeded: ${verdictId}`);
  
  // Verify
  const [rows] = await db.run({
    sql: `SELECT verdict_id, title, agent_source, status FROM verdicts ORDER BY created_at DESC LIMIT 5`,
  });
  
  for (const row of rows) {
    const j = row.toJSON();
    console.log(`  ${j.agent_source} | ${j.status} | ${j.title}`);
  }
  
  await db.close();
  spanner.close();
}

seed().catch(console.error);
