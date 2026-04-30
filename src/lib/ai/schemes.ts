export const PatchSchema = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Internal logic for the fix" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "The full file content after patch" },
          explanation: { type: "string" }
        },
        required: ["path", "content"]
      }
    },
    verificationSteps: { type: "array", items: { type: "string" } }
  },
  required: ["reasoning", "files"]
};
