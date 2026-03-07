import type { Express } from "express";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAssignedAgentIdsByProjectIds } from "../shared/project-assignments.ts";
import { createProjectRouteHelpers } from "./projects/helpers.ts";

type FirstQueryValue = (value: unknown) => string | undefined;
type NormalizeTextField = (value: unknown) => string | null;
type RunInTransaction = (fn: () => void) => void;

interface RegisterProjectRoutesOptions {
  app: Express;
  db: DatabaseSync;
  firstQueryValue: FirstQueryValue;
  normalizeTextField: NormalizeTextField;
  runInTransaction: RunInTransaction;
  nowMs: () => number;
}

export function registerProjectRoutes({
  app,
  db,
  firstQueryValue,
  normalizeTextField,
  runInTransaction,
  nowMs,
}: RegisterProjectRoutesOptions): void {
  const {
    PROJECT_PATH_ALLOWED_ROOTS,
    normalizeProjectPathInput,
    pathInsideRoot,
    isPathInsideAllowedRoots,
    getContainingAllowedRoot,
    findConflictingProjectByPath,
    inspectDirectoryPath,
    ensureDirectoryPathExists,
    collectProjectPathSuggestions,
    resolveInitialBrowsePath,
    pickNativeDirectoryPath,
    validateProjectAgentIds,
  } = createProjectRouteHelpers({ db, normalizeTextField });

  const clipText = (value: unknown, limit = 180): string => {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!text) return "";
    return text.length > limit ? `${text.slice(0, limit).trimEnd()}...` : text;
  };

  const statusTone = (status: string): "neutral" | "info" | "success" | "warning" => {
    if (status === "done") return "success";
    if (status === "review" || status === "pending" || status === "cancelled") return "warning";
    if (status === "planned" || status === "in_progress" || status === "collaborating") return "info";
    return "neutral";
  };

  const severityRank = (severity: "high" | "medium" | "low"): number => {
    if (severity === "high") return 3;
    if (severity === "medium") return 2;
    return 1;
  };

  app.get("/api/projects", (req, res) => {
    const page = Math.max(Number(firstQueryValue(req.query.page)) || 1, 1);
    const pageSizeRaw = Number(firstQueryValue(req.query.page_size)) || 10;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 50);
    const search = normalizeTextField(firstQueryValue(req.query.search));

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      conditions.push("(p.name LIKE ? OR p.project_path LIKE ? OR p.core_goal LIKE ?)");
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = db
      .prepare(
        `
    SELECT COUNT(*) AS cnt
    FROM projects p
    ${where}
  `,
      )
      .get(...(params as SQLInputValue[])) as { cnt: number };
    const total = Number(totalRow?.cnt ?? 0) || 0;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
    const offset = (page - 1) * pageSize;

    const rows = db
      .prepare(
        `
    SELECT p.*,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
    FROM projects p
    ${where}
    ORDER BY COALESCE(p.last_used_at, p.updated_at) DESC, p.updated_at DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `,
      )
      .all(...([...(params as SQLInputValue[]), pageSize, offset] as SQLInputValue[]));

    const projectRows = rows as Array<Record<string, unknown> & { id: string }>;
    const assignedByProject = getAssignedAgentIdsByProjectIds(
      db,
      projectRows.map((row) => row.id),
    );
    const projects = projectRows.map((row) => ({
      ...row,
      assigned_agent_ids: assignedByProject.get(row.id) ?? [],
    }));

    res.json({
      projects,
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
    });
  });

  app.get("/api/projects/path-check", (req, res) => {
    const raw = firstQueryValue(req.query.path);
    const normalized = normalizeProjectPathInput(raw);
    if (!normalized) return res.status(400).json({ error: "project_path_required" });
    if (!isPathInsideAllowedRoots(normalized)) {
      return res.status(403).json({
        error: "project_path_outside_allowed_roots",
        allowed_roots: PROJECT_PATH_ALLOWED_ROOTS,
      });
    }

    const inspected = inspectDirectoryPath(normalized);
    res.json({
      ok: true,
      normalized_path: normalized,
      exists: inspected.exists,
      is_directory: inspected.isDirectory,
      can_create: inspected.canCreate,
      nearest_existing_parent: inspected.nearestExistingParent,
    });
  });

  app.get("/api/projects/path-suggestions", (req, res) => {
    const q = normalizeTextField(firstQueryValue(req.query.q)) ?? "";
    const parsedLimit = Number(firstQueryValue(req.query.limit) ?? "30");
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.trunc(parsedLimit))) : 30;
    const paths = collectProjectPathSuggestions(q, limit);
    res.json({ ok: true, paths });
  });

  app.post("/api/projects/path-native-picker", async (_req, res) => {
    try {
      const picked = await pickNativeDirectoryPath();
      if (picked.cancelled) return res.json({ ok: false, cancelled: true });
      if (!picked.path) return res.status(400).json({ error: "native_picker_unavailable" });

      const normalized = normalizeProjectPathInput(picked.path);
      if (!normalized) return res.status(400).json({ error: "project_path_required" });
      if (!isPathInsideAllowedRoots(normalized)) {
        return res.status(403).json({
          error: "project_path_outside_allowed_roots",
          allowed_roots: PROJECT_PATH_ALLOWED_ROOTS,
        });
      }
      try {
        if (!fs.statSync(normalized).isDirectory()) {
          return res.status(400).json({ error: "project_path_not_directory" });
        }
      } catch {
        return res.status(400).json({ error: "project_path_not_found" });
      }

      return res.json({ ok: true, path: normalized, source: picked.source });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: "native_picker_failed", reason: message });
    }
  });

  app.get("/api/projects/path-browse", (req, res) => {
    const raw = firstQueryValue(req.query.path);
    const currentPath = resolveInitialBrowsePath(raw ?? null);
    if (!isPathInsideAllowedRoots(currentPath)) {
      return res.status(403).json({
        error: "project_path_outside_allowed_roots",
        allowed_roots: PROJECT_PATH_ALLOWED_ROOTS,
      });
    }

    let entries: Array<{ name: string; path: string }> = [];
    try {
      const dirents = fs.readdirSync(currentPath, { withFileTypes: true });
      entries = dirents
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          name: entry.name,
          path: path.join(currentPath, entry.name),
        }));
    } catch {
      entries = [];
    }

    const MAX_ENTRIES = 300;
    const truncated = entries.length > MAX_ENTRIES;
    const containingRoot = getContainingAllowedRoot(currentPath);
    const candidateParent = path.dirname(currentPath);
    const parent =
      candidateParent !== currentPath && (!containingRoot || pathInsideRoot(candidateParent, containingRoot))
        ? candidateParent
        : null;
    res.json({
      ok: true,
      current_path: currentPath,
      parent_path: parent !== currentPath ? parent : null,
      entries: entries.slice(0, MAX_ENTRIES),
      truncated,
    });
  });

  app.post("/api/projects", (req, res) => {
    const body = req.body ?? {};
    const name = normalizeTextField(body.name);
    const projectPath = normalizeProjectPathInput(body.project_path);
    const coreGoal = normalizeTextField(body.core_goal);
    const createPathIfMissing = body.create_path_if_missing !== false;
    if (!name) return res.status(400).json({ error: "name_required" });
    if (!projectPath) return res.status(400).json({ error: "project_path_required" });
    if (!coreGoal) return res.status(400).json({ error: "core_goal_required" });
    if (!isPathInsideAllowedRoots(projectPath)) {
      return res.status(403).json({
        error: "project_path_outside_allowed_roots",
        allowed_roots: PROJECT_PATH_ALLOWED_ROOTS,
      });
    }
    const conflictingProject = findConflictingProjectByPath(projectPath);
    if (conflictingProject) {
      return res.status(409).json({
        error: "project_path_conflict",
        existing_project_id: conflictingProject.id,
        existing_project_name: conflictingProject.name,
        existing_project_path: conflictingProject.project_path,
      });
    }
    const inspected = inspectDirectoryPath(projectPath);
    if (inspected.exists && !inspected.isDirectory) {
      return res.status(400).json({ error: "project_path_not_directory" });
    }
    if (!inspected.exists) {
      if (!createPathIfMissing) {
        return res.status(409).json({
          error: "project_path_not_found",
          normalized_path: projectPath,
          can_create: inspected.canCreate,
          nearest_existing_parent: inspected.nearestExistingParent,
        });
      }
      const ensureDir = ensureDirectoryPathExists(projectPath);
      if (!ensureDir.ok) {
        return res.status(400).json({ error: "project_path_unavailable", reason: ensureDir.reason });
      }
    }

    const githubRepo = typeof body.github_repo === "string" ? body.github_repo.trim() || null : null;
    const assignmentMode = body.assignment_mode === "manual" ? "manual" : "auto";
    const validatedAgentIds = validateProjectAgentIds((body as Record<string, unknown>).agent_ids);
    if ("error" in validatedAgentIds) {
      return res.status(400).json({
        error: validatedAgentIds.error.code,
        invalid_ids: validatedAgentIds.error.invalidIds ?? [],
      });
    }
    const agentIds = validatedAgentIds.agentIds;

    const id = randomUUID();
    const t = nowMs();
    runInTransaction(() => {
      db.prepare(
        `
      INSERT INTO projects (id, name, project_path, core_goal, assignment_mode, last_used_at, created_at, updated_at, github_repo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      ).run(id, name, projectPath, coreGoal, assignmentMode, t, t, t, githubRepo);

      if (assignmentMode === "manual" && agentIds.length > 0) {
        const insertPA = db.prepare("INSERT INTO project_agents (project_id, agent_id, created_at) VALUES (?, ?, ?)");
        for (const agentId of agentIds) {
          insertPA.run(id, agentId, t);
        }
      }
    });

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    const assignedAgentIds = (
      db.prepare("SELECT agent_id FROM project_agents WHERE project_id = ?").all(id) as Array<{ agent_id: string }>
    ).map((row) => row.agent_id);
    res.json({ ok: true, project: { ...project, assigned_agent_ids: assignedAgentIds } });
  });

  app.patch("/api/projects/:id", (req, res) => {
    const id = String(req.params.id);
    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "not_found" });

    const body = req.body ?? {};
    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [nowMs()];
    const createPathIfMissing = body.create_path_if_missing !== false;

    if ("name" in body) {
      const value = normalizeTextField(body.name);
      if (!value) return res.status(400).json({ error: "name_required" });
      updates.push("name = ?");
      params.push(value);
    }
    if ("project_path" in body) {
      const value = normalizeProjectPathInput(body.project_path);
      if (!value) return res.status(400).json({ error: "project_path_required" });
      if (!isPathInsideAllowedRoots(value)) {
        return res.status(403).json({
          error: "project_path_outside_allowed_roots",
          allowed_roots: PROJECT_PATH_ALLOWED_ROOTS,
        });
      }
      const conflictingProject = findConflictingProjectByPath(value, id);
      if (conflictingProject) {
        return res.status(409).json({
          error: "project_path_conflict",
          existing_project_id: conflictingProject.id,
          existing_project_name: conflictingProject.name,
          existing_project_path: conflictingProject.project_path,
        });
      }
      const inspected = inspectDirectoryPath(value);
      if (inspected.exists && !inspected.isDirectory) {
        return res.status(400).json({ error: "project_path_not_directory" });
      }
      if (!inspected.exists) {
        if (!createPathIfMissing) {
          return res.status(409).json({
            error: "project_path_not_found",
            normalized_path: value,
            can_create: inspected.canCreate,
            nearest_existing_parent: inspected.nearestExistingParent,
          });
        }
        const ensureDir = ensureDirectoryPathExists(value);
        if (!ensureDir.ok) {
          return res.status(400).json({ error: "project_path_unavailable", reason: ensureDir.reason });
        }
      }
      updates.push("project_path = ?");
      params.push(value);
    }
    if ("core_goal" in body) {
      const value = normalizeTextField(body.core_goal);
      if (!value) return res.status(400).json({ error: "core_goal_required" });
      updates.push("core_goal = ?");
      params.push(value);
    }
    if ("github_repo" in body) {
      const value = typeof body.github_repo === "string" ? body.github_repo.trim() || null : null;
      updates.push("github_repo = ?");
      params.push(value);
    }
    if ("assignment_mode" in body) {
      const value = body.assignment_mode === "manual" ? "manual" : "auto";
      updates.push("assignment_mode = ?");
      params.push(value);
    }

    const hasAgentIdsUpdate = "agent_ids" in body;
    let agentIds: string[] = [];
    if (hasAgentIdsUpdate) {
      const validatedAgentIds = validateProjectAgentIds((body as Record<string, unknown>).agent_ids);
      if ("error" in validatedAgentIds) {
        return res.status(400).json({
          error: validatedAgentIds.error.code,
          invalid_ids: validatedAgentIds.error.invalidIds ?? [],
        });
      }
      agentIds = validatedAgentIds.agentIds;
    }

    if (updates.length <= 1 && !hasAgentIdsUpdate) {
      return res.status(400).json({ error: "no_fields" });
    }

    runInTransaction(() => {
      if (updates.length > 1) {
        params.push(id);
        db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...(params as SQLInputValue[]));
      }
      if (hasAgentIdsUpdate) {
        db.prepare("DELETE FROM project_agents WHERE project_id = ?").run(id);
        if (agentIds.length > 0) {
          const insertPA = db.prepare("INSERT INTO project_agents (project_id, agent_id, created_at) VALUES (?, ?, ?)");
          const t = nowMs();
          for (const agentId of agentIds) {
            insertPA.run(id, agentId, t);
          }
        }
      }
    });

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    const assignedAgentIds = (
      db.prepare("SELECT agent_id FROM project_agents WHERE project_id = ?").all(id) as Array<{ agent_id: string }>
    ).map((row) => row.agent_id);
    res.json({ ok: true, project: { ...project, assigned_agent_ids: assignedAgentIds } });
  });

  app.delete("/api/projects/:id", (req, res) => {
    const id = String(req.params.id);
    const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "not_found" });

    db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  app.get("/api/projects/:id", (req, res) => {
    const id = String(req.params.id);
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!project) return res.status(404).json({ error: "not_found" });

    const tasks = db
      .prepare(
        `
    SELECT t.id, t.title, t.status, t.task_type, t.priority, t.created_at, t.updated_at, t.completed_at,
           t.source_task_id,
           t.assigned_agent_id,
           COALESCE(a.name, '') AS assigned_agent_name,
           COALESCE(a.name_ko, '') AS assigned_agent_name_ko
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.assigned_agent_id
    WHERE t.project_id = ?
    ORDER BY t.created_at DESC
    LIMIT 300
  `,
      )
      .all(id);

    const reports = db
      .prepare(
        `
    SELECT t.id, t.title, t.completed_at, t.created_at, t.assigned_agent_id,
           COALESCE(a.name, '') AS agent_name,
           COALESCE(a.name_ko, '') AS agent_name_ko,
           COALESCE(d.name, '') AS dept_name,
           COALESCE(d.name_ko, '') AS dept_name_ko
    FROM tasks t
    LEFT JOIN agents a ON a.id = t.assigned_agent_id
    LEFT JOIN departments d ON d.id = t.department_id
    WHERE t.project_id = ?
      AND t.status = 'done'
      AND (t.source_task_id IS NULL OR TRIM(t.source_task_id) = '')
    ORDER BY t.completed_at DESC, t.created_at DESC
    LIMIT 200
  `,
      )
      .all(id);

    const decisionEvents = db
      .prepare(
        `
    SELECT
      id,
      snapshot_hash,
      event_type,
      summary,
      selected_options_json,
      note,
      task_id,
      meeting_id,
      created_at
    FROM project_review_decision_events
    WHERE project_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 300
  `,
      )
      .all(id);

    const timelineTaskRows = tasks as Array<{
      id: string;
      title: string;
      status: string;
      created_at: number;
      updated_at: number;
      completed_at: number | null;
      assigned_agent_id: string | null;
      assigned_agent_name: string;
      assigned_agent_name_ko: string;
    }>;

    const taskLogs = db
      .prepare(
        `
    SELECT tl.id, tl.task_id, tl.kind, tl.message, tl.created_at, t.title AS task_title
    FROM task_logs tl
    INNER JOIN tasks t ON t.id = tl.task_id
    WHERE t.project_id = ?
    ORDER BY tl.created_at DESC
    LIMIT 120
  `,
      )
      .all(id) as Array<{
      id: number;
      task_id: string;
      kind: string;
      message: string;
      created_at: number;
      task_title: string;
    }>;

    const projectMessages = db
      .prepare(
        `
    SELECT
      m.id,
      m.task_id,
      m.message_type,
      m.content,
      m.created_at,
      COALESCE(a.name, '') AS sender_name,
      COALESCE(a.name_ko, '') AS sender_name_ko,
      t.title AS task_title
    FROM messages m
    INNER JOIN tasks t ON t.id = m.task_id
    LEFT JOIN agents a ON a.id = m.sender_id
    WHERE t.project_id = ?
      AND m.message_type IN ('directive','task_assign','status_update','report')
    ORDER BY m.created_at DESC
    LIMIT 120
  `,
      )
      .all(id) as Array<{
      id: string;
      task_id: string | null;
      message_type: string;
      content: string;
      created_at: number;
      sender_name: string;
      sender_name_ko: string;
      task_title: string;
    }>;

    const archives = db
      .prepare(
        `
    SELECT
      a.id,
      a.root_task_id,
      a.created_at,
      a.updated_at,
      t.title AS task_title,
      COALESCE(g.name, '') AS generated_by_name,
      COALESCE(g.name_ko, '') AS generated_by_name_ko
    FROM task_report_archives a
    INNER JOIN tasks t ON t.id = a.root_task_id
    LEFT JOIN agents g ON g.id = a.generated_by_agent_id
    WHERE t.project_id = ?
    ORDER BY a.updated_at DESC
    LIMIT 40
  `,
      )
      .all(id) as Array<{
      id: string;
      root_task_id: string;
      created_at: number;
      updated_at: number;
      task_title: string;
      generated_by_name: string;
      generated_by_name_ko: string;
    }>;

    const reportCountsByTask = new Map<string, number>();
    const latestReportByTask = new Map<string, { created_at: number; content: string }>();
    for (const msg of projectMessages) {
      if (!msg.task_id || msg.message_type !== "report") continue;
      reportCountsByTask.set(msg.task_id, (reportCountsByTask.get(msg.task_id) ?? 0) + 1);
      const prev = latestReportByTask.get(msg.task_id);
      if (!prev || msg.created_at > prev.created_at) {
        latestReportByTask.set(msg.task_id, { created_at: msg.created_at, content: msg.content });
      }
    }

    const timeline = [
      ...timelineTaskRows.map((task) => ({
        id: `task:${task.id}`,
        type: "task_created" as const,
        task_id: task.id,
        title: task.title,
        summary: `Task opened in status '${task.status}'.`,
        actor_name: task.assigned_agent_name || null,
        created_at: task.created_at,
        tone: statusTone(task.status),
      })),
      ...taskLogs.map((row) => ({
        id: `log:${row.id}`,
        type: "task_log" as const,
        task_id: row.task_id,
        title: row.task_title,
        summary: clipText(row.message) || row.kind,
        actor_name: null,
        created_at: row.created_at,
        tone: row.kind === "error" ? "warning" : "neutral",
      })),
      ...projectMessages.map((row) => ({
        id: `msg:${row.id}`,
        type: row.message_type === "report" ? ("report" as const) : ("message" as const),
        task_id: row.task_id,
        title: row.task_title || row.message_type,
        summary: clipText(row.content),
        actor_name: row.sender_name || null,
        created_at: row.created_at,
        tone:
          row.message_type === "report"
            ? ("success" as const)
            : row.message_type === "directive"
              ? ("info" as const)
              : ("neutral" as const),
      })),
      ...(decisionEvents as Array<{
        id: number;
        summary: string;
        task_id: string | null;
        created_at: number;
        event_type: string;
      }>).map((event) => ({
        id: `decision:${event.id}`,
        type: "decision" as const,
        task_id: event.task_id,
        title: event.event_type,
        summary: clipText(event.summary),
        actor_name: null,
        created_at: event.created_at,
        tone: "info" as const,
      })),
      ...archives.map((archive) => ({
        id: `archive:${archive.id}`,
        type: "archive" as const,
        task_id: archive.root_task_id,
        title: archive.task_title,
        summary: "Planning archive generated for CEO review.",
        actor_name: archive.generated_by_name || null,
        created_at: archive.updated_at || archive.created_at,
        tone: "success" as const,
      })),
    ]
      .filter((item) => item.summary || item.title)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 80);

    const now = nowMs();
    const postmortems = timelineTaskRows
      .map((task) => {
        const stalenessHours = Math.max(0, Math.round(((now - (task.updated_at || task.created_at)) / 3_600_000) * 10) / 10);
        const evidence: string[] = [];
        const nextActions: string[] = [];
        let primaryCause = "";
        let severity: "high" | "medium" | "low" = "low";

        if (task.status === "cancelled") {
          primaryCause = "Execution was cancelled before completion.";
          severity = "high";
          evidence.push("Task ended in cancelled state.");
          nextActions.push("Re-open the task with a narrower scope and explicit owner.");
        } else if ((task.status === "in_progress" || task.status === "collaborating") && stalenessHours >= 12) {
          primaryCause = "Execution stalled without a recent checkpoint.";
          severity = stalenessHours >= 24 ? "high" : "medium";
          evidence.push(`No meaningful task update for ${stalenessHours}h.`);
          nextActions.push("Request a concise status report from the current owner.");
        } else if (task.status === "review" && stalenessHours >= 6) {
          primaryCause = "Review queue is holding the task open.";
          severity = stalenessHours >= 18 ? "high" : "medium";
          evidence.push(`Task remained in review for ${stalenessHours}h.`);
          nextActions.push("Escalate to the review owner or convert comments into subtasks.");
        } else if (task.status === "pending" && stalenessHours >= 24) {
          primaryCause = "Task is parked in pending without reactivation.";
          severity = "medium";
          evidence.push(`Task remained pending for ${stalenessHours}h.`);
          nextActions.push("Decide whether to resume, split, or archive the task.");
        } else if (!task.assigned_agent_id && task.status !== "done") {
          primaryCause = "No owner is assigned.";
          severity = "medium";
          evidence.push("Task has no assigned agent.");
          nextActions.push("Assign an owner before the next execution cycle.");
        } else if (!((project as { project_path?: string | null }).project_path ?? "").trim()) {
          primaryCause = "Project path is missing.";
          severity = "medium";
          evidence.push("Project metadata does not include a valid path.");
          nextActions.push("Restore the project path so agents can inspect the workspace.");
        }

        const latestReport = latestReportByTask.get(task.id);
        if ((task.status === "in_progress" || task.status === "review") && !latestReport) {
          evidence.push("No report message has been posted yet.");
          nextActions.push("Require one short report before continuing work.");
          if (severity === "low") severity = "medium";
          if (!primaryCause) primaryCause = "Task is active without any progress report.";
        }

        if (!primaryCause) return null;
        if (latestReport) {
          evidence.push(`Latest report: ${clipText(latestReport.content, 120)}`);
        }

        return {
          task_id: task.id,
          title: task.title,
          status: task.status,
          owner_name: task.assigned_agent_name || null,
          updated_at: task.updated_at,
          severity,
          staleness_hours: stalenessHours,
          primary_cause: primaryCause,
          summary: `${primaryCause} Current status: ${task.status}.`,
          evidence: evidence.slice(0, 3),
          next_actions: Array.from(new Set(nextActions)).slice(0, 3),
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          severityRank((b as NonNullable<typeof b>).severity) - severityRank((a as NonNullable<typeof a>).severity) ||
          (b as NonNullable<typeof b>).staleness_hours - (a as NonNullable<typeof a>).staleness_hours,
      )
      .slice(0, 8);
    const staleTasks = timelineTaskRows.filter(
      (task) =>
        (task.status === "in_progress" || task.status === "collaborating" || task.status === "review") &&
        now - (task.updated_at || task.created_at) >= 12 * 3_600_000,
    ).length;
    const reviewBacklog = timelineTaskRows.filter((task) => task.status === "review" || task.status === "pending").length;
    const ownerlessTasks = timelineTaskRows.filter((task) => !task.assigned_agent_id && task.status !== "done").length;
    const healthScore = Math.max(
      0,
      100 - postmortems.length * 8 - staleTasks * 6 - reviewBacklog * 4 - ownerlessTasks * 7,
    );
    const recommendedActions = [
      staleTasks > 0
        ? {
            id: "stale_tasks",
            title: "Escalate stalled execution",
            detail: `${staleTasks} active tasks have gone stale. Request a status report or reassign ownership.`,
            priority: staleTasks >= 3 ? ("high" as const) : ("medium" as const),
          }
        : null,
      reviewBacklog > 0
        ? {
            id: "review_backlog",
            title: "Drain review queue",
            detail: `${reviewBacklog} tasks are blocked in review or pending. Convert comments into explicit next steps.`,
            priority: reviewBacklog >= 4 ? ("high" as const) : ("medium" as const),
          }
        : null,
      ownerlessTasks > 0
        ? {
            id: "ownerless_tasks",
            title: "Assign missing owners",
            detail: `${ownerlessTasks} tasks have no owner. Assign a responsible agent before the next cycle.`,
            priority: "high" as const,
          }
        : null,
      postmortems.length === 0
        ? {
            id: "healthy_project",
            title: "Maintain cadence",
            detail: "No major incidents detected. Keep status reports and archive discipline consistent.",
            priority: "low" as const,
          }
        : null,
    ].filter(Boolean);

    const assignedAgents = db
      .prepare(
        `
    SELECT a.* FROM agents a
    INNER JOIN project_agents pa ON pa.agent_id = a.id
    WHERE pa.project_id = ?
    ORDER BY a.department_id, a.role, a.name
  `,
      )
      .all(id);
    const assignedAgentIds = assignedAgents.map((agent: any) => agent.id);

    res.json({
      project: { ...project, assigned_agent_ids: assignedAgentIds },
      assigned_agents: assignedAgents,
      tasks,
      reports,
      decision_events: decisionEvents,
      intelligence: {
        summary: {
          open_incidents: postmortems.length,
          high_risk_incidents: postmortems.filter((item) => item?.severity === "high").length,
          timeline_events: timeline.length,
          health_score: Math.round(healthScore),
          stale_tasks: staleTasks,
          review_backlog: reviewBacklog,
          ownerless_tasks: ownerlessTasks,
        },
        timeline,
        postmortems,
        recommended_actions: recommendedActions,
      },
    });
  });
}
