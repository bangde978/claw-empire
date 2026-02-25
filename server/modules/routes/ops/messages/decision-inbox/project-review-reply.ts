import { randomUUID } from "node:crypto";

type DecisionOption = { number: number; action: string; label: string };

type ProjectReviewReplyInput = {
  req: any;
  res: any;
  currentItem: any;
  selectedOption: DecisionOption;
  optionNumber: number;
  deps: any;
};

export function handleProjectReviewDecisionReply(input: ProjectReviewReplyInput): boolean {
  const { req, res, currentItem, selectedOption, optionNumber, deps } = input;
  if (currentItem.kind !== "project_review_ready") return false;

  const {
    db,
    appendTaskLog,
    nowMs,
    normalizeTextField,
    getPreferredLanguage,
    pickL,
    l,
    broadcast,
    finishReview,
    getProjectReviewDecisionState,
    recordProjectReviewDecisionEvent,
    getProjectReviewTaskChoices,
    openSupplementRound,
    PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX,
  } = deps;

  const projectId = currentItem.project_id;
  if (!projectId) {
    res.status(400).json({ error: "project_id_required" });
    return true;
  }
  const selectedAction = selectedOption.action;
  const decisionSnapshotHash = getProjectReviewDecisionState(projectId)?.snapshot_hash ?? null;

  if (selectedAction === "keep_waiting") {
    res.json({
      ok: true,
      resolved: false,
      kind: "project_review_ready",
      action: "keep_waiting",
    });
    return true;
  }

  if (selectedAction.startsWith("approve_task_review:")) {
    const selectedTaskId = selectedAction.slice("approve_task_review:".length).trim();
    if (!selectedTaskId) {
      res.status(400).json({ error: "task_id_required" });
      return true;
    }
    const targetTask = db
      .prepare(
        `
        SELECT id, title
        FROM tasks
        WHERE id = ?
          AND project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
      `,
      )
      .get(selectedTaskId, projectId) as { id: string; title: string } | undefined;
    if (!targetTask) {
      res.status(404).json({ error: "project_review_task_not_found" });
      return true;
    }

    appendTaskLog(
      targetTask.id,
      "system",
      `${PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX} (project_id=${projectId}, option=${optionNumber})`,
    );
    recordProjectReviewDecisionEvent({
      project_id: projectId,
      snapshot_hash: decisionSnapshotHash,
      event_type: "representative_pick",
      summary: `대표 선택: ${targetTask.title}`,
      selected_options_json: JSON.stringify([
        {
          number: optionNumber,
          action: selectedAction,
          label: selectedOption.label || targetTask.title,
          task_id: targetTask.id,
        },
      ]),
      task_id: targetTask.id,
    });
    const remaining = getProjectReviewTaskChoices(projectId).filter((task: any) => !task.selected).length;
    res.json({
      ok: true,
      resolved: false,
      kind: "project_review_ready",
      action: "approve_task_review",
      task_id: targetTask.id,
      pending_task_choices: remaining,
    });
    return true;
  }

  if (selectedAction === "add_followup_request") {
    const note = normalizeTextField(req.body?.note);
    if (!note) {
      res.status(400).json({ error: "followup_note_required" });
      return true;
    }
    const lang = getPreferredLanguage();
    const followupTitlePrefix = pickL(
      l(["[의사결정 추가요청]"], ["[Decision Follow-up]"], ["[意思決定追加要請]"], ["[决策追加请求]"]),
      lang,
    );
    const targetTaskIdInput = normalizeTextField(req.body?.target_task_id);
    const targetTask = targetTaskIdInput
      ? (db
          .prepare(
            `
            SELECT id, title, status, assigned_agent_id, department_id
            FROM tasks
            WHERE id = ?
              AND project_id = ?
              AND status = 'review'
              AND source_task_id IS NULL
          `,
          )
          .get(targetTaskIdInput, projectId) as
          | {
              id: string;
              title: string;
              status: string;
              assigned_agent_id: string | null;
              department_id: string | null;
            }
          | undefined)
      : undefined;
    const fallbackTargetTask = db
      .prepare(
        `
        SELECT id, title, status, assigned_agent_id, department_id
        FROM tasks
        WHERE project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
        ORDER BY updated_at ASC, created_at ASC
        LIMIT 1
      `,
      )
      .get(projectId) as
      | {
          id: string;
          title: string;
          status: string;
          assigned_agent_id: string | null;
          department_id: string | null;
        }
      | undefined;
    const resolvedTarget = targetTask ?? fallbackTargetTask;
    if (!resolvedTarget) {
      res.status(404).json({ error: "project_review_task_not_found" });
      return true;
    }

    const subtaskId = randomUUID();
    const createdAt = nowMs();
    const noteCompact = note.replace(/\s+/g, " ").trim();
    const noteTitle = noteCompact.length > 72 ? `${noteCompact.slice(0, 69).trimEnd()}...` : noteCompact;
    const title = `${followupTitlePrefix} ${noteTitle}`;
    db.prepare(
      `
        INSERT INTO subtasks (id, task_id, title, description, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `,
    ).run(subtaskId, resolvedTarget.id, title, note, createdAt);

    appendTaskLog(resolvedTarget.id, "system", `Decision inbox follow-up request added: ${note}`);
    recordProjectReviewDecisionEvent({
      project_id: projectId,
      snapshot_hash: decisionSnapshotHash,
      event_type: "followup_request",
      summary: selectedOption.label || "추가요청 입력",
      selected_options_json: JSON.stringify([
        {
          number: optionNumber,
          action: selectedAction,
          label: selectedOption.label || "add_followup_request",
          task_id: resolvedTarget.id,
        },
      ]),
      note,
      task_id: resolvedTarget.id,
    });
    const insertedSubtask = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(subtaskId);
    broadcast("subtask_update", insertedSubtask);

    const supplement = openSupplementRound(
      resolvedTarget.id,
      resolvedTarget.assigned_agent_id,
      resolvedTarget.department_id,
      "Decision inbox",
    );

    res.json({
      ok: true,
      resolved: false,
      kind: "project_review_ready",
      action: "add_followup_request",
      task_id: resolvedTarget.id,
      subtask_id: subtaskId,
      supplement_round_started: supplement.started,
      supplement_round_reason: supplement.reason,
    });
    return true;
  }

  if (selectedAction === "start_project_review") {
    const reviewTaskChoices = getProjectReviewTaskChoices(projectId);
    const requiresRepresentativeSelection = reviewTaskChoices.length > 1;
    const pendingChoices = requiresRepresentativeSelection
      ? reviewTaskChoices.filter((task: any) => !task.selected)
      : [];
    if (requiresRepresentativeSelection && pendingChoices.length > 0) {
      res.status(409).json({
        error: "project_task_options_pending",
        pending_task_choices: pendingChoices.map((task: any) => ({ id: task.id, title: task.title })),
      });
      return true;
    }

    const readiness = db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS active_total,
          SUM(CASE WHEN status NOT IN ('done', 'cancelled') AND status = 'review' THEN 1 ELSE 0 END) AS active_review
        FROM tasks
        WHERE project_id = ?
      `,
      )
      .get(projectId) as { active_total: number | null; active_review: number | null } | undefined;
    const activeTotal = readiness?.active_total ?? 0;
    const activeReview = readiness?.active_review ?? 0;
    if (!(activeTotal > 0 && activeTotal === activeReview)) {
      res.status(409).json({
        error: "project_not_ready_for_review_meeting",
        active_total: activeTotal,
        active_review: activeReview,
      });
      return true;
    }

    const reviewTasks = db
      .prepare(
        `
        SELECT id, title
        FROM tasks
        WHERE project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
        ORDER BY updated_at ASC
      `,
      )
      .all(projectId) as Array<{ id: string; title: string }>;

    for (const task of reviewTasks) {
      appendTaskLog(task.id, "system", "Decision inbox: project-level review meeting approved by CEO");
      finishReview(task.id, task.title, {
        bypassProjectDecisionGate: true,
        trigger: "decision_inbox",
      });
    }
    recordProjectReviewDecisionEvent({
      project_id: projectId,
      snapshot_hash: decisionSnapshotHash,
      event_type: "start_review_meeting",
      summary: selectedOption.label || "팀장 회의 진행",
      selected_options_json: JSON.stringify([
        {
          number: optionNumber,
          action: selectedAction,
          label: selectedOption.label || "start_project_review",
          task_count: reviewTasks.length,
        },
      ]),
    });

    res.json({
      ok: true,
      resolved: true,
      kind: "project_review_ready",
      action: "start_project_review",
      started_task_ids: reviewTasks.map((task) => task.id),
    });
    return true;
  }

  res.status(400).json({ error: "unsupported_project_action", action: selectedAction });
  return true;
}
