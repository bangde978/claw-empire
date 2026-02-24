import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import OfficeView from "./components/OfficeView";
import { ChatPanel } from "./components/ChatPanel";
import Dashboard from "./components/Dashboard";
import TaskBoard from "./components/TaskBoard";
import AgentDetail from "./components/AgentDetail";
import SettingsPanel from "./components/SettingsPanel";
import TerminalPanel from "./components/TerminalPanel";
import SkillsLibrary from "./components/SkillsLibrary";
import AgentManager from "./components/AgentManager";
import TaskReportPopup from "./components/TaskReportPopup";
import ReportHistory from "./components/ReportHistory";
import AgentStatusPanel from "./components/AgentStatusPanel";
import OfficeRoomManager from "./components/OfficeRoomManager";
import DecisionInboxModal from "./components/DecisionInboxModal";
import { buildDecisionInboxItems } from "./components/chat/decision-inbox";
import type { DecisionInboxItem } from "./components/chat/decision-inbox";
import { useWebSocket } from "./hooks/useWebSocket";
import type {
  Department,
  Agent,
  Task,
  Message,
  CompanyStats,
  CompanySettings,
  CliStatusMap,
  SubTask,
  MeetingPresence,
  MeetingReviewDecision,
  RoomTheme,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import {
  detectBrowserLanguage,
  I18nProvider,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_USER_SET_STORAGE_KEY,
  normalizeLanguage,
  pickLang,
} from "./i18n";
import type { TaskReportDetail } from "./api";
import * as api from "./api";
import { useTheme } from "./ThemeContext";

interface SubAgent {
  id: string;
  parentAgentId: string;
  task: string;
  status: "working" | "done";
}

export interface CrossDeptDelivery {
  id: string;
  fromAgentId: string;
  toAgentId: string;
}

export interface CeoOfficeCall {
  id: string;
  fromAgentId: string;
  seatIndex: number;
  phase: "kickoff" | "review";
  action?: "arrive" | "speak" | "dismiss";
  line?: string;
  decision?: MeetingReviewDecision;
  taskId?: string;
  instant?: boolean;
  holdUntil?: number;
}

type View = "office" | "agents" | "dashboard" | "tasks" | "skills" | "settings";
type TaskPanelTab = "terminal" | "minutes";
type RuntimeOs = "windows" | "mac" | "linux" | "unknown";

export interface OAuthCallbackResult {
  provider: string | null;
  error: string | null;
}

const MAX_LIVE_MESSAGES = 600;
const MAX_LIVE_SUBTASKS = 2000;
const MAX_LIVE_SUBAGENTS = 600;
const MAX_CROSS_DEPT_DELIVERIES = 240;
const MAX_CEO_OFFICE_CALLS = 480;
const MAX_SUBAGENT_TASK_LABEL_CHARS = 100;
const MAX_SUBAGENT_STREAM_TAIL_CHARS = 16_000;
const MAX_SUBAGENT_STREAM_TRACKED_TASKS = 180;
const MAX_CODEX_THREAD_BINDINGS = 2000;
const CODEX_THREAD_BINDING_TTL_MS = 30 * 60 * 1000;
const UPDATE_BANNER_DISMISS_STORAGE_KEY = "climpire_update_banner_dismissed";
const ROOM_THEMES_STORAGE_KEY = "climpire_room_themes";
type RoomThemeMap = Record<string, RoomTheme>;

type CliSubAgentEvent =
  | { kind: "spawn"; id: string; task: string | null }
  | { kind: "done"; id: string }
  | { kind: "bind_thread"; threadId: string; subAgentId: string }
  | { kind: "close_thread"; threadId: string };

const SUB_AGENT_PARSE_MARKERS = [
  "\"Task\"",
  "\"spawn_agent\"",
  "\"close_agent\"",
  "\"tool_use\"",
  "\"tool_result\"",
  "\"collab_tool_call\"",
  "\"item.started\"",
  "\"item.completed\"",
  "\"tool_name\"",
  "\"tool_id\"",
  "\"callID\"",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const raw of value) {
    const parsed = asNonEmptyString(raw);
    if (parsed) items.push(parsed);
  }
  return items;
}

function isSubAgentToolName(value: unknown): boolean {
  const name = asNonEmptyString(value)?.toLowerCase();
  return name === "task" || name === "spawn_agent" || name === "spawnagent";
}

function extractTaskLabel(value: unknown): string | null {
  if (typeof value === "string") {
    const firstLine = value.split("\n")[0]?.trim() ?? "";
    return firstLine ? firstLine.slice(0, MAX_SUBAGENT_TASK_LABEL_CHARS) : null;
  }
  const obj = asRecord(value);
  if (!obj) return null;
  const raw =
    asNonEmptyString(obj.description) ??
    asNonEmptyString(obj.prompt) ??
    asNonEmptyString(obj.task) ??
    asNonEmptyString(obj.message) ??
    asNonEmptyString(obj.command);
  if (!raw) return null;
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  return firstLine ? firstLine.slice(0, MAX_SUBAGENT_TASK_LABEL_CHARS) : null;
}

function shouldParseCliChunkForSubAgents(chunk: string): boolean {
  for (const marker of SUB_AGENT_PARSE_MARKERS) {
    if (chunk.includes(marker)) return true;
  }
  return false;
}

function parseCliSubAgentEvents(json: Record<string, unknown>): CliSubAgentEvent[] {
  const events: CliSubAgentEvent[] = [];
  const type = asNonEmptyString(json.type);
  if (!type) return events;

  if (type === "stream_event") {
    const event = asRecord(json.event);
    if (!event) return events;
    if (asNonEmptyString(event.type) === "content_block_start") {
      const block = asRecord(event.content_block);
      if (block && asNonEmptyString(block.type) === "tool_use" && isSubAgentToolName(block.name)) {
        const id = asNonEmptyString(block.id);
        if (id) events.push({ kind: "spawn", id, task: extractTaskLabel(block.input) });
      }
    }
    return events;
  }

  if (type === "assistant") {
    const message = asRecord(json.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const blockRaw of content) {
      const block = asRecord(blockRaw);
      if (!block || asNonEmptyString(block.type) !== "tool_use" || !isSubAgentToolName(block.name)) continue;
      const id = asNonEmptyString(block.id);
      if (id) events.push({ kind: "spawn", id, task: extractTaskLabel(block.input) });
    }
    return events;
  }

  if (type === "user") {
    const message = asRecord(json.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const blockRaw of content) {
      const block = asRecord(blockRaw);
      if (!block || asNonEmptyString(block.type) !== "tool_result") continue;
      const toolUseId = asNonEmptyString(block.tool_use_id);
      if (toolUseId) events.push({ kind: "done", id: toolUseId });
    }
    return events;
  }

  if (type === "item.started" || type === "item.completed") {
    const item = asRecord(json.item);
    if (!item || asNonEmptyString(item.type) !== "collab_tool_call") return events;
    const tool = asNonEmptyString(item.tool)?.toLowerCase();

    if (tool && isSubAgentToolName(tool)) {
      const itemId = asNonEmptyString(item.id);
      if (itemId) {
        const subAgentId = `codex:${itemId}`;
        const task =
          extractTaskLabel(item.prompt) ??
          extractTaskLabel(item.arguments) ??
          extractTaskLabel(item.input);
        events.push({ kind: "spawn", id: subAgentId, task });
        if (type === "item.completed") {
          for (const threadId of asStringArray(item.receiver_thread_ids)) {
            events.push({ kind: "bind_thread", threadId, subAgentId });
          }
        }
      }
      return events;
    }

    if (type === "item.completed" && tool === "close_agent") {
      for (const threadId of asStringArray(item.receiver_thread_ids)) {
        events.push({ kind: "close_thread", threadId });
      }
    }
    return events;
  }

  if (type === "tool_use") {
    const part = asRecord(json.part);
    if (part && asNonEmptyString(part.type) === "tool" && isSubAgentToolName(part.tool)) {
      const callId =
        asNonEmptyString(part.callID) ??
        asNonEmptyString(part.callId) ??
        asNonEmptyString(part.call_id);
      if (callId) {
        const subAgentId = `opencode:${callId}`;
        const partState = asRecord(part.state);
        const task = extractTaskLabel(partState?.input) ?? extractTaskLabel(part.input);
        events.push({ kind: "spawn", id: subAgentId, task });
        const status = asNonEmptyString(partState?.status)?.toLowerCase();
        if (status === "completed" || status === "error" || status === "failed") {
          events.push({ kind: "done", id: subAgentId });
        }
      }
      return events;
    }

    if (isSubAgentToolName(json.tool_name)) {
      const toolId = asNonEmptyString(json.tool_id);
      if (toolId) {
        events.push({
          kind: "spawn",
          id: `gemini:${toolId}`,
          task: extractTaskLabel(json.parameters),
        });
      }
      return events;
    }

    if (isSubAgentToolName(json.tool)) {
      const id = asNonEmptyString(json.id);
      if (id) {
        events.push({ kind: "spawn", id, task: extractTaskLabel(json.input) });
      }
    }
    return events;
  }

  if (type === "tool_result") {
    if (isSubAgentToolName(json.tool)) {
      const id = asNonEmptyString(json.id);
      if (id) events.push({ kind: "done", id });
    }
    const toolId = asNonEmptyString(json.tool_id);
    if (toolId) events.push({ kind: "done", id: `gemini:${toolId}` });
  }

  return events;
}

function isRoomTheme(value: unknown): value is RoomTheme {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.floor1 === "number" &&
    Number.isFinite(v.floor1) &&
    typeof v.floor2 === "number" &&
    Number.isFinite(v.floor2) &&
    typeof v.wall === "number" &&
    Number.isFinite(v.wall) &&
    typeof v.accent === "number" &&
    Number.isFinite(v.accent)
  );
}

function isRoomThemeMap(value: unknown): value is RoomThemeMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isRoomTheme);
}

function readStoredRoomThemes(): { themes: RoomThemeMap; hasStored: boolean } {
  if (typeof window === "undefined") return { themes: {}, hasStored: false };
  try {
    const raw = window.localStorage.getItem(ROOM_THEMES_STORAGE_KEY);
    if (!raw) return { themes: {}, hasStored: false };
    const parsed: unknown = JSON.parse(raw);
    if (!isRoomThemeMap(parsed)) return { themes: {}, hasStored: false };
    return { themes: parsed, hasStored: true };
  } catch {
    return { themes: {}, hasStored: false };
  }
}

function appendCapped<T>(prev: T[], item: T, max: number): T[] {
  const next = prev.length >= max ? prev.slice(prev.length - max + 1) : prev.slice();
  next.push(item);
  return next;
}

function areValuesEquivalent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return Object.is(a, b);
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function areExtraFieldsEquivalent(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  comparedKeys: ReadonlySet<string>,
): boolean {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (comparedKeys.has(key)) continue;
    if (!areValuesEquivalent(a[key], b[key])) return false;
  }
  return true;
}

const AGENT_EQ_KNOWN_KEYS = new Set<string>([
  "id",
  "name",
  "name_ko",
  "department_id",
  "role",
  "cli_provider",
  "oauth_account_id",
  "api_provider_id",
  "api_model",
  "avatar_emoji",
  "personality",
  "status",
  "current_task_id",
  "stats_tasks_done",
  "stats_xp",
  "created_at",
]);

const TASK_EQ_KNOWN_KEYS = new Set<string>([
  "id",
  "title",
  "description",
  "department_id",
  "assigned_agent_id",
  "project_id",
  "status",
  "priority",
  "task_type",
  "project_path",
  "result",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
  "source_task_id",
  "subtask_total",
  "subtask_done",
  "hidden",
]);

function areAgentsEquivalent(a: Agent, b: Agent): boolean {
  if (
    a.id === b.id &&
    a.name === b.name &&
    a.name_ko === b.name_ko &&
    a.department_id === b.department_id &&
    a.role === b.role &&
    a.cli_provider === b.cli_provider &&
    (a.oauth_account_id ?? null) === (b.oauth_account_id ?? null) &&
    (a.api_provider_id ?? null) === (b.api_provider_id ?? null) &&
    (a.api_model ?? null) === (b.api_model ?? null) &&
    a.avatar_emoji === b.avatar_emoji &&
    (a.personality ?? null) === (b.personality ?? null) &&
    a.status === b.status &&
    (a.current_task_id ?? null) === (b.current_task_id ?? null) &&
    a.stats_tasks_done === b.stats_tasks_done &&
    a.stats_xp === b.stats_xp &&
    a.created_at === b.created_at
  ) {
    return areExtraFieldsEquivalent(
      a as unknown as Record<string, unknown>,
      b as unknown as Record<string, unknown>,
      AGENT_EQ_KNOWN_KEYS,
    );
  }
  return false;
}

function areAgentListsEquivalent(prev: Agent[], next: Agent[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (!areAgentsEquivalent(prev[i], next[i])) return false;
  }
  return true;
}

function areTasksEquivalent(a: Task, b: Task): boolean {
  if (
    a.id === b.id &&
    a.title === b.title &&
    (a.description ?? null) === (b.description ?? null) &&
    (a.department_id ?? null) === (b.department_id ?? null) &&
    (a.assigned_agent_id ?? null) === (b.assigned_agent_id ?? null) &&
    (a.project_id ?? null) === (b.project_id ?? null) &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.task_type === b.task_type &&
    (a.project_path ?? null) === (b.project_path ?? null) &&
    (a.result ?? null) === (b.result ?? null) &&
    (a.started_at ?? null) === (b.started_at ?? null) &&
    (a.completed_at ?? null) === (b.completed_at ?? null) &&
    a.created_at === b.created_at &&
    a.updated_at === b.updated_at &&
    (a.source_task_id ?? null) === (b.source_task_id ?? null) &&
    (a.subtask_total ?? null) === (b.subtask_total ?? null) &&
    (a.subtask_done ?? null) === (b.subtask_done ?? null) &&
    (a.hidden ?? 0) === (b.hidden ?? 0)
  ) {
    return areExtraFieldsEquivalent(
      a as unknown as Record<string, unknown>,
      b as unknown as Record<string, unknown>,
      TASK_EQ_KNOWN_KEYS,
    );
  }
  return false;
}

function areTaskListsEquivalent(prev: Task[], next: Task[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (!areTasksEquivalent(prev[i], next[i])) return false;
  }
  return true;
}

function mergeSettingsWithDefaults(
  settings?: Partial<CompanySettings> | null
): CompanySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
    language: normalizeLanguage(settings?.language ?? DEFAULT_SETTINGS.language),
    providerModelConfig: {
      ...(DEFAULT_SETTINGS.providerModelConfig ?? {}),
      ...(settings?.providerModelConfig ?? {}),
    },
  };
}

function isUserLanguagePinned(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LANGUAGE_USER_SET_STORAGE_KEY) === "1";
}

function readStoredClientLanguage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (!raw) return null;
  return normalizeLanguage(raw);
}

function detectRuntimeOs(): RuntimeOs {
  if (typeof window === "undefined") return "unknown";
  const ua = (window.navigator.userAgent || "").toLowerCase();
  const platform = (window.navigator.platform || "").toLowerCase();
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  if (platform.includes("mac") || ua.includes("mac os")) return "mac";
  if (platform.includes("linux") || ua.includes("linux")) return "linux";
  return "unknown";
}

function isForceUpdateBannerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("force_update_banner") === "1";
  } catch {
    return false;
  }
}

function syncClientLanguage(language: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(language));
  window.dispatchEvent(new Event("climpire-language-change"));
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const initialRoomThemes = useMemo(() => readStoredRoomThemes(), []);
  const hasLocalRoomThemesRef = useRef<boolean>(initialRoomThemes.hasStored);

  // Core state
  const [view, setView] = useState<View>("office");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<CompanyStats | null>(null);
  const [settings, setSettings] = useState<CompanySettings>(() =>
    mergeSettingsWithDefaults({ language: detectBrowserLanguage() })
  );
  const [cliStatus, setCliStatus] = useState<CliStatusMap | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);

  // UI state
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [taskPanel, setTaskPanel] = useState<{ taskId: string; tab: TaskPanelTab } | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadAgentIds, setUnreadAgentIds] = useState<Set<string>>(new Set());
  const [crossDeptDeliveries, setCrossDeptDeliveries] = useState<CrossDeptDelivery[]>([]);
  const [ceoOfficeCalls, setCeoOfficeCalls] = useState<CeoOfficeCall[]>([]);
  const [meetingPresence, setMeetingPresence] = useState<MeetingPresence[]>([]);
  const [oauthResult, setOauthResult] = useState<OAuthCallbackResult | null>(null);
  const [taskReport, setTaskReport] = useState<TaskReportDetail | null>(null);
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [showAgentStatus, setShowAgentStatus] = useState(false);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [showDecisionInbox, setShowDecisionInbox] = useState(false);
  const [decisionInboxLoading, setDecisionInboxLoading] = useState(false);
  const [decisionInboxItems, setDecisionInboxItems] = useState<DecisionInboxItem[]>([]);
  const [decisionReplyBusyKey, setDecisionReplyBusyKey] = useState<string | null>(null);
  const [activeRoomThemeTargetId, setActiveRoomThemeTargetId] = useState<string | null>(null);
  const [customRoomThemes, setCustomRoomThemes] = useState<RoomThemeMap>(() => initialRoomThemes.themes);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [runtimeOs] = useState<RuntimeOs>(() => detectRuntimeOs());
  const [forceUpdateBanner] = useState<boolean>(() => isForceUpdateBannerEnabled());
  const [updateStatus, setUpdateStatus] = useState<api.UpdateStatus | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(UPDATE_BANNER_DISMISS_STORAGE_KEY) ?? "";
  });
  const [streamingMessage, setStreamingMessage] = useState<{
    message_id: string;
    agent_id: string;
    agent_name: string;
    agent_avatar: string;
    content: string;
  } | null>(null);
  const viewRef = useRef<View>("office");
  viewRef.current = view;
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;
  const tasksRef = useRef<Task[]>(tasks);
  tasksRef.current = tasks;
  const subAgentsRef = useRef<SubAgent[]>(subAgents);
  subAgentsRef.current = subAgents;
  const codexThreadToSubAgentIdRef = useRef<Map<string, string>>(new Map());
  const codexThreadBindingTsRef = useRef<Map<string, number>>(new Map());
  const subAgentStreamTailRef = useRef<Map<string, string>>(new Map());

  // Ref to track currently open chat (avoids stale closures in WebSocket handlers)
  const activeChatRef = useRef<{ showChat: boolean; agentId: string | null }>({ showChat: false, agentId: null });
  activeChatRef.current = { showChat, agentId: chatAgent?.id ?? null };
  const liveSyncInFlightRef = useRef(false);
  const liveSyncQueuedRef = useRef(false);
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // OAuth callback detection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthProvider = params.get("oauth");
    const oauthError = params.get("oauth_error");
    if (oauthProvider || oauthError) {
      setOauthResult({
        provider: oauthProvider,
        error: oauthError,
      });
      // Clean URL
      const clean = new URL(window.location.href);
      clean.searchParams.delete("oauth");
      clean.searchParams.delete("oauth_error");
      window.history.replaceState({}, "", clean.pathname + clean.search);
      // Switch to settings view
      setView("settings");
    }
  }, []);

  // WebSocket
  const { connected, on } = useWebSocket();

  // Initial data fetch
  const fetchAll = useCallback(async () => {
    try {
      const [depts, ags, tks, sts, sett, subs, presence, decisionItems] = await Promise.all([
        api.getDepartments(),
        api.getAgents(),
        api.getTasks(),
        api.getStats(),
        api.getSettings(),
        api.getActiveSubtasks(),
        api.getMeetingPresence().catch(() => []),
        api.getDecisionInbox().catch(() => []),
      ]);
      setDepartments(depts);
      setAgents(ags);
      setTasks(tks);
      setStats(sts);
      const mergedSettings = mergeSettingsWithDefaults(sett);
      const autoDetectedLanguage = detectBrowserLanguage();
      const storedClientLanguage = readStoredClientLanguage();
      const shouldAutoAssignLanguage =
        !isUserLanguagePinned()
        && !storedClientLanguage
        && mergedSettings.language === DEFAULT_SETTINGS.language;
      const nextSettings = shouldAutoAssignLanguage
        ? { ...mergedSettings, language: autoDetectedLanguage }
        : mergedSettings;

      setSettings(nextSettings);
      syncClientLanguage(nextSettings.language);
      const dbRoomThemes = isRoomThemeMap(nextSettings.roomThemes)
        ? nextSettings.roomThemes
        : undefined;

      if (!hasLocalRoomThemesRef.current && dbRoomThemes && Object.keys(dbRoomThemes).length > 0) {
        setCustomRoomThemes(dbRoomThemes);
        hasLocalRoomThemesRef.current = true;
        try {
          window.localStorage.setItem(ROOM_THEMES_STORAGE_KEY, JSON.stringify(dbRoomThemes));
        } catch {
          // ignore quota errors
        }
      }

      if (
        hasLocalRoomThemesRef.current &&
        Object.keys(initialRoomThemes.themes).length > 0 &&
        (!dbRoomThemes || Object.keys(dbRoomThemes).length === 0)
      ) {
        api.saveRoomThemes(initialRoomThemes.themes).catch((error) => {
          console.error("Room theme sync to DB failed:", error);
        });
      }

      if (
        shouldAutoAssignLanguage &&
        mergedSettings.language !== autoDetectedLanguage
      ) {
        api.saveSettings(nextSettings).catch((error) => {
          console.error("Auto language sync failed:", error);
        });
      }
      setSubtasks(subs);
      setMeetingPresence(presence);
      setDecisionInboxItems(
        (decisionItems ?? []).map((item) => ({
          id: item.id,
          kind: item.kind,
          agentId: item.agent_id ?? null,
          agentName: item.kind === "project_review_ready"
            ? (item.agent_name || item.project_name || item.project_id || "Planning Lead")
            : (item.task_title || item.task_id || "Task"),
          agentNameKo: item.kind === "project_review_ready"
            ? (item.agent_name_ko || item.agent_name || item.project_name || item.project_id || "기획팀장")
            : (item.task_title || item.task_id || "작업"),
          agentAvatar: item.agent_avatar ?? (item.kind === "project_review_ready" ? "🧑‍💼" : null),
          requestContent: item.summary,
          options: item.options.map((option) => ({
            number: option.number,
            label: option.label ?? option.action,
            action: option.action,
          })),
          createdAt: item.created_at,
          taskId: item.task_id,
          projectId: item.project_id,
          projectName: item.project_name,
        })),
      );
    } catch (e) {
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const runLiveSync = useCallback(() => {
    if (liveSyncInFlightRef.current) {
      liveSyncQueuedRef.current = true;
      return;
    }
    liveSyncInFlightRef.current = true;
    Promise.all([api.getTasks(), api.getAgents(), api.getStats(), api.getDecisionInbox()])
      .then(([nextTasks, nextAgents, nextStats, nextDecisionItems]) => {
        setTasks((prev) => (areTaskListsEquivalent(prev, nextTasks) ? prev : nextTasks));
        setAgents((prev) => (areAgentListsEquivalent(prev, nextAgents) ? prev : nextAgents));
        setStats(nextStats);
        setDecisionInboxItems((prev) => {
          const preservedAgentRequests = prev.filter((item) => item.kind === "agent_request");
          const workflowItems: DecisionInboxItem[] = nextDecisionItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            agentId: item.agent_id ?? null,
            agentName: item.kind === "project_review_ready"
              ? (item.agent_name || item.project_name || item.project_id || "Planning Lead")
              : (item.task_title || item.task_id || "Task"),
            agentNameKo: item.kind === "project_review_ready"
              ? (item.agent_name_ko || item.agent_name || item.project_name || item.project_id || "기획팀장")
              : (item.task_title || item.task_id || "작업"),
            agentAvatar: item.agent_avatar ?? (item.kind === "project_review_ready" ? "🧑‍💼" : null),
            requestContent: item.summary,
            options: item.options.map((option) => ({
              number: option.number,
              label: option.label ?? option.action,
              action: option.action,
            })),
            createdAt: item.created_at,
            taskId: item.task_id,
            projectId: item.project_id,
            projectName: item.project_name,
          }));
          const merged = [...workflowItems, ...preservedAgentRequests];
          const deduped = new Map<string, DecisionInboxItem>();
          for (const entry of merged) deduped.set(entry.id, entry);
          return Array.from(deduped.values()).sort((a, b) => b.createdAt - a.createdAt);
        });
      })
      .catch(console.error)
      .finally(() => {
        liveSyncInFlightRef.current = false;
        if (!liveSyncQueuedRef.current) return;
        liveSyncQueuedRef.current = false;
        setTimeout(() => runLiveSync(), 120);
      });
  }, []);

  const scheduleLiveSync = useCallback((delayMs = 120) => {
    if (liveSyncTimerRef.current) return;
    liveSyncTimerRef.current = setTimeout(() => {
      liveSyncTimerRef.current = null;
      runLiveSync();
    }, Math.max(0, delayMs));
  }, [runLiveSync]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    return () => {
      if (!liveSyncTimerRef.current) return;
      clearTimeout(liveSyncTimerRef.current);
      liveSyncTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshUpdateStatus = () => {
      api.getUpdateStatus()
        .then((status) => {
          if (cancelled) return;
          setUpdateStatus(status);
        })
        .catch(() => {
          // Network/offline failure should not block app UI.
        });
    };
    refreshUpdateStatus();
    const timer = setInterval(refreshUpdateStatus, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Fetch CLI status on settings view
  useEffect(() => {
    if (view === "settings" && !cliStatus) {
      api.getCliStatus(true).then(setCliStatus).catch(console.error);
    }
  }, [view, cliStatus]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [view]);

  useEffect(() => {
    const closeMobileNavOnDesktop = () => {
      if (window.innerWidth >= 1024) setMobileNavOpen(false);
    };
    window.addEventListener("resize", closeMobileNavOnDesktop);
    return () => window.removeEventListener("resize", closeMobileNavOnDesktop);
  }, []);

  useEffect(() => {
    if (view !== "office") return;
    api.getMeetingPresence().then(setMeetingPresence).catch(() => {});
  }, [view]);

  // WebSocket event handlers
  useEffect(() => {
    const unsubs = [
      on("task_update", () => {
        scheduleLiveSync(80);
      }),
      on("agent_status", (payload: unknown) => {
        const p = payload as Agent & { subAgents?: SubAgent[] };
        const { subAgents: incomingSubAgents, ...agentPatch } = p;
        const hasKnownAgent = agentsRef.current.some((a) => a.id === agentPatch.id);
        if (!hasKnownAgent) {
          // Unknown agent payload can be stale/out-of-order; use canonical API sync instead.
          scheduleLiveSync(80);
          return;
        }
        setAgents((prev) => {
          const idx = prev.findIndex((a) => a.id === agentPatch.id);
          if (idx < 0) return prev;
          const current = prev[idx];
          const merged = { ...current, ...agentPatch };
          if (areAgentsEquivalent(current, merged)) return prev;
          const next = [...prev];
          next[idx] = merged;
          return next;
        });
        if (incomingSubAgents) {
          setSubAgents((prev) => {
            const others = prev.filter((s) => s.parentAgentId !== p.id);
            const next = [...others, ...incomingSubAgents];
            return next.length > MAX_LIVE_SUBAGENTS
              ? next.slice(next.length - MAX_LIVE_SUBAGENTS)
              : next;
          });
        }
      }),
      on("agent_created", () => {
        scheduleLiveSync(60);
      }),
      on("agent_deleted", () => {
        scheduleLiveSync(60);
      }),
      on("departments_changed", () => {
        scheduleLiveSync(60);
      }),
      on("new_message", (payload: unknown) => {
        const msg = payload as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return appendCapped(prev, msg, MAX_LIVE_MESSAGES);
        });
        // Track unread: if an agent sent a message, mark as unread
        // BUT skip if the chat panel is currently open for this agent
        if (msg.sender_type === 'agent' && msg.sender_id) {
          const { showChat: chatOpen, agentId: activeId } = activeChatRef.current;
          if (chatOpen && activeId === msg.sender_id) return; // already reading
          setUnreadAgentIds((prev) => {
            if (prev.has(msg.sender_id!)) return prev;
            const next = new Set(prev);
            next.add(msg.sender_id!);
            return next;
          });
        }
      }),
      on("announcement", (payload: unknown) => {
        const msg = payload as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return appendCapped(prev, msg, MAX_LIVE_MESSAGES);
        });
        if (msg.sender_type === 'agent' && msg.sender_id) {
          const { showChat: chatOpen, agentId: activeId } = activeChatRef.current;
          if (chatOpen && activeId === msg.sender_id) return; // already reading
          setUnreadAgentIds((prev) => {
            if (prev.has(msg.sender_id!)) return prev;
            const next = new Set(prev);
            next.add(msg.sender_id!);
            return next;
          });
        }
      }),
      on("task_report", (payload: unknown) => {
        const p = payload as { task?: { id?: string } } | null;
        const reportTaskId = typeof p?.task?.id === "string" ? p.task.id : null;
        if (!reportTaskId) {
          setTaskReport(payload as TaskReportDetail);
          return;
        }
        api.getTaskReportDetail(reportTaskId)
          .then((detail) => setTaskReport(detail))
          .catch(() => setTaskReport(payload as TaskReportDetail));
      }),
      on("cross_dept_delivery", (payload: unknown) => {
        const p = payload as { from_agent_id: string; to_agent_id: string };
        setCrossDeptDeliveries((prev) =>
          appendCapped(
            prev,
            {
              id: `cd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fromAgentId: p.from_agent_id,
              toAgentId: p.to_agent_id,
            },
            MAX_CROSS_DEPT_DELIVERIES,
          )
        );
      }),
      on("ceo_office_call", (payload: unknown) => {
        const p = payload as {
          from_agent_id: string;
          seat_index?: number;
          phase?: "kickoff" | "review";
          action?: "arrive" | "speak" | "dismiss";
          line?: string;
          decision?: MeetingReviewDecision;
          task_id?: string;
          hold_until?: number;
        };
        if (!p.from_agent_id) return;
        const action = p.action ?? "arrive";
        if (action === "arrive" || action === "speak") {
          setMeetingPresence((prev) => {
            const existing = prev.find((row) => row.agent_id === p.from_agent_id);
            const rest = prev.filter((row) => row.agent_id !== p.from_agent_id);
            const holdUntil = action === "arrive"
              ? (p.hold_until ?? existing?.until ?? (Date.now() + 600_000))
              : (existing?.until ?? (Date.now() + 600_000));
            return [
              ...rest,
              {
                decision: (p.phase ?? existing?.phase ?? "kickoff") === "review"
                  ? (p.decision ?? existing?.decision ?? "reviewing")
                  : null,
                agent_id: p.from_agent_id,
                seat_index: p.seat_index ?? existing?.seat_index ?? 0,
                phase: p.phase ?? existing?.phase ?? "kickoff",
                task_id: p.task_id ?? existing?.task_id ?? null,
                until: holdUntil,
              },
            ];
          });
        } else if (action === "dismiss") {
          setMeetingPresence((prev) => prev.filter((row) => row.agent_id !== p.from_agent_id));
        }
        setCeoOfficeCalls((prev) =>
          appendCapped(
            prev,
            {
              id: `ceo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fromAgentId: p.from_agent_id,
              seatIndex: p.seat_index ?? 0,
              phase: p.phase ?? "kickoff",
              action,
              line: p.line,
              decision: p.decision,
              taskId: p.task_id,
              holdUntil: p.hold_until,
              instant: action === "arrive" && viewRef.current !== "office",
            },
            MAX_CEO_OFFICE_CALLS,
          )
        );
      }),
      on("subtask_update", (payload: unknown) => {
        const st = payload as SubTask;
        setSubtasks((prev) => {
          const idx = prev.findIndex((s) => s.id === st.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = st;
            return next;
          }
          return appendCapped(prev, st, MAX_LIVE_SUBTASKS);
        });
        // Coalesce expensive sync calls when subtask events burst.
        scheduleLiveSync(160);
      }),
      on("cli_output", (payload: unknown) => {
        const p = payload as { task_id?: string; stream?: string; data?: string };
        if (typeof p.task_id !== "string" || typeof p.data !== "string") return;
        const threadMap = codexThreadToSubAgentIdRef.current;
        const threadTsMap = codexThreadBindingTsRef.current;
        const pruneCodexThreadBindings = (now: number) => {
          for (const [threadId, ts] of threadTsMap.entries()) {
            if (now - ts <= CODEX_THREAD_BINDING_TTL_MS) continue;
            threadTsMap.delete(threadId);
            threadMap.delete(threadId);
          }
          if (threadMap.size <= MAX_CODEX_THREAD_BINDINGS) return;
          const entries = Array.from(threadTsMap.entries()).sort((a, b) => a[1] - b[1]);
          const overflow = threadMap.size - MAX_CODEX_THREAD_BINDINGS;
          for (let i = 0; i < overflow && i < entries.length; i += 1) {
            const threadId = entries[i][0];
            threadTsMap.delete(threadId);
            threadMap.delete(threadId);
          }
        };
        const now = Date.now();
        pruneCodexThreadBindings(now);
        const tailMap = subAgentStreamTailRef.current;
        const setTaskTail = (taskId: string, rawTail: string) => {
          const trimmedTail = rawTail.length > MAX_SUBAGENT_STREAM_TAIL_CHARS
            ? rawTail.slice(rawTail.length - MAX_SUBAGENT_STREAM_TAIL_CHARS)
            : rawTail;
          if (!trimmedTail) {
            tailMap.delete(taskId);
            return;
          }
          if (!tailMap.has(taskId) && tailMap.size >= MAX_SUBAGENT_STREAM_TRACKED_TASKS) {
            const oldestTaskId = tailMap.keys().next().value as string | undefined;
            if (oldestTaskId) tailMap.delete(oldestTaskId);
          }
          tailMap.set(taskId, trimmedTail);
        };

        const previousTail = tailMap.get(p.task_id) ?? "";
        const combined = previousTail + p.data;
        let lines: string[] = [];
        const lastNewline = combined.lastIndexOf("\n");

        if (lastNewline < 0) {
          setTaskTail(p.task_id, combined);
          const singleLineCandidate = combined.trim();
          if (
            singleLineCandidate &&
            singleLineCandidate[0] === "{" &&
            singleLineCandidate[singleLineCandidate.length - 1] === "}" &&
            shouldParseCliChunkForSubAgents(singleLineCandidate)
          ) {
            lines = [singleLineCandidate];
            setTaskTail(p.task_id, "");
          } else {
            return;
          }
        } else {
          const completeChunk = combined.slice(0, lastNewline);
          const nextTail = combined.slice(lastNewline + 1);
          setTaskTail(p.task_id, nextTail);
          if (!shouldParseCliChunkForSubAgents(completeChunk)) return;
          lines = completeChunk.split("\n");
        }
        const knownSubAgentIds = new Set(subAgentsRef.current.map((s) => s.id));
        const doneSubAgentIds = new Set(
          subAgentsRef.current.filter((s) => s.status === "done").map((s) => s.id),
        );
        let cachedParentAgentId: string | null | undefined;
        const resolveParentAgentId = () => {
          if (cachedParentAgentId !== undefined) return cachedParentAgentId;
          const byAgent = agentsRef.current.find((a) => a.current_task_id === p.task_id)?.id ?? null;
          if (byAgent) {
            cachedParentAgentId = byAgent;
            return byAgent;
          }
          const byTask = tasksRef.current.find((t) => t.id === p.task_id)?.assigned_agent_id ?? null;
          cachedParentAgentId = byTask;
          return byTask;
        };
        const upsertSubAgent = (subAgentId: string, taskLabel: string | null) => {
          knownSubAgentIds.add(subAgentId);
          doneSubAgentIds.delete(subAgentId);
          const parentAgentId = resolveParentAgentId();
          setSubAgents((prev) => {
            const idx = prev.findIndex((s) => s.id === subAgentId);
            if (idx >= 0) {
              const current = prev[idx];
              const nextTask = taskLabel ?? current.task;
              const nextParentAgentId = current.parentAgentId || parentAgentId || current.parentAgentId;
              if (current.task === nextTask && current.parentAgentId === nextParentAgentId) return prev;
              const next = [...prev];
              next[idx] = { ...current, task: nextTask, parentAgentId: nextParentAgentId };
              return next;
            }
            if (!parentAgentId) return prev;
            return appendCapped(
              prev,
              {
                id: subAgentId,
                parentAgentId,
                task: taskLabel ?? "Sub-task",
                status: "working" as const,
              },
              MAX_LIVE_SUBAGENTS,
            );
          });
        };
        const markSubAgentDone = (subAgentId: string) => {
          if (!knownSubAgentIds.has(subAgentId) || doneSubAgentIds.has(subAgentId)) return;
          doneSubAgentIds.add(subAgentId);
          for (const [threadId, mappedSubAgentId] of threadMap.entries()) {
            if (mappedSubAgentId !== subAgentId) continue;
            threadMap.delete(threadId);
            threadTsMap.delete(threadId);
          }
          setSubAgents((prev) => {
            const idx = prev.findIndex((s) => s.id === subAgentId);
            if (idx < 0 || prev[idx].status === "done") return prev;
            const next = [...prev];
            next[idx] = { ...prev[idx], status: "done" as const };
            return next;
          });
        };
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line[0] !== "{") continue;
          if (!shouldParseCliChunkForSubAgents(line)) continue;
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (!json) continue;
          const events = parseCliSubAgentEvents(json);
          for (const event of events) {
            if (event.kind === "spawn") {
              upsertSubAgent(event.id, event.task);
              continue;
            }
            if (event.kind === "done") {
              markSubAgentDone(event.id);
              continue;
            }
            if (event.kind === "bind_thread") {
              threadMap.set(event.threadId, event.subAgentId);
              threadTsMap.set(event.threadId, now);
              if (threadMap.size > MAX_CODEX_THREAD_BINDINGS) {
                pruneCodexThreadBindings(now);
              }
              continue;
            }
            const mappedSubAgentId = threadMap.get(event.threadId);
            if (!mappedSubAgentId) continue;
            threadMap.delete(event.threadId);
            threadTsMap.delete(event.threadId);
            markSubAgentDone(mappedSubAgentId);
          }
        }
      }),
      on("chat_stream", (payload: unknown) => {
        const p = payload as {
          phase: "start" | "delta" | "end";
          message_id: string;
          agent_id: string;
          agent_name?: string;
          agent_avatar?: string;
          text?: string;
          content?: string;
          created_at?: number;
        };
        if (p.phase === "start") {
          setStreamingMessage({
            message_id: p.message_id,
            agent_id: p.agent_id,
            agent_name: p.agent_name ?? "",
            agent_avatar: p.agent_avatar ?? "",
            content: "",
          });
        } else if (p.phase === "delta") {
          setStreamingMessage((prev) => {
            if (!prev || prev.message_id !== p.message_id) return prev;
            return { ...prev, content: prev.content + (p.text ?? "") };
          });
        } else if (p.phase === "end") {
          setStreamingMessage(null);
          // end 이벤트에는 DB에 저장된 최종 메시지가 new_message로 별도 전달됨
          // 만약 new_message가 안 오는 경우를 대비해 직접 추가
          if (p.content && p.message_id) {
            const finalMsg: Message = {
              id: p.message_id,
              sender_type: "agent",
              sender_id: p.agent_id,
              receiver_type: "agent",
              receiver_id: null,
              content: p.content,
              message_type: "chat",
              task_id: null,
              created_at: p.created_at ?? Date.now(),
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === finalMsg.id)) return prev;
              return appendCapped(prev, finalMsg, MAX_LIVE_MESSAGES);
            });
          }
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [on, scheduleLiveSync]);

  // Polling for fresh data every 5 seconds (paused when tab is hidden)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    function start() { timer = setInterval(() => scheduleLiveSync(0), 5000); }
    function handleVisibility() {
      clearInterval(timer);
      if (!document.hidden) {
        scheduleLiveSync(0);
        start();
      }
    }
    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [scheduleLiveSync]);

  const activeMeetingTaskId = useMemo(() => {
    const now = Date.now();
    const counts = new Map<string, number>();
    for (const row of meetingPresence) {
      if (row.until < now || !row.task_id) continue;
      counts.set(row.task_id, (counts.get(row.task_id) ?? 0) + 1);
    }
    let picked: string | null = null;
    let maxCount = -1;
    for (const [taskId, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        picked = taskId;
      }
    }
    return picked;
  }, [meetingPresence]);

  // Handlers
  type ProjectMetaPayload = {
    project_id?: string;
    project_path?: string;
    project_context?: string;
  };

  async function handleSendMessage(
    content: string,
    receiverType: "agent" | "department" | "all",
    receiverId?: string,
    messageType?: string,
    projectMeta?: ProjectMetaPayload
  ) {
    try {
      await api.sendMessage({
        receiver_type: receiverType,
        receiver_id: receiverId,
        content,
        message_type: (messageType as "chat" | "task_assign" | "report") || "chat",
        project_id: projectMeta?.project_id,
        project_path: projectMeta?.project_path,
        project_context: projectMeta?.project_context,
      });
      // Refresh messages
      const msgs = await api.getMessages({
        receiver_type: receiverType,
        receiver_id: receiverId,
        limit: 50,
      });
      setMessages(msgs);
    } catch (e) {
      console.error("Send message failed:", e);
    }
  }

  async function handleSendAnnouncement(content: string) {
    try {
      await api.sendAnnouncement(content);
    } catch (e) {
      console.error("Announcement failed:", e);
    }
  }

  async function handleSendDirective(content: string, projectMeta?: ProjectMetaPayload) {
    try {
      if (projectMeta?.project_id || projectMeta?.project_path || projectMeta?.project_context) {
        await api.sendDirectiveWithProject({
          content,
          project_id: projectMeta.project_id,
          project_path: projectMeta.project_path,
          project_context: projectMeta.project_context,
        });
      } else {
        await api.sendDirective(content);
      }
    } catch (e) {
      console.error("Directive failed:", e);
    }
  }

  async function handleCreateTask(input: {
    title: string;
    description?: string;
    department_id?: string;
    task_type?: string;
    priority?: number;
    project_id?: string;
    project_path?: string;
    assigned_agent_id?: string;
  }) {
    try {
      await api.createTask(input as Parameters<typeof api.createTask>[0]);
      const tks = await api.getTasks();
      setTasks(tks);
      const sts = await api.getStats();
      setStats(sts);
    } catch (e) {
      console.error("Create task failed:", e);
    }
  }

  async function handleUpdateTask(id: string, data: Partial<Task>) {
    try {
      await api.updateTask(id, data);
      const tks = await api.getTasks();
      setTasks(tks);
    } catch (e) {
      console.error("Update task failed:", e);
    }
  }

  async function handleDeleteTask(id: string) {
    try {
      await api.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      console.error("Delete task failed:", e);
    }
  }

  async function handleAssignTask(taskId: string, agentId: string) {
    try {
      await api.assignTask(taskId, agentId);
      const [tks, ags] = await Promise.all([api.getTasks(), api.getAgents()]);
      setTasks(tks);
      setAgents(ags);
    } catch (e) {
      console.error("Assign task failed:", e);
    }
  }

  async function handleRunTask(id: string) {
    try {
      await api.runTask(id);
      const [tks, ags] = await Promise.all([api.getTasks(), api.getAgents()]);
      setTasks(tks);
      setAgents(ags);
    } catch (e) {
      console.error("Run task failed:", e);
    }
  }

  async function handleStopTask(id: string) {
    try {
      await api.stopTask(id);
      const [tks, ags] = await Promise.all([api.getTasks(), api.getAgents()]);
      setTasks(tks);
      setAgents(ags);
    } catch (e) {
      console.error("Stop task failed:", e);
    }
  }

  async function handlePauseTask(id: string) {
    try {
      await api.pauseTask(id);
      const [tks, ags] = await Promise.all([api.getTasks(), api.getAgents()]);
      setTasks(tks);
      setAgents(ags);
    } catch (e) {
      console.error("Pause task failed:", e);
    }
  }

  async function handleResumeTask(id: string) {
    try {
      await api.resumeTask(id);
      const [tks, ags] = await Promise.all([api.getTasks(), api.getAgents()]);
      setTasks(tks);
      setAgents(ags);
    } catch (e) {
      console.error("Resume task failed:", e);
    }
  }

  async function handleSaveSettings(s: CompanySettings) {
    try {
      const nextSettings = mergeSettingsWithDefaults(s);
      const autoUpdateChanged =
        Boolean(nextSettings.autoUpdateEnabled) !== Boolean(settings.autoUpdateEnabled);
      await api.saveSettings(nextSettings);
      if (autoUpdateChanged) {
        try {
          await api.setAutoUpdateEnabled(Boolean(nextSettings.autoUpdateEnabled));
        } catch (syncErr) {
          console.error("Auto update runtime sync failed:", syncErr);
        }
      }
      setSettings(nextSettings);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LANGUAGE_USER_SET_STORAGE_KEY, "1");
      }
      syncClientLanguage(nextSettings.language);
    } catch (e) {
      console.error("Save settings failed:", e);
    }
  }

  async function handleDismissAutoUpdateNotice() {
    if (!settings.autoUpdateNoticePending) return;
    setSettings((prev) => ({ ...prev, autoUpdateNoticePending: false }));
    try {
      await api.saveSettingsPatch({ autoUpdateNoticePending: false });
    } catch (err) {
      console.error("Failed to persist auto-update notice dismissal:", err);
    }
  }

  function handleOpenChat(agent: Agent) {
    setChatAgent(agent);
    setShowChat(true);
    // Clear unread for this agent
    setUnreadAgentIds((prev) => {
      if (!prev.has(agent.id)) return prev;
      const next = new Set(prev);
      next.delete(agent.id);
      return next;
    });
    // Fetch messages for this agent
    api
      .getMessages({ receiver_type: "agent", receiver_id: agent.id, limit: 50 })
      .then(setMessages)
      .catch(console.error);
  }

  const mapWorkflowDecisionItems = useCallback((items: api.DecisionInboxRouteItem[]): DecisionInboxItem[] => {
    const locale = normalizeLanguage(settings.language);
    const optionLabel = (kind: DecisionInboxItem["kind"], action: string, number: number): string => {
      if (kind === "project_review_ready") {
        if (action === "start_project_review") {
          return pickLang(locale, {
            ko: "팀장 회의 진행",
            en: "Start Team-Lead Meeting",
            ja: "チームリーダー会議を進行",
            zh: "启动组长评审会议",
          });
        }
        if (action === "keep_waiting") {
          return pickLang(locale, {
            ko: "대기 유지",
            en: "Keep Waiting",
            ja: "待機維持",
            zh: "保持等待",
          });
        }
        if (action === "add_followup_request") {
          return pickLang(locale, {
            ko: "추가요청 입력",
            en: "Add Follow-up Request",
            ja: "追加要請を入力",
            zh: "输入追加请求",
          });
        }
      }
      if (kind === "task_timeout_resume") {
        if (action === "resume_timeout_task") {
          return pickLang(locale, {
            ko: "이어서 진행 (재개)",
            en: "Resume Task",
            ja: "続行する",
            zh: "继续执行",
          });
        }
        if (action === "keep_inbox") {
          return pickLang(locale, {
            ko: "Inbox 유지",
            en: "Keep in Inbox",
            ja: "Inboxで保留",
            zh: "保留在 Inbox",
          });
        }
      }
      if (kind === "review_round_pick") {
        if (action === "skip_to_next_round") {
          return pickLang(locale, {
            ko: "다음 라운드로 SKIP",
            en: "Skip to Next Round",
            ja: "次ラウンドへスキップ",
            zh: "跳到下一轮",
          });
        }
      }
      return `${number}. ${action}`;
    };

    return items.map((item) => ({
      id: item.id,
      kind: item.kind,
      agentId: item.agent_id ?? null,
      agentName: item.agent_name
        || (item.kind === "project_review_ready"
          ? (item.project_name || item.project_id || "Planning Lead")
          : (item.task_title || item.task_id || "Task")),
      agentNameKo: item.agent_name_ko
        || item.agent_name
        || (item.kind === "project_review_ready"
          ? (item.project_name || item.project_id || "기획팀장")
          : (item.task_title || item.task_id || "작업")),
      agentAvatar: item.agent_avatar ?? ((item.kind === "project_review_ready" || item.kind === "review_round_pick") ? "🧑‍💼" : null),
      requestContent: item.summary,
      options: item.options.map((option) => ({
        number: option.number,
        label: option.label ?? optionLabel(item.kind, option.action, option.number),
        action: option.action,
      })),
      createdAt: item.created_at,
      taskId: item.task_id,
      projectId: item.project_id,
      projectName: item.project_name,
    }));
  }, [settings.language]);

  const loadDecisionInbox = useCallback(async () => {
    setDecisionInboxLoading(true);
    try {
      const [allMessages, workflowDecisionItems] = await Promise.all([
        api.getMessages({ limit: 500 }),
        api.getDecisionInbox(),
      ]);
      const agentDecisionItems = buildDecisionInboxItems(allMessages, agents);
      const workflowItems = mapWorkflowDecisionItems(workflowDecisionItems);
      const merged = [...workflowItems, ...agentDecisionItems];
      const deduped = new Map<string, DecisionInboxItem>();
      for (const item of merged) deduped.set(item.id, item);
      setDecisionInboxItems(Array.from(deduped.values()).sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error("Load decision inbox failed:", error);
    } finally {
      setDecisionInboxLoading(false);
    }
  }, [agents, mapWorkflowDecisionItems]);

  const handleOpenDecisionInbox = useCallback(() => {
    setShowDecisionInbox(true);
    void loadDecisionInbox();
  }, [loadDecisionInbox]);

  const handleOpenDecisionChat = useCallback((agentId: string) => {
    const matchedAgent = agents.find((agent) => agent.id === agentId);
    if (!matchedAgent) {
      window.alert(pickLang(normalizeLanguage(settings.language), {
        ko: "요청 에이전트 정보를 찾지 못했습니다.",
        en: "Could not find the requested agent.",
        ja: "対象エージェント情報が見つかりません。",
        zh: "未找到对应代理信息。",
      }));
      return;
    }
    setShowDecisionInbox(false);
    handleOpenChat(matchedAgent);
  }, [agents, settings.language]);

  const handleReplyDecisionOption = useCallback(async (
    item: DecisionInboxItem,
    optionNumber: number,
    payloadInput?: { note?: string; selected_option_numbers?: number[] },
  ) => {
    const option = item.options.find((entry) => entry.number === optionNumber);
    if (!option) return;
    const busyKey = `${item.id}:${option.number}`;
    setDecisionReplyBusyKey(busyKey);
    const locale = normalizeLanguage(settings.language);
    try {
      if (item.kind === "agent_request") {
        if (!item.agentId) return;
        const replyContent = pickLang(locale, {
          ko: `[의사결정 회신] ${option.number}번으로 진행해 주세요. (${option.label})`,
          en: `[Decision Reply] Please proceed with option ${option.number}. (${option.label})`,
          ja: `[意思決定返信] ${option.number}番で進めてください。(${option.label})`,
          zh: `[决策回复] 请按选项 ${option.number} 推进。（${option.label}）`,
        });
        await api.sendMessage({
          receiver_type: "agent",
          receiver_id: item.agentId,
          content: replyContent,
          message_type: "chat",
          task_id: item.taskId ?? undefined,
        });
        setDecisionInboxItems((prev) => prev.filter((entry) => entry.id !== item.id));
      } else {
        const selectedAction = option.action ?? "";
        let payload: { note?: string; target_task_id?: string; selected_option_numbers?: number[] } | undefined;
        if (selectedAction === "add_followup_request") {
          const note = payloadInput?.note?.trim() ?? "";
          if (!note) {
            window.alert(pickLang(locale, {
              ko: "추가요청사항이 비어 있습니다.",
              en: "Additional request is empty.",
              ja: "追加要請が空です。",
              zh: "追加请求内容为空。",
            }));
            return;
          }
          payload = {
            note,
            ...(item.taskId ? { target_task_id: item.taskId } : {}),
          };
        } else if (item.kind === "review_round_pick") {
          const selectedOptionNumbers = payloadInput?.selected_option_numbers;
          const note = payloadInput?.note?.trim() ?? "";
          payload = {
            ...(note ? { note } : {}),
            ...(Array.isArray(selectedOptionNumbers) ? { selected_option_numbers: selectedOptionNumbers } : {}),
          };
        }
        const replyResult = await api.replyDecisionInbox(item.id, optionNumber, payload);
        if (replyResult.resolved) {
          setDecisionInboxItems((prev) => prev.filter((entry) => entry.id !== item.id));
          scheduleLiveSync(40);
        }
        await loadDecisionInbox();
      }
    } catch (error) {
      console.error("Decision reply failed:", error);
      window.alert(pickLang(locale, {
        ko: "의사결정 회신 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        en: "Failed to send decision reply. Please try again.",
        ja: "意思決定返信の送信に失敗しました。もう一度お試しください。",
        zh: "发送决策回复失败，请稍后重试。",
      }));
    } finally {
      setDecisionReplyBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }, [settings.language, loadDecisionInbox, scheduleLiveSync]);

  const uiLanguage = normalizeLanguage(settings.language);
  const loadingTitle = pickLang(uiLanguage, {
    ko: "Claw-Empire 로딩 중...",
    en: "Loading Claw-Empire...",
    ja: "Claw-Empireを読み込み中...",
    zh: "Claw-Empire 加载中...",
  });
  const loadingSubtitle = pickLang(uiLanguage, {
    ko: "AI 에이전트 제국을 준비하고 있습니다",
    en: "Preparing your AI agent empire",
    ja: "AIエージェント帝国を準備しています",
    zh: "正在准备你的 AI 代理帝国",
  });
  const viewTitle = (() => {
    switch (view) {
      case "office":
        return `🏢 ${pickLang(uiLanguage, {
          ko: "오피스",
          en: "Office",
          ja: "オフィス",
          zh: "办公室",
        })}`;
      case "dashboard":
        return `📊 ${pickLang(uiLanguage, {
          ko: "대시보드",
          en: "Dashboard",
          ja: "ダッシュボード",
          zh: "仪表盘",
        })}`;
      case "tasks":
        return `📋 ${pickLang(uiLanguage, {
          ko: "업무 관리",
          en: "Tasks",
          ja: "タスク管理",
          zh: "任务管理",
        })}`;
      case "skills":
        return `📚 ${pickLang(uiLanguage, {
          ko: "문서고",
          en: "Skills",
          ja: "スキル資料室",
          zh: "技能库",
        })}`;
      case "settings":
        return `⚙️ ${pickLang(uiLanguage, {
          ko: "설정",
          en: "Settings",
          ja: "設定",
          zh: "设置",
        })}`;
      default:
        return "";
    }
  })();
  const announcementLabel = `📢 ${pickLang(uiLanguage, {
    ko: "전사 공지",
    en: "Announcement",
    ja: "全社告知",
    zh: "全员公告",
  })}`;
  const roomManagerLabel = `🏢 ${pickLang(uiLanguage, {
    ko: "사무실 관리",
    en: "Office Manager",
    ja: "オフィス管理",
    zh: "办公室管理",
  })}`;
  const roomManagerDepartments = useMemo(
    () => [
      {
        id: "ceoOffice",
        name: pickLang(uiLanguage, {
          ko: "CEO 오피스",
          en: "CEO Office",
          ja: "CEOオフィス",
          zh: "CEO办公室",
        }),
      },
      ...departments,
      {
        id: "breakRoom",
        name: pickLang(uiLanguage, {
          ko: "휴게실",
          en: "Break Room",
          ja: "休憩室",
          zh: "休息室",
        }),
      },
    ],
    [departments, uiLanguage]
  );
  const reportLabel = `📋 ${pickLang(uiLanguage, {
    ko: "보고서",
    en: "Reports",
    ja: "レポート",
    zh: "报告",
  })}`;
  const tasksPrimaryLabel = pickLang(uiLanguage, {
    ko: "업무",
    en: "Tasks",
    ja: "タスク",
    zh: "任务",
  });
  const agentStatusLabel = pickLang(uiLanguage, {
    ko: "에이전트",
    en: "Agents",
    ja: "エージェント",
    zh: "代理",
  });
  const decisionLabel = pickLang(uiLanguage, {
    ko: "의사결정",
    en: "Decisions",
    ja: "意思決定",
    zh: "决策",
  });
  const effectiveUpdateStatus = forceUpdateBanner
    ? {
        current_version: updateStatus?.current_version ?? "1.1.0",
        latest_version: updateStatus?.latest_version ?? "1.1.1-test",
        update_available: true,
        release_url: updateStatus?.release_url ?? "https://github.com/GreenSheep01201/claw-empire/releases/latest",
        checked_at: Date.now(),
        enabled: true,
        repo: updateStatus?.repo ?? "GreenSheep01201/claw-empire",
        error: null,
      }
    : updateStatus;
  const updateBannerVisible = Boolean(
    effectiveUpdateStatus?.enabled &&
    effectiveUpdateStatus.update_available &&
    effectiveUpdateStatus.latest_version &&
    (forceUpdateBanner || effectiveUpdateStatus.latest_version !== dismissedUpdateVersion)
  );
  const updateReleaseUrl = effectiveUpdateStatus?.release_url
    ?? `https://github.com/${effectiveUpdateStatus?.repo ?? "GreenSheep01201/claw-empire"}/releases/latest`;
  const updateTitle = updateBannerVisible
    ? pickLang(uiLanguage, {
        ko: `새 버전 v${effectiveUpdateStatus?.latest_version} 사용 가능 (현재 v${effectiveUpdateStatus?.current_version}).`,
        en: `New version v${effectiveUpdateStatus?.latest_version} is available (current v${effectiveUpdateStatus?.current_version}).`,
        ja: `新しいバージョン v${effectiveUpdateStatus?.latest_version} が利用可能です（現在 v${effectiveUpdateStatus?.current_version}）。`,
        zh: `发现新版本 v${effectiveUpdateStatus?.latest_version}（当前 v${effectiveUpdateStatus?.current_version}）。`,
      })
    : "";
  const updateHint = runtimeOs === "windows"
    ? pickLang(uiLanguage, {
        ko: "Windows PowerShell에서 `git pull; pnpm install` 실행 후 서버를 재시작하세요.",
        en: "In Windows PowerShell, run `git pull; pnpm install`, then restart the server.",
        ja: "Windows PowerShell で `git pull; pnpm install` を実行し、サーバーを再起動してください。",
        zh: "在 Windows PowerShell 中执行 `git pull; pnpm install`，然后重启服务。",
      })
    : pickLang(uiLanguage, {
        ko: "macOS/Linux에서 `git pull && pnpm install` 실행 후 서버를 재시작하세요.",
        en: "On macOS/Linux, run `git pull && pnpm install`, then restart the server.",
        ja: "macOS/Linux で `git pull && pnpm install` を実行し、サーバーを再起動してください。",
        zh: "在 macOS/Linux 上执行 `git pull && pnpm install`，然后重启服务。",
      });
  const updateReleaseLabel = pickLang(uiLanguage, {
    ko: "릴리즈 노트",
    en: "Release Notes",
    ja: "リリースノート",
    zh: "发布说明",
  });
  const updateDismissLabel = pickLang(uiLanguage, {
    ko: "나중에",
    en: "Dismiss",
    ja: "後で",
    zh: "稍后",
  });
  const autoUpdateNoticeVisible = Boolean(settings.autoUpdateNoticePending);
  const autoUpdateNoticeTitle = pickLang(uiLanguage, {
    ko: "업데이트 안내: 자동 업데이트 토글이 추가되었습니다.",
    en: "Update notice: Auto Update toggle has been added.",
    ja: "更新のお知らせ: Auto Update トグルが追加されました。",
    zh: "更新提示：已新增 Auto Update 开关。",
  });
  const autoUpdateNoticeHint = pickLang(uiLanguage, {
    ko: "기존 설치(1.1.3 이하)에서는 기본값이 OFF입니다. Settings > General에서 필요 시 ON으로 전환할 수 있습니다.",
    en: "For existing installs (v1.1.3 and below), the default remains OFF. You can enable it in Settings > General when needed.",
    ja: "既存インストール（v1.1.3 以下）では既定値は OFF のままです。必要に応じて Settings > General で ON にできます。",
    zh: "对于现有安装（v1.1.3 及以下），默认仍为 OFF。可在 Settings > General 中按需开启。",
  });
  const autoUpdateNoticeActionLabel = pickLang(uiLanguage, {
    ko: "확인",
    en: "Got it",
    ja: "確認",
    zh: "知道了",
  });
  const autoUpdateNoticeContainerClass = theme === "light"
    ? "border-b border-sky-200 bg-sky-50 px-3 py-2.5 sm:px-4 lg:px-6"
    : "border-b border-sky-500/30 bg-sky-500/10 px-3 py-2.5 sm:px-4 lg:px-6";
  const autoUpdateNoticeTextClass = theme === "light"
    ? "min-w-0 text-xs text-sky-900"
    : "min-w-0 text-xs text-sky-100";
  const autoUpdateNoticeHintClass = theme === "light"
    ? "mt-0.5 text-[11px] text-sky-800"
    : "mt-0.5 text-[11px] text-sky-200/90";
  const autoUpdateNoticeButtonClass = theme === "light"
    ? "rounded-md border border-sky-300 bg-white px-2.5 py-1 text-[11px] text-sky-900 transition hover:bg-sky-100"
    : "rounded-md border border-sky-300/40 bg-sky-200/10 px-2.5 py-1 text-[11px] text-sky-100 transition hover:bg-sky-200/20";
  const updateTestModeHint = forceUpdateBanner
    ? pickLang(uiLanguage, {
        ko: "테스트 표시 모드입니다. `?force_update_banner=1`을 제거하면 원래 상태로 돌아갑니다.",
        en: "Test display mode is on. Remove `?force_update_banner=1` to return to normal behavior.",
        ja: "テスト表示モードです。`?force_update_banner=1` を外すと通常動作に戻ります。",
        zh: "当前为测试显示模式。移除 `?force_update_banner=1` 即可恢复正常行为。",
      })
    : "";

  if (loading) {
    return (
      <I18nProvider language={uiLanguage}>
        <div className="h-screen flex items-center justify-center" style={{ background: 'var(--th-bg-primary)' }}>
          <div className="text-center">
            <div className="text-5xl mb-4 animate-agent-bounce">🏢</div>
            <div className="text-lg font-medium" style={{ color: 'var(--th-text-secondary)' }}>
              {loadingTitle}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--th-text-muted)' }}>
              {loadingSubtitle}
            </div>
          </div>
        </div>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={uiLanguage}>
      <div className="app-shell flex h-[100dvh] min-h-[100dvh] overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex lg:flex-shrink-0">
          <Sidebar
            currentView={view}
            onChangeView={setView}
            departments={departments}
            agents={agents}
            settings={settings}
            connected={connected}
          />
        </div>

        {/* Mobile Sidebar Overlay */}
        {mobileNavOpen && (
          <button
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <div
          className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:hidden ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
          }`}
        >
          <Sidebar
            currentView={view}
            onChangeView={(nextView) => {
              setView(nextView);
              setMobileNavOpen(false);
            }}
            departments={departments}
            agents={agents}
            settings={settings}
            connected={connected}
          />
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          {/* Top Bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between px-3 py-2 backdrop-blur-sm sm:px-4 sm:py-3 lg:px-6" style={{ borderBottom: '1px solid var(--th-border)', background: 'var(--th-bg-header)' }}>
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition lg:hidden"
                style={{ border: '1px solid var(--th-border)', background: 'var(--th-bg-surface)', color: 'var(--th-text-secondary)' }}
                aria-label="Open navigation"
              >
                ☰
              </button>
              <h1 className="truncate text-base font-bold sm:text-lg" style={{ color: 'var(--th-text-heading)' }}>{viewTitle}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setView("tasks")}
                className="header-action-btn header-action-btn-primary"
                aria-label={tasksPrimaryLabel}
              >
                <span className="sm:hidden">📋</span>
                <span className="hidden sm:inline">📋 {tasksPrimaryLabel}</span>
              </button>
              <button
                onClick={handleOpenDecisionInbox}
                disabled={decisionInboxLoading}
                className={`header-action-btn header-action-btn-secondary disabled:cursor-wait disabled:opacity-60${decisionInboxItems.length > 0 ? " decision-has-pending" : ""}`}
                aria-label={decisionLabel}
              >
                <span className="sm:hidden">{decisionInboxLoading ? "⏳" : "🧭"}</span>
                <span className="hidden sm:inline">
                  {decisionInboxLoading ? "⏳" : "🧭"} {decisionLabel}
                </span>
                {decisionInboxItems.length > 0 && (
                  <span className="header-decision-badge">{decisionInboxItems.length}</span>
                )}
              </button>
              {/* Desktop: show all buttons inline (hidden on mobile via CSS) */}
              <button
                onClick={() => setShowAgentStatus(true)}
                className="header-action-btn header-action-btn-secondary mobile-hidden"
              >
                &#x1F6E0; {agentStatusLabel}
              </button>
              <button
                onClick={() => setShowReportHistory(true)}
                className="header-action-btn header-action-btn-secondary mobile-hidden"
              >
                {reportLabel}
              </button>
              <button
                onClick={() => {
                  setChatAgent(null);
                  setShowChat(true);
                  api
                    .getMessages({ receiver_type: "all", limit: 50 })
                    .then(setMessages)
                    .catch(console.error);
                }}
                className="header-action-btn header-action-btn-secondary"
              >
                <span className="sm:hidden">📢</span>
                <span className="hidden sm:inline">{announcementLabel}</span>
              </button>
              <button
                onClick={() => setShowRoomManager(true)}
                className="header-action-btn header-action-btn-secondary mobile-hidden"
              >
                {roomManagerLabel}
              </button>
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="theme-toggle-btn"
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={theme === "dark" ? "라이트 모드" : "다크 모드"}
              >
                <span className="theme-toggle-icon">
                  {theme === "dark" ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  )}
                </span>
              </button>
              {/* Mobile: hamburger menu for secondary actions */}
              <div className="relative sm:hidden">
                <button
                  onClick={() => setMobileHeaderMenuOpen(!mobileHeaderMenuOpen)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition"
                  style={{ border: '1px solid var(--th-border)', background: 'var(--th-bg-surface)', color: 'var(--th-text-secondary)' }}
                  aria-label="더보기 메뉴"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="1" />
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="12" cy="19" r="1" />
                  </svg>
                </button>
                {mobileHeaderMenuOpen && (
                  <>
                    <button
                      className="fixed inset-0 z-40"
                      onClick={() => setMobileHeaderMenuOpen(false)}
                      aria-label="Close menu"
                    />
                    <div
                      className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg py-1 shadow-lg"
                      style={{ border: '1px solid var(--th-border)', background: 'var(--th-bg-surface)' }}
                    >
                      <button
                        onClick={() => { setShowAgentStatus(true); setMobileHeaderMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:opacity-80"
                        style={{ color: 'var(--th-text-primary)' }}
                      >
                        &#x1F6E0; {agentStatusLabel}
                      </button>
                      <button
                        onClick={() => { setShowReportHistory(true); setMobileHeaderMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:opacity-80"
                        style={{ color: 'var(--th-text-primary)' }}
                      >
                        {reportLabel}
                      </button>
                      <button
                        onClick={() => { setShowRoomManager(true); setMobileHeaderMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:opacity-80"
                        style={{ color: 'var(--th-text-primary)' }}
                      >
                        {roomManagerLabel}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--th-text-muted)' }}>
                <div
                  className={`w-2 h-2 rounded-full ${
                    connected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="hidden sm:inline">{connected ? "Live" : "Offline"}</span>
              </div>
            </div>
          </header>

          {autoUpdateNoticeVisible && (
            <div className={autoUpdateNoticeContainerClass}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className={autoUpdateNoticeTextClass}>
                  <div className="font-medium">{autoUpdateNoticeTitle}</div>
                  <div className={autoUpdateNoticeHintClass}>{autoUpdateNoticeHint}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleDismissAutoUpdateNotice();
                    }}
                    className={autoUpdateNoticeButtonClass}
                  >
                    {autoUpdateNoticeActionLabel}
                  </button>
                </div>
              </div>
            </div>
          )}

          {updateBannerVisible && effectiveUpdateStatus && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2.5 sm:px-4 lg:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs text-amber-100">
                  <div className="font-medium">{updateTitle}</div>
                  <div className="mt-0.5 text-[11px] text-amber-200/90">{updateHint}</div>
                  {updateTestModeHint && (
                    <div className="mt-0.5 text-[11px] text-amber-300/90">{updateTestModeHint}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={updateReleaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-amber-300/40 bg-amber-200/10 px-2.5 py-1 text-[11px] text-amber-100 transition hover:bg-amber-200/20"
                  >
                    {updateReleaseLabel}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const latest = effectiveUpdateStatus.latest_version ?? "";
                      setDismissedUpdateVersion(latest);
                      if (typeof window !== "undefined") {
                        window.localStorage.setItem(UPDATE_BANNER_DISMISS_STORAGE_KEY, latest);
                      }
                    }}
                    className="rounded-md border border-slate-500/40 bg-slate-700/30 px-2.5 py-1 text-[11px] text-slate-100 transition hover:bg-slate-700/50"
                  >
                    {updateDismissLabel}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Views */}
          <div className="p-3 sm:p-4 lg:p-6">
            {view === "office" && (
              <OfficeView
                departments={departments}
                agents={agents}
                tasks={tasks}
                subAgents={subAgents}
                meetingPresence={meetingPresence}
                activeMeetingTaskId={activeMeetingTaskId}
                unreadAgentIds={unreadAgentIds}
                crossDeptDeliveries={crossDeptDeliveries}
                onCrossDeptDeliveryProcessed={(id) =>
                  setCrossDeptDeliveries((prev) => prev.filter((d) => d.id !== id))
                }
                ceoOfficeCalls={ceoOfficeCalls}
                onCeoOfficeCallProcessed={(id) =>
                  setCeoOfficeCalls((prev) => prev.filter((d) => d.id !== id))
                }
                onOpenActiveMeetingMinutes={(taskId) =>
                  setTaskPanel({ taskId, tab: "minutes" })
                }
                customDeptThemes={customRoomThemes}
                themeHighlightTargetId={activeRoomThemeTargetId}
                onSelectAgent={(a) => setSelectedAgent(a)}
                onSelectDepartment={(dept) => {
                  const leader = agents.find(
                    (a) => a.department_id === dept.id && a.role === "team_leader"
                  );
                  if (leader) {
                    handleOpenChat(leader);
                  }
                }}
              />
            )}

            {view === "dashboard" && (
              <Dashboard
                stats={stats}
                agents={agents}
                tasks={tasks}
                companyName={settings.companyName}
                onPrimaryCtaClick={() => setView("tasks")}
              />
            )}

            {view === "tasks" && (
              <TaskBoard
                tasks={tasks}
                agents={agents}
                departments={departments}
                subtasks={subtasks}
                onCreateTask={handleCreateTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onAssignTask={handleAssignTask}
                onRunTask={handleRunTask}
                onStopTask={handleStopTask}
                onPauseTask={handlePauseTask}
                onResumeTask={handleResumeTask}
                onOpenTerminal={(id) => setTaskPanel({ taskId: id, tab: "terminal" })}
                onOpenMeetingMinutes={(id) => setTaskPanel({ taskId: id, tab: "minutes" })}
              />
            )}

            {view === "agents" && (
              <AgentManager
                agents={agents}
                departments={departments}
                onAgentsChange={() => {
                  api.getAgents().then(setAgents).catch(console.error);
                  api.getDepartments().then(setDepartments).catch(console.error);
                  api.getTasks().then(setTasks).catch(console.error);
                }}
              />
            )}

            {view === "skills" && <SkillsLibrary agents={agents} />}

            {view === "settings" && (
              <SettingsPanel
                settings={settings}
                cliStatus={cliStatus}
                onSave={handleSaveSettings}
                onRefreshCli={() =>
                  api.getCliStatus(true).then(setCliStatus).catch(console.error)
                }
                oauthResult={oauthResult}
                onOauthResultClear={() => setOauthResult(null)}
              />
            )}
          </div>
        </main>

        {/* Chat Panel (slide-in) */}
        {showChat && (
          <ChatPanel
            selectedAgent={chatAgent}
            messages={messages}
            agents={agents}
            streamingMessage={streamingMessage}
            onSendMessage={handleSendMessage}
            onSendAnnouncement={handleSendAnnouncement}
            onSendDirective={handleSendDirective}
            onClearMessages={async (agentId) => {
              try {
                await api.clearMessages(agentId);
                setMessages([]);
              } catch (e) {
                console.error("Clear messages failed:", e);
              }
            }}
            onClose={() => setShowChat(false)}
          />
        )}

        {showDecisionInbox && (
          <DecisionInboxModal
            open={showDecisionInbox}
            loading={decisionInboxLoading}
            items={decisionInboxItems}
            agents={agents}
            busyKey={decisionReplyBusyKey}
            uiLanguage={uiLanguage}
            onClose={() => setShowDecisionInbox(false)}
            onRefresh={() => { void loadDecisionInbox(); }}
            onReplyOption={handleReplyDecisionOption}
            onOpenChat={handleOpenDecisionChat}
          />
        )}

        {/* Agent Detail Modal */}
        {selectedAgent && (
          <AgentDetail
            agent={selectedAgent}
            agents={agents}
            department={departments.find(
              (d) => d.id === selectedAgent.department_id
            )}
            departments={departments}
            tasks={tasks}
            subAgents={subAgents}
            subtasks={subtasks}
            onClose={() => setSelectedAgent(null)}
            onChat={(a) => {
              setSelectedAgent(null);
              handleOpenChat(a);
            }}
            onAssignTask={() => {
              setSelectedAgent(null);
              setView("tasks");
            }}
            onOpenTerminal={(id) => {
              setSelectedAgent(null);
              setTaskPanel({ taskId: id, tab: "terminal" });
            }}
            onAgentUpdated={() => {
              api.getAgents().then((ags) => {
                setAgents(ags);
                // Refresh selected agent with updated data
                if (selectedAgent) {
                  const updated = ags.find(a => a.id === selectedAgent.id);
                  if (updated) setSelectedAgent(updated);
                }
              }).catch(console.error);
            }}
          />
        )}

        {/* Terminal Panel (slide-in from right) */}
        {taskPanel && (
          <TerminalPanel
            taskId={taskPanel.taskId}
            initialTab={taskPanel.tab}
            task={tasks.find((t) => t.id === taskPanel.taskId)}
            agent={agents.find(
              (a) =>
                a.current_task_id === taskPanel.taskId ||
                tasks.find((t) => t.id === taskPanel.taskId)?.assigned_agent_id === a.id
            )}
            agents={agents}
            onClose={() => setTaskPanel(null)}
          />
        )}

        {/* Task Report Popup (auto-shows on task completion) */}
        {taskReport && (
          <TaskReportPopup
            report={taskReport}
            agents={agents}
            uiLanguage={uiLanguage}
            onClose={() => setTaskReport(null)}
          />
        )}

        {/* Report History Modal */}
        {showReportHistory && (
          <ReportHistory
            agents={agents}
            uiLanguage={uiLanguage}
            onClose={() => setShowReportHistory(false)}
          />
        )}

        {/* Agent Status Panel */}
        {showAgentStatus && (
          <AgentStatusPanel
            agents={agents}
            uiLanguage={uiLanguage}
            onClose={() => setShowAgentStatus(false)}
          />
        )}

        {/* Office Room Manager */}
        {showRoomManager && (
          <OfficeRoomManager
            departments={roomManagerDepartments}
            customThemes={customRoomThemes}
            onActiveDeptChange={setActiveRoomThemeTargetId}
            onThemeChange={(themes) => {
              setCustomRoomThemes(themes);
              hasLocalRoomThemesRef.current = true;
              try {
                window.localStorage.setItem(ROOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
              } catch { /* ignore quota errors */ }
              api.saveRoomThemes(themes).catch((error) => {
                console.error("Save room themes failed:", error);
              });
            }}
            onClose={() => {
              setShowRoomManager(false);
              setActiveRoomThemeTargetId(null);
            }}
            language={uiLanguage}
          />
        )}
      </div>
    </I18nProvider>
  );
}
