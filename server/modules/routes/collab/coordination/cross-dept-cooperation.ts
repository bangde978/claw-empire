import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Lang } from "../../../../types/lang.ts";
import { resolveWorkflowPackKeyForTask } from "../../../workflow/packs/task-pack-resolver.ts";
import type { AgentRow } from "./types.ts";

interface CrossDeptContext {
  teamLeader: AgentRow;
  taskTitle: string;
  ceoMessage: string;
  leaderDeptId: string;
  leaderDeptName: string;
  leaderName: string;
  lang: Lang;
  taskId: string;
  projectId?: string | null;
  projectCandidateAgentIds?: string[] | null;
}
type CrossDeptCooperationDeps = any;

export function createCrossDeptCooperationTools(deps: CrossDeptCooperationDeps) {
  const {
    db,
    nowMs,
    appendTaskLog,
    broadcast,
    recordTaskCreationAudit,
    delegatedTaskToSubtask,
    crossDeptNextCallbacks,
    findTeamLeader,
    findBestSubordinate,
    resolveLang,
    getDeptName,
    getAgentDisplayName,
    sendAgentMessage,
    notifyCeo,
    l,
    pickL,
    startTaskExecutionForAgent,
    linkCrossDeptTaskToParentSubtask,
    detectProjectPath,
    resolveProjectPath,
    logsDir,
    getDeptRoleConstraint,
    getRecentConversationContext,
    buildAvailableSkillsPromptBlock,
    buildTaskExecutionPrompt,
    hasExplicitWarningFixRequest,
    ensureTaskExecutionSession,
    getProviderModelConfig,
    spawnCliAgent,
    handleSubtaskDelegationComplete,
    handleTaskRunComplete,
    startProgressTimer,
  } = deps;

  function getProjectCandidateAgentIds(projectId: string | null | undefined): string[] | null {
    const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
    if (!normalizedProjectId) return null;

    const project = db.prepare("SELECT assignment_mode FROM projects WHERE id = ?").get(normalizedProjectId) as
      | { assignment_mode?: string }
      | undefined;
    if (project?.assignment_mode !== "manual") return null;

    return (
      db.prepare("SELECT agent_id FROM project_agents WHERE project_id = ?").all(normalizedProjectId) as Array<{
        agent_id: string;
      }>
    ).map((row) => row.agent_id);
  }

  function pickManualPoolAgent(
    candidateAgentIds: string[],
    preferredDeptId?: string | null,
    excludeIds: string[] = [],
  ): AgentRow | null {
    const candidateIds = [
      ...new Set(candidateAgentIds.map((id) => String(id || "").trim()).filter((id) => id.length > 0)),
    ];
    if (candidateIds.length === 0) return null;

    const excludedIds = [...new Set(excludeIds.map((id) => String(id || "").trim()).filter((id) => id.length > 0))];
    const idPlaceholders = candidateIds.map(() => "?").join(",");
    const params: unknown[] = [...candidateIds];

    const deptClause = preferredDeptId ? "AND department_id = ?" : "";
    if (preferredDeptId) params.push(preferredDeptId);

    const excludeClause = excludedIds.length > 0 ? `AND id NOT IN (${excludedIds.map(() => "?").join(",")})` : "";
    if (excludedIds.length > 0) params.push(...excludedIds);

    const agents = db
      .prepare(
        `SELECT * FROM agents WHERE id IN (${idPlaceholders}) ${deptClause} ${excludeClause} ORDER BY
         CASE status WHEN 'idle' THEN 0 WHEN 'break' THEN 1 WHEN 'working' THEN 2 ELSE 3 END,
         CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 WHEN 'intern' THEN 2 WHEN 'team_leader' THEN 3 ELSE 4 END`,
      )
      .all(...params) as unknown as AgentRow[];
    return agents[0] ?? null;
  }

  function recoverCrossDeptQueueAfterMissingCallback(completedChildTaskId: string): void {
    const child = db.prepare("SELECT source_task_id FROM tasks WHERE id = ?").get(completedChildTaskId) as
      | { source_task_id: string | null }
      | undefined;
    if (!child?.source_task_id) return;

    const parent = db
      .prepare(
        `
    SELECT id, title, description, department_id, project_id, status, assigned_agent_id, started_at
    FROM tasks
    WHERE id = ?
  `,
      )
      .get(child.source_task_id) as
      | {
          id: string;
          title: string;
          description: string | null;
          department_id: string | null;
          project_id: string | null;
          status: string;
          assigned_agent_id: string | null;
          started_at: number | null;
        }
      | undefined;
    if (!parent || parent.status !== "collaborating" || !parent.department_id) return;

    const activeSibling = db
      .prepare(
        `
    SELECT 1
    FROM tasks
    WHERE source_task_id = ?
      AND status IN ('planned', 'pending', 'collaborating', 'in_progress', 'review')
    LIMIT 1
  `,
      )
      .get(parent.id);
    if (activeSibling) return;

    const targetDeptRows = db
      .prepare(
        `
    SELECT target_department_id
    FROM subtasks
    WHERE task_id = ?
      AND target_department_id IS NOT NULL
    ORDER BY created_at ASC
  `,
      )
      .all(parent.id) as Array<{ target_department_id: string | null }>;
    const deptIds: string[] = [];
    const seen = new Set<string>();
    for (const row of targetDeptRows) {
      if (!row.target_department_id || seen.has(row.target_department_id)) continue;
      seen.add(row.target_department_id);
      deptIds.push(row.target_department_id);
    }
    if (deptIds.length === 0) return;

    const doneRows = db
      .prepare(
        `
    SELECT department_id
    FROM tasks
    WHERE source_task_id = ?
      AND status = 'done'
      AND department_id IS NOT NULL
  `,
      )
      .all(parent.id) as Array<{ department_id: string | null }>;
    const doneDept = new Set(doneRows.map((r) => r.department_id).filter((v): v is string => !!v));
    const nextIndex = deptIds.findIndex((deptId) => !doneDept.has(deptId));

    const leader = findTeamLeader(parent.department_id);
    if (!leader) return;
    const lang = resolveLang(parent.description ?? parent.title);
    const projectCandidateAgentIds = getProjectCandidateAgentIds(parent.project_id);

    const delegateMainTask = () => {
      const current = db
        .prepare("SELECT status, assigned_agent_id, started_at FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string; assigned_agent_id: string | null; started_at: number | null } | undefined;
      if (!current || current.status !== "collaborating") return;
      if (current.assigned_agent_id || current.started_at) return;

      const subordinate = findBestSubordinate(parent.department_id!, leader.id, projectCandidateAgentIds);
      const manualPoolFallback =
        Array.isArray(projectCandidateAgentIds) && projectCandidateAgentIds.length > 0
          ? pickManualPoolAgent(projectCandidateAgentIds, parent.department_id, [leader.id]) ||
            pickManualPoolAgent(projectCandidateAgentIds, null, [leader.id])
          : null;
      const leaderAllowed = !Array.isArray(projectCandidateAgentIds) || projectCandidateAgentIds.includes(leader.id);
      const assignee = subordinate ?? (leaderAllowed ? leader : manualPoolFallback) ?? leader;
      const deptName = getDeptName(parent.department_id!);
      const t = nowMs();
      db.prepare("UPDATE tasks SET assigned_agent_id = ?, status = 'planned', updated_at = ? WHERE id = ?").run(
        assignee.id,
        t,
        parent.id,
      );
      db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(parent.id, assignee.id);
      appendTaskLog(
        parent.id,
        "system",
        `Recovery: cross-dept queue completed, delegated to ${assignee.name_ko || assignee.name}`,
      );
      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(parent.id));
      broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(assignee.id));
      startTaskExecutionForAgent(parent.id, assignee, parent.department_id, deptName);
    };

    if (nextIndex === -1) {
      delegateMainTask();
      return;
    }

    const ctx: CrossDeptContext = {
      teamLeader: leader,
      taskTitle: parent.title,
      ceoMessage: (parent.description ?? "").replace(/^\[CEO\]\s*/, ""),
      leaderDeptId: parent.department_id,
      leaderDeptName: getDeptName(parent.department_id),
      leaderName: getAgentDisplayName(leader, lang),
      lang,
      taskId: parent.id,
      projectId: parent.project_id,
      projectCandidateAgentIds,
    };
    const shouldResumeMainAfterAll = !parent.assigned_agent_id && !parent.started_at;
    startCrossDeptCooperation(deptIds, nextIndex, ctx, shouldResumeMainAfterAll ? delegateMainTask : undefined);
  }

  function startCrossDeptCooperation(
    deptIds: string[],
    index: number,
    ctx: CrossDeptContext,
    onAllDone?: () => void,
  ): void {
    if (index >= deptIds.length) {
      onAllDone?.();
      return;
    }

    const crossDeptId = deptIds[index];
    const crossLeader = findTeamLeader(crossDeptId);
    if (!crossLeader) {
      // Skip this dept, try next
      startCrossDeptCooperation(deptIds, index + 1, ctx, onAllDone);
      return;
    }

    const { teamLeader, taskTitle, ceoMessage, leaderDeptId, leaderDeptName, leaderName, lang, taskId } = ctx;
    const resolvedProjectId =
      ctx.projectId ??
      (db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(taskId) as { project_id: string | null } | undefined)
        ?.project_id ??
      null;
    const projectCandidateAgentIds =
      ctx.projectCandidateAgentIds !== undefined
        ? ctx.projectCandidateAgentIds
        : getProjectCandidateAgentIds(resolvedProjectId);
    const nextCtx: CrossDeptContext =
      ctx.projectId === resolvedProjectId && ctx.projectCandidateAgentIds === projectCandidateAgentIds
        ? ctx
        : {
            ...ctx,
            projectId: resolvedProjectId,
            projectCandidateAgentIds,
          };

    const crossDeptName = getDeptName(crossDeptId);
    const manualScoped = Array.isArray(projectCandidateAgentIds);
    const crossSub = manualScoped
      ? findBestSubordinate(crossDeptId, crossLeader.id, projectCandidateAgentIds)
      : findBestSubordinate(crossDeptId, crossLeader.id);
    const crossLeaderAllowed = !manualScoped || projectCandidateAgentIds.includes(crossLeader.id);
    const manualPoolFallback =
      manualScoped && projectCandidateAgentIds.length > 0
        ? pickManualPoolAgent(projectCandidateAgentIds, crossDeptId, [teamLeader.id]) ||
          pickManualPoolAgent(projectCandidateAgentIds, null, [teamLeader.id]) ||
          pickManualPoolAgent(projectCandidateAgentIds, crossDeptId) ||
          pickManualPoolAgent(projectCandidateAgentIds, null)
        : null;
    const crossCoordinator = crossLeaderAllowed ? crossLeader : (crossSub ?? manualPoolFallback ?? crossLeader);
    const crossCoordinatorName =
      lang === "ko" ? crossCoordinator.name_ko || crossCoordinator.name : crossCoordinator.name;

    // Notify remaining queue
    if (deptIds.length > 1) {
      const remaining = deptIds.length - index;
      notifyCeo(
        pickL(
          l(
            [`협업 요청 진행 중: ${crossDeptName} (${index + 1}/${deptIds.length}, 남은 ${remaining}팀 순차 진행)`],
            [
              `Collaboration request in progress: ${crossDeptName} (${index + 1}/${deptIds.length}, ${remaining} team(s) remaining in queue)`,
            ],
            [`協業依頼進行中: ${crossDeptName} (${index + 1}/${deptIds.length}、残り${remaining}チーム)`],
            [`协作请求进行中：${crossDeptName}（${index + 1}/${deptIds.length}，队列剩余${remaining}个团队）`],
          ),
          lang,
        ),
        taskId,
      );
    }

    const coopReq = pickL(
      l(
        [
          `${crossCoordinatorName}님, 안녕하세요! 대표님 지시로 "${taskTitle}" 업무 진행 중인데, ${crossDeptName} 협조가 필요합니다. 도움 부탁드려요! 🤝`,
          `${crossCoordinatorName}님! "${taskTitle}" 건으로 ${crossDeptName} 지원이 필요합니다. 시간 되시면 협의 부탁드립니다.`,
        ],
        [
          `Hi ${crossCoordinatorName}! We're working on "${taskTitle}" per CEO's directive and need ${crossDeptName}'s support. Could you help? 🤝`,
          `${crossCoordinatorName}, we need ${crossDeptName}'s input on "${taskTitle}". Let's sync when you have a moment.`,
        ],
        [`${crossCoordinatorName}さん、CEO指示の"${taskTitle}"で${crossDeptName}の協力が必要です。お願いします！🤝`],
        [`${crossCoordinatorName}，CEO安排的"${taskTitle}"需要${crossDeptName}配合，麻烦协调一下！🤝`],
      ),
      lang,
    );
    sendAgentMessage(
      teamLeader,
      coopReq,
      "chat",
      "agent",
      crossCoordinator.id === teamLeader.id ? null : crossCoordinator.id,
      taskId,
    );

    // Broadcast delivery animation event for UI
    broadcast("cross_dept_delivery", {
      from_agent_id: teamLeader.id,
      to_agent_id: crossCoordinator.id,
      task_title: taskTitle,
    });

    // Cross-department leader acknowledges AND creates a real task
    const crossAckDelay = 1500 + Math.random() * 1000;
    setTimeout(() => {
      const crossSubAtRun = manualScoped
        ? findBestSubordinate(crossDeptId, crossLeader.id, projectCandidateAgentIds)
        : findBestSubordinate(crossDeptId, crossLeader.id);
      const manualPoolFallbackAtRun =
        manualScoped && projectCandidateAgentIds.length > 0
          ? pickManualPoolAgent(projectCandidateAgentIds, crossDeptId, [teamLeader.id]) ||
            pickManualPoolAgent(projectCandidateAgentIds, null, [teamLeader.id]) ||
            pickManualPoolAgent(projectCandidateAgentIds, crossDeptId) ||
            pickManualPoolAgent(projectCandidateAgentIds, null)
          : null;
      const execAgent =
        crossSubAtRun ??
        (crossLeaderAllowed ? crossLeader : manualPoolFallbackAtRun) ??
        crossCoordinator ??
        crossLeader;
      const execName = lang === "ko" ? execAgent.name_ko || execAgent.name : execAgent.name;

      const crossAckMsg =
        execAgent.id !== crossCoordinator.id
          ? pickL(
              l(
                [
                  `네, ${leaderName}님! 확인했습니다. ${execName}에게 바로 배정하겠습니다 👍`,
                  `알겠습니다! ${execName}가 지원하도록 하겠습니다. 진행 상황 공유드릴게요.`,
                ],
                [
                  `Sure, ${leaderName}! I'll assign ${execName} to support right away 👍`,
                  `Got it! ${execName} will handle the ${crossDeptName} side. I'll keep you posted.`,
                ],
                [`了解しました、${leaderName}さん！${execName}を割り当てます 👍`],
                [`好的，${leaderName}！安排${execName}支援 👍`],
              ),
              lang,
            )
          : pickL(
              l(
                [`네, ${leaderName}님! 확인했습니다. 제가 직접 처리하겠습니다 👍`],
                [`Sure, ${leaderName}! I'll handle it personally 👍`],
                [`了解しました！私が直接対応します 👍`],
                [`好的！我亲自来处理 👍`],
              ),
              lang,
            );
      sendAgentMessage(crossCoordinator, crossAckMsg, "chat", "agent", null, taskId);

      // Create actual task in the cross-department
      const crossTaskId = randomUUID();
      const ct = nowMs();
      const crossTaskTitle = pickL(
        l([`[협업] ${taskTitle}`], [`[Collaboration] ${taskTitle}`], [`[協業] ${taskTitle}`], [`[协作] ${taskTitle}`]),
        lang,
      );
      const parentTaskPath = db
        .prepare("SELECT project_id, project_path, workflow_pack_key FROM tasks WHERE id = ?")
        .get(taskId) as
        | {
            project_id: string | null;
            project_path: string | null;
            workflow_pack_key: string | null;
          }
        | undefined;
      const crossDetectedPath = parentTaskPath?.project_path ?? detectProjectPath(ceoMessage);
      const crossWorkflowPackKey = resolveWorkflowPackKeyForTask({
        db: db as any,
        sourceTaskPackKey: parentTaskPath?.workflow_pack_key,
        sourceTaskId: taskId,
        projectId: parentTaskPath?.project_id ?? null,
      });
      db.prepare(
        `
      INSERT INTO tasks (id, title, description, department_id, project_id, status, priority, task_type, workflow_pack_key, project_path, source_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planned', 1, 'general', ?, ?, ?, ?, ?)
    `,
      ).run(
        crossTaskId,
        crossTaskTitle,
        `[Cross-dept from ${leaderDeptName}] ${ceoMessage}`,
        crossDeptId,
        parentTaskPath?.project_id ?? null,
        crossWorkflowPackKey,
        crossDetectedPath,
        taskId,
        ct,
        ct,
      );
      recordTaskCreationAudit({
        taskId: crossTaskId,
        taskTitle: crossTaskTitle,
        taskStatus: "planned",
        departmentId: crossDeptId,
        sourceTaskId: taskId,
        taskType: "general",
        projectPath: crossDetectedPath ?? null,
        trigger: "workflow.cross_dept_cooperation",
        triggerDetail: `from_dept=${leaderDeptId}; to_dept=${crossDeptId}`,
        actorType: "agent",
        actorId: crossCoordinator.id,
        actorName: crossCoordinator.name,
        body: {
          parent_task_id: taskId,
          ceo_message: ceoMessage,
          from_department_id: leaderDeptId,
          to_department_id: crossDeptId,
        },
      });
      if (parentTaskPath?.project_id) {
        db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(
          ct,
          ct,
          parentTaskPath.project_id,
        );
      }
      appendTaskLog(crossTaskId, "system", `Cross-dept request from ${leaderName} (${leaderDeptName})`);
      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(crossTaskId));
      const linkedSubtaskId = linkCrossDeptTaskToParentSubtask(taskId, crossDeptId, crossTaskId);
      if (linkedSubtaskId) {
        delegatedTaskToSubtask.set(crossTaskId, linkedSubtaskId);
      }

      // Delegate to cross-dept subordinate and spawn CLI
      const ct2 = nowMs();
      db.prepare(
        "UPDATE tasks SET assigned_agent_id = ?, status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?",
      ).run(execAgent.id, ct2, ct2, crossTaskId);
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(
        crossTaskId,
        execAgent.id,
      );
      appendTaskLog(crossTaskId, "system", `${crossCoordinatorName} → ${execName}`);

      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(crossTaskId));
      broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(execAgent.id));

      // Register callback to start next department when this one finishes
      if (index + 1 < deptIds.length) {
        crossDeptNextCallbacks.set(crossTaskId, () => {
          const nextDelay = 2000 + Math.random() * 1000;
          setTimeout(() => {
            startCrossDeptCooperation(deptIds, index + 1, nextCtx, onAllDone);
          }, nextDelay);
        });
      } else if (onAllDone) {
        // Last department in the queue: continue only after this cross task completes review.
        crossDeptNextCallbacks.set(crossTaskId, () => {
          const nextDelay = 1200 + Math.random() * 800;
          setTimeout(() => onAllDone(), nextDelay);
        });
      }

      // Actually spawn the CLI agent
      const execProvider = execAgent.cli_provider || "claude";
      if (["claude", "codex", "gemini", "opencode"].includes(execProvider)) {
        const crossTaskData = db.prepare("SELECT * FROM tasks WHERE id = ?").get(crossTaskId) as
          | {
              title: string;
              description: string | null;
              project_path: string | null;
            }
          | undefined;
        if (crossTaskData) {
          const projPath = resolveProjectPath(crossTaskData);
          const logFilePath = path.join(logsDir, `${crossTaskId}.log`);
          const roleLabels: Record<string, string> = {
            team_leader: "Team Leader",
            senior: "Senior",
            junior: "Junior",
            intern: "Intern",
          };
          const roleLabel = roleLabels[execAgent.role] ?? execAgent.role;
          const deptConstraint = getDeptRoleConstraint(crossDeptId, crossDeptName);
          const deptPromptRaw = (
            db.prepare("SELECT prompt FROM departments WHERE id = ?").get(crossDeptId) as
              | { prompt?: string | null }
              | undefined
          )?.prompt;
          const deptPrompt = typeof deptPromptRaw === "string" ? deptPromptRaw.trim() : "";
          const deptPromptBlock = deptPrompt ? `[Department Shared Prompt]\n${deptPrompt}` : "";
          const crossConversationCtx = getRecentConversationContext(execAgent.id);
          const taskLang = resolveLang(crossTaskData.description ?? crossTaskData.title);
          const availableSkillsPromptBlock = buildAvailableSkillsPromptBlock(execProvider);
          const spawnPrompt = buildTaskExecutionPrompt(
            [
              availableSkillsPromptBlock,
              `[Task] ${crossTaskData.title}`,
              crossTaskData.description ? `\n${crossTaskData.description}` : "",
              crossConversationCtx,
              `\n---`,
              `Agent: ${execAgent.name} (${roleLabel}, ${crossDeptName})`,
              execAgent.personality ? `Personality: ${execAgent.personality}` : "",
              deptConstraint,
              deptPromptBlock,
              pickL(
                l(
                  ["위 작업을 충분히 완수하세요. 필요 시 위 대화 맥락을 참고하세요."],
                  ["Please complete the task above thoroughly. Use the conversation context above if relevant."],
                  ["上記タスクを丁寧に完了してください。必要に応じて会話コンテキストを参照してください。"],
                  ["请完整地完成上述任务。可按需参考上方会话上下文。"],
                ),
                taskLang,
              ),
            ],
            {
              allowWarningFix: hasExplicitWarningFixRequest(crossTaskData.title, crossTaskData.description),
            },
          );
          const executionSession = ensureTaskExecutionSession(crossTaskId, execAgent.id, execProvider);
          const sessionPrompt = [
            `[Task Session] id=${executionSession.sessionId} owner=${executionSession.agentId} provider=${executionSession.provider}`,
            "Task-scoped session: keep continuity only for this collaboration task.",
            spawnPrompt,
          ].join("\n");

          appendTaskLog(crossTaskId, "system", `RUN start (agent=${execAgent.name}, provider=${execProvider})`);
          const crossModelConfig = getProviderModelConfig();
          const crossModel = execAgent.cli_model || crossModelConfig[execProvider]?.model || undefined;
          const crossReasoningLevel =
            execProvider === "codex"
              ? execAgent.cli_reasoning_level || crossModelConfig[execProvider]?.reasoningLevel || undefined
              : crossModelConfig[execProvider]?.reasoningLevel || undefined;
          const child = spawnCliAgent(
            crossTaskId,
            execProvider,
            sessionPrompt,
            projPath,
            logFilePath,
            crossModel,
            crossReasoningLevel,
          );
          child.on("close", (code: number | null) => {
            const linked = delegatedTaskToSubtask.get(crossTaskId);
            if (linked) {
              handleSubtaskDelegationComplete(crossTaskId, linked, code ?? 1);
            } else {
              handleTaskRunComplete(crossTaskId, code ?? 1);
            }
          });

          notifyCeo(
            pickL(
              l(
                [`${crossDeptName} ${execName}가 '${taskTitle}' 협업 작업을 시작했습니다.`],
                [`${crossDeptName} ${execName} started collaboration work for '${taskTitle}'.`],
                [`${crossDeptName}の${execName}が「${taskTitle}」の協業作業を開始しました。`],
                [`${crossDeptName} 的 ${execName} 已开始「${taskTitle}」协作工作。`],
              ),
              lang,
            ),
            crossTaskId,
          );
          startProgressTimer(crossTaskId, crossTaskData.title, crossDeptId);
        }
      }
    }, crossAckDelay);
  }

  return {
    recoverCrossDeptQueueAfterMissingCallback,
    startCrossDeptCooperation,
  };
}
