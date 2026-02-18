import { useState, useMemo } from "react";
import type { Agent, Task, Department, SubTask } from "../types";
import * as api from "../api";
import AgentAvatar from "./AgentAvatar";

interface SubAgent {
  id: string;
  parentAgentId: string;
  task: string;
  status: "working" | "done";
}

interface AgentDetailProps {
  agent: Agent;
  agents: Agent[];
  department: Department | undefined;
  tasks: Task[];
  subAgents: SubAgent[];
  subtasks: SubTask[];
  onClose: () => void;
  onChat: (agent: Agent) => void;
  onAssignTask: (agentId: string) => void;
  onOpenTerminal?: (taskId: string) => void;
  onAgentUpdated?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  team_leader: "팀장",
  senior: "시니어",
  junior: "주니어",
  intern: "인턴",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  idle: { label: "대기중", color: "text-green-400", bg: "bg-green-500/20" },
  working: { label: "근무중", color: "text-blue-400", bg: "bg-blue-500/20" },
  break: { label: "휴식중", color: "text-yellow-400", bg: "bg-yellow-500/20" },
  offline: {
    label: "오프라인",
    color: "text-slate-400",
    bg: "bg-slate-500/20",
  },
};

const CLI_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
  antigravity: "Antigravity",
};

const SUBTASK_STATUS_ICON: Record<string, string> = {
  pending: '\u23F3',
  in_progress: '\uD83D\uDD28',
  done: '\u2705',
  blocked: '\uD83D\uDEAB',
};

export default function AgentDetail({
  agent,
  agents,
  department,
  tasks,
  subAgents,
  subtasks,
  onClose,
  onChat,
  onAssignTask,
  onOpenTerminal,
  onAgentUpdated,
}: AgentDetailProps) {
  const [tab, setTab] = useState<"info" | "tasks" | "alba">("info");
  const [editingCli, setEditingCli] = useState(false);
  const [selectedCli, setSelectedCli] = useState(agent.cli_provider);
  const [savingCli, setSavingCli] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const agentTasks = tasks.filter((t) => t.assigned_agent_id === agent.id);

  const subtasksByTask = useMemo(() => {
    const map: Record<string, SubTask[]> = {};
    for (const st of subtasks) {
      if (!map[st.task_id]) map[st.task_id] = [];
      map[st.task_id].push(st);
    }
    return map;
  }, [subtasks]);
  const agentSubAgents = subAgents.filter(
    (s) => s.parentAgentId === agent.id
  );
  const statusCfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
  const doneTasks = agentTasks.filter((t) => t.status === "done").length;

  const xpLevel = Math.floor(agent.stats_xp / 100) + 1;
  const xpProgress = agent.stats_xp % 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-[480px] max-h-[80vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div
          className="relative px-6 py-5 border-b border-slate-700"
          style={{
            background: department
              ? `linear-gradient(135deg, ${department.color}22, transparent)`
              : undefined,
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-700/50 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>

          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative">
              <AgentAvatar
                agent={agent}
                agents={agents}
                size={64}
                rounded="2xl"
                className={agent.status === "working" ? "animate-agent-work" : ""}
              />
              <div
                className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-800 ${
                  agent.status === "working"
                    ? "bg-blue-500"
                    : agent.status === "idle"
                    ? "bg-green-500"
                    : agent.status === "break"
                    ? "bg-yellow-500"
                    : "bg-slate-500"
                }`}
              />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{agent.name}</h2>
                <span className={`text-xs px-1.5 py-0.5 rounded ${statusCfg.bg} ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
              </div>
              <div className="text-sm text-slate-400 mt-0.5">
                {department?.icon} {department?.name_ko} ·{" "}
                {ROLE_LABELS[agent.role] ?? agent.role}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                {editingCli ? (
                  <>
                    <span>🔧</span>
                    <select
                      value={selectedCli}
                      onChange={(e) => setSelectedCli(e.target.value)}
                      className="bg-slate-700 text-slate-200 text-xs rounded px-1.5 py-0.5 border border-slate-600 focus:outline-none focus:border-blue-500"
                    >
                      {Object.entries(CLI_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <button
                      disabled={savingCli}
                      onClick={async () => {
                        setSavingCli(true);
                        try {
                          await api.updateAgent(agent.id, { cli_provider: selectedCli });
                          onAgentUpdated?.();
                          setEditingCli(false);
                        } catch (e) {
                          console.error("Failed to update CLI:", e);
                        } finally {
                          setSavingCli(false);
                        }
                      }}
                      className="text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {savingCli ? "..." : "저장"}
                    </button>
                    <button
                      onClick={() => { setEditingCli(false); setSelectedCli(agent.cli_provider); }}
                      className="text-[10px] px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 text-slate-300 rounded transition-colors"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditingCli(true)}
                    className="flex items-center gap-1 hover:text-slate-300 transition-colors"
                    title="클릭하여 CLI 변경"
                  >
                    🔧 {CLI_LABELS[agent.cli_provider] ?? agent.cli_provider}
                    <span className="text-[9px] text-slate-600 ml-0.5">✏️</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Level bar */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-yellow-400 font-bold">
              Lv.{xpLevel}
            </span>
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-500 to-amber-400 rounded-full transition-all"
                style={{ width: `${xpProgress}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500">
              {agent.stats_xp} XP
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700">
          {[
            { key: "info", label: "정보" },
            { key: "tasks", label: `업무 (${agentTasks.length})` },
            {
              key: "alba",
              label: `알바생 (${agentSubAgents.length})`,
            },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[40vh]">
          {tab === "info" && (
            <div className="space-y-3">
              <div className="bg-slate-700/30 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">성격</div>
                <div className="text-sm text-slate-300">
                  {agent.personality ?? "설정 없음"}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-white">
                    {agent.stats_tasks_done}
                  </div>
                  <div className="text-[10px] text-slate-500">완료 업무</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-white">{xpLevel}</div>
                  <div className="text-[10px] text-slate-500">레벨</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-white">
                    {agentSubAgents.filter((s) => s.status === "working").length}
                  </div>
                  <div className="text-[10px] text-slate-500">알바생</div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => onChat(agent)}
                  className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  💬 대화하기
                </button>
                <button
                  onClick={() => onAssignTask(agent.id)}
                  className="flex-1 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                >
                  📋 업무 배정
                </button>
              </div>
              {agent.status === "working" && agent.current_task_id && onOpenTerminal && (
                <button
                  onClick={() => onOpenTerminal(agent.current_task_id!)}
                  className="w-full mt-2 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  &#128421; 터미널 보기
                </button>
              )}
            </div>
          )}

          {tab === "tasks" && (
            <div className="space-y-2">
              {agentTasks.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  배정된 업무가 없습니다
                </div>
              ) : (
                agentTasks.map((t) => {
                  const tSubs = subtasksByTask[t.id] ?? [];
                  const isExpanded = expandedTaskId === t.id;
                  const subTotal = t.subtask_total ?? tSubs.length;
                  const subDone = t.subtask_done ?? tSubs.filter(s => s.status === 'done').length;
                  return (
                    <div key={t.id} className="bg-slate-700/30 rounded-lg p-3">
                      <button
                        onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                        className="flex items-start gap-3 w-full text-left"
                      >
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                            t.status === "done"
                              ? "bg-green-500"
                              : t.status === "in_progress"
                              ? "bg-blue-500"
                              : "bg-slate-500"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white truncate">
                            {t.title}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {t.status} · {t.task_type}
                          </div>
                          {subTotal > 0 && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <div className="flex-1 h-1 bg-slate-600 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all"
                                  style={{ width: `${Math.round((subDone / subTotal) * 100)}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                {subDone}/{subTotal}
                              </span>
                            </div>
                          )}
                        </div>
                      </button>
                      {isExpanded && tSubs.length > 0 && (
                        <div className="mt-2 ml-5 space-y-1 border-l border-slate-600 pl-2">
                          {tSubs.map((st) => (
                            <div key={st.id} className="flex items-center gap-1.5 text-xs">
                              <span>{SUBTASK_STATUS_ICON[st.status] || '\u23F3'}</span>
                              <span className={`flex-1 truncate ${st.status === 'done' ? 'line-through text-slate-500' : 'text-slate-300'}`}>
                                {st.title}
                              </span>
                              {st.status === 'blocked' && st.blocked_reason && (
                                <span className="text-red-400 text-[10px] truncate max-w-[80px]" title={st.blocked_reason}>
                                  {st.blocked_reason}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {tab === "alba" && (
            <div className="space-y-2">
              {agentSubAgents.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <div className="text-3xl mb-2">🧑‍💼</div>
                  현재 알바생이 없습니다
                  <div className="text-xs mt-1 text-slate-600">
                    병렬 처리 시 자동으로 알바생이 소환됩니다
                  </div>
                </div>
              ) : (
                agentSubAgents.map((s) => (
                  <div
                    key={s.id}
                    className={`bg-slate-700/30 rounded-lg p-3 flex items-center gap-3 ${
                      s.status === "working" ? "animate-alba-spawn" : ""
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-sm">
                      🧑‍💼
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate flex items-center gap-1.5">
                        <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
                          알바
                        </span>
                        {s.task}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {s.status === "working" ? "🔨 작업중..." : "✅ 완료"}
                      </div>
                    </div>
                    {s.status === "working" && (
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
