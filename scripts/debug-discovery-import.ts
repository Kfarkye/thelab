import { GoogleAuth } from "google-auth-library";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "1049576459547";
const LOCATION = "global";
const DATA_STORE = "repo-content-v1";

const SPANNER_INSTANCE = process.env.SPANNER_INSTANCE || "game-data";
const SPANNER_DB = "recruitingdb";
const SPANNER_TABLE = "RepoChunks";

async function checkDocumentsList(accessToken: string): Promise<void> {
  console.log("\nVerifying Documents in Datastore...");
  const listUrl = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/dataStores/${DATA_STORE}/branches/0/documents`;

  const res = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Goog-User-Project": PROJECT_ID,
    },
  });

  if (!res.ok) {
    console.error("Failed to list documents:", await res.text());
    return;
  }

  const data = await res.json() as { documents?: unknown[] };
  if (!data.documents || data.documents.length === 0) {
    console.log("Result: {} (No documents found).");
  } else {
    console.log(`Result: Found ${data.documents.length} document(s).`);
    console.log("\nSample Document mapping translated by Vertex Search:");
    console.log(JSON.stringify(data.documents, null, 2));
  }
}

async function main(): Promise<void> {
  let accessToken: string | null = null;
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    accessToken = token.token ?? null;
  } catch (error) {
    console.warn(
      "google-auth-library token failed, using gcloud fallback:",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!accessToken) {
    accessToken = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  }

  if (!accessToken) throw new Error("Failed to get access token");

  const baseUrl = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/dataStores/${DATA_STORE}/branches/0/documents:import`;

  console.log(`Starting Import from Spanner: ${SPANNER_INSTANCE}/${SPANNER_DB}/${SPANNER_TABLE}`);

  const requestBody = {
    spannerSource: {
      projectId: PROJECT_ID,
      instanceId: SPANNER_INSTANCE,
      databaseId: SPANNER_DB,
      tableId: SPANNER_TABLE,
    },
    idField: "id",
    reconciliationMode: "INCREMENTAL",
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Goog-User-Project": PROJECT_ID,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Import failed to start: ${response.status} ${await response.text()}`);
  }

  const operation = await response.json() as { name: string };

  console.log("Import request body:", JSON.stringify(requestBody, null, 2));
  console.log("Operation response:", JSON.stringify(operation, null, 2));

  console.log(`Operation Created: ${operation.name}`);
  console.log("Polling LRO status (this takes a few minutes)...");

  let isDone = false;
  while (!isDone) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const opRes = await fetch(`https://discoveryengine.googleapis.com/v1/${operation.name}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Goog-User-Project": PROJECT_ID,
      },
    });

    if (!opRes.ok) {
      console.error("\nLRO Poll Failed:", await opRes.text());
      continue;
    }

    const opData = await opRes.json() as {
      done?: boolean;
      error?: unknown;
      metadata?: {
        successCount?: number;
        failureCount?: number;
        errorSamples?: unknown[];
      };
    };
    isDone = Boolean(opData.done);

    if (isDone) {
      console.log("\n\n=== IMPORT COMPLETE ===");

      if (opData.error) {
        console.error("Fatal Import Error:", JSON.stringify(opData.error, null, 2));
      } else {
        console.log("Import API Success.");
      }

      const metadata = opData.metadata || {};
      console.log(`\nMetrics:\n- Success Count: ${metadata.successCount || 0}\n- Failure Count: ${metadata.failureCount || 0}`);

      if (metadata.errorSamples && metadata.errorSamples.length > 0) {
        console.warn("\nRow-Level Errors (Schema Rejections):");
        console.warn(JSON.stringify(metadata.errorSamples, null, 2));
      }

      await checkDocumentsList(accessToken);
    } else {
      process.stdout.write(".");
    }
  }
}

main().catch((err: unknown) => {
  console.error("\nFatal script error:", err);
  process.exit(1);
});
