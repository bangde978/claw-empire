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
import TaskReportPopup from "./components/TaskReportPopup";
import ReportHistory from "./components/ReportHistory";
import AgentStatusPanel from "./components/AgentStatusPanel";
import OfficeRoomManager from "./components/OfficeRoomManager";
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

type View = "office" | "dashboard" | "tasks" | "skills" | "settings";
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
const UPDATE_BANNER_DISMISS_STORAGE_KEY = "climpire_update_banner_dismissed";
const ROOM_THEMES_STORAGE_KEY = "climpire_room_themes";
type RoomThemeMap = Record<string, RoomTheme>;

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
  const [activeRoomThemeTargetId, setActiveRoomThemeTargetId] = useState<string | null>(null);
  const [customRoomThemes, setCustomRoomThemes] = useState<RoomThemeMap>(() => initialRoomThemes.themes);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
      const [depts, ags, tks, sts, sett, subs, presence] = await Promise.all([
        api.getDepartments(),
        api.getAgents(),
        api.getTasks(),
        api.getStats(),
        api.getSettings(),
        api.getActiveSubtasks(),
        api.getMeetingPresence().catch(() => []),
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
    Promise.all([api.getTasks(), api.getAgents(), api.getStats()])
      .then(([nextTasks, nextAgents, nextStats]) => {
        setTasks(nextTasks);
        setAgents(nextAgents);
        setStats(nextStats);
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
        setAgents((prev) =>
          prev.map((a) =>
            a.id === p.id ? { ...a, ...p } : a
          )
        );
        if (p.subAgents) {
          setSubAgents((prev) => {
            const others = prev.filter((s) => s.parentAgentId !== p.id);
            const next = [...others, ...p.subAgents!];
            return next.length > MAX_LIVE_SUBAGENTS
              ? next.slice(next.length - MAX_LIVE_SUBAGENTS)
              : next;
          });
        }
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
        const p = payload as { task_id: string; stream: string; data: string };
        // Parse stream-json for sub-agent (Task tool) spawns from Claude Code
        try {
          const lines = p.data.split("\n").filter(Boolean);
          for (const line of lines) {
            const json = JSON.parse(line);
            // Detect Claude Code sub-agent spawn events
            if (json.type === "tool_use" && json.tool === "Task") {
              const parentAgent = agents.find(
                (a) => a.current_task_id === p.task_id
              );
              if (parentAgent) {
                const subId = json.id || `sub-${Date.now()}`;
                setSubAgents((prev) => {
                  if (prev.some((s) => s.id === subId)) return prev;
                  return appendCapped(
                    prev,
                    {
                      id: subId,
                      parentAgentId: parentAgent.id,
                      task: json.input?.prompt?.slice(0, 100) || "Sub-task",
                      status: "working" as const,
                    },
                    MAX_LIVE_SUBAGENTS,
                  );
                });
              }
            }
            // Detect sub-agent completion
            if (json.type === "tool_result" && json.tool === "Task") {
              setSubAgents((prev) =>
                prev.map((s) =>
                  s.id === json.id ? { ...s, status: "done" as const } : s
                )
              );
            }
          }
        } catch {
          // Not JSON or not parseable - ignore
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
                onClick={() => setShowAgentStatus(true)}
                className="header-action-btn header-action-btn-secondary"
              >
                <span className="sm:hidden">&#x1F6E0;</span>
                <span className="hidden sm:inline">&#x1F6E0; {agentStatusLabel}</span>
              </button>
              <button
                onClick={() => setShowReportHistory(true)}
                className="header-action-btn header-action-btn-secondary"
              >
                <span className="sm:hidden">📋</span>
                <span className="hidden sm:inline">{reportLabel}</span>
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
                className="header-action-btn header-action-btn-secondary"
              >
                <span className="sm:hidden">🏢</span>
                <span className="hidden sm:inline">{roomManagerLabel}</span>
              </button>
              {/* Theme toggle: sun/moon */}
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
