import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  SubAgent,
  CrossDeptDelivery,
  CeoOfficeCall,
  RoomTheme,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { detectBrowserLanguage } from "./i18n";
import type { TaskReportDetail } from "./api";
import * as api from "./api";
import { useTheme } from "./ThemeContext";
import { ROOM_THEMES_STORAGE_KEY, UPDATE_BANNER_DISMISS_STORAGE_KEY } from "./app/constants";
import {
  areAgentListsEquivalent,
  areTaskListsEquivalent,
  detectRuntimeOs,
  isForceUpdateBannerEnabled,
  isRoomThemeMap,
  isUserLanguagePinned,
  mergeSettingsWithDefaults,
  readStoredClientLanguage,
  readStoredRoomThemes,
  syncClientLanguage,
} from "./app/utils";
import type { OAuthCallbackResult, RuntimeOs, RoomThemeMap, TaskPanelTab, View } from "./app/types";
import { mapWorkflowDecisionItemsRaw } from "./app/decision-inbox";
import { useRealtimeSync } from "./app/useRealtimeSync";
import { useAppLabels } from "./app/useAppLabels";
import AppLoadingScreen from "./app/AppLoadingScreen";
import AppMainLayout from "./app/AppMainLayout";
import AppOverlays from "./app/AppOverlays";
import { useAppActions } from "./app/useAppActions";
import { useActiveMeetingTaskId } from "./app/useActiveMeetingTaskId";
import { useUpdateStatusPolling } from "./app/useUpdateStatusPolling";
import { useAppViewEffects } from "./app/useAppViewEffects";

export type { OAuthCallbackResult } from "./app/types";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const initialRoomThemes = useMemo(() => readStoredRoomThemes(), []);
  const hasLocalRoomThemesRef = useRef<boolean>(initialRoomThemes.hasStored);

  const [view, setView] = useState<View>("office");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<CompanyStats | null>(null);
  const [settings, setSettings] = useState<CompanySettings>(() =>
    mergeSettingsWithDefaults({ language: detectBrowserLanguage() }),
  );
  const [cliStatus, setCliStatus] = useState<CliStatusMap | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);

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
  const activeChatRef = useRef<{ showChat: boolean; agentId: string | null }>({ showChat: false, agentId: null });
  activeChatRef.current = { showChat, agentId: chatAgent?.id ?? null };
  const liveSyncInFlightRef = useRef(false);
  const liveSyncQueuedRef = useRef(false);
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { connected, on } = useWebSocket();

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
        !isUserLanguagePinned() && !storedClientLanguage && mergedSettings.language === DEFAULT_SETTINGS.language;
      const nextSettings = shouldAutoAssignLanguage
        ? { ...mergedSettings, language: autoDetectedLanguage }
        : mergedSettings;

      setSettings(nextSettings);
      syncClientLanguage(nextSettings.language);
      const dbRoomThemes = isRoomThemeMap(nextSettings.roomThemes) ? nextSettings.roomThemes : undefined;

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

      if (shouldAutoAssignLanguage && mergedSettings.language !== autoDetectedLanguage) {
        api.saveSettings(nextSettings).catch((error) => {
          console.error("Auto language sync failed:", error);
        });
      }
      setSubtasks(subs);
      setMeetingPresence(presence);
      setDecisionInboxItems(mapWorkflowDecisionItemsRaw(decisionItems ?? []));
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, [initialRoomThemes.themes]);

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
          const workflowItems = mapWorkflowDecisionItemsRaw(nextDecisionItems);
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

  const scheduleLiveSync = useCallback(
    (delayMs = 120) => {
      if (liveSyncTimerRef.current) return;
      liveSyncTimerRef.current = setTimeout(
        () => {
          liveSyncTimerRef.current = null;
          runLiveSync();
        },
        Math.max(0, delayMs),
      );
    },
    [runLiveSync],
  );

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

  useUpdateStatusPolling(setUpdateStatus);
  useAppViewEffects({
    view,
    cliStatus,
    setView,
    setOauthResult,
    setCliStatus,
    setMobileNavOpen,
    setMeetingPresence,
  });

  useRealtimeSync({
    on,
    scheduleLiveSync,
    agentsRef,
    tasksRef,
    subAgentsRef,
    viewRef,
    activeChatRef,
    codexThreadToSubAgentIdRef,
    codexThreadBindingTsRef,
    subAgentStreamTailRef,
    setAgents,
    setMessages,
    setUnreadAgentIds,
    setTaskReport,
    setCrossDeptDeliveries,
    setCeoOfficeCalls,
    setMeetingPresence,
    setSubtasks,
    setSubAgents,
    setStreamingMessage,
  });

  const actions = useAppActions({
    agents,
    settings,
    scheduleLiveSync,
    setSettings,
    setAgents,
    setDepartments,
    setTasks,
    setStats,
    setMessages,
    setChatAgent,
    setShowChat,
    setUnreadAgentIds,
    setShowDecisionInbox,
    setDecisionInboxLoading,
    setDecisionInboxItems,
    setDecisionReplyBusyKey,
    setCliStatus,
  });

  const activeMeetingTaskId = useActiveMeetingTaskId(meetingPresence);

  const labels = useAppLabels({
    view,
    settings,
    departments,
    theme,
    runtimeOs,
    forceUpdateBanner,
    updateStatus,
    dismissedUpdateVersion,
  });

  if (loading) {
    return (
      <AppLoadingScreen language={labels.uiLanguage} title={labels.loadingTitle} subtitle={labels.loadingSubtitle} />
    );
  }

  return (
    <AppMainLayout
      connected={connected}
      view={view}
      setView={setView}
      departments={departments}
      agents={agents}
      stats={stats}
      tasks={tasks}
      subtasks={subtasks}
      subAgents={subAgents}
      meetingPresence={meetingPresence}
      settings={settings}
      cliStatus={cliStatus}
      oauthResult={oauthResult}
      labels={labels}
      mobileNavOpen={mobileNavOpen}
      setMobileNavOpen={setMobileNavOpen}
      mobileHeaderMenuOpen={mobileHeaderMenuOpen}
      setMobileHeaderMenuOpen={setMobileHeaderMenuOpen}
      theme={theme}
      toggleTheme={toggleTheme}
      decisionInboxLoading={decisionInboxLoading}
      decisionInboxCount={decisionInboxItems.length}
      activeMeetingTaskId={activeMeetingTaskId}
      unreadAgentIds={unreadAgentIds}
      crossDeptDeliveries={crossDeptDeliveries}
      ceoOfficeCalls={ceoOfficeCalls}
      customRoomThemes={customRoomThemes}
      activeRoomThemeTargetId={activeRoomThemeTargetId}
      onCrossDeptDeliveryProcessed={(id) => setCrossDeptDeliveries((prev) => prev.filter((d) => d.id !== id))}
      onCeoOfficeCallProcessed={(id) => setCeoOfficeCalls((prev) => prev.filter((d) => d.id !== id))}
      onOpenActiveMeetingMinutes={(taskId) => setTaskPanel({ taskId, tab: "minutes" })}
      onSelectAgent={setSelectedAgent}
      onSelectDepartment={(department) => {
        const leader = agents.find((agent) => agent.department_id === department.id && agent.role === "team_leader");
        if (leader) actions.handleOpenChat(leader);
      }}
      onCreateTask={actions.handleCreateTask}
      onUpdateTask={actions.handleUpdateTask}
      onDeleteTask={actions.handleDeleteTask}
      onAssignTask={actions.handleAssignTask}
      onRunTask={actions.handleRunTask}
      onStopTask={actions.handleStopTask}
      onPauseTask={actions.handlePauseTask}
      onResumeTask={actions.handleResumeTask}
      onOpenTerminal={(taskId) => setTaskPanel({ taskId, tab: "terminal" })}
      onOpenMeetingMinutes={(taskId) => setTaskPanel({ taskId, tab: "minutes" })}
      onAgentsChange={actions.handleAgentsChange}
      onSaveSettings={actions.handleSaveSettings}
      onRefreshCli={actions.handleRefreshCli}
      onOauthResultClear={() => setOauthResult(null)}
      onOpenDecisionInbox={actions.handleOpenDecisionInbox}
      onOpenAgentStatus={() => setShowAgentStatus(true)}
      onOpenReportHistory={() => setShowReportHistory(true)}
      onOpenAnnouncement={actions.handleOpenAnnouncement}
      onOpenRoomManager={() => setShowRoomManager(true)}
      onDismissAutoUpdateNotice={actions.handleDismissAutoUpdateNotice}
      onDismissUpdate={() => {
        const latest = labels.effectiveUpdateStatus?.latest_version ?? "";
        setDismissedUpdateVersion(latest);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(UPDATE_BANNER_DISMISS_STORAGE_KEY, latest);
        }
      }}
    >
      <AppOverlays
        showChat={showChat}
        chatAgent={chatAgent}
        messages={messages}
        agents={agents}
        streamingMessage={streamingMessage}
        onSendMessage={actions.handleSendMessage}
        onSendAnnouncement={actions.handleSendAnnouncement}
        onSendDirective={actions.handleSendDirective}
        onClearMessages={actions.handleClearMessages}
        onCloseChat={() => setShowChat(false)}
        showDecisionInbox={showDecisionInbox}
        decisionInboxLoading={decisionInboxLoading}
        decisionInboxItems={decisionInboxItems}
        decisionReplyBusyKey={decisionReplyBusyKey}
        uiLanguage={labels.uiLanguage}
        onCloseDecisionInbox={() => setShowDecisionInbox(false)}
        onRefreshDecisionInbox={() => {
          void actions.loadDecisionInbox();
        }}
        onReplyDecisionOption={actions.handleReplyDecisionOption}
        onOpenDecisionChat={actions.handleOpenDecisionChat}
        selectedAgent={selectedAgent}
        departments={departments}
        tasks={tasks}
        subAgents={subAgents}
        subtasks={subtasks}
        onCloseSelectedAgent={() => setSelectedAgent(null)}
        onChatFromAgentDetail={(agent) => {
          setSelectedAgent(null);
          actions.handleOpenChat(agent);
        }}
        onAssignTaskFromAgentDetail={() => {
          setSelectedAgent(null);
          setView("tasks");
        }}
        onOpenTerminalFromAgentDetail={(taskId) => {
          setSelectedAgent(null);
          setTaskPanel({ taskId, tab: "terminal" });
        }}
        onAgentUpdated={() => {
          api
            .getAgents()
            .then((nextAgents) => {
              setAgents(nextAgents);
              if (selectedAgent) {
                const updated = nextAgents.find((agent) => agent.id === selectedAgent.id);
                if (updated) setSelectedAgent(updated);
              }
            })
            .catch(console.error);
        }}
        taskPanel={taskPanel}
        onCloseTaskPanel={() => setTaskPanel(null)}
        taskReport={taskReport}
        onCloseTaskReport={() => setTaskReport(null)}
        showReportHistory={showReportHistory}
        onCloseReportHistory={() => setShowReportHistory(false)}
        showAgentStatus={showAgentStatus}
        onCloseAgentStatus={() => setShowAgentStatus(false)}
        showRoomManager={showRoomManager}
        roomManagerDepartments={labels.roomManagerDepartments}
        customRoomThemes={customRoomThemes}
        onActiveRoomThemeTargetIdChange={setActiveRoomThemeTargetId}
        onRoomThemeChange={(themes) => {
          setCustomRoomThemes(themes as RoomThemeMap);
          hasLocalRoomThemesRef.current = true;
          try {
            window.localStorage.setItem(ROOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
          } catch {
            // ignore quota errors
          }
          api.saveRoomThemes(themes as Record<string, RoomTheme>).catch((error) => {
            console.error("Save room themes failed:", error);
          });
        }}
        onCloseRoomManager={() => {
          setShowRoomManager(false);
          setActiveRoomThemeTargetId(null);
        }}
      />
    </AppMainLayout>
  );
}
