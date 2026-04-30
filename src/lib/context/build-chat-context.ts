import { buildContextScopeInstruction } from "@/lib/context/context-policy";

export type ActiveObject = {
  object_type?: string;
  object_id?: string;
  display_name?: string;
};

export type ChatContextInput = {
  globalPreferences?: string;
  rosterDigest?: string;
  selectedCandidateContext?: string;
  selectedMarginContext?: string;
  activeObject?: ActiveObject;
  localContext?: string;
};

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function buildChatWorkspaceContext(input: ChatContextInput): string {
  const blocks: string[] = [];

  blocks.push(`CONTEXT SCOPE RULE\n${buildContextScopeInstruction()}`);

  const globalPreferences = clean(input.globalPreferences);
  if (globalPreferences) {
    blocks.push(`GLOBAL PREFERENCES\n${globalPreferences}`);
  }

  if (input.activeObject?.object_id || input.activeObject?.display_name) {
    blocks.push(
      [
        "ACTIVE OBJECT",
        input.activeObject.object_type ? `Type: ${input.activeObject.object_type}` : "",
        input.activeObject.object_id ? `ID: ${input.activeObject.object_id}` : "",
        input.activeObject.display_name ? `Name: ${input.activeObject.display_name}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const rosterDigest = clean(input.rosterDigest);
  if (rosterDigest) {
    blocks.push(`ROSTER CONTEXT\n${rosterDigest}`);
  }

  const selectedCandidateContext = clean(input.selectedCandidateContext);
  if (selectedCandidateContext) {
    blocks.push(`SELECTED CANDIDATE CONTEXT\n${selectedCandidateContext}`);
  }

  const selectedMarginContext = clean(input.selectedMarginContext);
  if (selectedMarginContext) {
    blocks.push(`SELECTED PACKAGE CONTEXT\n${selectedMarginContext}`);
  }

  const localContext = clean(input.localContext);
  if (localContext) {
    blocks.push(`LOCAL CONTEXT\n${localContext}`);
  }

  return blocks.join("\n\n");
}

