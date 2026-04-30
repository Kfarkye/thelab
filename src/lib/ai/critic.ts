import { createVertexGenAI, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "@/lib/ai/gemini-config";

const ai = createVertexGenAI();

export const verifyAgainstLedger = async (patch: any, ledgerContext: string): Promise<boolean> => {
  const prompt = `
    Check this code patch against the Ledger Rules.
    Rules: ${ledgerContext}
    Patch: ${JSON.stringify(patch)}
    
    Does this patch violate any rules (e.g., using 'any', wrong Spanner property, generic CSS)?
    Respond with EXACTLY 'PASSED' or 'FAILED: [reason]'.
  `;

  const result = await ai.models.generateContent({
    model: GEMINI_PRO_MODEL,
    contents: prompt,
    config: {
      thinkingConfig: GEMINI_THINKING_HIGH,
      temperature: 0.2,
    },
  });
  const response = result.text || "";

  return response.trim().startsWith("PASSED");
};
