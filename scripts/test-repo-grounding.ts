import { queryRepoKnowledge } from "@/lib/ai/repo-retrieval";

async function main(): Promise<void> {
  const prompt = "What package does the repo governance require for Gemini/Vertex work?";
  console.log(`[1] Prompt: "${prompt}"\n`);

  console.log("[2] Querying Vertex AI Search via Gemini...");
  const response = await queryRepoKnowledge(prompt);

  console.log("\n=== RESPONSE ===");
  console.log(response.text);
  console.log("================\n");

  console.log("[3] Verifying Acceptance Criteria...");
  console.log(`- Grounded: ${response.grounded}`);
  console.log(`- Citations: ${response.citations.length} found`);

  response.citations.forEach((citation, index) => {
    console.log(`  [${index}] Title: ${citation.title || "N/A"} | URI: ${citation.uri || "N/A"}`);
  });

  const mentionsGenAi = response.text.includes("@google/genai");
  const mentionsVertexAi = response.text.includes("@google-cloud/vertexai");

  console.log(`\n- Mentions @google/genai: ${mentionsGenAi}`);
  console.log(`- Mentions @google-cloud/vertexai: ${mentionsVertexAi}`);

  const passed =
    response.grounded === true &&
    response.citations.length > 0 &&
    mentionsGenAi &&
    !mentionsVertexAi;

  if (!passed) {
    console.error("\nACCEPTANCE FAILED: See criteria above.");
    process.exit(1);
  }

  console.log("\nACCEPTANCE PASSED: Answer is grounded, uses correct SDK, and provides citations.");
}

main().catch((error: unknown) => {
  console.error("\nFatal Error:", error);
  process.exit(1);
});
