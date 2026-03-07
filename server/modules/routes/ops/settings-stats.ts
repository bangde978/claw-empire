import type { RuntimeContext } from "../../../types/runtime-context.ts";
import {
  decryptMessengerChannelsForClient,
  encryptMessengerChannelsForStorage,
} from "../../../messenger/token-crypto.ts";
import { syncOfficePackAgentsForPack } from "../collab/office-pack-agent-hydration.ts";

const MESSENGER_SETTINGS_KEY = "messengerChannels";
const OFFICE_PACK_PROFILES_KEY = "officePackProfiles";
const OFFICE_PACK_SEED_INIT_KEY = "officePackSeedAgentsInitialized";
const OFFICE_PACK_HYDRATED_PACKS_KEY = "officePackHydratedPacks";

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function registerOpsSettingsStatsRoutes(ctx: RuntimeContext): void {
  const { app, db, nowMs } = ctx;

  const readBooleanLikeSetting = (key: string): boolean => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(key) as
      | { value?: unknown }
      | undefined;
    if (!row) return false;
    const raw = String(row.value ?? "")
      .trim()
      .toLowerCase();
    if (!raw) return false;
    if (raw === "true" || raw === "1") return true;
    try {
      const parsed = JSON.parse(String(row.value));
      return parsed === true || parsed === 1;
    } catch {
      return false;
    }
  };

  const markSeedInitDone = (): void => {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'",
    ).run(OFFICE_PACK_SEED_INIT_KEY);
  };

  const maybeRunOfficePackSeedInit = (): void => {
    if (readBooleanLikeSetting(OFFICE_PACK_SEED_INIT_KEY)) return;

    // Do not bulk-insert office-pack seed agents into global agents table.
    // Pack agents are loaded from settings profiles and hydrated on-demand only.
    markSeedInitDone();
  };

  const normalizePackKey = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim().replace(/^["']|["']$/g, "");
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  };

  const readHydratedPackSet = (): Set<string> => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(OFFICE_PACK_HYDRATED_PACKS_KEY) as
      | { value?: unknown }
      | undefined;
    if (!row) return new Set<string>();
    const parsed = safeJsonParse(String(row.value ?? ""));
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.map((entry) => normalizePackKey(entry)).filter((entry): entry is string => !!entry));
  };

  const saveHydratedPackSet = (packSet: Set<string>): void => {
    const serialized = JSON.stringify([...packSet].sort());
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(OFFICE_PACK_HYDRATED_PACKS_KEY, serialized);
  };

  const maybeHydratePackOnFirstSelection = (selectedPackRaw: unknown, profilesOverride?: unknown): void => {
    const selectedPack = normalizePackKey(selectedPackRaw);
    if (!selectedPack || selectedPack === "development") return;

    const hydratedPacks = readHydratedPackSet();
    if (hydratedPacks.has(selectedPack)) return;

    const profilesValue =
      profilesOverride ??
      (
        db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(OFFICE_PACK_PROFILES_KEY) as
          | { value?: unknown }
          | undefined
      )?.value;
    if (profilesValue === undefined) return;

    const result = syncOfficePackAgentsForPack(db, profilesValue, selectedPack, nowMs);
    if (result.departmentsSynced > 0 || result.agentsSynced > 0) {
      hydratedPacks.add(selectedPack);
      saveHydratedPackSet(hydratedPacks);
    }
  };

  try {
    maybeRunOfficePackSeedInit();
  } catch {
    // best-effort sync only
  }

  app.get("/api/settings", (_req, res) => {
    try {
      const selectedPackRow = db
        .prepare("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .get("officeWorkflowPack") as { value?: unknown } | undefined;
      const profilesRow = db
        .prepare("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .get(OFFICE_PACK_PROFILES_KEY) as { value?: unknown } | undefined;
      maybeHydratePackOnFirstSelection(selectedPackRow?.value, profilesRow?.value);
    } catch {
      // best-effort hydration only
    }

    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        settings[row.key] = row.key === MESSENGER_SETTINGS_KEY ? decryptMessengerChannelsForClient(parsed) : parsed;
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json({ settings });
  });

  app.put("/api/settings", (req, res) => {
    const body = req.body ?? {};
    const officePackProfilesInPayload = (body as Record<string, unknown>)[OFFICE_PACK_PROFILES_KEY];
    const selectedOfficePackInPayload = (body as Record<string, unknown>)["officeWorkflowPack"];

    const upsert = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );

    try {
      for (const [key, value] of Object.entries(body)) {
        if (key === MESSENGER_SETTINGS_KEY) {
          const parsedValue = typeof value === "string" ? safeJsonParse(value) : value;
          const encrypted = encryptMessengerChannelsForStorage(parsedValue);
          upsert.run(key, typeof encrypted === "string" ? encrypted : JSON.stringify(encrypted));
          continue;
        }

        if (key === OFFICE_PACK_PROFILES_KEY && !readBooleanLikeSetting(OFFICE_PACK_SEED_INIT_KEY)) {
          markSeedInitDone();
        }
        upsert.run(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      if (selectedOfficePackInPayload !== undefined) {
        maybeHydratePackOnFirstSelection(selectedOfficePackInPayload, officePackProfilesInPayload);
      }
    } catch (err: any) {
      const detail = err?.message || String(err);
      return res.status(500).json({ ok: false, error: "settings_write_failed", detail });
    }

    res.json({ ok: true });
  });

  app.get("/api/stats", (_req, res) => {
    const totalTasks = (db.prepare("SELECT COUNT(*) as cnt FROM tasks").get() as { cnt: number }).cnt;
    const doneTasks = (db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done'").get() as { cnt: number })
      .cnt;
    const inProgressTasks = (
      db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'in_progress'").get() as { cnt: number }
    ).cnt;
    const inboxTasks = (db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'inbox'").get() as { cnt: number })
      .cnt;
    const plannedTasks = (
      db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'planned'").get() as {
        cnt: number;
      }
    ).cnt;
    const reviewTasks = (
      db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'review'").get() as {
        cnt: number;
      }
    ).cnt;
    const cancelledTasks = (
      db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'cancelled'").get() as {
        cnt: number;
      }
    ).cnt;
    const collaboratingTasks = (
      db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'collaborating'").get() as {
        cnt: number;
      }
    ).cnt;

    const totalAgents = (db.prepare("SELECT COUNT(*) as cnt FROM agents").get() as { cnt: number }).cnt;
    const workingAgents = (
      db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'working'").get() as {
        cnt: number;
      }
    ).cnt;
    const idleAgents = (
      db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE status = 'idle'").get() as {
        cnt: number;
      }
    ).cnt;

    const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const topAgents = db
      .prepare("SELECT id, name, avatar_emoji, stats_tasks_done, stats_xp FROM agents ORDER BY stats_xp DESC LIMIT 5")
      .all();

    const activePackRow = db.prepare("SELECT value FROM settings WHERE key = 'officeWorkflowPack' LIMIT 1").get() as
      | { value?: unknown }
      | undefined;
    const activePack = normalizePackKey(activePackRow?.value) ?? "development";

    let tasksByDept: unknown[];
    if (activePack !== "development") {
      try {
        tasksByDept = db
          .prepare(
            `
        SELECT
          opd.department_id AS id,
          opd.name,
          opd.icon,
          opd.color,
          COUNT(t.id) AS total_tasks,
          SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_tasks
        FROM office_pack_departments opd
        LEFT JOIN tasks t
          ON t.department_id = opd.department_id
         AND COALESCE(t.workflow_pack_key, 'development') = ?
        WHERE opd.workflow_pack_key = ?
        GROUP BY opd.department_id
        ORDER BY opd.sort_order ASC, opd.department_id ASC
      `,
          )
          .all(activePack, activePack);
      } catch {
        tasksByDept = [];
      }
    } else {
      tasksByDept = [];
    }

    if (!Array.isArray(tasksByDept) || tasksByDept.length <= 0) {
      tasksByDept = db
        .prepare(
          `
      SELECT d.id, d.name, d.icon, d.color,
        COUNT(t.id) AS total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_tasks
      FROM departments d
      LEFT JOIN tasks t
        ON t.department_id = d.id
       AND COALESCE(t.workflow_pack_key, 'development') = 'development'
      GROUP BY d.id
      ORDER BY d.sort_order ASC, d.id ASC
    `,
        )
        .all();
    }

    const recentActivity = db
      .prepare(
        `
    SELECT tl.*, t.title AS task_title
    FROM task_logs tl
    LEFT JOIN tasks t ON tl.task_id = t.id
    ORDER BY tl.created_at DESC
    LIMIT 20
  `,
      )
      .all();

    res.json({
      stats: {
        tasks: {
          total: totalTasks,
          done: doneTasks,
          in_progress: inProgressTasks,
          inbox: inboxTasks,
          planned: plannedTasks,
          collaborating: collaboratingTasks,
          review: reviewTasks,
          cancelled: cancelledTasks,
          completion_rate: completionRate,
        },
        agents: {
          total: totalAgents,
          working: workingAgents,
          idle: idleAgents,
        },
        top_agents: topAgents,
        tasks_by_department: tasksByDept,
        recent_activity: recentActivity,
      },
    });
  });

  app.get("/api/dashboard/insights", (_req, res) => {
    const now = nowMs();
    const tasks = db
      .prepare(
        `
      SELECT
        t.id,
        t.title,
        t.status,
        t.task_type,
        t.project_id,
        t.project_path,
        t.assigned_agent_id,
        t.created_at,
        t.started_at,
        t.updated_at,
        t.completed_at,
        COALESCE(a.name, '') AS agent_name,
        COALESCE(a.name_ko, '') AS agent_name_ko,
        COALESCE(d.name, '') AS dept_name,
        COALESCE(d.name_ko, '') AS dept_name_ko
      FROM tasks t
      LEFT JOIN agents a ON a.id = t.assigned_agent_id
      LEFT JOIN departments d ON d.id = t.department_id
    `,
      )
      .all() as Array<{
      id: string;
      title: string;
      status: string;
      task_type: string;
      project_id: string | null;
      project_path: string | null;
      assigned_agent_id: string | null;
      created_at: number;
      started_at: number | null;
      updated_at: number;
      completed_at: number | null;
      agent_name: string;
      agent_name_ko: string;
      dept_name: string;
      dept_name_ko: string;
    }>;

    const agents = db
      .prepare(
        `
      SELECT
        a.id,
        a.name,
        a.name_ko,
        a.status,
        a.current_task_id,
        COALESCE(d.name, '') AS dept_name,
        COALESCE(d.name_ko, '') AS dept_name_ko
      FROM agents a
      LEFT JOIN departments d ON d.id = a.department_id
    `,
      )
      .all() as Array<{
      id: string;
      name: string;
      name_ko: string;
      status: string;
      current_task_id: string | null;
      dept_name: string;
      dept_name_ko: string;
    }>;

    const riskRadar = [
      (() => {
        const rows = tasks.filter(
          (task) =>
            (task.status === "in_progress" || task.status === "collaborating") &&
            now - (task.updated_at || task.created_at) >= 12 * 3_600_000,
        );
        return {
          id: "stalled_execution",
          severity: rows.some((task) => now - (task.updated_at || task.created_at) >= 24 * 3_600_000)
            ? "critical"
            : "warning",
          title: "Stalled execution",
          summary: "Active tasks have stopped moving and need a checkpoint or reassignment.",
          count: rows.length,
          sample_labels: rows.slice(0, 3).map((task) => task.title),
        } as const;
      })(),
      (() => {
        const rows = tasks.filter((task) => task.status === "review" || task.status === "pending");
        return {
          id: "review_queue",
          severity: rows.length >= 5 ? "warning" : "info",
          title: "Review queue backlog",
          summary: "Tasks are waiting for review or a decision instead of progressing.",
          count: rows.length,
          sample_labels: rows.slice(0, 3).map((task) => task.title),
        } as const;
      })(),
      (() => {
        const rows = tasks.filter(
          (task) =>
            task.project_path == null || task.project_path.trim() === "" || task.project_path.trim() === "General",
        );
        return {
          id: "missing_project_path",
          severity: rows.length > 0 ? "warning" : "info",
          title: "Missing project path",
          summary: "Tasks without a valid workspace path limit code inspection and autonomous execution.",
          count: rows.length,
          sample_labels: rows.slice(0, 3).map((task) => task.title),
        } as const;
      })(),
      (() => {
        const rows = agents.filter((agent) => agent.status === "working" && !agent.current_task_id);
        return {
          id: "orphan_working_agents",
          severity: rows.length > 0 ? "warning" : "info",
          title: "Orphan working agents",
          summary: "Some agents are marked working without a bound current task.",
          count: rows.length,
          sample_labels: rows.slice(0, 3).map((agent) => agent.name || agent.name_ko),
        } as const;
      })(),
    ].filter((item) => item.count > 0);

    const projectTaskMap = new Map<
      string,
      {
        project_id: string;
        project_name: string;
        project_path: string;
        stale_tasks: number;
        review_backlog: number;
        ownerless_tasks: number;
        open_incidents: number;
      }
    >();
    const projects = db
      .prepare("SELECT id, name, project_path FROM projects")
      .all() as Array<{ id: string; name: string; project_path: string }>;
    for (const project of projects) {
      projectTaskMap.set(project.id, {
        project_id: project.id,
        project_name: project.name,
        project_path: project.project_path,
        stale_tasks: 0,
        review_backlog: 0,
        ownerless_tasks: 0,
        open_incidents: 0,
      });
    }
    for (const task of tasks) {
      if (!task.project_id) continue;
      const entry = projectTaskMap.get(task.project_id);
      if (!entry) continue;
      const stale =
        (task.status === "in_progress" || task.status === "collaborating" || task.status === "review") &&
        now - (task.updated_at || task.created_at) >= 12 * 3_600_000;
      if (stale) entry.stale_tasks += 1;
      if (task.status === "review" || task.status === "pending") entry.review_backlog += 1;
      if (!task.assigned_agent_id && task.status !== "done") entry.ownerless_tasks += 1;
      if (stale || task.status === "pending" || task.status === "cancelled" || !task.assigned_agent_id) {
        entry.open_incidents += 1;
      }
    }
    const projectHotspots = Array.from(projectTaskMap.values())
      .map((project) => ({
        ...project,
        risk_score: project.open_incidents * 10 + project.stale_tasks * 12 + project.review_backlog * 5 + project.ownerless_tasks * 9,
      }))
      .filter((project) => project.risk_score > 0)
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, 6);

    const recommendedActions = [
      riskRadar.find((item) => item.id === "stalled_execution")
        ? {
            id: "action_stalled_execution",
            title: "Run a stalled-task standup",
            detail: "Request one-line progress updates from stalled task owners and either unblock or reassign them.",
            priority: "high" as const,
          }
        : null,
      riskRadar.find((item) => item.id === "missing_project_path")
        ? {
            id: "action_missing_project_path",
            title: "Restore missing project paths",
            detail: "Workspace paths are missing on active tasks. Fix path metadata before autonomous work drifts.",
            priority: "high" as const,
          }
        : null,
      riskRadar.find((item) => item.id === "review_queue")
        ? {
            id: "action_review_queue",
            title: "Collapse review backlog into explicit subtasks",
            detail: "Turn review comments into concrete follow-up items so tasks can leave the queue faster.",
            priority: "medium" as const,
          }
        : null,
      projectHotspots[0]
        ? {
            id: "action_project_hotspot",
            title: `Stabilize hotspot project: ${projectHotspots[0].project_name}`,
            detail: `Highest-risk project currently shows ${projectHotspots[0].open_incidents} incidents. Run a focused triage there first.`,
            priority: "medium" as const,
            project_id: projectHotspots[0].project_id,
            project_path: projectHotspots[0].project_path,
          }
        : null,
    ].filter(Boolean);

    const agentPerformance = agents
      .map((agent) => {
        const ownedTasks = tasks.filter((task) => task.assigned_agent_id === agent.id);
        const doneTasks = ownedTasks.filter((task) => task.status === "done");
        const activeTasks = ownedTasks.filter((task) => task.status === "in_progress" || task.status === "review");
        const reviewTasks = ownedTasks.filter((task) => task.status === "review");
        const stalledTasks = ownedTasks.filter(
          (task) =>
            (task.status === "in_progress" || task.status === "review") &&
            now - (task.updated_at || task.created_at) >= 12 * 3_600_000,
        );
        const durations = doneTasks
          .map((task) => {
            const start = task.started_at || task.created_at;
            const end = task.completed_at || task.updated_at;
            return end > start ? (end - start) / 3_600_000 : null;
          })
          .filter((value): value is number => value != null);
        const avgCycleHours =
          durations.length > 0 ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null;
        const typeCounts = new Map<string, number>();
        for (const task of doneTasks) {
          typeCounts.set(task.task_type, (typeCounts.get(task.task_type) ?? 0) + 1);
        }
        const dominantTaskType =
          [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (ownedTasks[0]?.task_type ?? null);
        const completionRate = ownedTasks.length > 0 ? Math.round((doneTasks.length / ownedTasks.length) * 100) : 0;
        const reviewRate = ownedTasks.length > 0 ? Math.round((reviewTasks.length / ownedTasks.length) * 100) : 0;
        const stallRate = ownedTasks.length > 0 ? Math.round((stalledTasks.length / ownedTasks.length) * 100) : 0;
        const score = Math.max(
          0,
          completionRate * 1.2 + doneTasks.length * 3 - reviewRate * 0.6 - stallRate * 1.1 - activeTasks.length * 0.2,
        );
        return {
          agent_id: agent.id,
          agent_name: agent.name,
          agent_name_ko: agent.name_ko,
          department_name: agent.dept_name,
          department_name_ko: agent.dept_name_ko,
          tasks_owned: ownedTasks.length,
          tasks_done: doneTasks.length,
          active_tasks: activeTasks.length,
          completion_rate: completionRate,
          avg_cycle_hours: avgCycleHours,
          review_rate: reviewRate,
          stall_rate: stallRate,
          dominant_task_type: dominantTaskType,
          score: Math.round(score),
        };
      })
      .filter((item) => item.tasks_owned > 0)
      .sort((a, b) => b.score - a.score || b.tasks_done - a.tasks_done)
      .slice(0, 8);

    res.json({
      risk_radar: riskRadar,
      agent_performance: agentPerformance,
      project_hotspots: projectHotspots,
      recommended_actions: recommendedActions,
    });
  });

  app.get("/api/dashboard/handled-history", (_req, res) => {
    const items = db
      .prepare(
        `
        SELECT
          kind,
          item_id,
          title,
          project_id,
          project_path,
          fingerprint,
          handled_by,
          note,
          handled_at,
          updated_at
        FROM dashboard_handled_history
        ORDER BY handled_at DESC
      `,
      )
      .all();
    res.json({ items });
  });

  if (typeof app.post === "function") {
    app.post("/api/dashboard/handled-history", (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const kind = body.kind === "risk" || body.kind === "action" ? body.kind : null;
      const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
      const handledBy =
        typeof body.handled_by === "string" && body.handled_by.trim() ? body.handled_by.trim() : "Operator";
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
      const projectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
      const projectPath =
        typeof body.project_path === "string" && body.project_path.trim() ? body.project_path.trim() : null;
      const handledAt =
        typeof body.handled_at === "number" && Number.isFinite(body.handled_at) ? Math.floor(body.handled_at) : nowMs();

      if (!kind || !itemId || !title || !fingerprint) {
        return res.status(400).json({ ok: false, error: "invalid_dashboard_handled_item" });
      }

      const updatedAt = nowMs();
      db.prepare(
        `
        INSERT INTO dashboard_handled_history (
          kind, item_id, title, project_id, project_path, fingerprint, handled_by, note, handled_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(kind, item_id) DO UPDATE SET
          title = excluded.title,
          project_id = excluded.project_id,
          project_path = excluded.project_path,
          fingerprint = excluded.fingerprint,
          handled_by = excluded.handled_by,
          note = excluded.note,
          handled_at = excluded.handled_at,
          updated_at = excluded.updated_at
      `,
      ).run(kind, itemId, title, projectId, projectPath, fingerprint, handledBy, note, handledAt, updatedAt);

      res.json({ ok: true });
    });
  }

  if (typeof app.delete === "function") {
    app.delete("/api/dashboard/handled-history", (req, res) => {
      const kind = req.query.kind === "risk" || req.query.kind === "action" ? req.query.kind : null;
      const itemId = typeof req.query.item_id === "string" ? req.query.item_id.trim() : "";

      if (kind && itemId) {
        db.prepare("DELETE FROM dashboard_handled_history WHERE kind = ? AND item_id = ?").run(kind, itemId);
        return res.json({ ok: true, deleted: 1 });
      }

      db.prepare("DELETE FROM dashboard_handled_history").run();
      res.json({ ok: true, deleted: "all" });
    });
  }
}
