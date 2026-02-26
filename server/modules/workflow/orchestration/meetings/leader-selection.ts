interface AgentRow {
  id: string;
  name: string;
  name_ko: string;
  role: string;
  personality: string | null;
  status: string;
  department_id: string | null;
  current_task_id: string | null;
  avatar_emoji: string;
  cli_provider: string | null;
  oauth_account_id: string | null;
  api_provider_id: string | null;
  api_model: string | null;
  cli_model: string | null;
  cli_reasoning_level: string | null;
}

type LeaderSelectionDeps = {
  db: any;
  findTeamLeader: (departmentId: string) => AgentRow | null;
  detectTargetDepartments: (text: string) => string[];
};

export function createMeetingLeaderSelectionTools(deps: LeaderSelectionDeps) {
  const { db, findTeamLeader, detectTargetDepartments } = deps;

  function getLeadersByDepartmentIds(deptIds: string[]): AgentRow[] {
    const out: AgentRow[] = [];
    const seen = new Set<string>();
    for (const deptId of deptIds) {
      if (!deptId) continue;
      const leader = findTeamLeader(deptId);
      if (!leader || seen.has(leader.id)) continue;
      out.push(leader);
      seen.add(leader.id);
    }
    return out;
  }

  function getAllActiveTeamLeaders(): AgentRow[] {
    return db
      .prepare(
        `
    SELECT a.*
    FROM agents a
    LEFT JOIN departments d ON a.department_id = d.id
    WHERE a.role = 'team_leader' AND a.status != 'offline'
    ORDER BY d.sort_order ASC, a.name ASC
  `,
      )
      .all() as unknown as AgentRow[];
  }

  function getTaskRelatedDepartmentIds(taskId: string, fallbackDeptId: string | null): string[] {
    const task = db.prepare("SELECT title, description, department_id FROM tasks WHERE id = ?").get(taskId) as
      | { title: string; description: string | null; department_id: string | null }
      | undefined;

    const deptSet = new Set<string>();
    if (fallbackDeptId) deptSet.add(fallbackDeptId);
    if (task?.department_id) deptSet.add(task.department_id);

    const subtaskDepts = db
      .prepare(
        "SELECT DISTINCT target_department_id FROM subtasks WHERE task_id = ? AND target_department_id IS NOT NULL",
      )
      .all(taskId) as Array<{ target_department_id: string | null }>;
    for (const row of subtaskDepts) {
      if (row.target_department_id) deptSet.add(row.target_department_id);
    }

    const sourceText = `${task?.title ?? ""} ${task?.description ?? ""}`;
    for (const deptId of detectTargetDepartments(sourceText)) {
      deptSet.add(deptId);
    }

    return [...deptSet];
  }

  function getTaskReviewLeaders(
    taskId: string,
    fallbackDeptId: string | null,
    opts?: { minLeaders?: number; includePlanning?: boolean; fallbackAll?: boolean },
  ): AgentRow[] {
    // 프로젝트 manual 모드 확인 — 지정 직원의 부서 팀장만 참석
    const taskRow = db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(taskId) as
      | { project_id: string | null }
      | undefined;
    if (taskRow?.project_id) {
      const proj = db.prepare("SELECT assignment_mode FROM projects WHERE id = ?").get(taskRow.project_id) as
        | { assignment_mode: string }
        | undefined;
      if (proj?.assignment_mode === "manual") {
        const assignedAgents = db
          .prepare(
            "SELECT DISTINCT a.department_id FROM project_agents pa JOIN agents a ON a.id = pa.agent_id WHERE pa.project_id = ?",
          )
          .all(taskRow.project_id) as Array<{ department_id: string | null }>;
        const manualDeptIds = assignedAgents.map((r) => r.department_id).filter(Boolean) as string[];
        const leaders = getLeadersByDepartmentIds(manualDeptIds);
        const seen = new Set(leaders.map((l) => l.id));
        // 기획팀장은 항상 포함
        const planningLeader = findTeamLeader("planning");
        if (planningLeader && !seen.has(planningLeader.id)) {
          leaders.unshift(planningLeader);
        }
        return leaders;
      }
    }

    const deptIds = getTaskRelatedDepartmentIds(taskId, fallbackDeptId);
    const leaders = getLeadersByDepartmentIds(deptIds);
    const includePlanning = opts?.includePlanning ?? true;
    const minLeaders = opts?.minLeaders ?? 2;
    const fallbackAll = opts?.fallbackAll ?? true;

    const seen = new Set(leaders.map((l) => l.id));
    if (includePlanning) {
      const planningLeader = findTeamLeader("planning");
      if (planningLeader && !seen.has(planningLeader.id)) {
        leaders.unshift(planningLeader);
        seen.add(planningLeader.id);
      }
    }

    // If related departments are not detectable, expand to all team leaders
    // so approval is based on real multi-party communication.
    if (fallbackAll && leaders.length < minLeaders) {
      for (const leader of getAllActiveTeamLeaders()) {
        if (seen.has(leader.id)) continue;
        leaders.push(leader);
        seen.add(leader.id);
      }
    }

    return leaders;
  }

  return {
    getLeadersByDepartmentIds,
    getAllActiveTeamLeaders,
    getTaskRelatedDepartmentIds,
    getTaskReviewLeaders,
  };
}
