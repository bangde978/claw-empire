import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
      sendAgentMessage(agent, buildCliFailureMessage(agent, lang, "offline"));
      return;
    }

    const useTaskFlow = shouldTreatDirectChatAsTask(ceoMessage, messageType);
    console.log(
      `[scheduleAgentReply] useTaskFlow=${useTaskFlow}, messageType=${messageType}, msg="${ceoMessage.slice(0, 50)}"`,
    );
    if (useTaskFlow) {
      if (agent.role === "team_leader" && agent.department_id) {
        handleTaskDelegation(agent, ceoMessage, "", options);
      } else {
        createDirectAgentTaskAndRun(agent, ceoMessage, options);
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

          insertStreamingMessage(msgId, agent, finalReply);
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

          insertStreamingMessage(msgId, agent, finalReply);
          return;
        }

        const run = await runAgentOneShot(agent, built.prompt, { projectPath, rawOutput: true });
        const reply = chooseSafeReply(run, built.lang, "direct", agent);
        sendAgentMessage(agent, reply);
      })();
    }, delay);
  }

  return {
    shouldTreatDirectChatAsTask,
    createDirectAgentTaskAndRun,
    scheduleAgentReply,
  };
}
