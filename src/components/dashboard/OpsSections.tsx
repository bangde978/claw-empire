import { localeName, type UiLanguage } from "../../i18n";
import type { Agent, Task } from "../../types";
import type { TaskBoardCreateDraft } from "../../app/types";
import type {
  DashboardAgentPerformanceItem,
  DashboardProjectHotspotItem,
  DashboardRecommendedActionItem,
  DashboardRiskRadarItem,
} from "../../api";
import AgentAvatar from "../AgentAvatar";
import {
  getRankTier,
  STATUS_LABELS,
  STATUS_LEFT_BORDER,
  taskStatusLabel,
  timeAgo,
  type DashboardHandledRecord,
  type DashboardHandledTimelineItem,
  type TFunction,
} from "./model";

export interface DepartmentPerformance {
  id: string;
  name: string;
  icon: string;
  done: number;
  total: number;
  ratio: number;
  color: {
    bar: string;
    badge: string;
  };
}

interface DashboardDeptAndSquadProps {
  deptData: DepartmentPerformance[];
  workingAgents: Agent[];
  idleAgentsList: Agent[];
  agents: Agent[];
  language: UiLanguage;
  numberFormatter: Intl.NumberFormat;
  t: TFunction;
}

export function DashboardDeptAndSquad({
  deptData,
  workingAgents,
  idleAgentsList,
  agents,
  language,
  numberFormatter,
  t,
}: DashboardDeptAndSquadProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
      <div className="game-panel p-5">
        <h2
          className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wider"
          style={{ color: "var(--th-text-primary)" }}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15 text-sm"
            style={{ boxShadow: "0 0 8px rgba(59,130,246,0.3)" }}
          >
            🏰
          </span>
          {t({ ko: "부서 성과", en: "DEPT. PERFORMANCE", ja: "部署パフォーマンス", zh: "部门绩效" })}
          <span
            className="ml-auto text-[9px] font-medium normal-case tracking-normal"
            style={{ color: "var(--th-text-muted)" }}
          >
            {t({ ko: "부서별 성과", en: "by department", ja: "部署別", zh: "按部门" })}
          </span>
        </h2>

        {deptData.length === 0 ? (
          <div
            className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-sm"
            style={{ color: "var(--th-text-muted)" }}
          >
            <span className="text-3xl opacity-30">🏰</span>
            {t({ ko: "데이터가 없습니다", en: "No data available", ja: "データがありません", zh: "暂无数据" })}
          </div>
        ) : (
          <div className="space-y-2.5">
            {deptData.map((dept) => (
              <article
                key={dept.id}
                className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:bg-white/[0.04] hover:translate-x-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-transform duration-200 group-hover:scale-110"
                      style={{ background: "var(--th-bg-surface)" }}
                    >
                      {dept.icon}
                    </span>
                    <span className="text-sm font-bold" style={{ color: "var(--th-text-primary)" }}>
                      {dept.name}
                    </span>
                  </div>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${dept.color.badge}`}>
                    {dept.ratio}%
                  </span>
                </div>

                <div className="mt-2.5 relative h-2 overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.04]">
                  <div
                    className={`xp-bar-fill h-full rounded-full bg-gradient-to-r ${dept.color.bar} transition-all duration-700`}
                    style={{ width: `${dept.ratio}%` }}
                  />
                </div>

                <div
                  className="mt-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--th-text-muted)" }}
                >
                  <span>
                    {t({ ko: "클리어", en: "cleared", ja: "クリア", zh: "完成" })} {numberFormatter.format(dept.done)}
                  </span>
                  <span>
                    {t({ ko: "전체", en: "total", ja: "全体", zh: "总计" })} {numberFormatter.format(dept.total)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="game-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="flex items-center gap-2 text-sm font-black uppercase tracking-wider"
            style={{ color: "var(--th-text-primary)" }}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-sm"
              style={{ boxShadow: "0 0 8px rgba(0,240,255,0.2)" }}
            >
              🤖
            </span>
            {t({ ko: "스쿼드", en: "SQUAD", ja: "スクワッド", zh: "小队" })}
          </h2>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t({ ko: "ON", en: "ON", ja: "ON", zh: "在线" })} {numberFormatter.format(workingAgents.length)}
            </span>
            <span
              className="flex items-center gap-1 rounded-md border px-2 py-0.5 font-bold"
              style={{
                borderColor: "var(--th-border)",
                background: "var(--th-bg-surface)",
                color: "var(--th-text-secondary)",
              }}
            >
              {t({ ko: "OFF", en: "OFF", ja: "OFF", zh: "离线" })} {numberFormatter.format(idleAgentsList.length)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {agents.map((agent) => {
            const isWorking = agent.status === "working";
            const tier = getRankTier(agent.stats_xp);
            const delay = (agent.id.charCodeAt(0) * 137) % 1500;
            return (
              <div
                key={agent.id}
                title={`${localeName(language, agent)} — ${
                  isWorking
                    ? t({ ko: "작업 중", en: "Working", ja: "作業中", zh: "工作中" })
                    : t({ ko: "대기 중", en: "Idle", ja: "待機中", zh: "空闲" })
                } — ${tier.name}`}
                className={`group relative flex flex-col items-center gap-1.5 ${isWorking ? "animate-bubble-float" : ""}`}
                style={isWorking ? { animationDelay: `${delay}ms` } : {}}
              >
                <div className="relative">
                  <div
                    className="overflow-hidden rounded-2xl transition-transform duration-200 group-hover:scale-110"
                    style={{
                      boxShadow: isWorking ? `0 0 12px ${tier.glow}` : "none",
                      border: isWorking ? `2px solid ${tier.color}60` : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <AgentAvatar agent={agent} agents={agents} size={40} rounded="2xl" />
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 ${
                      isWorking ? "bg-emerald-400 animate-status-glow" : "bg-slate-600"
                    }`}
                    style={{ borderColor: "var(--th-bg-primary)" }}
                  />
                </div>
                <span
                  className="max-w-[52px] truncate text-center text-[9px] font-bold leading-tight"
                  style={{ color: isWorking ? "var(--th-text-primary)" : "var(--th-text-muted)" }}
                >
                  {localeName(language, agent)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface DashboardMissionLogProps {
  recentTasks: Task[];
  agentMap: Map<string, Agent>;
  agents: Agent[];
  language: UiLanguage;
  localeTag: string;
  idleAgents: number;
  numberFormatter: Intl.NumberFormat;
  t: TFunction;
}

export function DashboardMissionLog({
  recentTasks,
  agentMap,
  agents,
  language,
  localeTag,
  idleAgents,
  numberFormatter,
  t,
}: DashboardMissionLogProps) {
  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2
          className="flex items-center gap-2 text-sm font-black uppercase tracking-wider"
          style={{ color: "var(--th-text-primary)" }}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-sm"
            style={{ boxShadow: "0 0 8px rgba(139,92,246,0.2)" }}
          >
            📡
          </span>
          {t({ ko: "미션 로그", en: "MISSION LOG", ja: "ミッションログ", zh: "任务日志" })}
          <span
            className="ml-2 text-[9px] font-medium normal-case tracking-normal"
            style={{ color: "var(--th-text-muted)" }}
          >
            {t({ ko: "최근 활동", en: "Recent activity", ja: "最近の活動", zh: "最近活动" })}
          </span>
        </h2>
        <span
          className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold"
          style={{
            borderColor: "var(--th-border)",
            background: "var(--th-bg-surface)",
            color: "var(--th-text-secondary)",
          }}
        >
          {t({ ko: "유휴", en: "Idle", ja: "待機", zh: "空闲" })} {numberFormatter.format(idleAgents)}
          {t({ ko: "명", en: "", ja: "人", zh: "人" })}
        </span>
      </div>

      {recentTasks.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 py-10 text-sm"
          style={{ color: "var(--th-text-muted)" }}
        >
          <span className="text-3xl opacity-30">📡</span>
          {t({ ko: "로그 없음", en: "No logs", ja: "ログなし", zh: "暂无日志" })}
        </div>
      ) : (
        <div className="space-y-2">
          {recentTasks.map((task) => {
            const statusInfo = STATUS_LABELS[task.status] ?? {
              color: "bg-slate-600/20 text-slate-200 border-slate-500/30",
              dot: "bg-slate-400",
            };
            const assignedAgent =
              task.assigned_agent ?? (task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : undefined);
            const leftBorder = STATUS_LEFT_BORDER[task.status] ?? "border-l-slate-500";

            return (
              <article
                key={task.id}
                className={`group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-white/[0.06] border-l-[3px] ${leftBorder} bg-white/[0.02] p-3 transition-all duration-200 hover:bg-white/[0.04] hover:translate-x-1`}
              >
                {assignedAgent ? (
                  <AgentAvatar agent={assignedAgent} agents={agents} size={36} rounded="xl" />
                ) : (
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl border text-base"
                    style={{
                      borderColor: "var(--th-border)",
                      background: "var(--th-bg-surface)",
                      color: "var(--th-text-muted)",
                    }}
                  >
                    📄
                  </div>
                )}

                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-bold transition-colors group-hover:text-white"
                    style={{ color: "var(--th-text-primary)" }}
                  >
                    {task.title}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusInfo.dot}`} />
                    {assignedAgent
                      ? localeName(language, assignedAgent)
                      : t({ ko: "미배정", en: "Unassigned", ja: "未割り当て", zh: "未分配" })}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${statusInfo.color}`}
                  >
                    {taskStatusLabel(task.status, t)}
                  </span>
                  <span className="text-[9px] font-medium" style={{ color: "var(--th-text-muted)" }}>
                    {timeAgo(task.updated_at, localeTag)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface DashboardRiskRadarProps {
  riskRadar: DashboardRiskRadarItem[];
  handledCount: number;
  showHandled: boolean;
  handledRecords: Record<string, DashboardHandledRecord>;
  localeTag: string;
  onDismissRisk: (item: DashboardRiskRadarItem) => void;
  onToggleHandled: () => void;
  t: TFunction;
}

export function DashboardRiskRadar({
  riskRadar,
  handledCount,
  showHandled,
  handledRecords,
  localeTag,
  onDismissRisk,
  onToggleHandled,
  t,
}: DashboardRiskRadarProps) {
  const severityClass = (severity: DashboardRiskRadarItem["severity"]) => {
    switch (severity) {
      case "critical":
        return "border-rose-500/40 bg-rose-500/10 text-rose-200";
      case "warning":
        return "border-amber-500/40 bg-amber-500/10 text-amber-200";
      default:
        return "border-cyan-500/40 bg-cyan-500/10 text-cyan-100";
    }
  };

  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/15 text-sm">🛰️</span>
          {t({ ko: "리스크 레이더", en: "RISK RADAR", ja: "リスクレーダー", zh: "风险雷达" })}
        </h2>
        <div className="flex items-center gap-2">
          {handledCount > 0 && (
            <button
              onClick={onToggleHandled}
              className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px] font-bold"
              style={{ color: "var(--th-text-secondary)" }}
            >
              {showHandled
                ? t({ ko: "처리 숨김", en: "Hide handled", ja: "処理済みを隠す", zh: "隐藏已处理" })
                : t({ ko: "처리 보기", en: "Show handled", ja: "処理済みを見る", zh: "显示已处理" })}
            </button>
          )}
          <span className="rounded-md border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: "var(--th-border)", color: "var(--th-text-secondary)" }}>
            {riskRadar.length}
          </span>
        </div>
      </div>
      {riskRadar.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "현재 감지된 리스크 없음", en: "No active risks", ja: "アクティブなリスクなし", zh: "当前无活跃风险" })}
        </div>
      ) : (
        <div className="space-y-2">
          {riskRadar.map((item) => (
            <article key={item.id} className={`rounded-xl border px-3 py-3 ${severityClass(item.severity)}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{item.title}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onDismissRisk(item)}
                    className="rounded-md border border-current/30 px-2 py-0.5 text-[10px] font-bold uppercase transition hover:bg-black/10"
                  >
                    {t({ ko: "처리", en: "Handled", ja: "処理済み", zh: "已处理" })}
                  </button>
                  <span className="rounded-md border border-current/30 px-2 py-0.5 text-[10px] font-black uppercase">
                    {item.count}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-200">{item.summary}</p>
              {item.sample_labels.length > 0 && (
                <p className="mt-2 text-[11px] text-slate-300">{item.sample_labels.join(" · ")}</p>
              )}
              {showHandled && handledRecords[item.id] && (
                <p className="mt-2 text-[10px] text-slate-300">
                  {t({ ko: "처리 기록", en: "Handled", ja: "処理記録", zh: "处理记录" })}:{" "}
                  {handledRecords[item.id].handled_by} ·{" "}
                  {new Date(handledRecords[item.id].handled_at).toLocaleString(localeTag)}
                  {handledRecords[item.id].note ? ` · ${handledRecords[item.id].note}` : ""}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

interface DashboardAgentPerformanceProps {
  agentPerformance: DashboardAgentPerformanceItem[];
  agents: Agent[];
  language: UiLanguage;
  numberFormatter: Intl.NumberFormat;
  t: TFunction;
}

export function DashboardAgentPerformance({
  agentPerformance,
  agents,
  language,
  numberFormatter,
  t,
}: DashboardAgentPerformanceProps) {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-sm">📈</span>
          {t({ ko: "에이전트 퍼포먼스", en: "AGENT PERFORMANCE", ja: "エージェント成績", zh: "Agent 绩效" })}
        </h2>
      </div>
      {agentPerformance.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "집계 가능한 수행 데이터 없음", en: "No performance data", ja: "成績データなし", zh: "暂无绩效数据" })}
        </div>
      ) : (
        <div className="space-y-2">
          {agentPerformance.map((item, index) => {
            const agent = agentMap.get(item.agent_id);
            return (
              <article
                key={item.agent_id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
              >
                {agent ? (
                  <AgentAvatar agent={agent} agents={agents} size={40} rounded="2xl" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03] text-base">
                    {index + 1}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold" style={{ color: "var(--th-text-primary)" }}>
                      {agent ? localeName(language, agent) : item.agent_name}
                    </p>
                    <span className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[9px]" style={{ color: "var(--th-text-muted)" }}>
                      {item.department_name}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                    {t({ ko: "완료", en: "Done", ja: "完了", zh: "完成" })} {numberFormatter.format(item.tasks_done)} /{" "}
                    {numberFormatter.format(item.tasks_owned)} · {t({ ko: "검토율", en: "Review", ja: "レビュー率", zh: "审核率" })}{" "}
                    {item.review_rate}% · {t({ ko: "정체율", en: "Stall", ja: "停滞率", zh: "停滞率" })} {item.stall_rate}%
                  </p>
                  <p className="mt-0.5 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                    {t({ ko: "주력", en: "Focus", ja: "得意分野", zh: "重点类型" })}: {item.dominant_task_type || "-"} ·{" "}
                    {t({ ko: "평균 사이클", en: "Avg cycle", ja: "平均サイクル", zh: "平均周期" })}:{" "}
                    {item.avg_cycle_hours == null ? "-" : `${item.avg_cycle_hours}h`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                    {item.score}
                  </span>
                  <span className="text-[9px]" style={{ color: "var(--th-text-muted)" }}>
                    {item.completion_rate}% clear
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface DashboardProjectHotspotsProps {
  projectHotspots: DashboardProjectHotspotItem[];
  onInspectProject: (input: { projectId: string; projectPath: string }) => void;
  onCreateFollowup: (draft: TaskBoardCreateDraft) => void;
  t: TFunction;
}

export function DashboardProjectHotspots({
  projectHotspots,
  onInspectProject,
  onCreateFollowup,
  t,
}: DashboardProjectHotspotsProps) {
  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-sm">🔥</span>
          {t({ ko: "프로젝트 핫스팟", en: "PROJECT HOTSPOTS", ja: "プロジェクトホットスポット", zh: "项目热点" })}
        </h2>
      </div>
      {projectHotspots.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "리스크 프로젝트 없음", en: "No hotspot projects", ja: "リスク案件なし", zh: "暂无热点项目" })}
        </div>
      ) : (
        <div className="space-y-2">
          {projectHotspots.map((item) => (
            <article key={item.project_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold" style={{ color: "var(--th-text-primary)" }}>
                  {item.project_name}
                </p>
                <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-200">
                  {item.risk_score}
                </span>
              </div>
              <p className="mt-1 truncate text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                {item.project_path}
              </p>
              <p className="mt-2 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                incidents {item.open_incidents} · stale {item.stale_tasks} · review {item.review_backlog} · ownerless{" "}
                {item.ownerless_tasks}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => onInspectProject({ projectId: item.project_id, projectPath: item.project_path })}
                  className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-500/20"
                >
                  {t({ ko: "업무 보기", en: "View Tasks", ja: "タスクを見る", zh: "查看任务" })}
                </button>
                <button
                  onClick={() =>
                    onCreateFollowup({
                      title: `[Follow-up] Stabilize ${item.project_name}`,
                      description: `Hotspot project triage. Risk score ${item.risk_score}. Incidents ${item.open_incidents}, stale ${item.stale_tasks}, review backlog ${item.review_backlog}, ownerless ${item.ownerless_tasks}.`,
                      project_id: item.project_id,
                      project_path: item.project_path,
                      task_type: "analysis",
                      priority: item.risk_score >= 60 ? 4 : 3,
                    })
                  }
                  className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-100 transition hover:bg-amber-500/20"
                >
                  {t({ ko: "후속 업무", en: "Follow-up", ja: "フォローアップ", zh: "创建跟进" })}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

interface DashboardRecommendedActionsProps {
  recommendedActions: DashboardRecommendedActionItem[];
  handledCount: number;
  showHandled: boolean;
  handledRecords: Record<string, DashboardHandledRecord>;
  localeTag: string;
  onInspectAction: (input: { projectId?: string; projectPath?: string; search?: string }) => void;
  onCreateFollowup: (draft: TaskBoardCreateDraft) => void;
  onDismissAction: (item: DashboardRecommendedActionItem) => void;
  onToggleHandled: () => void;
  t: TFunction;
}

export function DashboardRecommendedActions({
  recommendedActions,
  handledCount,
  showHandled,
  handledRecords,
  localeTag,
  onInspectAction,
  onCreateFollowup,
  onDismissAction,
  onToggleHandled,
  t,
}: DashboardRecommendedActionsProps) {
  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-sm">🧭</span>
          {t({ ko: "추천 액션", en: "RECOMMENDED ACTIONS", ja: "推奨アクション", zh: "推荐动作" })}
        </h2>
        {handledCount > 0 && (
          <button
            onClick={onToggleHandled}
            className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px] font-bold"
            style={{ color: "var(--th-text-secondary)" }}
          >
            {showHandled
              ? t({ ko: "처리 숨김", en: "Hide handled", ja: "処理済みを隠す", zh: "隐藏已处理" })
              : t({ ko: "처리 보기", en: "Show handled", ja: "処理済みを見る", zh: "显示已处理" })}
          </button>
        )}
      </div>
      {recommendedActions.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "추천 액션 없음", en: "No recommended actions", ja: "推奨アクションなし", zh: "暂无推荐动作" })}
        </div>
      ) : (
        <div className="space-y-2">
          {recommendedActions.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold" style={{ color: "var(--th-text-primary)" }}>
                  {item.title}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onDismissAction(item)}
                    className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase"
                    style={{ color: "var(--th-text-muted)" }}
                  >
                    {t({ ko: "처리", en: "Handled", ja: "処理済み", zh: "已处理" })}
                  </button>
                  <span className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase" style={{ color: "var(--th-text-muted)" }}>
                    {item.priority}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--th-text-secondary)" }}>
                {item.detail}
              </p>
              {showHandled && handledRecords[item.id] && (
                <p className="mt-2 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                  {t({ ko: "처리 기록", en: "Handled", ja: "処理記録", zh: "处理记录" })}:{" "}
                  {handledRecords[item.id].handled_by} · {new Date(handledRecords[item.id].handled_at).toLocaleString(localeTag)}
                  {handledRecords[item.id].note ? ` · ${handledRecords[item.id].note}` : ""}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(item.project_path || item.project_id) && (
                  <button
                    onClick={() =>
                      onInspectAction({
                        projectId: item.project_id,
                        projectPath: item.project_path,
                        search: item.project_path ? undefined : item.title,
                      })
                    }
                    className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    {t({ ko: "관련 업무", en: "Open Tasks", ja: "関連タスク", zh: "相关任务" })}
                  </button>
                )}
                <button
                  onClick={() =>
                    onCreateFollowup({
                      title: `[Follow-up] ${item.title}`,
                      description: item.detail,
                      project_id: item.project_id,
                      project_path: item.project_path,
                      task_type: "analysis",
                      priority: item.priority === "high" ? 4 : item.priority === "medium" ? 3 : 2,
                    })
                  }
                  className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-100 transition hover:bg-amber-500/20"
                >
                  {t({ ko: "후속 업무", en: "Create Follow-up", ja: "フォローアップ作成", zh: "创建跟进" })}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

interface DashboardHandledTimelineProps {
  items: DashboardHandledTimelineItem[];
  localeTag: string;
  onReopenItem: (item: DashboardHandledTimelineItem) => void;
  onOpenContext: (item: DashboardHandledTimelineItem) => void;
  onClearHistory: () => void;
  t: TFunction;
}

export function DashboardHandledTimeline({
  items,
  localeTag,
  onReopenItem,
  onOpenContext,
  onClearHistory,
  t,
}: DashboardHandledTimelineProps) {
  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-sm">🧾</span>
          {t({ ko: "최근 처리 기록", en: "RECENTLY HANDLED", ja: "最近の処理履歴", zh: "最近处理记录" })}
        </h2>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              onClick={onClearHistory}
              className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px] font-bold"
              style={{ color: "var(--th-text-secondary)" }}
            >
              {t({ ko: "기록 비우기", en: "Clear history", ja: "履歴を消去", zh: "清空记录" })}
            </button>
          )}
          <span className="rounded-md border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: "var(--th-border)", color: "var(--th-text-secondary)" }}>
            {items.length}
          </span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "아직 처리 기록 없음", en: "No handled history yet", ja: "処理履歴はまだありません", zh: "暂时还没有处理记录" })}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <article key={`${item.kind}:${item.id}:${item.handled_at}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-bold" style={{ color: "var(--th-text-primary)" }}>
                  {item.title}
                </p>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    item.kind === "risk"
                      ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                      : "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                  }`}
                >
                  {item.kind}
                </span>
              </div>
              <p className="mt-1 text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                {item.handled_by} · {new Date(item.handled_at).toLocaleString(localeTag)} · {timeAgo(item.handled_at, localeTag)}
              </p>
              {item.note && (
                <p className="mt-2 text-[11px]" style={{ color: "var(--th-text-secondary)" }}>
                  {item.note}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(item.project_path || item.project_id) && (
                  <button
                    onClick={() => onOpenContext(item)}
                    className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    {t({ ko: "관련 업무", en: "Open context", ja: "関連タスク", zh: "打开相关项" })}
                  </button>
                )}
                <button
                  onClick={() => onReopenItem(item)}
                  className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-100 transition hover:bg-amber-500/20"
                >
                  {t({ ko: "다시 열기", en: "Reopen", ja: "再オープン", zh: "重新打开" })}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

interface DashboardHandledAnalyticsProps {
  items: DashboardHandledTimelineItem[];
  numberFormatter: Intl.NumberFormat;
  t: TFunction;
}

export function DashboardHandledAnalytics({ items, numberFormatter, t }: DashboardHandledAnalyticsProps) {
  const now = Date.now();
  const last24h = items.filter((item) => now - item.handled_at <= 24 * 3_600_000);
  const last7d = items.filter((item) => now - item.handled_at <= 7 * 24 * 3_600_000);
  const riskCount = items.filter((item) => item.kind === "risk").length;
  const actionCount = items.length - riskCount;
  const topOperators = Array.from(
    items.reduce((map, item) => {
      map.set(item.handled_by, (map.get(item.handled_by) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="game-panel p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 text-sm">📚</span>
        <h2 className="text-sm font-black uppercase tracking-wider" style={{ color: "var(--th-text-primary)" }}>
          {t({ ko: "처리 분석", en: "HANDLED ANALYTICS", ja: "処理分析", zh: "处理分析" })}
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          {
            id: "total",
            label: t({ ko: "전체", en: "Total", ja: "全体", zh: "总计" }),
            value: items.length,
            tone: "text-cyan-100 border-cyan-400/30 bg-cyan-500/10",
          },
          {
            id: "24h",
            label: t({ ko: "최근 24시간", en: "Last 24h", ja: "直近24時間", zh: "最近24小时" }),
            value: last24h.length,
            tone: "text-emerald-100 border-emerald-400/30 bg-emerald-500/10",
          },
          {
            id: "7d",
            label: t({ ko: "최근 7일", en: "Last 7d", ja: "直近7日", zh: "最近7天" }),
            value: last7d.length,
            tone: "text-amber-100 border-amber-400/30 bg-amber-500/10",
          },
          {
            id: "risk_ratio",
            label: t({ ko: "리스크 비중", en: "Risk Share", ja: "リスク比率", zh: "风险占比" }),
            value: items.length === 0 ? "0%" : `${Math.round((riskCount / items.length) * 100)}%`,
            tone: "text-rose-100 border-rose-400/30 bg-rose-500/10",
          },
        ].map((card) => (
          <article key={card.id} className={`rounded-xl border p-3 ${card.tone}`}>
            <p className="text-[10px] font-bold uppercase">{card.label}</p>
            <p className="mt-1 text-xl font-black">
              {typeof card.value === "number" ? numberFormatter.format(card.value) : card.value}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--th-text-muted)" }}>
            {t({ ko: "종류별", en: "By Kind", ja: "種別", zh: "按类型" })}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--th-text-secondary)" }}>
            {t({ ko: "리스크", en: "Risks", ja: "リスク", zh: "风险" })}: {numberFormatter.format(riskCount)}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--th-text-secondary)" }}>
            {t({ ko: "액션", en: "Actions", ja: "アクション", zh: "动作" })}: {numberFormatter.format(actionCount)}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--th-text-muted)" }}>
            {t({ ko: "주요 처리자", en: "Top Operators", ja: "主な処理者", zh: "主要处理人" })}
          </p>
          {topOperators.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--th-text-muted)" }}>
              {t({ ko: "기록 없음", en: "No history", ja: "履歴なし", zh: "暂无记录" })}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {topOperators.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--th-text-secondary)" }}>{name}</span>
                  <span className="rounded-md border border-white/[0.08] px-2 py-0.5 text-[10px]" style={{ color: "var(--th-text-primary)" }}>
                    {numberFormatter.format(count)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
