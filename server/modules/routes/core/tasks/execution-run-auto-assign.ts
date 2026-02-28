import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  DEFAULT_WORKFLOW_PACK_KEY,
  isWorkflowPackKey,
  type WorkflowPackKey,
} from "../../../workflow/packs/definitions.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

type ProjectAssignmentModeRow = {
  assignment_mode?: string | null;
};

type ProjectAgentRow = {
  agent_id: string;
};

export type AutoAssignableAgent = {
  id: string;
  name: string;
  department_id: string | null;
  role: string;
  cli_provider: string | null;
  status: string;
  current_task_id: string | null;
  stats_tasks_done: number;
  created_at: number;
};

type CandidateTaskShape = {
  workflow_pack_key?: string | null;
  department_id?: string | null;
  project_id?: string | null;
};

export type AutoAssignSelectionResult = {
  packKey: WorkflowPackKey;
  agent: AutoAssignableAgent;
};

const PACK_DEPARTMENT_PRIORITIES: Record<WorkflowPackKey, string[]> = {
  development: ["dev", "qa", "devsecops", "operations", "planning", "design"],
  report: ["planning", "qa", "design", "dev", "operations", "devsecops"],
  web_research_report: ["dev", "planning", "qa", "design", "operations", "devsecops"],
  video_preprod: ["design", "planning", "dev", "operations", "qa", "devsecops"],
  novel: ["design", "planning", "dev", "qa", "operations", "devsecops"],
  roleplay: ["design", "planning", "qa", "dev", "operations", "devsecops"],
};

function normalizePackKey(raw: string | null | undefined): WorkflowPackKey {
  if (isWorkflowPackKey(raw)) return raw;
  return DEFAULT_WORKFLOW_PACK_KEY;
}

function buildPreferredDepartmentOrder(packKey: WorkflowPackKey, taskDepartmentId: string | null | undefined): string[] {
  const preferred = PACK_DEPARTMENT_PRIORITIES[packKey] ?? PACK_DEPARTMENT_PRIORITIES[DEFAULT_WORKFLOW_PACK_KEY];
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    if (!value) return;
    if (out.includes(value)) return;
    out.push(value);
  };

  add(taskDepartmentId);
  for (const deptId of preferred) add(deptId);
  return out;
}

function loadManualProjectAgentScope(db: DbLike, projectId: string | null | undefined): string[] | null {
  if (!projectId) return null;
  const project = db.prepare("SELECT assignment_mode FROM projects WHERE id = ?").get(projectId) as
    | ProjectAssignmentModeRow
    | undefined;
  if (project?.assignment_mode !== "manual") return null;
  const rows = db.prepare("SELECT agent_id FROM project_agents WHERE project_id = ?").all(projectId) as ProjectAgentRow[];
  return rows.map((row) => row.agent_id).filter((id) => typeof id === "string" && id.length > 0);
}

function selectCandidate(
  db: DbLike,
  preferredDeptIds: string[],
  manualAgentScope: string[] | null,
): AutoAssignableAgent | null {
  if (Array.isArray(manualAgentScope) && manualAgentScope.length === 0) {
    return null;
  }

  const conditions: string[] = [
    "cli_provider IS NOT NULL",
    "status IN ('idle', 'break')",
    "(current_task_id IS NULL OR current_task_id = '')",
  ];
  const params: SQLInputValue[] = [];

  if (preferredDeptIds.length > 0) {
    conditions.push(`department_id IN (${preferredDeptIds.map(() => "?").join(", ")})`);
    params.push(...preferredDeptIds);
  }

  if (Array.isArray(manualAgentScope)) {
    conditions.push(`id IN (${manualAgentScope.map(() => "?").join(", ")})`);
    params.push(...manualAgentScope);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `
      SELECT id, name, department_id, role, cli_provider, status, current_task_id, stats_tasks_done, created_at
      FROM agents
      ${where}
      ORDER BY created_at ASC
    `,
    )
    .all(...params) as AutoAssignableAgent[];
  if (rows.length === 0) return null;

  const deptRank = (deptId: string | null): number => {
    if (!deptId) return preferredDeptIds.length + 1;
    const index = preferredDeptIds.indexOf(deptId);
    return index >= 0 ? index : preferredDeptIds.length;
  };
  const statusRank = (status: string): number => (status === "idle" ? 0 : status === "break" ? 1 : 2);
  const leaderRank = (role: string): number => (role === "team_leader" ? 1 : 0);

  rows.sort((a, b) => {
    const byDept = deptRank(a.department_id) - deptRank(b.department_id);
    if (byDept !== 0) return byDept;

    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;

    const byLeader = leaderRank(a.role) - leaderRank(b.role);
    if (byLeader !== 0) return byLeader;

    const byTasksDone = (a.stats_tasks_done ?? 0) - (b.stats_tasks_done ?? 0);
    if (byTasksDone !== 0) return byTasksDone;

    return (a.created_at ?? 0) - (b.created_at ?? 0);
  });

  return rows[0] ?? null;
}

export function selectAutoAssignableAgentForTask(
  db: DbLike,
  task: CandidateTaskShape,
): AutoAssignSelectionResult | null {
  const packKey = normalizePackKey(task.workflow_pack_key);
  const preferredDeptIds = buildPreferredDepartmentOrder(packKey, task.department_id);
  const manualAgentScope = loadManualProjectAgentScope(db, task.project_id);

  const preferredCandidate = selectCandidate(db, preferredDeptIds, manualAgentScope);
  if (preferredCandidate) {
    return { packKey, agent: preferredCandidate };
  }

  const fallbackCandidate = selectCandidate(db, [], manualAgentScope);
  if (!fallbackCandidate) return null;

  return { packKey, agent: fallbackCandidate };
}
