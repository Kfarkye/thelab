import type { ConsoleMode, ModeConfig } from "@/lib/types/chat";

export const MODES: Record<ConsoleMode, ModeConfig> = {
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    suggestions: [
      "What are the current BLS certification requirements?",
      "Which states are in the nursing compact?",
      "ACLS renewal — what CE hours do I need?",
    ],
    placeholder: "Ask a question...",
  },
  sports: {
    id: "sports",
    label: "Sports",
    suggestions: [
      "Who's injured for tonight's NBA games?",
      "Dallas Stars playoff schedule and odds",
      "Best MLB DFS value plays today",
    ],
    placeholder: "Ask a question...",
  },
  code: {
    id: "code",
    label: "Code",
    suggestions: [
      "Debug this error — what's the root cause and fix?",
      "Review this function for edge cases and performance",
      "How should I architect this feature?",
    ],
    placeholder: "Paste code, describe a bug, or ask anything...",
  },
  worldcup: {
    id: "worldcup",
    label: "World Cup",
    suggestions: [
      "What if Argentina draws Mexico 1-1?",
      "Show me Group D standings and path to knockout",
      "Which teams have the highest travel fatigue index?",
    ],
    placeholder: "Ask about the 2026 World Cup...",
  },
  ayaops: {
    id: "ayaops",
    label: "AyaOps",
    suggestions: [
      "Who's finishing up in the next 30 days?",
      "Where are we thin on coverage right now?",
      "Any travelers flagged for credential gaps?",
    ],
    placeholder: "Ask about your team...",
  },
  facility: {
    id: "facility",
    label: "Facility",
    suggestions: [
      "Which facilities submit without references?",
      "Which facilities give quick offers?",
      "Which facilities have the best pay-to-cost-of-living setup?",
      "Which facilities extend travelers most?",
      "Which facilities cancel most?",
    ],
    placeholder: "Ask about facilities...",
  },
  margins: {
    id: "margins",
    label: "Margins",
    suggestions: [
      "What's the read on this margin?",
      "Where's the risk in this package?",
      "What should I lock before submit?",
    ],
    placeholder: "What's the risk here?",
  },
  agent: {
    id: "agent",
    label: "Agent",
    suggestions: [
      "Review the AyaOps facility tab for visual regressions",
      "Verify the candidate card badges render as SVG icons",
      "Check if the tool status chips stack correctly on multi-tool calls",
    ],
    placeholder: "Describe what the browser agent should check...",
  },
  clicks: {
    id: "clicks",
    label: "Clicks",
    suggestions: [
      "Show me the latest interested clicks in Texas",
      "Are there any matched candidates today?",
      "Who clicked on ICU jobs in California?",
    ],
    placeholder: "Ask about interested clicks or demand trends...",
  },
};
