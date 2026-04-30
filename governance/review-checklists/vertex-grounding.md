# Vertex Grounding Checklist

- Gemini calls use `@google/genai` in Vertex AI mode.
- SDK calls use `ai.models.*` or `ai.chats.*`.
- Config is passed in `config`.
- Tools are passed in `config.tools`.
- Public factual grounding uses `googleSearch`.
- Private enterprise grounding uses `retrieval.vertexAiSearch`.
- No deprecated Vertex SDK imports are introduced.
- No SDK type errors are suppressed.

