import type {
  ProjectDecisionEventItem,
  ProjectIntelligence,
  ProjectPostmortemItem,
  ProjectReportHistoryItem,
  ProjectTaskHistoryItem,
  ProjectTimelineItem,
} from "../../api";
import type { Project } from "../../types";
import type { GroupedProjectTaskCard, ProjectI18nTranslate } from "./types";
import { fmtTime } from "./utils";

interface ProjectInsightsPanelProps {
  t: ProjectI18nTranslate;
  selectedProject: Project | null;
  loadingDetail: boolean;
  isCreating: boolean;
  groupedTaskCards: GroupedProjectTaskCard[];
  sortedReports: ProjectReportHistoryItem[];
  sortedDecisionEvents: ProjectDecisionEventItem[];
  intelligence?: ProjectIntelligence;
  getDecisionEventLabel: (eventType: ProjectDecisionEventItem["event_type"]) => string;
  handleOpenTaskDetail: (taskId: string) => Promise<void>;
  onCreateFollowupTask: (input: { key: string; title: string; detail: string }) => Promise<void>;
  followupBusyKey: string | null;
  followupNotice: string | null;
}

export default function ProjectInsightsPanel({
  t,
  selectedProject,
  loadingDetail,
  isCreating,
  groupedTaskCards,
  sortedReports,
  sortedDecisionEvents,
  intelligence,
  getDecisionEventLabel,
  handleOpenTaskDetail,
  onCreateFollowupTask,
  followupBusyKey,
  followupNotice,
}: ProjectInsightsPanelProps) {
  const timeline = intelligence?.timeline ?? [];
  const postmortems = intelligence?.postmortems ?? [];

  const getTimelineToneClass = (tone: ProjectTimelineItem["tone"]) => {
    switch (tone) {
      case "success":
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
      case "warning":
        return "border-amber-500/30 bg-amber-500/10 text-amber-200";
      case "info":
        return "border-blue-500/30 bg-blue-500/10 text-blue-200";
      default:
        return "border-slate-700/70 bg-slate-900/60 text-slate-200";
    }
  };

  const getPostmortemSeverityClass = (severity: ProjectPostmortemItem["severity"]) => {
    switch (severity) {
      case "high":
        return "border-rose-500/40 bg-rose-500/10 text-rose-200";
      case "medium":
        return "border-amber-500/40 bg-amber-500/10 text-amber-200";
      default:
        return "border-blue-500/40 bg-blue-500/10 text-blue-200";
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">
            {t({ ko: "프로젝트 정보", en: "Project Info", ja: "プロジェクト情報", zh: "项目信息" })}
          </h4>
          {selectedProject?.github_repo && (
            <a
              href={`https://github.com/${selectedProject.github_repo}`}
              target="_blank"
              rel="noopener noreferrer"
              title={selectedProject.github_repo}
              className="flex items-center gap-1 rounded-md border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-blue-500 hover:text-white"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              {selectedProject.github_repo}
            </a>
          )}
        </div>
        {loadingDetail ? (
          <p className="mt-2 text-xs text-slate-400">
            {t({ ko: "불러오는 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
          </p>
        ) : isCreating ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({
              ko: "신규 프로젝트를 입력 중입니다",
              en: "Creating a new project",
              ja: "新規プロジェクトを入力中です",
              zh: "正在输入新项目",
            })}
          </p>
        ) : !selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({ ko: "프로젝트를 선택하세요", en: "Select a project", ja: "プロジェクトを選択", zh: "请选择项目" })}
          </p>
        ) : (
          <div className="mt-2 space-y-2 text-xs">
            <p className="text-slate-200">
              <span className="text-slate-500">ID:</span> {selectedProject.id}
            </p>
            <p className="break-all text-slate-200">
              <span className="text-slate-500">Path:</span> {selectedProject.project_path}
            </p>
            <p className="break-all text-slate-200">
              <span className="text-slate-500">Goal:</span> {selectedProject.core_goal}
            </p>
            {intelligence && (
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
                  {t({ ko: "건강 점수", en: "Health Score", ja: "健全性スコア", zh: "健康分" })}: {intelligence.summary.health_score}
                </span>
                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                  {t({ ko: "정체", en: "Stale", ja: "停滞", zh: "停滞" })}: {intelligence.summary.stale_tasks}
                </span>
                <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-200">
                  {t({ ko: "검토 대기", en: "Review Queue", ja: "レビュー待ち", zh: "审核队列" })}: {intelligence.summary.review_backlog}
                </span>
                <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
                  {t({ ko: "미배정", en: "Ownerless", ja: "未割当", zh: "无负责人" })}: {intelligence.summary.ownerless_tasks}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-white">
            {t({ ko: "추천 액션", en: "Recommended Actions", ja: "推奨アクション", zh: "推荐动作" })}
          </h4>
        </div>
        {followupNotice && <p className="mb-3 text-[11px] text-emerald-300">{followupNotice}</p>}
        {!selectedProject ? (
          <p className="text-xs text-slate-500">-</p>
        ) : (intelligence?.recommended_actions?.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-500">
            {t({ ko: "추천 액션이 없습니다", en: "No recommended actions", ja: "推奨アクションなし", zh: "暂无推荐动作" })}
          </p>
        ) : (
          <div className="space-y-2">
            {intelligence?.recommended_actions.map((action) => (
              <div key={action.id} className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-100">{action.title}</p>
                  <span className="rounded-md border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                    {action.priority}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{action.detail}</p>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={followupBusyKey === `action:${action.id}`}
                    onClick={() =>
                      void onCreateFollowupTask({
                        key: `action:${action.id}`,
                        title: action.title,
                        detail: action.detail,
                      })
                    }
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {followupBusyKey === `action:${action.id}`
                      ? t({ ko: "생성 중...", en: "Creating...", ja: "作成中...", zh: "创建中..." })
                      : t({ ko: "후속 작업 생성", en: "Create Follow-up", ja: "フォローアップ作成", zh: "创建跟进任务" })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-white">
              {t({ ko: "프로젝트 타임라인", en: "Project Timeline", ja: "プロジェクトタイムライン", zh: "项目时间线" })}
            </h4>
            <span className="rounded-md border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300">
              {intelligence?.summary.timeline_events ?? 0}
            </span>
          </div>
          {!selectedProject ? (
            <p className="text-xs text-slate-500">-</p>
          ) : timeline.length === 0 ? (
            <p className="text-xs text-slate-500">
              {t({ ko: "표시할 이벤트가 없습니다", en: "No timeline events", ja: "イベントなし", zh: "暂无时间线事件" })}
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {timeline.map((item) => (
                <div key={item.id} className={`rounded-lg border px-3 py-2 ${getTimelineToneClass(item.tone)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{item.title}</p>
                    <p className="text-[11px] text-slate-400">{fmtTime(item.created_at)}</p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-300">{item.summary}</p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>{item.actor_name || "-"}</span>
                    {item.task_id && (
                      <button
                        type="button"
                        onClick={() => void handleOpenTaskDetail(item.task_id!)}
                        className="rounded-md border border-slate-600 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800"
                      >
                        {t({ ko: "열기", en: "Open", ja: "開く", zh: "打开" })}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-white">
              {t({
                ko: "실패/정체 복기",
                en: "Failure Postmortems",
                ja: "失敗・停滞レビュー",
                zh: "失败与停滞复盘",
              })}
            </h4>
            <span className="rounded-md border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300">
              {intelligence?.summary.open_incidents ?? 0}
            </span>
          </div>
          {!selectedProject ? (
            <p className="text-xs text-slate-500">-</p>
          ) : postmortems.length === 0 ? (
            <p className="text-xs text-slate-500">
              {t({
                ko: "현재 열려 있는 복기 항목이 없습니다",
                en: "No active postmortems",
                ja: "現在アクティブな復盤項目はありません",
                zh: "当前没有活跃复盘项",
              })}
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {postmortems.map((item) => (
                <div key={item.task_id} className={`rounded-lg border px-3 py-2 ${getPostmortemSeverityClass(item.severity)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleOpenTaskDetail(item.task_id)}
                      className="truncate text-left text-xs font-semibold text-white hover:underline"
                    >
                      {item.title}
                    </button>
                    <span className="rounded-md border border-current/30 px-1.5 py-0.5 text-[10px] uppercase">
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-200">{item.summary}</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {t({ ko: "담당", en: "Owner", ja: "担当", zh: "负责人" })}: {item.owner_name || "-"} ·{" "}
                    {t({ ko: "정체", en: "Stale", ja: "停滞", zh: "停滞" })}: {item.staleness_hours}h
                  </p>
                  {item.evidence.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {item.evidence.map((entry, index) => (
                        <p key={`${item.task_id}-e-${index}`} className="text-[11px] text-slate-300">
                          - {entry}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.next_actions.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {item.next_actions.map((entry, index) => (
                        <p key={`${item.task_id}-n-${index}`} className="text-[11px] text-emerald-300">
                          + {entry}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={followupBusyKey === `postmortem:${item.task_id}`}
                      onClick={() =>
                        void onCreateFollowupTask({
                          key: `postmortem:${item.task_id}`,
                          title: item.title,
                          detail: [item.summary, ...item.next_actions].join("\n"),
                        })
                      }
                      className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {followupBusyKey === `postmortem:${item.task_id}`
                        ? t({ ko: "생성 중...", en: "Creating...", ja: "作成中...", zh: "创建中..." })
                        : t({ ko: "후속 작업 생성", en: "Create Follow-up", ja: "フォローアップ作成", zh: "创建跟进任务" })}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <h4 className="text-sm font-semibold text-white">
          {t({ ko: "작업 이력", en: "Task History", ja: "作業履歴", zh: "任务历史" })}
        </h4>
        {!selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">-</p>
        ) : groupedTaskCards.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({ ko: "연결된 작업이 없습니다", en: "No mapped tasks", ja: "紐づくタスクなし", zh: "没有映射任务" })}
          </p>
        ) : (
          <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
            {groupedTaskCards.map((group) => (
              <button
                key={group.root.id}
                type="button"
                onClick={() => void handleOpenTaskDetail(group.root.id)}
                className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-left transition hover:border-blue-500/70 hover:bg-slate-900"
              >
                <p className="whitespace-pre-wrap break-all text-xs font-semibold text-slate-100">{group.root.title}</p>
                <p className="mt-1 break-all text-[11px] text-slate-400">
                  {group.root.status} · {group.root.task_type} · {fmtTime(group.root.created_at)}
                </p>
                <p className="mt-1 break-all text-[11px] text-slate-500">
                  {t({ ko: "담당", en: "Owner", ja: "担当", zh: "负责人" })}:{" "}
                  {group.root.assigned_agent_name_ko || group.root.assigned_agent_name || "-"}
                </p>
                <p className="mt-1 text-[11px] text-blue-300">
                  {t({ ko: "하위 작업", en: "Sub tasks", ja: "サブタスク", zh: "子任务" })}: {group.children.length}
                </p>
                {group.children.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {group.children.slice(0, 3).map((child: ProjectTaskHistoryItem) => (
                      <p key={child.id} className="whitespace-pre-wrap break-all text-[11px] text-slate-500">
                        - {child.title}
                      </p>
                    ))}
                    {group.children.length > 3 && (
                      <p className="text-[11px] text-slate-500">+{group.children.length - 3}</p>
                    )}
                  </div>
                )}
                <p className="mt-2 text-right text-[11px] text-emerald-300">
                  {t({
                    ko: "카드 클릭으로 상세 보기",
                    en: "Click card for details",
                    ja: "クリックで詳細表示",
                    zh: "点击卡片查看详情",
                  })}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <h4 className="text-sm font-semibold text-white">
          {t({ ko: "보고서 이력(프로젝트 매핑)", en: "Mapped Reports", ja: "紐づくレポート", zh: "映射报告" })}
        </h4>
        {!selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">-</p>
        ) : sortedReports.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({
              ko: "연결된 보고서가 없습니다",
              en: "No mapped reports",
              ja: "紐づくレポートなし",
              zh: "没有映射报告",
            })}
          </p>
        ) : (
          <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
            {sortedReports.map((row) => (
              <div
                key={row.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-all text-xs font-medium text-slate-100">{row.title}</p>
                  <p className="text-[11px] text-slate-400">{fmtTime(row.completed_at || row.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleOpenTaskDetail(row.id)}
                  className="shrink-0 rounded-md bg-emerald-700 px-2 py-1 text-[11px] text-white hover:bg-emerald-600"
                >
                  {t({ ko: "열람", en: "Open", ja: "表示", zh: "查看" })}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <h4 className="text-sm font-semibold text-white">
          {t({ ko: "대표 선택사항", en: "Representative Decisions", ja: "代表選択事項", zh: "代表选择事项" })}
        </h4>
        {!selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">-</p>
        ) : sortedDecisionEvents.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({
              ko: "기록된 대표 의사결정이 없습니다",
              en: "No representative decision records",
              ja: "代表意思決定の記録はありません",
              zh: "暂无代表决策记录",
            })}
          </p>
        ) : (
          <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
            {sortedDecisionEvents.map((event) => {
              let selectedLabels: string[] = [];
              if (event.selected_options_json) {
                try {
                  const parsed = JSON.parse(event.selected_options_json) as Array<{ label?: unknown }>;
                  selectedLabels = Array.isArray(parsed)
                    ? parsed
                        .map((row) => (typeof row?.label === "string" ? row.label.trim() : ""))
                        .filter((label) => label.length > 0)
                    : [];
                } catch {
                  selectedLabels = [];
                }
              }

              return (
                <div
                  key={`${event.id}-${event.created_at}`}
                  className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-semibold text-slate-100">
                      {getDecisionEventLabel(event.event_type)}
                    </p>
                    <p className="text-[11px] text-slate-400">{fmtTime(event.created_at)}</p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-300">{event.summary}</p>
                  {selectedLabels.length > 0 && (
                    <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-blue-300">
                      {t({ ko: "선택 내용", en: "Selected Items", ja: "選択内容", zh: "已选内容" })}:{" "}
                      {selectedLabels.join(" / ")}
                    </p>
                  )}
                  {event.note && event.note.trim().length > 0 && (
                    <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-emerald-300">
                      {t({ ko: "추가 요청사항", en: "Additional Request", ja: "追加要請事項", zh: "追加请求事项" })}:{" "}
                      {event.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
