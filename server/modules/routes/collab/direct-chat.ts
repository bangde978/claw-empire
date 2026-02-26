import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sendMessengerMessage, type MessengerChannel } from "../../../gateway/client.ts";
import type { RuntimeContext } from "../../../types/runtime-context.ts";
import type { Lang } from "../../../types/lang.ts";
import type { DelegationOptions } from "./project-resolution.ts";

export interface AgentRow {
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

type L10n = Record<Lang, string[]>;

type DirectReplyPayload = {
  text?: string;
};

type DirectReplyBuild = {
  prompt: string;
  lang: Lang;
};

type DirectChatDeps = {
  db: RuntimeContext["db"];
  logsDir: string;
  nowMs: () => number;
  randomDelay: (minMs: number, maxMs: number) => number;
  broadcast: (type: string, payload: unknown) => void;
  appendTaskLog: (taskId: string, kind: string, message: string) => void;
  recordTaskCreationAudit: RuntimeContext["recordTaskCreationAudit"];
  resolveLang: (text?: string, fallback?: Lang) => Lang;
  resolveProjectPath: (taskLike: { project_path?: string | null; description?: string | null }) => string;
  detectProjectPath: (text: string) => string | null;
  normalizeTextField: (value: unknown) => string | null;
  resolveProjectFromOptions: (options: DelegationOptions) => {
    id: string | null;
    name: string | null;
    projectPath: string | null;
    coreGoal: string | null;
  };
  buildRoundGoal: (projectCoreGoal: string, message: string) => string;
  getDeptName: (deptId: string) => string;
  l: (ko: string[], en: string[], ja?: string[], zh?: string[]) => L10n;
  pickL: (pool: L10n, lang: Lang) => string;
  sendAgentMessage: (
    agent: AgentRow,
    content: string,
    messageType?: string,
    receiverType?: string,
    receiverId?: string | null,
    taskId?: string | null,
  ) => void;
  chooseSafeReply: (run: DirectReplyPayload, lang: Lang, context: "direct", agent: AgentRow) => string;
  buildCliFailureMessage: (agent: AgentRow, lang: Lang, reason: string) => string;
  buildDirectReplyPrompt: (agent: AgentRow, ceoMessage: string, messageType: string) => DirectReplyBuild;
  runAgentOneShot: (
    agent: AgentRow,
    prompt: string,
    opts: { projectPath: string; rawOutput: true },
  ) => Promise<DirectReplyPayload>;
  executeApiProviderAgent: RuntimeContext["executeApiProviderAgent"];
  executeCopilotAgent: RuntimeContext["executeCopilotAgent"];
  executeAntigravityAgent: RuntimeContext["executeAntigravityAgent"];
  isTaskWorkflowInterrupted: (taskId: string) => boolean;
  startTaskExecutionForAgent: (
    taskId: string,
    agent: AgentRow,
    deptId: string | null,
    deptName: string,
    options?: {
      onMainTaskDone?: () => void;
      disableCrossDeptAfterMain?: boolean;
    },
  ) => void;
  handleTaskDelegation: (
    teamLeader: AgentRow,
    ceoMessage: string,
    mentionContext: string,
    options?: DelegationOptions,
  ) => void;
};

function shouldTreatDirectChatAsTask(ceoMessage: string, messageType: string): boolean {
  if (messageType === "task_assign") return true;
  if (messageType === "report") return false;
  const text = ceoMessage.trim();
  if (!text) return false;
  if (/^\[(의사결정\s*회신|decision\s*reply|意思決定返信|决策回复)\]/i.test(text)) return false;

  if (/^\s*(task|todo|업무|지시|작업|할일)\s*[:\-]/i.test(text)) return true;

  const taskKeywords =
    /(테스트|검증|확인해|진행해|수정해|구현해|반영해|처리해|해줘|부탁|fix|implement|refactor|test|verify|check|run|apply|update|debug|investigate|対応|確認|修正|実装|测试|检查|修复|处理)/i;
  if (taskKeywords.test(text)) return true;

  const requestTone =
    /(해주세요|해 주세요|부탁해|부탁합니다|please|can you|could you|お願いします|してください|请|麻烦)/i;
  if (requestTone.test(text) && text.length >= 12) return true;

  return false;
}

export function isTaskKickoffMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[!?.。！？…~]+$/g, "");
  if (!normalized) return false;
  if (/^(고고|ㄱㄱ|가자|가즈아|진행|진행해|시작|시작해|착수|착수해|바로 진행|바로해)$/i.test(normalized)) return true;
  if (/^(go|go go|gogo|let'?s go|start|proceed|execute|go ahead)$/i.test(normalized)) return true;
  return false;
}

export function isAffirmativeReply(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[!?.。！？…~]+$/g, "");
  if (!normalized) return false;

  const negativePatterns = [
    /^(아니|아니요|아뇨|노|안됨|하지마|중지|멈춰|스탑|stop|no|nope|nah|don'?t|not now|later|아직|다음에|やめて|いいえ|不要|不用|不行|先不要)/i,
  ];
  if (negativePatterns.some((pattern) => pattern.test(normalized))) return false;

  const affirmativePatterns = [
    /^(네|예|응|ㅇㅇ|좋아|좋아요|오케이|ok|okay|sure|yep|yeah|yes|go|go ahead|proceed|do it|start|let'?s go|let?s do it|진행|시작|착수|바로 해|콜|ㄱㄱ|고고)/i,
    /^(はい|了解|お願いします|進めて|進めてください|開始して|いいよ|いいです|実行して)/i,
    /^(好|好的|可以|行|开始吧|继续|请开始|执行吧|马上开始)/i,
  ];
  return affirmativePatterns.some((pattern) => pattern.test(normalized));
}

export function isAgentEscalationPrompt(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const patterns = [
    /(바로\s*)?(시작|진행|착수).*(할까요|할까|할게요\?|해도 될까요|진행해도 될까요)/i,
    /(업무|작업|요청|평가|리뷰|검토).*(진행|시작).*(할까요|해볼까요|해도 될까요)/i,
    /(shall i|should i|would you like me to|may i|can i).*(start|proceed|execute|run|begin)/i,
    /(start now|proceed now|go ahead\?)/i,
    /(開始|進行).*(しましょうか|していいですか|しますか)/i,
    /(现在|现在就).*(开始|执行).*(吗|？|\?)/i,
    /(要不要|是否).*(开始|执行)/i,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isCancelReply(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return /^(취소|중지|멈춰|그만|나중에|cancel|stop|abort|later|not now|いいえ|中止|不要|先不要)/i.test(normalized);
}

export function isNoPathReply(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  const patterns = [
    /(경로|프로젝트).*없/,
    /(모르겠|몰라|기억안)/,
    /(no path|don't have.*path|no project path|without path|unknown path)/i,
    /(create new project|new project please|make new project)/i,
    /(路径).*没有|没有路径|新建项目|新项目/,
    /(パス).*ない|新規プロジェクト/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isTaskReadinessMessage(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (shouldTreatDirectChatAsTask(normalized, "chat")) return true;
  const readinessPatterns = [
    /(업무|작업|지시|요청|평가|리뷰|검토|분석|문서화|구현|수정|개선|진행).*(가능|할\s*수|할수|되나|될까)/i,
    /(가능|할\s*수|할수|가능해|가능합|can\s+you|possible).*(업무|작업|지시|요청|평가|리뷰|검토|분석|문서화|구현|수정|개선|진행)/i,
    /(go ahead|can proceed|ready to start|start this)/i,
  ];
  return readinessPatterns.some((pattern) => pattern.test(normalized));
}

type RecentCeoMessage = {
  content: string;
  messageType?: string | null;
  createdAt?: number | null;
};

export function resolveContextualTaskMessage(
  currentMessage: string,
  recentCeoMessages: RecentCeoMessage[],
  recentAgentMessages: Array<{ content: string; createdAt?: number | null }> = [],
): string | null {
  const kickoff = isTaskKickoffMessage(currentMessage);
  const affirmative = isAffirmativeReply(currentMessage);
  if (!kickoff && !affirmative) return null;
  const current = currentMessage.trim();

  const escalationPromptTs = recentAgentMessages
    .filter((row) => isAgentEscalationPrompt(row.content))
    .map((row) => row.createdAt ?? 0)
    .sort((a, b) => b - a)[0];
  if (affirmative && !kickoff && !escalationPromptTs) return null;

  for (const row of recentCeoMessages) {
    const candidate = (row.content || "").trim();
    if (!candidate) continue;
    if (candidate === current) continue;
    if (affirmative && escalationPromptTs) {
      const candidateTs = row.createdAt ?? 0;
      if (candidateTs > escalationPromptTs) continue;
    }
    if (shouldTreatDirectChatAsTask(candidate, row.messageType ?? "chat") || isTaskReadinessMessage(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isMessengerChannel(value: unknown): value is MessengerChannel {
  return value === "telegram" || value === "discord" || value === "slack";
}

function splitSentences(text: string): string[] {
  return (
    text.match(/[^.!?…。！？]+[.!?…。！？]?/gu)?.map((part) => part.trim()).filter(Boolean) ?? [text.trim()]
  ).filter(Boolean);
}

function collapseAdjacentRepeatedSentenceBlocks(sentences: string[]): string[] {
  const next = [...sentences];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let blockSize = Math.floor(next.length / 2); blockSize >= 1; blockSize -= 1) {
      for (let start = 0; start + blockSize * 2 <= next.length; start += 1) {
        let equal = true;
        for (let i = 0; i < blockSize; i += 1) {
          if (next[start + i] !== next[start + blockSize + i]) {
            equal = false;
            break;
          }
        }
        if (equal) {
          next.splice(start + blockSize, blockSize);
          changed = true;
          break outer;
        }
      }
    }
  }
  return next;
}

export function normalizeAgentReply(content: string): string {
  const trimmed = (content || "").trim();
  if (!trimmed) return "";

  const mergedWhitespace = trimmed
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
  if (!mergedWhitespace) return "";

  const repeatedBlock = mergedWhitespace.match(/^(.{6,}?)(?:\s+\1)+$/us);
  if (repeatedBlock?.[1]) {
    return repeatedBlock[1].trim();
  }

  const lines = mergedWhitespace
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2 && lines.every((line) => line === lines[0])) {
    return lines[0];
  }

  const dedupedSentences = collapseAdjacentRepeatedSentenceBlocks(splitSentences(mergedWhitespace));
  const sentenceNormalized = dedupedSentences.join(" ").trim();
  return sentenceNormalized || mergedWhitespace;
}

function getMessengerChunkLimit(channel: MessengerChannel): number {
  if (channel === "discord") return 1900;
  if (channel === "telegram") return 3800;
  return 35000;
}

function splitMessageByLimit(text: string, limit: number): string[] {
  const source = text.trim();
  if (!source) return [];
  if (source.length <= limit) return [source];

  const chunks: string[] = [];
  let remaining = source;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.4)) {
      cut = remaining.lastIndexOf(" ", limit);
    }
    if (cut < Math.floor(limit * 0.4)) {
      cut = limit;
    }
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function createDirectChatHandlers(deps: DirectChatDeps) {
  const {
    db,
    logsDir,
    nowMs,
    randomDelay,
    broadcast,
    appendTaskLog,
    recordTaskCreationAudit,
    resolveLang,
    resolveProjectPath,
    detectProjectPath,
    normalizeTextField,
    resolveProjectFromOptions,
    buildRoundGoal,
    getDeptName,
    l,
    pickL,
    sendAgentMessage,
    chooseSafeReply,
    buildCliFailureMessage,
    buildDirectReplyPrompt,
    runAgentOneShot,
    executeApiProviderAgent,
    executeCopilotAgent,
    executeAntigravityAgent,
    isTaskWorkflowInterrupted,
    startTaskExecutionForAgent,
    handleTaskDelegation,
  } = deps;
  const pendingProjectBindingByAgent = new Map<
    string,
    { taskMessage: string; options: DelegationOptions; requestedAt: number }
  >();

  async function relayReplyToMessenger(options: DelegationOptions, agent: AgentRow, rawContent: string): Promise<void> {
    const channel = options.messengerChannel;
    const targetId = (options.messengerTargetId || "").trim();
    if (!isMessengerChannel(channel) || !targetId) return;

    const cleaned = normalizeAgentReply(rawContent);
    if (!cleaned) return;

    const chunks = splitMessageByLimit(cleaned, getMessengerChunkLimit(channel));
    for (const chunk of chunks) {
      await sendMessengerMessage({
        channel,
        targetId,
        text: chunk,
      });
    }
    console.log(`[messenger-reply] relayed ${chunks.length} chunk(s) to ${channel}:${targetId} via ${agent.name}`);
  }

  function hasProjectBinding(taskMessage: string, options: DelegationOptions): boolean {
    if (normalizeTextField(options.projectId)) return true;
    if (detectProjectPath(options.projectPath || "") || detectProjectPath(taskMessage)) return true;
    const selectedProject = resolveProjectFromOptions(options);
    if (selectedProject.id || detectProjectPath(selectedProject.projectPath || "")) return true;
    return false;
  }

  function resolveProjectBindingFromText(text: string): {
    projectId?: string | null;
    projectPath?: string | null;
    projectContext?: string | null;
  } | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const detectedPath = detectProjectPath(trimmed);
    if (detectedPath) {
      const byPath = db
        .prepare(
          `
          SELECT id, project_path, core_goal
          FROM projects
          WHERE project_path = ?
          ORDER BY last_used_at DESC, updated_at DESC
          LIMIT 1
        `,
        )
        .get(detectedPath) as { id: string; project_path: string | null; core_goal: string | null } | undefined;
      return {
        projectId: byPath?.id ?? null,
        projectPath: normalizeTextField(byPath?.project_path) || detectedPath,
        projectContext: normalizeTextField(byPath?.core_goal),
      };
    }

    const candidate = trimmed.replace(/^프로젝트\s*[:\-]?\s*/i, "");
    if (!candidate || candidate.length < 2) return null;

    const exactByName = db
      .prepare(
        `
        SELECT id, project_path, core_goal
        FROM projects
        WHERE LOWER(name) = LOWER(?)
        ORDER BY last_used_at DESC, updated_at DESC
        LIMIT 1
      `,
      )
      .get(candidate) as { id: string; project_path: string | null; core_goal: string | null } | undefined;
    if (exactByName) {
      return {
        projectId: exactByName.id,
        projectPath: normalizeTextField(exactByName.project_path),
        projectContext: normalizeTextField(exactByName.core_goal),
      };
    }

    const fuzzyByName = db
      .prepare(
        `
        SELECT id, project_path, core_goal
        FROM projects
        WHERE LOWER(name) LIKE LOWER(?)
        ORDER BY last_used_at DESC, updated_at DESC
        LIMIT 1
      `,
      )
      .get(`%${candidate}%`) as { id: string; project_path: string | null; core_goal: string | null } | undefined;
    if (!fuzzyByName) return null;
    return {
      projectId: fuzzyByName.id,
      projectPath: normalizeTextField(fuzzyByName.project_path),
      projectContext: normalizeTextField(fuzzyByName.core_goal),
    };
  }

  function expandProjectRootAlias(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (trimmed === "~") return os.homedir();
    if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
    if (trimmed === "/Projects" || trimmed.startsWith("/Projects/")) {
      const suffix = trimmed.slice("/Projects".length).replace(/^\/+/, "");
      return suffix ? path.join(os.homedir(), "Projects", suffix) : path.join(os.homedir(), "Projects");
    }
    if (trimmed === "/projects" || trimmed.startsWith("/projects/")) {
      const suffix = trimmed.slice("/projects".length).replace(/^\/+/, "");
      return suffix ? path.join(os.homedir(), "projects", suffix) : path.join(os.homedir(), "projects");
    }
    return trimmed;
  }

  function parseAllowedProjectRootsFromEnv(): string[] {
    const raw = (process.env.PROJECT_PATH_ALLOWED_ROOTS || "").trim();
    if (!raw) return [];
    return raw
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.normalize(path.resolve(expandProjectRootAlias(item))));
  }

  function pickAutoProjectRoot(): string {
    const allowedRoots = parseAllowedProjectRootsFromEnv();
    const candidates = [
      ...allowedRoots,
      path.join(os.homedir(), "Projects"),
      path.join(os.homedir(), "projects"),
      path.join(process.cwd(), "projects"),
      process.cwd(),
    ];
    for (const candidate of candidates) {
      try {
        fs.mkdirSync(candidate, { recursive: true });
        if (fs.statSync(candidate).isDirectory()) {
          return path.normalize(candidate);
        }
      } catch {
        // try next
      }
    }
    return path.normalize(process.cwd());
  }

  function deriveAutoProjectName(taskMessage: string): string {
    const oneLine = taskMessage.replace(/\s+/g, " ").trim();
    if (!oneLine) return `Auto Project ${new Date().toISOString().slice(0, 10)}`;
    return oneLine.length > 56 ? `${oneLine.slice(0, 53)}...` : oneLine;
  }

  function deriveAutoProjectFolder(taskMessage: string): string {
    const ascii = taskMessage
      .normalize("NFKD")
      .replace(/[^\x00-\x7F]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    if (!ascii) return `${datePart}-project`;
    const short = ascii.slice(0, 40).replace(/-+$/g, "");
    return `${datePart}-${short || "project"}`;
  }

  function isProjectPathConflict(projectPath: string): boolean {
    if (process.platform === "win32" || process.platform === "darwin") {
      const row = db
        .prepare("SELECT id FROM projects WHERE LOWER(project_path) = LOWER(?) LIMIT 1")
        .get(projectPath) as { id: string } | undefined;
      return Boolean(row?.id);
    }
    const row = db.prepare("SELECT id FROM projects WHERE project_path = ? LIMIT 1").get(projectPath) as
      | { id: string }
      | undefined;
    return Boolean(row?.id);
  }

  function createAutoProjectBinding(taskMessage: string): {
    projectId: string;
    projectPath: string;
    projectContext: string;
    projectName: string;
  } | null {
    const root = pickAutoProjectRoot();
    const folderBase = deriveAutoProjectFolder(taskMessage);
    let attempt = 0;
    let projectPath = path.join(root, folderBase);
    while (attempt < 50) {
      if (!fs.existsSync(projectPath) && !isProjectPathConflict(projectPath)) {
        break;
      }
      attempt += 1;
      projectPath = path.join(root, `${folderBase}-${attempt + 1}`);
    }
    if (attempt >= 50) return null;

    try {
      fs.mkdirSync(projectPath, { recursive: true });
      if (!fs.statSync(projectPath).isDirectory()) return null;
    } catch {
      return null;
    }

    const projectId = randomUUID();
    const t = nowMs();
    const projectName = deriveAutoProjectName(taskMessage);
    const coreGoal = taskMessage.trim() || projectName;
    try {
      db.prepare(
        `
        INSERT INTO projects (id, name, project_path, core_goal, assignment_mode, last_used_at, created_at, updated_at, github_repo)
        VALUES (?, ?, ?, ?, 'auto', ?, ?, ?, NULL)
      `,
      ).run(projectId, projectName, projectPath, coreGoal, t, t, t);
    } catch (err) {
      console.warn(`[auto-project] failed to insert project: ${String(err)}`);
      return null;
    }

    return {
      projectId,
      projectPath,
      projectContext: coreGoal,
      projectName,
    };
  }

  function createDirectAgentTaskAndRun(agent: AgentRow, ceoMessage: string, options: DelegationOptions = {}): void {
    const lang = resolveLang(ceoMessage);
    const taskId = randomUUID();
    const t = nowMs();
    const taskTitle = ceoMessage.length > 60 ? `${ceoMessage.slice(0, 57)}...` : ceoMessage;
    const selectedProject = resolveProjectFromOptions(options);
    const projectCoreGoal = selectedProject.coreGoal || "";
    const projectContextHint = normalizeTextField(options.projectContext) || projectCoreGoal;
    const detectedPath =
      detectProjectPath(options.projectPath || selectedProject.projectPath || ceoMessage) ||
      selectedProject.projectPath;
    const roundGoal = buildRoundGoal(projectCoreGoal, ceoMessage);
    const deptId = agent.department_id ?? null;
    const deptName = deptId ? getDeptName(deptId) : "Unassigned";
    const descriptionLines = [`[CEO DIRECT] ${ceoMessage}`];
    if (selectedProject.name) descriptionLines.push(`[PROJECT] ${selectedProject.name}`);
    if (projectCoreGoal) descriptionLines.push(`[PROJECT CORE GOAL] ${projectCoreGoal}`);
    descriptionLines.push(`[ROUND GOAL] ${roundGoal}`);
    if (projectContextHint && projectContextHint !== projectCoreGoal) {
      descriptionLines.push(`[PROJECT CONTEXT] ${projectContextHint}`);
    }

    db.prepare(
      `
    INSERT INTO tasks (id, title, description, department_id, assigned_agent_id, project_id, status, priority, task_type, project_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, 'general', ?, ?, ?)
  `,
    ).run(taskId, taskTitle, descriptionLines.join("\n"), deptId, agent.id, selectedProject.id, detectedPath, t, t);
    recordTaskCreationAudit({
      taskId,
      taskTitle,
      taskStatus: "planned",
      departmentId: deptId,
      assignedAgentId: agent.id,
      taskType: "general",
      projectPath: detectedPath ?? null,
      trigger: "workflow.direct_agent_task",
      triggerDetail: "direct chat escalated to task",
      actorType: "agent",
      actorId: agent.id,
      actorName: agent.name,
      body: {
        ceo_message: ceoMessage,
        message_type: "task_assign",
        project_id: selectedProject.id,
        project_context: projectContextHint,
        round_goal: roundGoal,
      },
    });
    if (selectedProject.id) {
      db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(t, t, selectedProject.id);
    }

    db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(taskId, agent.id);
    appendTaskLog(taskId, "system", `Direct CEO assignment to ${agent.name}: ${ceoMessage}`);
    appendTaskLog(taskId, "system", `Round goal: ${roundGoal}`);
    if (selectedProject.id) {
      appendTaskLog(taskId, "system", `Project linked: ${selectedProject.name || selectedProject.id}`);
    }
    if (detectedPath) {
      appendTaskLog(taskId, "system", `Project path detected from direct chat: ${detectedPath}`);
    }

    const ack = pickL(
      l(
        ["지시 확인했습니다. 바로 작업으로 등록하고 착수하겠습니다."],
        ["Understood. I will register this as a task and start right away."],
        ["指示を確認しました。タスクとして登録し、すぐ着手します。"],
        ["已确认指示。我会先登记任务并立即开始执行。"],
      ),
      lang,
    );
    sendAgentMessage(agent, ack, "task_assign", "agent", null, taskId);
    void relayReplyToMessenger(options, agent, ack).catch((err) => {
      console.warn(`[messenger-reply] failed to relay task ack from ${agent.name}: ${String(err)}`);
    });

    broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
    broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(agent.id));

    setTimeout(
      () => {
        if (isTaskWorkflowInterrupted(taskId)) return;
        startTaskExecutionForAgent(taskId, agent, deptId, deptName);
      },
      randomDelay(900, 1600),
    );
  }

  function insertStreamingMessage(msgId: string, agent: AgentRow, content: string): void {
    const endedAt = nowMs();
    db.prepare(
      `
          INSERT INTO messages (id, sender_type, sender_id, receiver_type, receiver_id, content, message_type, task_id, created_at)
          VALUES (?, 'agent', ?, 'agent', NULL, ?, 'chat', NULL, ?)
        `,
    ).run(msgId, agent.id, content, endedAt);
    broadcast("chat_stream", {
      phase: "end",
      message_id: msgId,
      agent_id: agent.id,
      content,
      created_at: endedAt,
    });
  }

  function scheduleAgentReply(
    agentId: string,
    ceoMessage: string,
    messageType: string,
    options: DelegationOptions = {},
  ): void {
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
    if (!agent) return;

    if (agent.status === "offline") {
      const lang = resolveLang(ceoMessage);
      const offlineMessage = buildCliFailureMessage(agent, lang, "offline");
      sendAgentMessage(agent, offlineMessage);
      void relayReplyToMessenger(options, agent, offlineMessage).catch((err) => {
        console.warn(`[messenger-reply] failed to relay offline message from ${agent.name}: ${String(err)}`);
      });
      return;
    }

    const now = nowMs();
    const pendingBinding = pendingProjectBindingByAgent.get(agent.id);
    if (pendingBinding) {
      if (now - pendingBinding.requestedAt > 60 * 60 * 1000) {
        pendingProjectBindingByAgent.delete(agent.id);
      } else {
        if (isCancelReply(ceoMessage)) {
          pendingProjectBindingByAgent.delete(agent.id);
          const cancelMsg = pickL(
            l(
              ["알겠습니다. 프로젝트 지정 대기는 취소했습니다."],
              ["Understood. I canceled the pending project binding request."],
              ["承知しました。プロジェクト指定待ちはキャンセルしました。"],
              ["已了解。已取消项目绑定等待。"],
            ),
            resolveLang(ceoMessage),
          );
          sendAgentMessage(agent, cancelMsg);
          void relayReplyToMessenger(options, agent, cancelMsg).catch((err) => {
            console.warn(`[messenger-reply] failed to relay pending-cancel message from ${agent.name}: ${String(err)}`);
          });
          return;
        }

        const resolvedBinding = resolveProjectBindingFromText(ceoMessage);
        if (!resolvedBinding) {
          if (isNoPathReply(ceoMessage)) {
            const autoBinding = createAutoProjectBinding(pendingBinding.taskMessage);
            if (autoBinding) {
              pendingProjectBindingByAgent.delete(agent.id);
              const mergedOptions: DelegationOptions = {
                ...pendingBinding.options,
                projectId: autoBinding.projectId,
                projectPath: autoBinding.projectPath,
                projectContext: autoBinding.projectContext,
                messengerChannel: options.messengerChannel ?? pendingBinding.options.messengerChannel,
                messengerTargetId: options.messengerTargetId ?? pendingBinding.options.messengerTargetId,
              };
              const createdMsg = pickL(
                l(
                  [`프로젝트 경로가 없어 신규 프로젝트를 자동 생성했습니다: ${autoBinding.projectPath}`],
                  [`No project path was provided, so I auto-created a new project: ${autoBinding.projectPath}`],
                  [`プロジェクトパスがないため、新規プロジェクトを自動作成しました: ${autoBinding.projectPath}`],
                  [`未提供项目路径，已自动创建新项目：${autoBinding.projectPath}`],
                ),
                resolveLang(ceoMessage),
              );
              sendAgentMessage(agent, createdMsg);
              void relayReplyToMessenger(mergedOptions, agent, createdMsg).catch((err) => {
                console.warn(`[messenger-reply] failed to relay auto-project message from ${agent.name}: ${String(err)}`);
              });

              if (agent.role === "team_leader" && agent.department_id) {
                handleTaskDelegation(agent, pendingBinding.taskMessage, "", mergedOptions);
              } else {
                createDirectAgentTaskAndRun(agent, pendingBinding.taskMessage, mergedOptions);
              }
              return;
            }
          }
          const askAgain = pickL(
            l(
              [
                "작업 프로젝트를 먼저 정해야 합니다. 프로젝트 절대경로(예: /Users/classys/Projects/climpire) 또는 기존 프로젝트 이름을 보내주세요.",
              ],
              [
                "I need the project first. Send an absolute project path (e.g. /Users/classys/Projects/climpire) or an existing project name.",
              ],
              ["先に対象プロジェクトが必要です。絶対パスまたは既存プロジェクト名を送ってください。"],
              ["需要先确定项目。请发送项目绝对路径或已有项目名称。"],
            ),
            resolveLang(ceoMessage),
          );
          sendAgentMessage(agent, askAgain);
          void relayReplyToMessenger(options, agent, askAgain).catch((err) => {
            console.warn(`[messenger-reply] failed to relay pending-ask message from ${agent.name}: ${String(err)}`);
          });
          return;
        }

        pendingProjectBindingByAgent.delete(agent.id);
        const mergedOptions: DelegationOptions = {
          ...pendingBinding.options,
          ...resolvedBinding,
          messengerChannel: options.messengerChannel ?? pendingBinding.options.messengerChannel,
          messengerTargetId: options.messengerTargetId ?? pendingBinding.options.messengerTargetId,
        };

        if (agent.role === "team_leader" && agent.department_id) {
          const taskAck = pickL(
            l(
              ["프로젝트 확인했습니다. 바로 업무로 승격해 진행하겠습니다."],
              ["Project confirmed. I will escalate this into a task and proceed now."],
              ["プロジェクトを確認しました。タスクに昇格して進めます。"],
              ["已确认项目。将立即升级为任务并执行。"],
            ),
            resolveLang(ceoMessage),
          );
          sendAgentMessage(agent, taskAck);
          void relayReplyToMessenger(mergedOptions, agent, taskAck).catch((err) => {
            console.warn(`[messenger-reply] failed to relay pending-ack message from ${agent.name}: ${String(err)}`);
          });
          handleTaskDelegation(agent, pendingBinding.taskMessage, "", mergedOptions);
        } else {
          createDirectAgentTaskAndRun(agent, pendingBinding.taskMessage, mergedOptions);
        }
        return;
      }
    }

    let taskMessage = ceoMessage;
    let useTaskFlow = shouldTreatDirectChatAsTask(ceoMessage, messageType);
    if (!useTaskFlow) {
      const recentRows = db
        .prepare(
          `
          SELECT content, message_type, created_at
          FROM messages
          WHERE sender_type = 'ceo'
            AND receiver_type = 'agent'
            AND receiver_id = ?
            AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT 12
        `,
        )
        .all(agent.id, now - 30 * 60 * 1000) as Array<{
        content: string;
        message_type: string | null;
        created_at: number;
      }>;
      const recentAgentRows = db
        .prepare(
          `
          SELECT content, created_at
          FROM messages
          WHERE sender_type = 'agent'
            AND sender_id = ?
            AND receiver_type = 'agent'
            AND (receiver_id IS NULL OR receiver_id = '')
            AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT 12
        `,
        )
        .all(agent.id, now - 30 * 60 * 1000) as Array<{
        content: string;
        created_at: number;
      }>;

      const contextualTaskMessage = resolveContextualTaskMessage(
        ceoMessage,
        recentRows.map((row) => ({
          content: row.content,
          messageType: row.message_type,
          createdAt: row.created_at,
        })),
        recentAgentRows.map((row) => ({
          content: row.content,
          createdAt: row.created_at,
        })),
      );
      if (contextualTaskMessage) {
        useTaskFlow = true;
        taskMessage = contextualTaskMessage;
      }
    }
    console.log(
      `[scheduleAgentReply] useTaskFlow=${useTaskFlow}, messageType=${messageType}, msg="${ceoMessage.slice(0, 50)}", taskMsg="${taskMessage.slice(0, 50)}"`,
    );
    if (useTaskFlow) {
      if (!hasProjectBinding(taskMessage, options)) {
        const autoBinding = createAutoProjectBinding(taskMessage);
        if (autoBinding) {
          const mergedOptions: DelegationOptions = {
            ...options,
            projectId: autoBinding.projectId,
            projectPath: autoBinding.projectPath,
            projectContext: autoBinding.projectContext,
          };
          const createdMsg = pickL(
            l(
              [`프로젝트 경로가 없어 신규 프로젝트를 자동 생성했습니다: ${autoBinding.projectPath}`],
              [`No project path was provided, so I auto-created a new project: ${autoBinding.projectPath}`],
              [`プロジェクトパスがないため、新規プロジェクトを自動作成しました: ${autoBinding.projectPath}`],
              [`未提供项目路径，已自动创建新项目：${autoBinding.projectPath}`],
            ),
            resolveLang(ceoMessage),
          );
          sendAgentMessage(agent, createdMsg);
          void relayReplyToMessenger(mergedOptions, agent, createdMsg).catch((err) => {
            console.warn(`[messenger-reply] failed to relay auto-project message from ${agent.name}: ${String(err)}`);
          });

          if (agent.role === "team_leader" && agent.department_id) {
            handleTaskDelegation(agent, taskMessage, "", mergedOptions);
          } else {
            createDirectAgentTaskAndRun(agent, taskMessage, mergedOptions);
          }
          return;
        }

        pendingProjectBindingByAgent.set(agent.id, {
          taskMessage,
          options: {
            ...options,
            messengerChannel: options.messengerChannel,
            messengerTargetId: options.messengerTargetId,
          },
          requestedAt: now,
        });
        const askProject = pickL(
          l(
            [
              "프로젝트 자동 생성에 실패했습니다. 프로젝트 절대경로(예: /Users/classys/Projects/climpire) 또는 기존 프로젝트 이름을 알려주세요.",
            ],
            [
              "Auto project creation failed. Send an absolute project path (e.g. /Users/classys/Projects/climpire) or an existing project name.",
            ],
            ["プロジェクト自動作成に失敗しました。絶対パスまたは既存プロジェクト名を送ってください。"],
            ["自动创建项目失败。请发送项目绝对路径或已有项目名称。"],
          ),
          resolveLang(ceoMessage),
        );
        sendAgentMessage(agent, askProject);
        void relayReplyToMessenger(options, agent, askProject).catch((err) => {
          console.warn(`[messenger-reply] failed to relay project-ask message from ${agent.name}: ${String(err)}`);
        });
        return;
      }
      if (agent.role === "team_leader" && agent.department_id) {
        const taskAck = pickL(
          l(
            ["업무 요청 확인했습니다. 팀 배정 후 바로 진행하겠습니다."],
            ["Task request received. I will delegate and start immediately."],
            ["業務依頼を確認しました。チームへ割り当ててすぐ進めます。"],
            ["已收到任务请求。我会分配团队并立即推进。"],
          ),
          resolveLang(ceoMessage),
        );
        void relayReplyToMessenger(options, agent, taskAck).catch((err) => {
          console.warn(`[messenger-reply] failed to relay team-lead task ack from ${agent.name}: ${String(err)}`);
        });
        handleTaskDelegation(agent, taskMessage, "", options);
      } else {
        createDirectAgentTaskAndRun(agent, taskMessage, options);
      }
      return;
    }

    const delay = 1000 + Math.random() * 2000;
    setTimeout(() => {
      void (async () => {
        const activeTask = agent.current_task_id
          ? (db
              .prepare("SELECT title, description, project_path FROM tasks WHERE id = ?")
              .get(agent.current_task_id) as
              | {
                  title: string;
                  description: string | null;
                  project_path: string | null;
                }
              | undefined)
          : undefined;
        const detectedPath = detectProjectPath(ceoMessage);
        const projectPath = detectedPath || (activeTask ? resolveProjectPath(activeTask) : process.cwd());

        const built = buildDirectReplyPrompt(agent, ceoMessage, messageType);

        console.log(
          `[scheduleAgentReply] agent=${agent.name}, cli_provider=${agent.cli_provider}, api_provider_id=${agent.api_provider_id}, api_model=${agent.api_model}`,
        );

        if (agent.cli_provider === "api" && agent.api_provider_id) {
          const msgId = randomUUID();
          broadcast("chat_stream", {
            phase: "start",
            message_id: msgId,
            agent_id: agent.id,
            agent_name: agent.name,
            agent_avatar: agent.avatar_emoji ?? "🤖",
          });

          let fullText = "";
          let apiError = "";
          try {
            const logStream = fs.createWriteStream(path.join(logsDir, `direct-${agent.id}-${Date.now()}.log`), {
              flags: "w",
            });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 180_000);
            try {
              await executeApiProviderAgent(
                built.prompt,
                projectPath,
                logStream,
                controller.signal,
                undefined,
                agent.api_provider_id,
                agent.api_model ?? null,
                (text: string) => {
                  fullText += text;
                  logStream.write(text);
                  broadcast("chat_stream", {
                    phase: "delta",
                    message_id: msgId,
                    agent_id: agent.id,
                    text,
                  });
                  return true;
                },
              );
            } finally {
              clearTimeout(timeout);
              logStream.end();
            }
          } catch (err: any) {
            apiError = err?.message || String(err);
            console.error(`[scheduleAgentReply:API] Error for ${agent.name}:`, apiError);
          }

          const contentOnly = fullText
            .replace(/^\[api:[^\]]*\][^\n]*\n---\n/g, "")
            .replace(/\n---\n\[api:[^\]]*\]\s*Done\.\s*$/g, "")
            .trim();

          let finalReply: string;
          if (contentOnly) {
            finalReply = contentOnly.length > 12000 ? contentOnly.slice(0, 12000) : contentOnly;
          } else if (apiError) {
            finalReply = `[API Error] ${apiError}`;
          } else {
            finalReply = chooseSafeReply({ text: "" }, built.lang, "direct", agent);
          }
          finalReply = normalizeAgentReply(finalReply);

          insertStreamingMessage(msgId, agent, finalReply);
          void relayReplyToMessenger(options, agent, finalReply).catch((err) => {
            console.warn(`[messenger-reply] failed to relay API reply from ${agent.name}: ${String(err)}`);
          });
          return;
        }

        if (agent.cli_provider === "copilot" || agent.cli_provider === "antigravity") {
          const msgId = randomUUID();
          broadcast("chat_stream", {
            phase: "start",
            message_id: msgId,
            agent_id: agent.id,
            agent_name: agent.name,
            agent_avatar: agent.avatar_emoji ?? "🤖",
          });

          let fullText = "";
          let oauthError = "";
          try {
            const logStream = fs.createWriteStream(path.join(logsDir, `direct-${agent.id}-${Date.now()}.log`), {
              flags: "w",
            });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 180_000);
            const streamCb = (text: string) => {
              fullText += text;
              logStream.write(text);
              broadcast("chat_stream", {
                phase: "delta",
                message_id: msgId,
                agent_id: agent.id,
                text,
              });
              return true;
            };
            try {
              if (agent.cli_provider === "copilot") {
                await executeCopilotAgent(
                  built.prompt,
                  projectPath,
                  logStream,
                  controller.signal,
                  undefined,
                  agent.oauth_account_id ?? null,
                  streamCb,
                );
              } else {
                await executeAntigravityAgent(
                  built.prompt,
                  logStream,
                  controller.signal,
                  undefined,
                  agent.oauth_account_id ?? null,
                  streamCb,
                );
              }
            } finally {
              clearTimeout(timeout);
              logStream.end();
            }
          } catch (err: any) {
            oauthError = err?.message || String(err);
            console.error(`[scheduleAgentReply:OAuth] Error for ${agent.name}:`, oauthError);
          }

          const contentOnly = fullText
            .replace(/^\[(copilot|antigravity)\][^\n]*\n/gm, "")
            .replace(/---+/g, "")
            .replace(/^\[oauth[^\]]*\][^\n]*/gm, "")
            .trim();

          let finalReply: string;
          if (contentOnly) {
            finalReply = contentOnly.length > 12000 ? contentOnly.slice(0, 12000) : contentOnly;
          } else if (oauthError) {
            finalReply = `[OAuth Error] ${oauthError}`;
          } else {
            finalReply = chooseSafeReply({ text: "" }, built.lang, "direct", agent);
          }
          finalReply = normalizeAgentReply(finalReply);

          insertStreamingMessage(msgId, agent, finalReply);
          void relayReplyToMessenger(options, agent, finalReply).catch((err) => {
            console.warn(`[messenger-reply] failed to relay OAuth reply from ${agent.name}: ${String(err)}`);
          });
          return;
        }

        const run = await runAgentOneShot(agent, built.prompt, { projectPath, rawOutput: true });
        const reply = normalizeAgentReply(chooseSafeReply(run, built.lang, "direct", agent));
        sendAgentMessage(agent, reply);
        void relayReplyToMessenger(options, agent, reply).catch((err) => {
          console.warn(`[messenger-reply] failed to relay direct reply from ${agent.name}: ${String(err)}`);
        });
      })();
    }, delay);
  }

  return {
    shouldTreatDirectChatAsTask,
    createDirectAgentTaskAndRun,
    scheduleAgentReply,
  };
}
