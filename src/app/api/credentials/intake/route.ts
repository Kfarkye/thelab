import { NextRequest } from "next/server";
import { getEvidenceInlineData, markSavedImageUsed } from "@/lib/evidence/store";

export const runtime = "nodejs";

const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "workflowos-a0fbf";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "us-central1";

interface TokenResponse {
  access_token: string;
}

async function getVertexToken(): Promise<string> {
  const url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
  try {
    const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" }, next: { revalidate: 300 } });
    if (!res.ok) throw new Error("Metadata token fetch failed");
    const data = (await res.json()) as TokenResponse;
    return data.access_token;
  } catch (err) {
    if (process.env.DEBUG_FALLBACK_TOKEN) {
      return process.env.DEBUG_FALLBACK_TOKEN;
    }
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageId = body.imageId;
    if (!imageId) return Response.json({ error: "imageId is required" }, { status: 400 });

    const evidence = await getEvidenceInlineData(imageId);

    // Prompt Gemini Vision to OCR and extract credential
    const prompt = `Analyze this healthcare credential (e.g. BLS, ACLS, RN License). Extract:
1. type (BLS, ACLS, State License, etc)
2. provider_name (the person's name)
3. credential_number (if applicable)
4. state (if a state license)
5. issue_date (YYYY-MM-DD if available)
6. expiration_date (YYYY-MM-DD)
7. valid (true/false)

Return EXACTLY a JSON block enclosed in \`\`\`json ... \`\`\`.`;

    const token = await getVertexToken();
    const endpoint = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/gemini-1.5-pro:generateContent`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: evidence.mimeType,
                data: evidence.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
      },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Vertex API returned ${res.status}: ${errText}`);
    }

    const aiData = await res.json();
    const rawText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
    let extracted = {};
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[1]);
      } catch (e) {
        // Parse error
      }
    } else {
      // Try parsing the raw text directly
      try {
        extracted = JSON.parse(rawText);
      } catch (e) {}
    }

    await markSavedImageUsed(imageId);

    return Response.json({ status: "ok", imageId, extracted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error processing credential";
    console.error("Credential Processing Error:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
