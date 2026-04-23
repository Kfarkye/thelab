export interface Citation { title: string; uri: string; }
export interface CodeBlock {
  code: string;
  language: string;
  outcome?: string;
  output?: string;
}

export type WriteOutcome = "updated" | "inserted" | "no_change" | "failed";

export interface WriteResultMeta {
  outcome: WriteOutcome;
  action?: string;
  objectType?: string;
  rowsUpdated?: number | null;
  code?: string | null;
  payload?: Record<string, unknown>;
}

export interface ToolStatus {
  tool: string;
  status: "running" | "ok" | "failed";
  label: string;
  latencyMs?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  workspaceScope?: string | null;
  citations?: Citation[];
  queries?: string[];
  codeBlocks?: CodeBlock[];
  timestamp: Date;
  isStreaming?: boolean;
  durationMs?: number;
  imageUrl?: string;
  modelProvider?: string;
  modelId?: string;
  writeResult?: WriteResultMeta;
  toolStatuses?: ToolStatus[];
}

export interface SavedImage {
  imageId: string;
  candidateId: string | null;
  candidateName: string | null;
  sourceType: string;
  screenType: string | null;
  mode: string | null;
  createdAt: string;
  isPinned: boolean;
  tags: string[];
  previewUrl: string;
}

export interface SelectedCandidateContextPayload {
  candidate_id: string | null;
  nova_id: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  current_bucket: string | null;
  source: "left_rail_selected" | "left_rail_inferred";
}

export interface SelectedMarginContextPayload {
  candidate_name: string | null;
  profession: string | null;
  specialty: string | null;
  facility_name: string | null;
  facility_city: string | null;
  facility_state: string | null;
  assignment_start: string | null;
  assignment_end: string | null;
  weekly_gross: number | null;
  actual_margin_pct: number | null;
  target_margin_pct: number | null;
  base_pay_rate: number | null;
  weekly_stipends: number | null;
  weekly_hours: number | null;
  shift_type: string | null;
  shift_start: string | null;
  shift_end: string | null;
}

export interface BrowserStep {
  stepIndex: number;
  action: "navigate" | "click" | "type" | "select" | "wait" | "screenshot" | "assert" | "scroll";
  target?: string;
  value?: string;
  description: string;
  waitMs?: number;
  status?: "pending" | "running" | "pass" | "fail" | "skipped";
  durationMs?: number;
}

export interface VisualAssertion {
  assertionId: string;
  type: "element_exists" | "element_absent" | "text_contains" | "text_absent" | "css_property" | "no_emoji" | "class_present";
  selector?: string;
  property?: string;
  expected?: string;
  description: string;
  status?: "pending" | "pass" | "fail";
  actual?: string;
}

export interface BrowserTask {
  taskId: string;
  title: string;
  description: string;
  status: "draft" | "approved" | "running" | "complete" | "failed";
  targetUrl: string;
  steps: BrowserStep[];
  assertions: VisualAssertion[];
  returnCondition: string;
  sourcePrompt?: string;
  createdAt: string;
  durationMs?: number;
}

export type ConsoleMode =
  | "healthcare"
  | "sports"
  | "code"
  | "worldcup"
  | "ayaops"
  | "facility"
  | "margins"
  | "agent"
  | "clicks";

export type ModelOverride = "auto" | "sonnet" | "opus" | "flash" | "pro";

export interface ModeConfig {
  id: ConsoleMode;
  label: string;
  suggestions: string[];
  placeholder: string;
}

export type ImageIntent = "add_candidate" | "margin_approval" | "analyze" | null;

export interface ChatState {
  messages: Message[];
  input: string;
  loading: boolean;
  copiedId: string | null;
  pendingImage: string | null;
  imageIntent: ImageIntent;
  mode: ConsoleMode;
  selectedCandidate: { id: string; name: string; candidate: Record<string, unknown>; contextText: string } | null;
}

export type ChatAction =
  | { type: "SET_INPUT"; payload: string }
  | { type: "SET_PENDING_IMAGE"; payload: string | null }
  | { type: "SET_IMAGE_INTENT"; payload: ImageIntent }
  | { type: "ADD_USER_MESSAGE"; payload: { text: string; id: string; imageUrl?: string; workspaceScope?: string | null } }
  | { type: "ADD_ASSISTANT_MESSAGE"; payload: { text: string; id: string; workspaceScope?: string | null } }
  | { type: "START_ASSISTANT_STREAM"; payload: { id: string; workspaceScope?: string | null } }
  | { type: "APPEND_ASSISTANT_CHUNK"; payload: { id: string; textChunk: string } }
  | { type: "SET_ASSISTANT_WRITE_RESULT"; payload: { id: string; writeResult: WriteResultMeta } }
  | { type: "SET_ASSISTANT_GROUNDING"; payload: { id: string; citations: Citation[]; queries: string[] } }
  | { type: "FINISH_ASSISTANT_STREAM"; payload: { id: string; durationMs: number; modelProvider?: string; modelId?: string } }
  | { type: "ERROR_ASSISTANT_STREAM"; payload: { id: string; error: string; code?: string } }
  | { type: "ADD_CODE_BLOCK"; payload: { id: string; code: string; language: string } }
  | { type: "SET_CODE_RESULT"; payload: { id: string; outcome: string; output: string } }
  | { type: "SET_COPIED"; payload: string | null }
  | { type: "CLEAR_CHAT" }
  | { type: "SET_MODE"; payload: ConsoleMode }
  | { type: "SET_SELECTED_CANDIDATE"; payload: ChatState["selectedCandidate"] }
  | { type: "UPSERT_TOOL_STATUS"; payload: { id: string; status: ToolStatus } }
  | { type: "HYDRATE"; payload: Message[] };

// --- Summary types ---
export interface PanelItem {
  id: string;
  label: string;
  candidateName?: string | null;
  candidateId?: string | null;
  candidateEmail?: string | null;
  description?: string;
  state?: string;
  profession?: string;
  fee?: number;
  renewalFee?: number;
  board?: string;
  compact?: boolean;
  home?: string;
  away?: string;
  homeLogo?: string;
  awayLogo?: string;
  date?: string;
  startTime?: string;
  status?: string;
  venue?: string;
  league?: string;
  homeRecord?: string | null;
  awayRecord?: string | null;
  spread?: number | null;
  total?: number | null;
  // World Cup fields
  homeName?: string;
  awayName?: string;
  homeFlag?: string;
  awayFlag?: string;
  groupLetter?: string;
  kickoff?: string;
  stage?: string;
  writeupUrl?: string | null;
  publishedAt?: string | null;
  city?: string | null;
  // AyaOps fields
  novaId?: string | null;
  novaUrl?: string | null;
  specialty?: string;
  homeState?: string;
  rcThreadUrl?: string | null;
  outlookThreadUrl?: string | null;
  complianceRisk?: string | null;
  source?: string;
  assignmentStatus?: string | null;
  derivedCurrentStatus?: string | null;
  assignmentStart?: string | null;
  assignmentEnd?: string | null;
  weeklyGross?: number | null;
  hourlyRate?: number | null;
  facilityName?: string | null;
  facilityCity?: string | null;
  facilityState?: string | null;
  vmsPlatform?: string | null;
  facilityBeds?: number | null;
  phone?: string | null;
  facilityId?: string | null;
  facilitySystemName?: string | null;
  facilityProfileUrl?: string | null;
  facilityNovaUrl?: string | null;
  acceptsLocals?: boolean | null;
  requiresCompact?: boolean | null;
  submittalRules?: string | null;
  submissionDifficulty?: "easy" | "moderate" | "hard" | null;
  payVsLocalCol?: string | null;
  parkingCost?: string | null;
  cancelRatePct?: number | null;
  extensionRatePct?: number | null;
  closedAssignments?: number | null;
  touchPriorityScore?: number | null;
  touchPriorityLevel?: string | null;
  touchPriorityBand?: "today" | "this_week" | "monitor" | null;
  touchPriorityReason?: string | null;
  touchDaysToEnd?: number | null;
  touchNoteSeed?: string | null;
  lastTouchAt?: string | null;
  unansweredCount?: number | null;
  // Facility mode fields
  activeAssignments?: number | null;
  pendingStartAssignments?: number | null;
  pipelineAssignments?: number | null;
  totalAssignments?: number | null;
  // Margins mode fields
  marginObjectId?: string | null;
  marginId?: string | null;
  jobId?: string | null;
  targetMarginPct?: number | null;
  actualMarginPct?: number | null;
  basePayRate?: number | null;
  weeklyStipends?: number | null;
  grossWeeklyPayComputed?: number | null;
  shiftType?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  weeklyHours?: number | null;
  lastSeenAt?: string | null;
  isLocal?: boolean | null;
  isCompact?: boolean | null;
}

export interface SummaryData {
  pulse: Record<string, number>;
  items: PanelItem[];
  supportedLeagues?: { key: string; label: string }[];
  topProfessions?: { name: string; count: number }[];
}

export interface TodayCard {
  id: string;
  title: string;
  detail: string;
  prompt: string;
  actionLabel: string;
  tone?: "default" | "attention" | "positive";
}
