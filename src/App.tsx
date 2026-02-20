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

export interface OAuthCallbackResult {
  provider: string | null;
  error: string | null;
}

const MAX_LIVE_MESSAGES = 600;
const MAX_LIVE_SUBTASKS = 2000;
const MAX_LIVE_SUBAGENTS = 600;
const MAX_CROSS_DEPT_DELIVERIES = 240;
const MAX_CEO_OFFICE_CALLS = 480;

function appendCapped<T>(prev: T[], item: T, max: number): T[] {
  if (prev.length < max) return [...prev, item];
  return [...prev.slice(prev.length - max + 1), item];
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

function syncClientLanguage(language: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(language));
  window.dispatchEvent(new Event("climpire-language-change"));
}

export default function App() {
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
      const shouldAutoAssignLanguage = !isUserLanguagePinned();
      const nextSettings = shouldAutoAssignLanguage
        ? { ...mergedSettings, language: autoDetectedLanguage }
        : mergedSettings;

      setSettings(nextSettings);
      syncClientLanguage(nextSettings.language);

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

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
        api.getTasks().then(setTasks).catch(console.error);
        api.getAgents().then(setAgents).catch(console.error);
        api.getStats().then(setStats).catch(console.error);
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
        // Also refresh tasks to update subtask_total/subtask_done counts
        api.getTasks().then(setTasks).catch(console.error);
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
  }, [on]);

  // Polling for fresh data every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      api.getAgents().then(setAgents).catch(console.error);
      api.getTasks().then(setTasks).catch(console.error);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

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
  async function handleSendMessage(
    content: string,
    receiverType: "agent" | "department" | "all",
    receiverId?: string,
    messageType?: string
  ) {
    try {
      await api.sendMessage({
        receiver_type: receiverType,
        receiver_id: receiverId,
        content,
        message_type: (messageType as "chat" | "task_assign" | "report") || "chat",
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

  async function handleSendDirective(content: string) {
    try {
      await api.sendDirective(content);
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
      await api.saveSettings(nextSettings);
      setSettings(nextSettings);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LANGUAGE_USER_SET_STORAGE_KEY, "1");
      }
      syncClientLanguage(nextSettings.language);
    } catch (e) {
      console.error("Save settings failed:", e);
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
  const reportLabel = `📋 ${pickLang(uiLanguage, {
    ko: "보고서",
    en: "Reports",
    ja: "レポート",
    zh: "报告",
  })}`;
  const agentStatusLabel = pickLang(uiLanguage, {
    ko: "에이전트",
    en: "Agents",
    ja: "エージェント",
    zh: "代理",
  });

  if (loading) {
    return (
      <I18nProvider language={uiLanguage}>
        <div className="h-screen flex items-center justify-center bg-slate-900">
          <div className="text-center">
            <div className="text-5xl mb-4 animate-agent-bounce">🏢</div>
            <div className="text-lg text-slate-400 font-medium">
              {loadingTitle}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {loadingSubtitle}
            </div>
          </div>
        </div>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={uiLanguage}>
      <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-slate-900">
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
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700/50 bg-slate-900/85 px-3 py-2 backdrop-blur-sm sm:px-4 sm:py-3 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white lg:hidden"
                aria-label="Open navigation"
              >
                ☰
              </button>
              <h1 className="truncate text-base font-bold text-white sm:text-lg">{viewTitle}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowAgentStatus(true)}
                className="rounded-lg border border-blue-500/30 bg-blue-600/20 px-2.5 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-600/30 sm:px-3 sm:text-sm"
              >
                <span className="sm:hidden">&#x1F6E0;</span>
                <span className="hidden sm:inline">&#x1F6E0; {agentStatusLabel}</span>
              </button>
              <button
                onClick={() => setShowReportHistory(true)}
                className="rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-2.5 py-1.5 text-xs text-emerald-400 transition-colors hover:bg-emerald-600/30 sm:px-3 sm:text-sm"
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
                className="rounded-lg border border-amber-500/30 bg-amber-600/20 px-2.5 py-1.5 text-xs text-amber-400 transition-colors hover:bg-amber-600/30 sm:px-3 sm:text-sm"
              >
                <span className="sm:hidden">📢</span>
                <span className="hidden sm:inline">{announcementLabel}</span>
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <div
                  className={`w-2 h-2 rounded-full ${
                    connected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="hidden sm:inline">{connected ? "Live" : "Offline"}</span>
              </div>
            </div>
          </header>

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
      </div>
    </I18nProvider>
  );
}
