import { SummaryData, PanelItem, ConsoleMode, Message, WriteResultMeta, WriteOutcome, Citation } from "@/lib/types/chat";
export const CLEAN_COPY_MODES = new Set(["healthcare", "sports", "worldcup", "ayaops", "facility", "margins"]);

export function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripNumericCitationBrackets(value: string): string {
  return String(value || "").replace(/\s*\[(?:\d+\s*(?:,\s*\d+\s*)*)\]/g, "");
}

function semanticLinkLabel(url: string): string {
  const normalized = String(url || "").trim().toLowerCase();
  if (!normalized) return "Open link";
  if (normalized.includes("nova.ayahealthcare.com")) return "Open in Nova";
  if (normalized.includes("ringcentral")) return "Open in RingCentral";
  if (normalized.includes("outlook.")) return "Open in Outlook";
  if (normalized.includes("msappproxy")) return "Open secure report";
  return "Open link";
}

export function formatMarkdown(text: string): string {
  const escaped = escapeHtml(
    stripNumericCitationBrackets(String(text || "").replace(/\r\n?/g, "\n")),
  );
  const formatLabelValuePair = (
    _match: string,
    bulletRaw: string | undefined,
    labelRaw: string,
    valueRaw: string,
  ): string => {
    const bullet = String(bulletRaw || "");
    const label = String(labelRaw || "").trim();
    const value = String(valueRaw || "").trim();
    const labelKey = label.toLowerCase();
    if (!label) return _match;
    if (labelKey === "http:" || labelKey === "https:" || labelKey.includes("http:") || labelKey.includes("https:")) {
      return _match;
    }

    const labelNoColon = label.replace(/:\s*$/, "").trim();
    const sectionLabelLike = /^[IVXLC]+\.\s+[A-Z0-9/&()' .-]+$/i.test(labelNoColon);
    if (sectionLabelLike && value) {
      return `${bullet}<h4 class="c-md-section">${labelNoColon}: ${value}</h4>`;
    }

    if (!value) return `${bullet}<span class="c-md-label">${label}</span>`;

    const isAbsoluteUrl = /^https?:\/\/\S+$/i.test(value);
    if (isAbsoluteUrl) {
      const linkText = labelKey.includes("nova")
        ? "Open in Nova"
        : labelKey.includes("ringcentral")
          ? "Open in RingCentral"
          : labelKey.includes("outlook")
            ? "Open in Outlook"
            : "Open link";
      return `${bullet}<span class="c-md-label">${label}</span> <a class="c-md-link-value" href="${value}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    }

    const valuePlain = value.replace(/`/g, "").trim();
    const valueWords = valuePlain.split(/\s+/).filter(Boolean).length;
    const valueLen = valuePlain.length;
    const punctuationCount = (value.match(/[,;:]/g) || []).length;
    const isStatusValue = /^(out|doubtful|questionable|probable|active|inactive|full\s*time|final)$/i.test(
      valuePlain,
    );
    const isStatTriplet = /\b\d{1,3}\s*-\s*\d{1,3}\s*-\s*\d{1,3}\b/.test(valuePlain);
    const isActionableValue =
      /(?:^|[\s(])(?:[+-]\d+(?:\.\d+)?)(?=$|[\s)\]])/.test(valuePlain) ||
      /\b(?:moneyline|ml|puck\s*line|spread|total|over|under)\b/i.test(valuePlain) ||
      /\(\s*[+-]?\d+(?:\.\d+)?\s*\)/.test(valuePlain);

    const looksLongForm =
      valueLen > 72 ||
      valueWords > 10 ||
      punctuationCount > 1 ||
      /[.!?]\s+\S/.test(value);
    const shouldChip =
      !looksLongForm &&
      !isStatTriplet &&
      valueLen <= 44 &&
      valueWords <= 6 &&
      (isStatusValue || isActionableValue);

    const valueHtml = shouldChip
      ? `<strong class="c-md-value-chip ${isStatusValue ? "c-md-value-chip-status" : "c-md-value-chip-action"}">${valuePlain}</strong>`
      : looksLongForm
      ? `<span class="c-md-value-text">${value}</span>`
      : `<span class="c-md-value-text">${value}</span>`;
    return `${bullet}<span class="c-md-label">${label}</span> ${valueHtml}`;
  };

  let html = escaped
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      const trimmed = String(code || "").trim();
      if (trimmed && !trimmed.includes("\n") && trimmed.length <= 84) {
        return `<strong class="c-md-value-chip c-md-value-chip-action">${trimmed}</strong>`;
      }
      return `<pre class="c-code"><code>${code}</code></pre>`;
    })
    .replace(/^\s*([*-]\s+)?\*\*([A-Za-z0-9/&()' .-]{1,80}:)\*\*\s*$/gm, (_match, bulletRaw, labelRaw) => {
      const bullet = String(bulletRaw || "");
      const label = String(labelRaw || "").trim();
      return `${bullet}<span class="c-md-label">${label}</span>`;
    })
    .replace(
      /^([ \t]*(?:\*|-|\d+\.)\s+)\*\*([^*\n]{1,80}?:)\*\*\s*([^\n]+)/gm,
      formatLabelValuePair,
    )
    .replace(
      /^([ \t]*)\*\*([^*\n]{1,80}?:)\*\*\s*([^\n]+)/gm,
      formatLabelValuePair,
    )
    .replace(
      /^([ \t]*(?:\*|-|\d+\.)\s+)?([A-Za-z][A-Za-z0-9/&()' .-]{0,80}:)\s*([^\n]+)/gm,
      formatLabelValuePair,
    )
    .replace(/^>\s?(.*$)/gm, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
      const normalizedLabel = String(label || "").trim();
      const linkText = /^https?:\/\//i.test(normalizedLabel)
        ? semanticLinkLabel(url)
        : normalizedLabel || semanticLinkLabel(url);
      return `<a class="c-md-link-value" href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    })
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_match, prefix, url) => {
      return `${prefix}<a class="c-md-link-value" href="${url}" target="_blank" rel="noopener noreferrer">${semanticLinkLabel(url)}</a>`;
    })
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="c-inline-code">$1</code>')
    .replace(/^\s*####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*###\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*##\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*#\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*-{3,}\s*$/gm, '<hr class="c-md-rule" />')
    .replace(/^\s*\* (.*$)/gm, '<li>$1</li>')
    .replace(/^\s*- (.*$)/gm, '<li>$1</li>')
    .replace(/^\s*\d+\.\s(.*$)/gm, '<li>$1</li>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>");

  html = html
    .replace(/((<li>.*?<\/li>)(\s*<br\/>)?)+/g, (match) => `<ul>${match.replace(/<br\/>/g, "")}</ul>`)
    .replace(/\s*<hr class="c-md-rule" \/>\s*/g, "</p><hr class=\"c-md-rule\" /><p>")
    .replace(/<p>\s*(<(?:h3|h4|ul|pre|hr)[\s\S]*?<\/(?:h3|h4|ul|pre)>|<hr[^>]*>)\s*<\/p>/g, "$1");
  const wrapped = `<p>${html}</p>`;
  return wrapped.replace(
    /<p>\s*(<(?:h3|h4|ul|pre)\b[^>]*>[\s\S]*?<\/(?:h3|h4|ul|pre)>|<hr\b[^>]*\/?>)\s*<\/p>/g,
    "$1",
  )
    .replace(/<p>\s*<br\/>/g, "<p>")
    .replace(/<br\/>\s*<\/p>/g, "</p>")
    .replace(/<p>\s*<\/p>/g, "");
}

export function formatCopyReadyText(markdown: string): string {
  if (!markdown) return "";
  return stripNumericCitationBrackets(markdown)
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, block) => `${String(block || "").trim()}\n\n`)
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^"\s*/gm, "")
    .replace(/\s*"$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const COPY_READY_FENCE_LANGS = new Set(["", "text", "txt", "plain", "plaintext"]);

export function isCopyReadyFenceLanguage(language: string): boolean {
  return COPY_READY_FENCE_LANGS.has(String(language || "").trim().toLowerCase());
}

export function isLikelyRawPayloadBlock(code: string, language: string): boolean {
  const normalizedLang = String(language || "").trim().toLowerCase();
  const trimmed = String(code || "").trim();
  if (!trimmed) return false;
  if (trimmed.length < 220) return false;

  const looksJsonLike =
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /\"[A-Za-z0-9_ -]+\"\s*:/.test(trimmed);
  const rawPayloadSignals =
    /\"(candidate_id|visible_messages|participants|unknowns|latest_inbound_message|latest_outbound_message|profile_status_tags|source|thread_source|raw_payload|event_id|object_id)\"\s*:/.test(
      trimmed,
    );

  const looksHtmlLike =
    /<\/?[a-z][\s\S]*?>/i.test(trimmed) &&
    /<(div|section|article|header|main|aside|span|p|h[1-6]|table|tbody|tr|td|ul|li|a|img)(\s|>)/i.test(trimmed);
  const htmlLang = normalizedLang === "html" || normalizedLang === "xml" || normalizedLang === "jsx" || normalizedLang === "tsx";

  if (normalizedLang === "json" && (looksJsonLike || rawPayloadSignals)) return true;
  if (looksJsonLike && rawPayloadSignals) return true;
  if ((htmlLang || normalizedLang === "markdown" || normalizedLang === "md") && looksHtmlLike) return true;
  if (looksHtmlLike && trimmed.length > 380) return true;
  return false;
}

export function buildCopyOnlyMarkdown(markdown: string): string | null {
  const lines = String(markdown || "").split(/\r?\n/);
  if (lines.length === 0) return null;

  const segments: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(/^```([\w-]*)\s*$/);
    if (!open) continue;
    const lang = String(open[1] || "").trim().toLowerCase();
    const startIndex = i;
    const blockLines: string[] = [lines[i]];
    i += 1;
    while (i < lines.length) {
      blockLines.push(lines[i]);
      if (/^```\s*$/.test(lines[i])) break;
      i += 1;
    }
    if (!isCopyReadyFenceLanguage(lang)) continue;

    let label: string | null = null;
    for (let j = startIndex - 1; j >= 0; j -= 1) {
      const candidate = lines[j].trim();
      if (!candidate) break;
      if (candidate.startsWith("```")) break;
      const normalized = candidate.replace(/^>\s*/, "").replace(/^[-*]\s+/, "").trim();
      if (!normalized) continue;
      if (normalized.startsWith("{") || normalized.startsWith("[")) continue;
      if (normalized.length > 140) continue;
      label = normalized;
      break;
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;
    if (label) segments.push(`**${label}**\n${block}`);
    else segments.push(block);
  }

  if (segments.length === 0) return null;
  return segments.join("\n\n").trim();
}

export type AssistantDisplayContent = {
  visibleMarkdown: string;
  visibleMarkdownWithoutPrimaryCopyBlock: string;
  hiddenPayloadBlocks: string[];
  primaryCopyBlock: string | null;
  hasCopyBlocks: boolean;
};

export function buildAssistantDisplayContent(markdown: string, mode: ConsoleMode): AssistantDisplayContent {
  const raw = String(markdown || "");
  if (!raw.trim()) {
    return {
      visibleMarkdown: "",
      visibleMarkdownWithoutPrimaryCopyBlock: "",
      hiddenPayloadBlocks: [],
      primaryCopyBlock: null,
      hasCopyBlocks: false,
    };
  }

  const cleanMode = CLEAN_COPY_MODES.has(mode);
  if (!cleanMode) {
    const primaryCopyBlock = extractPrimaryCopyBlock(raw);
    return {
      visibleMarkdown: raw,
      visibleMarkdownWithoutPrimaryCopyBlock: primaryCopyBlock ? stripFirstCopyReadyFence(raw) : raw,
      hiddenPayloadBlocks: [],
      primaryCopyBlock,
      hasCopyBlocks: Boolean(primaryCopyBlock),
    };
  }

  const hiddenPayloadBlocks: string[] = [];
  const fencePattern = /```([\w-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let visible = "";
  let match: RegExpExecArray | null = null;

  while ((match = fencePattern.exec(raw)) !== null) {
    const full = String(match[0] || "");
    const lang = String(match[1] || "");
    const code = String(match[2] || "");
    visible += raw.slice(cursor, match.index);
    if (isLikelyRawPayloadBlock(code, lang)) {
      hiddenPayloadBlocks.push(code.trim());
    } else {
      visible += full;
    }
    cursor = match.index + full.length;
  }
  visible += raw.slice(cursor);

  const copyOnly = buildCopyOnlyMarkdown(visible);
  const visibleMarkdown = (copyOnly || visible).trim() || raw.trim();
  const primaryCopyBlock = extractPrimaryCopyBlock(visibleMarkdown);
  const visibleMarkdownWithoutPrimaryCopyBlock = primaryCopyBlock
    ? stripFirstCopyReadyFence(visibleMarkdown)
    : visibleMarkdown;

  return {
    visibleMarkdown,
    visibleMarkdownWithoutPrimaryCopyBlock,
    hiddenPayloadBlocks,
    primaryCopyBlock,
    hasCopyBlocks: Boolean(primaryCopyBlock),
  };
}

export type UserDisplayContent = {
  previewText: string;
  hiddenText: string | null;
  collapsed: boolean;
  charCount: number;
  lineCount: number;
};

export const USER_COLLAPSE_CHAR_LIMIT = 1200;
export const USER_COLLAPSE_LINE_LIMIT = 18;

export function buildUserDisplayContent(text: string): UserDisplayContent {
  const raw = String(text || "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      previewText: "",
      hiddenText: null,
      collapsed: false,
      charCount: 0,
      lineCount: 0,
    };
  }

  const lines = raw.split(/\r?\n/);
  const lineCount = lines.length;
  const charCount = raw.length;
  const hasFence = /```/.test(raw);
  const shouldCollapse =
    charCount > USER_COLLAPSE_CHAR_LIMIT ||
    lineCount > USER_COLLAPSE_LINE_LIMIT ||
    (hasFence && charCount > 600);

  if (!shouldCollapse) {
    return {
      previewText: raw,
      hiddenText: null,
      collapsed: false,
      charCount,
      lineCount,
    };
  }

  const lead = lines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("```"));
  const leadText =
    !lead || lead.startsWith("{") || lead.startsWith("[")
      ? "Structured payload attached."
      : lead.length > 180
        ? `${lead.slice(0, 180).trimEnd()}…`
        : lead;
  const contextLine = hasFence
    ? "Payload details are hidden to keep this thread readable."
    : "Long request details are hidden to keep this thread readable.";
  const previewText = `${leadText}\n\n${contextLine}`;

  return {
    previewText,
    hiddenText: raw,
    collapsed: true,
    charCount,
    lineCount,
  };
}

export function formatMessageTimestamp(value: Date): string {
  const safeDate = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(safeDate);
}

export function extractPrimaryCopyBlock(markdown: string): string | null {
  if (!markdown) return null;
  const fencePattern = /```([\w-]*)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = fencePattern.exec(markdown)) !== null) {
    const lang = String(match[1] || "").trim().toLowerCase();
    if (!isCopyReadyFenceLanguage(lang)) continue;
    const content = String(match[2] || "").trim();
    if (content) return content;
  }
  return null;
}

export function stripFirstCopyReadyFence(markdown: string): string {
  if (!markdown) return "";
  const fencePattern = /```([\w-]*)\n([\s\S]*?)```/gi;
  let stripped = false;
  const withoutFirstFence = markdown.replace(fencePattern, (full: string, language: string) => {
    if (stripped) return full;
    const lang = String(language || "").trim().toLowerCase();
    if (!isCopyReadyFenceLanguage(lang)) return full;
    stripped = true;
    return "";
  });
  if (!stripped) return markdown;
  return withoutFirstFence.replace(/\n{3,}/g, "\n\n").trim();
}

// --- Persistence ---
export const storageKey = (mode: ConsoleMode) => `chat-${mode}`;
export const MODE_KEY = "chat-mode";

export function saveToStorage(mode: ConsoleMode, messages: Message[]) {
  try {
    const serializable = messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() }));
    localStorage.setItem(storageKey(mode), JSON.stringify(serializable));
  } catch { /* quota or SSR */ }
}

export function loadFromStorage(mode: ConsoleMode): Message[] {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((m: Record<string, unknown>) => ({
      ...m,
      timestamp: new Date(m.timestamp as string),
      isStreaming: false,
      workspaceScope: typeof m.workspaceScope === "string" ? m.workspaceScope : null,
    }));
  } catch { return []; }
}

export function workspaceScopeFor(mode: ConsoleMode, item: PanelItem | null): string | null {
  if ((mode !== "facility" && mode !== "margins") || !item?.id) return null;
  return `${mode}:${item.id}`;
}

export function getSavedMode(): ConsoleMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (
      raw === "healthcare" ||
      raw === "sports" ||
      raw === "code" ||
      raw === "worldcup" ||
      raw === "ayaops" ||
      raw === "facility" ||
      raw === "margins" ||
      raw === "agent"
    ) {
      return raw;
    }
  } catch { /* SSR */ }
  return "sports";
}

export function readStringSafe(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function readNumberSafe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(readStringSafe(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readPercentDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 1 ? value / 100 : value;
  }
  const raw = readStringSafe(value);
  if (!raw) return null;
  const hasPercent = raw.includes("%");
  const parsed = Number(raw.replace(/[$,%\s,]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return hasPercent || Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "--";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(parsed);
}

export function formatTouchPriorityReason(value: string | null | undefined): string {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  // Title-case and clean underscores/dashes
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatLongDate(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString();
}

export function marginDeltaPoints(actual: number | null | undefined, target: number | null | undefined): number | null {
  if (typeof actual !== "number" || !Number.isFinite(actual)) return null;
  if (typeof target !== "number" || !Number.isFinite(target)) return null;
  return (actual - target) * 100;
}

export function formatMarginDelta(deltaPoints: number | null | undefined): string {
  if (typeof deltaPoints !== "number" || !Number.isFinite(deltaPoints)) return "Target n/a";
  const rounded = Math.round(deltaPoints * 100) / 100;
  if (Math.abs(rounded) < 0.01) return "On target";
  if (rounded > 0) return `+${rounded.toFixed(2)} over target`;
  return `${rounded.toFixed(2)} below target`;
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  const diffMs = parsed.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (absMs >= size || unit === "minute") {
      const amount = Math.round(diffMs / size);
      return formatter.format(amount, unit);
    }
  }
  return "--";
}

export function formatShiftWindow(
  shiftType: string | null | undefined,
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): string {
  const type = readStringSafe(shiftType);
  const start = readStringSafe(shiftStart);
  const end = readStringSafe(shiftEnd);
  const window = start || end ? `${start || "--"}-${end || "--"}` : "";
  if (type && window) return `${type} ${window}`;
  if (window) return window;
  if (type) return type;
  return "--";
}

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  const raw = readStringSafe(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatShiftCadence(
  weeklyHours: number | null | undefined,
  shiftType: string | null | undefined,
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
): string {
  const hours = typeof weeklyHours === "number" && Number.isFinite(weeklyHours) ? weeklyHours : null;
  const type = readStringSafe(shiftType).toLowerCase();
  const startMins = parseTimeToMinutes(shiftStart);
  const endMins = parseTimeToMinutes(shiftEnd);
  let shiftLengthHours: number | null = null;
  if (startMins != null && endMins != null) {
    const span = endMins >= startMins ? endMins - startMins : (24 * 60 - startMins) + endMins;
    if (span > 0) shiftLengthHours = span / 60;
  }
  const normalizedType =
    type === "day" ? "days" :
      type === "night" ? "nights" :
        type ? type : "shifts";

  if (hours != null && shiftLengthHours != null && shiftLengthHours > 0) {
    const shifts = hours / shiftLengthHours;
    const roundedShifts = Math.round(shifts);
    if (Math.abs(shifts - roundedShifts) <= 0.15 && roundedShifts > 0) {
      const roundedShiftLength = Math.round(shiftLengthHours * 10) / 10;
      const shiftLengthLabel = Number.isInteger(roundedShiftLength)
        ? String(roundedShiftLength)
        : roundedShiftLength.toFixed(1);
      return `${roundedShifts}×${shiftLengthLabel}s ${normalizedType}`;
    }
  }
  if (hours != null) return `${Math.round(hours)} hrs/week`;
  if (shiftLengthHours != null) {
    const roundedShiftLength = Math.round(shiftLengthHours * 10) / 10;
    const shiftLengthLabel = Number.isInteger(roundedShiftLength)
      ? String(roundedShiftLength)
      : roundedShiftLength.toFixed(1);
    return `${shiftLengthLabel}h ${normalizedType}`;
  }
  if (type) return normalizedType;
  return "--";
}

export function formatAssignmentWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "Assignment dates not set";
  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const hasValidRange =
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate.getTime() >= startDate.getTime();
    if (hasValidRange) {
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weeks = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / msPerWeek));
      return `${weeks} weeks · ${formatLongDate(start)} to ${formatLongDate(end)}`;
    }
    return `${formatLongDate(start)} to ${formatLongDate(end)}`;
  }
  if (start) return `Starts ${formatLongDate(start)}`;
  return `Through ${formatLongDate(end)}`;
}

export function assignmentProgress(start: string | null | undefined, end: string | null | undefined): { pct: number; label: string } | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) return null;
  const total = endDate.getTime() - startDate.getTime();
  const elapsed = Date.now() - startDate.getTime();
  const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
  return {
    pct,
    label: `${Math.round(pct)}% through assignment`,
  };
}


export function formatSubmissionDifficulty(value: "easy" | "moderate" | "hard" | null | undefined): string {
  if (value === "easy") return "Easy submittal";
  if (value === "moderate") return "Moderate submittal";
  if (value === "hard") return "Hard submittal";
  return "Not configured";
}

export function formatTournamentStage(value?: string | null): string {
  const map: Record<string, string> = {
    r32: "Round of 32",
    qf: "Quarterfinal",
    sf: "Semifinal",
    final: "Final",
    r16: "Round of 16",
    third_place: "Third Place",
  };
  return map[value || ""] || value || "";
}

/* ── Client-side state code normalizer ── */
export const CLIENT_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);
export const CLIENT_STATE_NAME_TO_CODE = new Map<string, string>([
  ["ALABAMA","AL"],["ALASKA","AK"],["ARIZONA","AZ"],["ARKANSAS","AR"],
  ["CALIFORNIA","CA"],["COLORADO","CO"],["CONNECTICUT","CT"],["DELAWARE","DE"],
  ["FLORIDA","FL"],["GEORGIA","GA"],["HAWAII","HI"],["IDAHO","ID"],
  ["ILLINOIS","IL"],["INDIANA","IN"],["IOWA","IA"],["KANSAS","KS"],
  ["KENTUCKY","KY"],["LOUISIANA","LA"],["MAINE","ME"],["MARYLAND","MD"],
  ["MASSACHUSETTS","MA"],["MICHIGAN","MI"],["MINNESOTA","MN"],["MISSISSIPPI","MS"],
  ["MISSOURI","MO"],["MONTANA","MT"],["NEBRASKA","NE"],["NEVADA","NV"],
  ["NEW HAMPSHIRE","NH"],["NEW JERSEY","NJ"],["NEW MEXICO","NM"],["NEW YORK","NY"],
  ["NORTH CAROLINA","NC"],["NORTH DAKOTA","ND"],["OHIO","OH"],["OKLAHOMA","OK"],
  ["OREGON","OR"],["PENNSYLVANIA","PA"],["RHODE ISLAND","RI"],["SOUTH CAROLINA","SC"],
  ["SOUTH DAKOTA","SD"],["TENNESSEE","TN"],["TEXAS","TX"],["UTAH","UT"],
  ["VERMONT","VT"],["VIRGINIA","VA"],["WASHINGTON","WA"],["WEST VIRGINIA","WV"],
  ["WISCONSIN","WI"],["WYOMING","WY"],["DISTRICT OF COLUMBIA","DC"],
]);

export function normalizeStateToCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase().replace(/[^A-Z\s]/g, "").trim();
  if (!trimmed) return null;
  if (CLIENT_STATE_CODES.has(trimmed)) return trimmed;
  return CLIENT_STATE_NAME_TO_CODE.get(trimmed) || null;
}

export function inferHealthcareContextFromPrompt(prompt: string): { state: string | null; profession: string | null } {
  const input = String(prompt || "").trim();
  if (!input) return { state: null, profession: null };

  const tellMatch = input.match(/tell me about the\s+(.+?)\s+license in\s+(.+)$/i);
  if (tellMatch) {
    return {
      profession: readStringSafe(tellMatch[1]) || null,
      state: readStringSafe(tellMatch[2]) || null,
    };
  }

  const licenseInMatch = input.match(/license in\s+(.+?)\s+for\s+(.+)$/i);
  if (licenseInMatch) {
    return {
      state: readStringSafe(licenseInMatch[1]) || null,
      profession: readStringSafe(licenseInMatch[2]) || null,
    };
  }

  const efficiencyGuideMatch = input.match(/([A-Za-z][A-Za-z\s]+?)\s+([A-Za-z][A-Za-z\-/\s]+?)\s+Efficiency Guide/i);
  if (efficiencyGuideMatch) {
    return {
      state: readStringSafe(efficiencyGuideMatch[1]) || null,
      profession: readStringSafe(efficiencyGuideMatch[2]) || null,
    };
  }

  const licenseHeaderMatch = input.match(/([A-Za-z][A-Za-z\s]+?)\s+([A-Za-z][A-Za-z\-/\s]+?)\s+license/i);
  if (licenseHeaderMatch) {
    return {
      state: readStringSafe(licenseHeaderMatch[1]) || null,
      profession: readStringSafe(licenseHeaderMatch[2]) || null,
    };
  }

  return { state: null, profession: null };
}

export function inferHealthcareContextFromLabel(label: string): { state: string | null; profession: string | null } {
  const input = String(label || "").trim();
  if (!input) return { state: null, profession: null };
  const byDash = input.match(/^([A-Za-z][A-Za-z\s]+?)\s*[—-]\s*(.+)$/);
  if (byDash) {
    return {
      state: readStringSafe(byDash[1]) || null,
      profession: readStringSafe(byDash[2]) || null,
    };
  }
  return { state: null, profession: null };
}

export function normalizeTextToken(value: string | null | undefined): string {
  return readStringSafe(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildLicensingReferenceUrl(slugOrId: string | null | undefined): string | null {
  const slug = readStringSafe(slugOrId).replace(/^\/+|\/+$/g, "");
  if (!slug) return null;
  return `https://www.statelicensingreference.com/${encodeURIComponent(slug)}`;
}

export type HealthcareResolvedEntity = {
  id: string;
  label: string;
  state: string | null;
  profession: string | null;
  url: string;
};

export function resolveHealthcareEntityFromPrompt(
  prompt: string,
  items: PanelItem[],
  selectedItem: PanelItem | null,
): HealthcareResolvedEntity | null {
  const normalizedPrompt = normalizeTextToken(prompt);
  if (!normalizedPrompt) return null;
  const rawPrompt = String(prompt || "").toLowerCase();

  const toEntity = (item: PanelItem): HealthcareResolvedEntity | null => {
    const id = readStringSafe(item.id);
    const url = buildLicensingReferenceUrl(id);
    if (!id || !url) return null;
    return {
      id,
      label: readStringSafe(item.label) || id,
      state: readStringSafe(item.state) || null,
      profession: readStringSafe(item.profession) || null,
      url,
    };
  };

  const selected = selectedItem ? toEntity(selectedItem) : null;
  if (selected && selectedItem) {
    const selectedState = normalizeTextToken(selectedItem.state || "");
    const selectedProfession = normalizeTextToken(selectedItem.profession || "");
    const selectedLabel = normalizeTextToken(selectedItem.label || "");
    const inferredFromPrompt = inferHealthcareContextFromPrompt(prompt);
    const inferredState = normalizeTextToken(inferredFromPrompt.state || "");
    const inferredProfession = normalizeTextToken(inferredFromPrompt.profession || "");
    const selectedMentioned =
      (selectedLabel && normalizedPrompt.includes(selectedLabel)) ||
      (selectedState &&
        selectedProfession &&
        normalizedPrompt.includes(selectedState) &&
        normalizedPrompt.includes(selectedProfession)) ||
      (selectedState &&
        selectedProfession &&
        inferredState === selectedState &&
        (inferredProfession === selectedProfession ||
          selectedProfession.includes(inferredProfession) ||
          inferredProfession.includes(selectedProfession)));

    if (selectedMentioned) return selected;
  }

  for (const item of items) {
    const slug = readStringSafe(item.id).toLowerCase();
    if (slug && rawPrompt.includes(slug)) {
      const entity = toEntity(item);
      if (entity) return entity;
    }
  }

  for (const item of items) {
    const label = normalizeTextToken(item.label);
    if (label && normalizedPrompt.includes(label)) {
      const entity = toEntity(item);
      if (entity) return entity;
    }
  }

  const inferred = inferHealthcareContextFromPrompt(prompt);
  const inferredState = normalizeTextToken(inferred.state || "");
  const inferredProfession = normalizeTextToken(inferred.profession || "");
  if (!inferredState || !inferredProfession) return null;

  for (const item of items) {
    const state = normalizeTextToken(item.state || "");
    const profession = normalizeTextToken(item.profession || "");
    const stateMatches =
      Boolean(state) && (state === inferredState || state.includes(inferredState) || inferredState.includes(state));
    const professionMatches =
      Boolean(profession) &&
      (profession === inferredProfession ||
        profession.includes(inferredProfession) ||
        inferredProfession.includes(profession));
    if (stateMatches && professionMatches) {
      const entity = toEntity(item);
      if (entity) return entity;
    }
  }

  return null;
}

export const writeOutcomeLabel = (outcome: import("@/lib/types/chat").WriteOutcome) => {
  if (outcome === "updated") return "Updated";
  if (outcome === "inserted") return "Created";
  if (outcome === "no_change") return "No change";
  return "Retry";
};

export const writePayloadForDisplay = (writeResult: import("@/lib/types/chat").WriteResultMeta): Record<string, unknown> => {
  if (writeResult.payload && typeof writeResult.payload === "object") return writeResult.payload;
  const fallback: Record<string, unknown> = { outcome: writeResult.outcome };
  if (writeResult.action) fallback.action = writeResult.action;
  if (writeResult.objectType) fallback.objectType = writeResult.objectType;
  if (typeof writeResult.rowsUpdated === "number") fallback.rowsUpdated = writeResult.rowsUpdated;
  if (writeResult.code) fallback.code = writeResult.code;
  return fallback;
};
