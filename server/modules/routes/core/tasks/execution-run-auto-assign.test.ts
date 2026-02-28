import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { selectAutoAssignableAgentForTask } from "./execution-run-auto-assign.ts";

function setupDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      role TEXT NOT NULL,
      cli_provider TEXT,
      status TEXT NOT NULL,
      current_task_id TEXT,
      stats_tasks_done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      assignment_mode TEXT NOT NULL DEFAULT 'auto'
    );
    CREATE TABLE project_agents (
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL
    );
  `);
  return db;
}

function insertAgent(
  db: DatabaseSync,
  input: {
    id: string;
    name: string;
    department_id: string | null;
    role?: string;
    cli_provider?: string | null;
    status?: string;
    current_task_id?: string | null;
    stats_tasks_done?: number;
    created_at?: number;
  },
): void {
  db.prepare(
    `
      INSERT INTO agents (
        id, name, department_id, role, cli_provider, status, current_task_id, stats_tasks_done, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.id,
    input.name,
    input.department_id,
    input.role ?? "senior",
    input.cli_provider ?? "codex",
    input.status ?? "idle",
    input.current_task_id ?? null,
    input.stats_tasks_done ?? 0,
    input.created_at ?? 1,
  );
}

describe("selectAutoAssignableAgentForTask", () => {
  it("오피스팩별 우선 부서가 다르게 적용된다", () => {
    const db = setupDb();
    try {
      insertAgent(db, { id: "agent-plan", name: "Planner", department_id: "planning", created_at: 1 });
      insertAgent(db, { id: "agent-dev", name: "Dev", department_id: "dev", created_at: 2 });
      insertAgent(db, { id: "agent-design", name: "Designer", department_id: "design", created_at: 3 });

      const reportSelected = selectAutoAssignableAgentForTask(db, {
        workflow_pack_key: "report",
        department_id: null,
        project_id: null,
      });
      const researchSelected = selectAutoAssignableAgentForTask(db, {
        workflow_pack_key: "web_research_report",
        department_id: null,
        project_id: null,
      });
      const novelSelected = selectAutoAssignableAgentForTask(db, {
        workflow_pack_key: "novel",
        department_id: null,
        project_id: null,
      });

      expect(reportSelected?.agent.department_id).toBe("planning");
      expect(researchSelected?.agent.department_id).toBe("dev");
      expect(novelSelected?.agent.department_id).toBe("design");
    } finally {
      db.close();
    }
  });

  it("팩 우선 부서 순서로 자동 배정 대상을 고른다", () => {
    const db = setupDb();
    try {
      insertAgent(db, { id: "agent-dev", name: "Dev", department_id: "dev", created_at: 1 });
      insertAgent(db, { id: "agent-plan", name: "Planner", department_id: "planning", created_at: 2 });

      const selected = selectAutoAssignableAgentForTask(db, {
        workflow_pack_key: "report",
        department_id: null,
        project_id: null,
      });

      expect(selected?.packKey).toBe("report");
      expect(selected?.agent.id).toBe("agent-plan");
    } finally {
      db.close();
    }
  });

  it("프로젝트 manual 모드에서는 지정 인원 범위로만 자동 배정한다", () => {
    const db = setupDb();
    try {
      insertAgent(db, { id: "agent-plan", name: "Planner", department_id: "planning", created_at: 1 });
      insertAgent(db, { id: "agent-sec", name: "Sec", department_id: "devsecops", created_at: 2 });
      db.prepare("INSERT INTO projects (id, assignment_mode) VALUES (?, ?)").run("project-1", "manual");
      db.prepare("INSERT INTO project_agents (project_id, agent_id) VALUES (?, ?)").run("project-1", "agent-sec");

      const selected = selectAutoAssignableAgentForTask(db, {
        workflow_pack_key: "report",
        department_id: null,
        project_id: "project-1",
      });

      expect(selected?.agent.id).toBe("agent-sec");
    } finally {
      db.close();
    }
  });

  it("선호 부서가 비어있으면 전체 idle/break 인원으로 폴백한다", () => {
    const db = setupDb();
    try {
      insertAgent(db, {
        id: "agent-dev-working",
        name: "Busy Dev",
        department_id: "dev",
        status: "working",
        current_task_id: "task-busy",
        created_at: 1,
      });
      insertAgent(db, {
        id: "agent-sec-idle",
        name: "Idle Sec",
        department_id: "devsecops",
        status: "idle",
        created_at: 2,
      });

      const selected = selectAutoAssignableAgentForTask(db, {
        workflow_pack_key: "roleplay",
        department_id: null,
        project_id: null,
      });

      expect(selected?.agent.id).toBe("agent-sec-idle");
    } finally {
      db.close();
    }
  });
});
