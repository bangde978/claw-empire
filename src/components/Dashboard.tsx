import { useEffect, useMemo, useState } from "react";
import type { TaskBoardCreateDraft } from "../app/types";
import type { Agent, CompanyStats, Task } from "../types";
import { localeName, useI18n } from "../i18n";
import {
  deleteDashboardHandledHistoryItem,
  getDashboardHandledHistory,
  getDashboardInsights,
  type DashboardAgentPerformanceItem,
  type DashboardHandledHistoryItem,
  type DashboardProjectHotspotItem,
  type DashboardRecommendedActionItem,
  type DashboardRiskRadarItem,
  upsertDashboardHandledHistoryItem,
} from "../api";
import {
  DashboardHeroHeader,
  DashboardHudStats,
  DashboardRankingBoard,
  type HudStat,
  type RankedAgent,
} from "./dashboard/HeroSections";
import {
  DashboardAgentPerformance,
  DashboardDeptAndSquad,
  DashboardHandledAnalytics,
  DashboardHandledTimeline,
  DashboardMissionLog,
  DashboardProjectHotspots,
  DashboardRecommendedActions,
  DashboardRiskRadar,
  type DepartmentPerformance,
} from "./dashboard/OpsSections";
import {
  DEPT_COLORS,
  loadDashboardHandledState,
  saveDashboardHandledState,
  timeAgo,
  useNow,
  type DashboardHandledState,
  type DashboardHandledTimelineItem,
} from "./dashboard/model";

interface DashboardProps {
  stats: CompanyStats | null;
  agents: Agent[];
  tasks: Task[];
  companyName: string;
  onPrimaryCtaClick: () => void;
  onInspectProject: (input: { projectId?: string; projectPath?: string; search?: string }) => void;
  onCreateFollowup: (draft: TaskBoardCreateDraft) => void;
}

export default function Dashboard({
  stats,
  agents,
  tasks,
  companyName,
  onPrimaryCtaClick,
  onInspectProject,
  onCreateFollowup,
}: DashboardProps) {
  const { t, language, locale: localeTag } = useI18n();
  const { date, time, briefing } = useNow(localeTag, t);
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(localeTag), [localeTag]);
  const [riskRadar, setRiskRadar] = useState<DashboardRiskRadarItem[]>([]);
  const [agentPerformance, setAgentPerformance] = useState<DashboardAgentPerformanceItem[]>([]);
  const [projectHotspots, setProjectHotspots] = useState<DashboardProjectHotspotItem[]>([]);
  const [recommendedActions, setRecommendedActions] = useState<DashboardRecommendedActionItem[]>([]);
  const [handledState, setHandledState] = useState(() => loadDashboardHandledState());
  const [showHandledRisks, setShowHandledRisks] = useState(false);
  const [showHandledActions, setShowHandledActions] = useState(false);
  const [lastInsightSync, setLastInsightSync] = useState<number | null>(null);

  useEffect(() => {
    saveDashboardHandledState(handledState);
  }, [handledState]);

  useEffect(() => {
    let cancelled = false;
    getDashboardHandledHistory()
      .then((items) => {
        if (cancelled) return;
        const nextState: DashboardHandledState = { risks: {}, actions: {} };
        for (const item of items) {
          const record = {
            fingerprint: item.fingerprint,
            handled_at: item.handled_at,
            handled_by: item.handled_by,
            note: item.note ?? undefined,
          };
          if (item.kind === "risk") {
            nextState.risks[item.item_id] = record;
          } else {
            nextState.actions[item.item_id] = record;
          }
        }
        setHandledState((prev) => {
          const hasServerData = items.length > 0;
          return hasServerData ? nextState : prev;
        });
      })
      .catch(() => {
        // keep local fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchInsights = async () => {
      try {
        const insights = await getDashboardInsights();
        if (cancelled) return;
        setRiskRadar(insights.risk_radar ?? []);
        setAgentPerformance(insights.agent_performance ?? []);
        setProjectHotspots(insights.project_hotspots ?? []);
        setRecommendedActions(insights.recommended_actions ?? []);
        setLastInsightSync(Date.now());
      } catch {
        if (cancelled) return;
        setRiskRadar([]);
        setAgentPerformance([]);
        setProjectHotspots([]);
        setRecommendedActions([]);
      }
    };

    void fetchInsights();
    const timer = window.setInterval(() => {
      void fetchInsights();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const riskFingerprint = (item: DashboardRiskRadarItem) =>
    `${item.id}:${item.severity}:${item.count}:${item.sample_labels.join("|")}`;
  const actionFingerprint = (item: DashboardRecommendedActionItem) =>
    `${item.id}:${item.priority}:${item.detail}:${item.project_path ?? ""}`;

  const visibleRiskRadar = useMemo(
    () =>
      showHandledRisks
        ? riskRadar
        : riskRadar.filter((item) => handledState.risks[item.id]?.fingerprint !== riskFingerprint(item)),
    [handledState.risks, riskRadar, showHandledRisks],
  );

  const visibleRecommendedActions = useMemo(
    () =>
      showHandledActions
        ? recommendedActions
        : recommendedActions.filter((item) => handledState.actions[item.id]?.fingerprint !== actionFingerprint(item)),
    [handledState.actions, recommendedActions, showHandledActions],
  );

  const handledRiskCount = riskRadar.length - visibleRiskRadar.length;
  const handledActionCount = recommendedActions.length - visibleRecommendedActions.length;
  const handledTimeline = useMemo(
    () =>
      [
        ...riskRadar.flatMap((item) => {
          const record = handledState.risks[item.id];
          return record
            ? [{ id: item.id, kind: "risk" as const, title: item.title, ...record }]
            : [];
        }),
        ...recommendedActions.flatMap((item) => {
          const record = handledState.actions[item.id];
          return record
            ? [{ id: item.id, kind: "action" as const, title: item.title, ...record }]
                .map((row) => ({
                  ...row,
                  project_id: item.project_id,
                  project_path: item.project_path,
                }))
            : [];
        }),
      ]
        .sort((a, b) => b.handled_at - a.handled_at)
        .slice(0, 8),
    [handledState.actions, handledState.risks, recommendedActions, riskRadar],
  );

  const markRiskHandled = (item: DashboardRiskRadarItem) => {
    const handledAt = Date.now();
    const note =
      typeof window !== "undefined"
        ? window
            .prompt(
              t({
                ko: "처리 메모를 남길까요? (선택)",
                en: "Add a handled note? (optional)",
                ja: "処理メモを残しますか？（任意）",
                zh: "要补充处理备注吗？（可选）",
              }),
              "",
            )
            ?.trim() ?? ""
        : "";
    setHandledState((prev) => ({
      ...prev,
      risks: {
        ...prev.risks,
        [item.id]: {
          fingerprint: riskFingerprint(item),
          handled_at: handledAt,
          handled_by: companyName || "Operator",
          note: note || undefined,
        },
      },
    }));
    void upsertDashboardHandledHistoryItem({
      kind: "risk",
      item_id: item.id,
      title: item.title,
      fingerprint: riskFingerprint(item),
      handled_by: companyName || "Operator",
      note: note || undefined,
      handled_at: handledAt,
    }).catch(() => {
      // local fallback already applied
    });
  };

  const markActionHandled = (item: DashboardRecommendedActionItem) => {
    const handledAt = Date.now();
    const note =
      typeof window !== "undefined"
        ? window
            .prompt(
              t({
                ko: "처리 메모를 남길까요? (선택)",
                en: "Add a handled note? (optional)",
                ja: "処理メモを残しますか？（任意）",
                zh: "要补充处理备注吗？（可选）",
              }),
              "",
            )
            ?.trim() ?? ""
        : "";
    setHandledState((prev) => ({
      ...prev,
      actions: {
        ...prev.actions,
        [item.id]: {
          fingerprint: actionFingerprint(item),
          handled_at: handledAt,
          handled_by: companyName || "Operator",
          note: note || undefined,
        },
      },
    }));
    void upsertDashboardHandledHistoryItem({
      kind: "action",
      item_id: item.id,
      title: item.title,
      project_id: item.project_id ?? undefined,
      project_path: item.project_path ?? undefined,
      fingerprint: actionFingerprint(item),
      handled_by: companyName || "Operator",
      note: note || undefined,
      handled_at: handledAt,
    }).catch(() => {
      // local fallback already applied
    });
  };

  const reopenHandledItem = (item: DashboardHandledTimelineItem) => {
    setHandledState((prev) => {
      if (item.kind === "risk") {
        const nextRisks = { ...prev.risks };
        delete nextRisks[item.id];
        return { ...prev, risks: nextRisks };
      }
      const nextActions = { ...prev.actions };
      delete nextActions[item.id];
      return { ...prev, actions: nextActions };
    });
    void deleteDashboardHandledHistoryItem({ kind: item.kind, item_id: item.id }).catch(() => {
      // local fallback already applied
    });

    if (item.project_id || item.project_path) {
      onInspectProject({ projectId: item.project_id, projectPath: item.project_path });
    }
  };

  const clearHandledHistory = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        t({
          ko: "처리 기록을 모두 비울까요?",
          en: "Clear all handled history?",
          ja: "処理履歴をすべて消去しますか？",
          zh: "要清空全部处理记录吗？",
        }),
      );
      if (!confirmed) return;
    }
    setHandledState({ risks: {}, actions: {} });
    setShowHandledActions(false);
    setShowHandledRisks(false);
    void deleteDashboardHandledHistoryItem().catch(() => {
      // local fallback already applied
    });
  };

  const totalTasks = stats?.tasks?.total ?? tasks.length;
  const completedTasks = stats?.tasks?.done ?? tasks.filter((task) => task.status === "done").length;
  const inProgressTasks = stats?.tasks?.in_progress ?? tasks.filter((task) => task.status === "in_progress").length;
  const plannedTasks = stats?.tasks?.planned ?? tasks.filter((task) => task.status === "planned").length;
  const reviewTasks = stats?.tasks?.review ?? tasks.filter((task) => task.status === "review").length;
  const pendingTasks = tasks.filter((task) => task.status === "pending").length;
  const activeAgents = stats?.agents?.working ?? agents.filter((agent) => agent.status === "working").length;
  const idleAgents = stats?.agents?.idle ?? agents.filter((agent) => agent.status === "idle").length;
  const totalAgents = stats?.agents?.total ?? agents.length;
  const completionRate =
    stats?.tasks?.completion_rate ?? (totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0);
  const activeRate = totalAgents > 0 ? Math.round((activeAgents / totalAgents) * 100) : 0;
  const reviewQueue = reviewTasks + pendingTasks;

  const primaryCtaLabel = t({ ko: "미션 시작", en: "Start Mission", ja: "ミッション開始", zh: "开始任务" });
  const primaryCtaEyebrow = t({ ko: "빠른 실행", en: "Quick Start", ja: "クイック開始", zh: "快速开始" });
  const primaryCtaDescription = t({
    ko: "핵심 업무를 바로 생성하고 실행으로 전환하세요",
    en: "Create a priority task and move execution immediately.",
    ja: "最優先タスクをすぐ作成して実行へ移行します。",
    zh: "立即创建优先任务并进入执行。",
  });

  const deptData = useMemo<DepartmentPerformance[]>(() => {
    if (stats?.tasks_by_department && stats.tasks_by_department.length > 0) {
      return stats.tasks_by_department
        .map((department, idx) => ({
          id: department.id,
          name: department.name,
          icon: department.icon ?? "🏢",
          done: department.done_tasks,
          total: department.total_tasks,
          ratio: department.total_tasks > 0 ? Math.round((department.done_tasks / department.total_tasks) * 100) : 0,
          color: DEPT_COLORS[idx % DEPT_COLORS.length],
        }))
        .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
    }

    const deptMap = new Map<string, { name: string; icon: string; done: number; total: number }>();
    for (const agent of agents) {
      if (!agent.department_id) continue;
      if (!deptMap.has(agent.department_id)) {
        deptMap.set(agent.department_id, {
          name: agent.department ? localeName(language, agent.department) : agent.department_id,
          icon: agent.department?.icon ?? "🏢",
          done: 0,
          total: 0,
        });
      }
    }
    for (const task of tasks) {
      if (!task.department_id) continue;
      const entry = deptMap.get(task.department_id);
      if (!entry) continue;
      entry.total += 1;
      if (task.status === "done") entry.done += 1;
    }
    return Array.from(deptMap.entries())
      .map(([id, value], idx) => ({
        id,
        ...value,
        ratio: value.total > 0 ? Math.round((value.done / value.total) * 100) : 0,
        color: DEPT_COLORS[idx % DEPT_COLORS.length],
      }))
      .sort((a, b) => b.ratio - a.ratio || b.total - a.total);
  }, [stats, agents, tasks, language]);

  const topAgents = useMemo<RankedAgent[]>(() => {
    if (stats?.top_agents && stats.top_agents.length > 0) {
      return stats.top_agents.slice(0, 5).map((topAgent) => {
        const agent = agentMap.get(topAgent.id);
        return {
          id: topAgent.id,
          name: agent ? localeName(language, agent) : topAgent.name,
          department: agent?.department ? localeName(language, agent.department) : "",
          tasksDone: topAgent.stats_tasks_done,
          xp: topAgent.stats_xp,
        };
      });
    }
    return [...agents]
      .sort((a, b) => b.stats_xp - a.stats_xp)
      .slice(0, 5)
      .map((agent) => ({
        id: agent.id,
        name: localeName(language, agent),
        department: agent.department ? localeName(language, agent.department) : "",
        tasksDone: agent.stats_tasks_done,
        xp: agent.stats_xp,
      }));
  }, [stats, agents, agentMap, language]);

  const maxXp = topAgents.length > 0 ? Math.max(...topAgents.map((agent) => agent.xp), 1) : 1;
  const recentTasks = useMemo(() => [...tasks].sort((a, b) => b.updated_at - a.updated_at).slice(0, 6), [tasks]);
  const workingAgents = agents.filter((agent) => agent.status === "working");
  const idleAgentsList = agents.filter((agent) => agent.status === "idle");

  const podiumOrder =
    topAgents.length >= 3
      ? [topAgents[1], topAgents[0], topAgents[2]]
      : topAgents.length === 2
        ? [topAgents[1], topAgents[0]]
        : topAgents;

  const hudStats: HudStat[] = [
    {
      id: "total",
      label: t({ ko: "미션", en: "MISSIONS", ja: "ミッション", zh: "任务" }),
      value: totalTasks,
      sub: t({ ko: "누적 태스크", en: "Total tasks", ja: "累積タスク", zh: "累计任务" }),
      color: "#3b82f6",
      icon: "📋",
    },
    {
      id: "clear",
      label: t({ ko: "완료율", en: "CLEAR RATE", ja: "クリア率", zh: "完成率" }),
      value: `${completionRate}%`,
      sub: `${numberFormatter.format(completedTasks)} ${t({ ko: "클리어", en: "cleared", ja: "クリア", zh: "完成" })}`,
      color: "#10b981",
      icon: "✅",
    },
    {
      id: "squad",
      label: t({ ko: "스쿼드", en: "SQUAD", ja: "スクワッド", zh: "小队" }),
      value: `${activeAgents}/${totalAgents}`,
      sub: `${t({ ko: "가동률", en: "uptime", ja: "稼働率", zh: "运行率" })} ${activeRate}%`,
      color: "#00f0ff",
      icon: "🤖",
    },
    {
      id: "active",
      label: t({ ko: "진행중", en: "IN PROGRESS", ja: "進行中", zh: "进行中" }),
      value: inProgressTasks,
      sub: `${t({ ko: "계획", en: "planned", ja: "計画", zh: "计划" })} ${numberFormatter.format(plannedTasks)}${t({
        ko: "건",
        en: "",
        ja: "件",
        zh: "项",
      })}`,
      color: "#f59e0b",
      icon: "⚡",
    },
  ];

  return (
    <section className="relative isolate space-y-4" style={{ color: "var(--th-text-primary)" }}>
      <div className="pointer-events-none absolute -left-40 -top-32 h-96 w-96 rounded-full bg-violet-600/10 blur-[100px] animate-drift-slow" />
      <div className="pointer-events-none absolute -right-32 top-20 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px] animate-drift-slow-rev" />
      <div className="pointer-events-none absolute left-1/3 bottom-32 h-72 w-72 rounded-full bg-amber-500/[0.05] blur-[80px]" />

      <DashboardHeroHeader
        companyName={companyName}
        time={time}
        date={date}
        briefing={briefing}
        reviewQueue={reviewQueue}
        numberFormatter={numberFormatter}
        primaryCtaEyebrow={primaryCtaEyebrow}
        primaryCtaDescription={primaryCtaDescription}
        primaryCtaLabel={primaryCtaLabel}
        onPrimaryCtaClick={onPrimaryCtaClick}
        t={t}
      />

      <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]" style={{ color: "var(--th-text-muted)" }}>
        <span>{t({ ko: "자동 새로고침", en: "Auto refresh", ja: "自動更新", zh: "自动刷新" })} 60s</span>
        <span>·</span>
        <span>
          {lastInsightSync == null
            ? t({ ko: "데이터 대기 중", en: "Waiting for data", ja: "データ待機中", zh: "等待数据" })
            : `${t({ ko: "업데이트", en: "Updated", ja: "更新", zh: "更新" })} ${timeAgo(lastInsightSync, localeTag)}`}
        </span>
      </div>

      <DashboardHudStats hudStats={hudStats} numberFormatter={numberFormatter} />

      <DashboardRankingBoard
        topAgents={topAgents}
        podiumOrder={podiumOrder}
        agentMap={agentMap}
        agents={agents}
        maxXp={maxXp}
        numberFormatter={numberFormatter}
        t={t}
      />

      <DashboardDeptAndSquad
        deptData={deptData}
        workingAgents={workingAgents}
        idleAgentsList={idleAgentsList}
        agents={agents}
        language={language}
        numberFormatter={numberFormatter}
        t={t}
      />

      <DashboardMissionLog
        recentTasks={recentTasks}
        agentMap={agentMap}
        agents={agents}
        language={language}
        localeTag={localeTag}
        idleAgents={idleAgents}
        numberFormatter={numberFormatter}
        t={t}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <DashboardRiskRadar
          riskRadar={visibleRiskRadar}
          handledCount={handledRiskCount}
          showHandled={showHandledRisks}
          handledRecords={handledState.risks}
          localeTag={localeTag}
          onDismissRisk={markRiskHandled}
          onToggleHandled={() => setShowHandledRisks((prev) => !prev)}
          t={t}
        />
        <DashboardAgentPerformance
          agentPerformance={agentPerformance}
          agents={agents}
          language={language}
          numberFormatter={numberFormatter}
          t={t}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DashboardProjectHotspots
          projectHotspots={projectHotspots}
          onInspectProject={({ projectId, projectPath }) => onInspectProject({ projectId, projectPath })}
          onCreateFollowup={onCreateFollowup}
          t={t}
        />
        <DashboardRecommendedActions
          recommendedActions={visibleRecommendedActions}
          handledCount={handledActionCount}
          showHandled={showHandledActions}
          handledRecords={handledState.actions}
          localeTag={localeTag}
          onInspectAction={onInspectProject}
          onCreateFollowup={onCreateFollowup}
          onDismissAction={markActionHandled}
          onToggleHandled={() => setShowHandledActions((prev) => !prev)}
          t={t}
        />
      </div>

      <DashboardHandledAnalytics items={handledTimeline} numberFormatter={numberFormatter} t={t} />

      <DashboardHandledTimeline
        items={handledTimeline}
        localeTag={localeTag}
        onReopenItem={reopenHandledItem}
        onOpenContext={(item) => onInspectProject({ projectId: item.project_id, projectPath: item.project_path })}
        onClearHistory={clearHandledHistory}
        t={t}
      />
    </section>
  );
}
