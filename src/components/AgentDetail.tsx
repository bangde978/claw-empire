import { useState } from "react";
import type { Agent, Task, Department } from "../types";

interface SubAgent {
  id: string;
  parentAgentId: string;
  task: string;
  status: "working" | "done";
}

interface AgentDetailProps {
  agent: Agent;
  department: Department | undefined;
  tasks: Task[];
  subAgents: SubAgent[];
  onClose: () => void;
  onChat: (agent: Agent) => void;
  onAssignTask: (agentId: string) => void;
  onOpenTerminal?: (taskId: string) => void;
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

export default function AgentDetail({
  agent,
  department,
  tasks,
  subAgents,
  onClose,
  onChat,
  onAssignTask,
  onOpenTerminal,
}: AgentDetailProps) {
  const [tab, setTab] = useState<"info" | "tasks" | "alba">("info");
  const agentTasks = tasks.filter((t) => t.assigned_agent_id === agent.id);
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
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl ${
                  agent.status === "working"
                    ? "animate-agent-work"
                    : ""
                }`}
                style={{
                  background: department
                    ? `${department.color}33`
                    : "#334155",
                }}
              >
                {agent.avatar_emoji}
              </div>
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
              <div className="text-xs text-slate-500 mt-0.5">
                🔧 {CLI_LABELS[agent.cli_provider] ?? agent.cli_provider}
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
                agentTasks.map((t) => (
                  <div
                    key={t.id}
                    className="bg-slate-700/30 rounded-lg p-3 flex items-start gap-3"
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
                    </div>
                  </div>
                ))
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
