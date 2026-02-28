import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "exec" | "prepare">;

export function applyDefaultSeeds(db: DbLike): void {
  const deptCount = (db.prepare("SELECT COUNT(*) as cnt FROM departments").get() as { cnt: number }).cnt;

  if (deptCount === 0) {
    const insertDept = db.prepare(
      "INSERT INTO departments (id, name, name_ko, name_ja, name_zh, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // Workflow order: 기획 → 개발 → 디자인 → QA → 인프라보안 → 운영
    insertDept.run("planning", "Planning", "기획팀", "企画チーム", "企划组", "📊", "#f59e0b", 1);
    insertDept.run("dev", "Development", "개발팀", "開発チーム", "开发组", "💻", "#3b82f6", 2);
    insertDept.run("design", "Design", "디자인팀", "デザインチーム", "设计组", "🎨", "#8b5cf6", 3);
    insertDept.run("qa", "QA/QC", "품질관리팀", "品質管理チーム", "质量管理组", "🔍", "#ef4444", 4);
    insertDept.run(
      "devsecops",
      "DevSecOps",
      "인프라보안팀",
      "インフラセキュリティチーム",
      "基础安全组",
      "🛡️",
      "#f97316",
      5,
    );
    insertDept.run("operations", "Operations", "운영팀", "運営チーム", "运营组", "⚙️", "#10b981", 6);
    console.log("[Claw-Empire] Seeded default departments");
  }

  const agentCount = (db.prepare("SELECT COUNT(*) as cnt FROM agents").get() as { cnt: number }).cnt;

  if (agentCount === 0) {
    const insertAgent = db.prepare(
      `INSERT INTO agents (id, name, name_ko, department_id, role, cli_provider, avatar_emoji, personality)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Development (3)
    insertAgent.run(randomUUID(), "Aria", "아리아", "dev", "team_leader", "claude", "👩‍💻", "꼼꼼한 시니어 개발자");
    insertAgent.run(randomUUID(), "Bolt", "볼트", "dev", "senior", "codex", "⚡", "빠른 코딩 전문가");
    insertAgent.run(randomUUID(), "Nova", "노바", "dev", "junior", "copilot", "🌟", "창의적인 주니어");
    // Design (2)
    insertAgent.run(randomUUID(), "Pixel", "픽셀", "design", "team_leader", "claude", "🎨", "디자인 리더");
    insertAgent.run(randomUUID(), "Luna", "루나", "design", "junior", "gemini", "🌙", "감성적인 UI 디자이너");
    // Planning (2)
    insertAgent.run(randomUUID(), "Sage", "세이지", "planning", "team_leader", "codex", "🧠", "전략 분석가");
    insertAgent.run(randomUUID(), "Clio", "클리오", "planning", "senior", "claude", "📝", "데이터 기반 기획자");
    // Operations (2)
    insertAgent.run(randomUUID(), "Atlas", "아틀라스", "operations", "team_leader", "claude", "🗺️", "운영의 달인");
    insertAgent.run(randomUUID(), "Turbo", "터보", "operations", "senior", "codex", "🚀", "자동화 전문가");
    // QA/QC (2)
    insertAgent.run(randomUUID(), "Hawk", "호크", "qa", "team_leader", "claude", "🦅", "날카로운 품질 감시자");
    insertAgent.run(randomUUID(), "Lint", "린트", "qa", "senior", "codex", "🔬", "꼼꼼한 테스트 전문가");
    // DevSecOps (2)
    insertAgent.run(randomUUID(), "Vault", "볼트S", "devsecops", "team_leader", "claude", "🛡️", "보안 아키텍트");
    insertAgent.run(randomUUID(), "Pipe", "파이프", "devsecops", "senior", "codex", "🔧", "CI/CD 파이프라인 전문가");
    // QA Junior (1)
    insertAgent.run(randomUUID(), "DORO", "도로롱", "qa", "junior", "gemini", "🩷", "꼼꼼한 품질관리 주니어");
    console.log("[Claw-Empire] Seeded default agents");
  }

  // Seed default settings if none exist
  {
    const defaultRoomThemes = {
      ceoOffice: { accent: 0xa77d0c, floor1: 0xe5d9b9, floor2: 0xdfd0a8, wall: 0x998243 },
      planning: { accent: 0xd4a85a, floor1: 0xf0e1c5, floor2: 0xeddaba, wall: 0xae9871 },
      dev: { accent: 0x5a9fd4, floor1: 0xd8e8f5, floor2: 0xcce1f2, wall: 0x6c96b7 },
      design: { accent: 0x9a6fc4, floor1: 0xe8def2, floor2: 0xe1d4ee, wall: 0x9378ad },
      qa: { accent: 0xd46a6a, floor1: 0xf0cbcb, floor2: 0xedc0c0, wall: 0xae7979 },
      devsecops: { accent: 0xd4885a, floor1: 0xf0d5c5, floor2: 0xedcdba, wall: 0xae8871 },
      operations: { accent: 0x5ac48a, floor1: 0xd0eede, floor2: 0xc4ead5, wall: 0x6eaa89 },
      breakRoom: { accent: 0xf0c878, floor1: 0xf7e2b7, floor2: 0xf6dead, wall: 0xa99c83 },
    };

    const settingsCount = (db.prepare("SELECT COUNT(*) as c FROM settings").get() as { c: number }).c;
    const isLegacySettingsInstall = settingsCount > 0;
    if (settingsCount === 0) {
      const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
      insertSetting.run("companyName", "Claw-Empire");
      insertSetting.run("ceoName", "CEO");
      insertSetting.run("autoAssign", "true");
      insertSetting.run("autoUpdateEnabled", "false");
      insertSetting.run("autoUpdateNoticePending", "false");
      insertSetting.run("oauthAutoSwap", "true");
      insertSetting.run("language", "en");
      insertSetting.run("defaultProvider", "claude");
      insertSetting.run(
        "providerModelConfig",
        JSON.stringify({
          claude: { model: "claude-opus-4-6", subModel: "claude-sonnet-4-6" },
          codex: {
            model: "gpt-5.3-codex",
            reasoningLevel: "xhigh",
            subModel: "gpt-5.3-codex",
            subModelReasoningLevel: "high",
          },
          gemini: { model: "gemini-3-pro-preview" },
          opencode: { model: "github-copilot/claude-sonnet-4.6" },
          copilot: { model: "github-copilot/claude-sonnet-4.6" },
          antigravity: { model: "google/antigravity-gemini-3-pro" },
        }),
      );
      insertSetting.run("roomThemes", JSON.stringify(defaultRoomThemes));
      console.log("[Claw-Empire] Seeded default settings");
    }

    const hasLanguageSetting = db.prepare("SELECT 1 FROM settings WHERE key = 'language' LIMIT 1").get() as
      | { 1: number }
      | undefined;
    if (!hasLanguageSetting) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("language", "en");
    }

    const hasOAuthAutoSwapSetting = db.prepare("SELECT 1 FROM settings WHERE key = 'oauthAutoSwap' LIMIT 1").get() as
      | { 1: number }
      | undefined;
    if (!hasOAuthAutoSwapSetting) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("oauthAutoSwap", "true");
    }

    const hasAutoUpdateEnabledSetting = db
      .prepare("SELECT 1 FROM settings WHERE key = 'autoUpdateEnabled' LIMIT 1")
      .get() as { 1: number } | undefined;
    if (!hasAutoUpdateEnabledSetting) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("autoUpdateEnabled", "false");
    }

    const hasAutoUpdateNoticePendingSetting = db
      .prepare("SELECT 1 FROM settings WHERE key = 'autoUpdateNoticePending' LIMIT 1")
      .get() as { 1: number } | undefined;
    if (!hasAutoUpdateNoticePendingSetting) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        "autoUpdateNoticePending",
        isLegacySettingsInstall ? "true" : "false",
      );
    }

    const hasRoomThemesSetting = db.prepare("SELECT 1 FROM settings WHERE key = 'roomThemes' LIMIT 1").get() as
      | { 1: number }
      | undefined;
    if (!hasRoomThemesSetting) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        "roomThemes",
        JSON.stringify(defaultRoomThemes),
      );
    }
  }

  // Migrate: add sort_order column & set correct ordering for existing DBs
  {
    try {
      db.exec("ALTER TABLE departments ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 99");
    } catch {
      /* already exists */
    }

    // UNIQUE 인덱스 일시 제거 → 값 갱신 → 인덱스 재생성 (충돌 방지)
    try {
      db.exec("DROP INDEX IF EXISTS idx_departments_sort_order");
    } catch {
      /* noop */
    }
    const DEPT_ORDER: Record<string, number> = { planning: 1, dev: 2, design: 3, qa: 4, devsecops: 5, operations: 6 };

    const insertDeptIfMissing = db.prepare(
      "INSERT OR IGNORE INTO departments (id, name, name_ko, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insertDeptIfMissing.run("qa", "QA/QC", "품질관리팀", "🔍", "#ef4444", 4);
    insertDeptIfMissing.run("devsecops", "DevSecOps", "인프라보안팀", "🛡️", "#f97316", 5);

    const updateOrder = db.prepare("UPDATE departments SET sort_order = ? WHERE id = ?");
    for (const [id, order] of Object.entries(DEPT_ORDER)) {
      updateOrder.run(order, id);
    }

    const allDepartments = db
      .prepare("SELECT id, sort_order FROM departments ORDER BY sort_order ASC, id ASC")
      .all() as Array<{ id: string; sort_order: number }>;
    const existingDeptIds = new Set(allDepartments.map((row) => row.id));
    const usedOrders = new Set<number>();
    for (const [id, order] of Object.entries(DEPT_ORDER)) {
      if (!existingDeptIds.has(id)) continue;
      usedOrders.add(order);
    }

    let nextOrder = 1;
    for (const row of allDepartments) {
      if (Object.prototype.hasOwnProperty.call(DEPT_ORDER, row.id)) continue;
      while (usedOrders.has(nextOrder)) nextOrder += 1;
      updateOrder.run(nextOrder, row.id);
      usedOrders.add(nextOrder);
      nextOrder += 1;
    }

    try {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_sort_order ON departments(sort_order)");
    } catch (err) {
      console.warn("[Claw-Empire] Failed to recreate idx_departments_sort_order:", err);
    }

    const insertAgentIfMissing = db.prepare(
      `INSERT OR IGNORE INTO agents (id, name, name_ko, department_id, role, cli_provider, avatar_emoji, personality)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Check which agents exist by name to avoid duplicates
    const existingNames = new Set(
      (db.prepare("SELECT name FROM agents").all() as { name: string }[]).map((r) => r.name),
    );

    const newAgents: [string, string, string, string, string, string, string][] = [
      // [name, name_ko, dept, role, provider, emoji, personality]
      ["Luna", "루나", "design", "junior", "gemini", "🌙", "감성적인 UI 디자이너"],
      ["Clio", "클리오", "planning", "senior", "claude", "📝", "데이터 기반 기획자"],
      ["Turbo", "터보", "operations", "senior", "codex", "🚀", "자동화 전문가"],
      ["Hawk", "호크", "qa", "team_leader", "claude", "🦅", "날카로운 품질 감시자"],
      ["Lint", "린트", "qa", "senior", "opencode", "🔬", "꼼꼼한 테스트 전문가"],
      ["Vault", "볼트S", "devsecops", "team_leader", "claude", "🛡️", "보안 아키텍트"],
      ["Pipe", "파이프", "devsecops", "senior", "codex", "🔧", "CI/CD 파이프라인 전문가"],
    ];

    let added = 0;
    for (const [name, nameKo, dept, role, provider, emoji, personality] of newAgents) {
      if (!existingNames.has(name)) {
        if (!existingDeptIds.has(dept)) {
          console.warn(`[Claw-Empire] Skip adding agent "${name}": missing department "${dept}"`);
          continue;
        }
        try {
          insertAgentIfMissing.run(randomUUID(), name, nameKo, dept, role, provider, emoji, personality);
          added++;
        } catch (err) {
          console.warn(`[Claw-Empire] Skip adding agent "${name}":`, err);
        }
      }
    }
    if (added > 0) console.log(`[Claw-Empire] Added ${added} new agents`);
  }
}
