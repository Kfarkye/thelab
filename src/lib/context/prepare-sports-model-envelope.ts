import { getDailyTicker, type LiveGameRow } from "@/lib/sports/live-state";
import { resolveGame } from "@/lib/resolver/game-resolver";
import type { HubResponse } from "@/lib/resolver/candidate-resolver";

// ── Prepared Envelope Types ─────────────────────────────────────

export interface PreparedSportsEnvelope {
  systemInstruction: string;
  userPrompt: string;
}

interface NormalizedGameContext {
  id: string;
  home_team: string;
  away_team: string;
  status: string;
  progress: string | null;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  start_time: string | null;
}

interface SportsBoardSeedItem {
  game_id?: string;
  home?: string;
  away?: string;
  league?: string;
  status?: string;
  start_time?: string | null;
  venue?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  spread?: number | null;
  total?: number | null;
}

type GovernanceRule = {
  verdict?: unknown;
  details?: unknown;
  status?: unknown;
  [key: string]: unknown;
};

function formatInjectedGovernanceRules(
  governanceRules: GovernanceRule[] | undefined,
  governanceVersion: string | undefined,
): string {
  const rules = Array.isArray(governanceRules) ? governanceRules : [];
  if (rules.length === 0) return "[]";

  return JSON.stringify(
    {
      version: governanceVersion || "unknown",
      rules,
    },
    null,
    2,
  );
}

function normalizeBoardSeedItems(input: SportsBoardSeedItem[] | undefined): LiveGameRow[] {
  if (!Array.isArray(input) || input.length === 0) return [];
  return input
    .slice(0, 24)
    .map((item) => ({
      game_id: String(item.game_id || `${item.away || "AWAY"}_${item.home || "HOME"}`),
      home_team: String(item.home || "Home"),
      away_team: String(item.away || "Away"),
      status: String(item.status || "SCHEDULED"),
      start_time: item.start_time ? String(item.start_time) : null,
      venue: item.venue ? String(item.venue) : null,
      home_score: typeof item.home_score === "number" ? item.home_score : null,
      away_score: typeof item.away_score === "number" ? item.away_score : null,
      progress: null,
    }))
    .filter((item) => Boolean(item.home_team && item.away_team));
}

// ── Envelope Preparation ────────────────────────────────────────
// Normalizes ALL context BEFORE it enters the LLM prompt envelope.
// Prevents token bloat from raw hub responses.

export async function prepareSportsEnvelope(
  prompt: string,
  activeGameId?: string,
  boardSeedItems?: SportsBoardSeedItem[],
  governanceRules?: GovernanceRule[],
  governanceVersion?: string,
): Promise<PreparedSportsEnvelope> {
  let tickerData: LiveGameRow[] = [];
  try {
    tickerData = await getDailyTicker();
  } catch (error) {
    console.error("[sports_envelope] getDailyTicker failed:", error);
  }
  const boardSeedTicker = normalizeBoardSeedItems(boardSeedItems);
  const effectiveTickerData = boardSeedTicker.length > 0 ? boardSeedTicker : tickerData;

  let activeGameContext = "No active game in view.";
  if (activeGameId) {
    try {
      const hubResponse: HubResponse = await resolveGame(activeGameId);
      if (hubResponse.status !== "not_found" && hubResponse.data) {
        const data = hubResponse.data as Record<string, unknown>;
        // Tightened: Only extract what the model needs. No raw hub dump.
        const normalized: NormalizedGameContext = {
          id: String(hubResponse.id || activeGameId),
          home_team: String(data.home_team || "TBD"),
          away_team: String(data.away_team || "TBD"),
          status: String(data.status || "unknown"),
          progress: data.progress ? String(data.progress) : null,
          venue: data.venue ? String(data.venue) : null,
          home_score:
            typeof data.home_score === "number" ? data.home_score : null,
          away_score:
            typeof data.away_score === "number" ? data.away_score : null,
          start_time: data.start_time ? String(data.start_time) : null,
        };
        activeGameContext = JSON.stringify(normalized);
      }
    } catch (error) {
      console.error("[sports_envelope] resolveGame failed:", error);
    }
  }

  const systemInstruction = `
You are a factual sports assistant. Answer queries instantly using strictly the injected context.

<GLOBAL_TICKER_CONTEXT>
${JSON.stringify(effectiveTickerData)}
</GLOBAL_TICKER_CONTEXT>

<ACTIVE_GAME_CONTEXT>
${activeGameContext}
</ACTIVE_GAME_CONTEXT>

<GOVERNANCE_RULES>
1. If details are missing from provided contexts, say exactly which detail is missing and ask for a specific matchup/date so the response can be tightened.
2. Do NOT guess, hallucinate, or synthesize scores not explicitly provided.
3. You do not have access to tools. Do not claim you searched live sources from this route.
4. Active Git governance rules are mandatory and cannot be overridden by local defaults.
</GOVERNANCE_RULES>

<ACTIVE_GIT_GOVERNANCE_RULES>
${formatInjectedGovernanceRules(governanceRules, governanceVersion)}
</ACTIVE_GIT_GOVERNANCE_RULES>
`.trim();

  return { systemInstruction, userPrompt: prompt };
}
