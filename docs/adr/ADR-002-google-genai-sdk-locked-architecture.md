# ADR-002: Google Gen AI SDK Locked Architecture

## VERDICT
Use `@google/genai` in Vertex AI mode for all Gemini and Vertex work.

## REQUIRED PACKAGE
`@google/genai`

## BANNED PACKAGES
- `@google-cloud/vertexai`
- `@google-cloud/aiplatform`
- `@google/generative-ai`

## INITIALIZATION
```ts
import { GoogleGenAI } from "@google/genai";
import { requireEnv } from "@/lib/env";

const ai = new GoogleGenAI({
  vertexai: true,
  project: requireEnv("GOOGLE_CLOUD_PROJECT"),
  location: requireEnv("GOOGLE_CLOUD_LOCATION"),
});
```

## ALLOWED CALL SHAPES
- `ai.models.generateContent(...)`
- `ai.models.generateContentStream(...)`
- `ai.chats.create({...})`
- `chatSession.sendMessage({ message })`
- `chatSession.sendMessageStream({ message })`
- `ai.models.countTokens(...)`

## BANNED CALL SHAPES
- `ai.getGenerativeModel(...)`
- `model.startChat(...)`

