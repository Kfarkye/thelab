import contextPolicy from "../../../governance/context-scope-policy.json";

export type ContextScopePolicy = typeof contextPolicy;

export function getContextScopePolicy(): ContextScopePolicy {
  return contextPolicy;
}

export function buildContextScopeInstruction(): string {
  return contextPolicy.model_instruction;
}

