import type { RuntimeContext, RouteCollabExports } from "../../types/runtime-context.ts";
import type { Lang } from "../../types/lang.ts";
import { randomUUID } from "node:crypto";
import { sendMessengerMessage, type MessengerChannel } from "../../gateway/client.ts";
import { isMessengerChannel } from "../../messenger/channels.ts";

import { createAnnouncementReplyScheduler } from "./collab/announcement-response.ts";
import { createChatReplyGenerator } from "./collab/chat-response.ts";
import { initializeCollabCoordination } from "./collab/coordination.ts";
import { createDirectChatHandlers, type AgentRow } from "./collab/direct-chat.ts";
import { initializeCollabLanguagePolicy } from "./collab/language-policy.ts";
import { initializeProjectResolution, type DelegationOptions } from "./collab/project-resolution.ts";
import { initializeSubtaskDelegation } from "./collab/subtask-delegation.ts";
import { createTaskDelegationHandler } from "./collab/task-delegation.ts";

export function registerRoutesPartB(ctx: RuntimeContext): RouteCollabExports {
  const __ctx: RuntimeContext = ctx;
  const appendTaskLog = __ctx.appendTaskLog;
  const broadcast = __ctx.broadcast;
  const buildCliFailureMessage = __ctx.buildCliFailureMessage;
  const buildDirectReplyPrompt = __ctx.buildDirectReplyPrompt;
  const executeApiProviderAgent = __ctx.executeApiProviderAgent;
  const executeCopilotAgent = __ctx.executeCopilotAgent;
  const executeAntigravityAgent = __ctx.executeAntigravityAgent;
  const buildTaskExecutionPrompt = __ctx.buildTaskExecutionPrompt;
  const chooseSafeReply = __ctx.chooseSafeReply;
  const createWorktree = __ctx.createWorktree;
  const db = __ctx.db;
  const delegatedTaskToSubtask = __ctx.delegatedTaskToSubtask;
  const ensureClaudeMd = __ctx.ensureClaudeMd;
  const ensureTaskExecutionSession = __ctx.ensureTaskExecutionSession;
  const finishReview = __ctx.finishReview;
  const getAgentDisplayName = __ctx.getAgentDisplayName;
  const getProviderModelConfig = __ctx.getProviderModelConfig;
  const getRecentConversationContext = __ctx.getRecentConversationContext;
  const handleTaskRunComplete = __ctx.handleTaskRunComplete;
  const hasExplicitWarningFixRequest = __ctx.hasExplicitWarningFixRequest;
  const getNextHttpAgentPid = __ctx.getNextHttpAgentPid;
  const isTaskWorkflowInterrupted = __ctx.isTaskWorkflowInterrupted;
  const launchApiProviderAgent = __ctx.launchApiProviderAgent;
  const launchHttpAgent = __ctx.launchHttpAgent;
  const logsDir = __ctx.logsDir;
  const notifyCeo = __ctx.notifyCeo;
  const nowMs = __ctx.nowMs;
  const randomDelay = __ctx.randomDelay;
  const recordTaskCreationAudit = __ctx.recordTaskCreationAudit;
  const runAgentOneShot = __ctx.runAgentOneShot;
  const seedApprovedPlanSubtasks = __ctx.seedApprovedPlanSubtasks;
  const spawnCliAgent = __ctx.spawnCliAgent;
  const startPlannedApprovalMeeting = __ctx.startPlannedApprovalMeeting;
  const startProgressTimer = __ctx.startProgressTimer;
  const startTaskExecutionForAgent = __ctx.startTaskExecutionForAgent;
  const stopRequestModeByTask = __ctx.stopRequestModeByTask;
  const stopRequestedTasks = __ctx.stopRequestedTasks;
  const subtaskDelegationCallbacks = __ctx.subtaskDelegationCallbacks;
  const subtaskDelegationCompletionNoticeSent = __ctx.subtaskDelegationCompletionNoticeSent;
  const subtaskDelegationDispatchInFlight = __ctx.subtaskDelegationDispatchInFlight;
  const resolveProjectPathBase = (...args: any[]) => __ctx.resolveProjectPath(...args);

  // ---------------------------------------------------------------------------
  // Agent auto-reply & task delegation logic
  // ---------------------------------------------------------------------------
  const TASK_MESSENGER_ROUTE_PREFIX = "[messenger-route]";
  const TASK_MESSENGER_ROUTE_CACHE_MAX = 1024;
  const TASK_MESSENGER_ROUTE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const TASK_MESSENGER_RELAY_MESSAGE_TYPES = new Set(["report", "chat", "status_update"]);
  const taskMessengerRouteByTaskId = new Map<string, { channel: MessengerChannel; targetId: string; updatedAt: number }>();

  function parseTaskMessengerRouteLine(line: string): { channel: MessengerChannel; targetId: string } | null {
    if (!line.startsWith(`${TASK_MESSENGER_ROUTE_PREFIX} `)) return null;
    const payload = line.slice(TASK_MESSENGER_ROUTE_PREFIX.length).trim();
    const separator = payload.indexOf(":");
    if (separator <= 0) return null;
    const channelRaw = payload.slice(0, separator).trim().toLowerCase();
    const targetId = payload.slice(separator + 1).trim();
    if (!isMessengerChannel(channelRaw) || !targetId) return null;
    return { channel: channelRaw, targetId };
  }

  function pruneTaskMessengerRouteCache(now: number): void {
    for (const [taskId, route] of taskMessengerRouteByTaskId.entries()) {
      if (now - route.updatedAt > TASK_MESSENGER_ROUTE_CACHE_TTL_MS) {
        taskMessengerRouteByTaskId.delete(taskId);
      }
    }
    while (taskMessengerRouteByTaskId.size > TASK_MESSENGER_ROUTE_CACHE_MAX) {
      const oldest = taskMessengerRouteByTaskId.keys().next().value;
      if (!oldest) break;
      taskMessengerRouteByTaskId.delete(oldest);
    }
  }

  function registerTaskMessengerRoute(taskId: string, options: DelegationOptions = {}): void {
    const now = nowMs();
    pruneTaskMessengerRouteCache(now);

    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) return;
    const targetId = (options.messengerTargetId || "").trim();
    if (!isMessengerChannel(options.messengerChannel) || !targetId) return;

    const nextRoute = { channel: options.messengerChannel, targetId };
    const current = taskMessengerRouteByTaskId.get(normalizedTaskId);
    if (current && current.channel === nextRoute.channel && current.targetId === nextRoute.targetId) {
      current.updatedAt = now;
      taskMessengerRouteByTaskId.set(normalizedTaskId, current);
      return;
    }

    taskMessengerRouteByTaskId.set(normalizedTaskId, { ...nextRoute, updatedAt: now });
    appendTaskLog(normalizedTaskId, "system", `${TASK_MESSENGER_ROUTE_PREFIX} ${nextRoute.channel}:${nextRoute.targetId}`);
  }

  function resolveTaskMessengerRoute(taskId: string): { channel: MessengerChannel; targetId: string } | null {
    const now = nowMs();
    pruneTaskMessengerRouteCache(now);

    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) return null;

    const cached = taskMessengerRouteByTaskId.get(normalizedTaskId);
    if (cached) return { channel: cached.channel, targetId: cached.targetId };

    const row = db
      .prepare(
        `
        SELECT message
        FROM task_logs
        WHERE task_id = ?
          AND kind = 'system'
          AND message LIKE ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(normalizedTaskId, `${TASK_MESSENGER_ROUTE_PREFIX} %`) as { message?: string } | undefined;
    const parsed = typeof row?.message === "string" ? parseTaskMessengerRouteLine(row.message) : null;
    if (parsed) {
      taskMessengerRouteByTaskId.set(normalizedTaskId, { ...parsed, updatedAt: now });
      pruneTaskMessengerRouteCache(now);
      return parsed;
    }
    return null;
  }

  function getMessengerChunkLimit(channel: MessengerChannel): number {
    if (channel === "discord") return 1900;
    if (channel === "telegram") return 3800;
    if (channel === "slack") return 3900;
    if (channel === "whatsapp") return 3900;
    if (channel === "googlechat") return 3900;
    if (channel === "signal") return 3900;
    if (channel === "imessage") return 3900;
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

  function normalizeMessengerTextLine(raw: string): string {
    return raw
      .replace(/[`*_~>#]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncateMessengerText(value: string, max = 160): string {
    const normalized = value.trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
  }

  function extractTaskTitleFromReportText(content: string, requestLine: string): string {
    const source = requestLine || content;
    const quoted =
      source.match(/['"]([^'"]{2,220})['"]/) ??
      source.match(/「([^」]{2,220})」/) ??
      source.match(/『([^』]{2,220})』/);
    const picked = quoted?.[1] ?? "";
    return truncateMessengerText(normalizeMessengerTextLine(picked), 90);
  }

  function buildMessengerReportIdentityIntro(agent: AgentRow, content: string, requestLine: string): string {
    const hasKorean = /[가-힣]/.test(content);
    const hasJapanese = /[ぁ-んァ-ン一-龯]/.test(content);
    const hasChinese = /[\u4e00-\u9fff]/.test(content) && !hasJapanese;
    const displayName = normalizeMessengerTextLine(agent.name_ko || agent.name || "Agent");
    const avatar = normalizeMessengerTextLine(agent.avatar_emoji || "🤖");
    const taskTitle = extractTaskTitleFromReportText(content, requestLine);

    if (hasKorean) {
      return taskTitle
        ? `${avatar} ${displayName} 보고: '${taskTitle}' 완료 결과를 전달드려요.`
        : `${avatar} ${displayName} 보고: 완료 결과를 전달드려요.`;
    }
    if (hasJapanese) {
      return taskTitle
        ? `${avatar} ${displayName} から報告: '${taskTitle}' の完了結果を共有します。`
        : `${avatar} ${displayName} から報告: 完了結果を共有します。`;
    }
    if (hasChinese) {
      return taskTitle
        ? `${avatar} ${displayName} 汇报：'${taskTitle}' 已完成，现发送结果。`
        : `${avatar} ${displayName} 汇报：任务已完成，现发送结果。`;
    }
    return taskTitle
      ? `${avatar} ${displayName} report: sharing completion result for '${taskTitle}'.`
      : `${avatar} ${displayName} report: sharing completion result.`;
  }

  function buildMessengerReportSummary(agent: AgentRow, content: string): string {
    const shouldSummarize =
      /\|\s*#\s*\|/i.test(content) ||
      /\|\s*1\s*\|/.test(content) ||
      /📋\s*(결과|Result|結果|结果)\s*:/i.test(content) ||
      content.length >= 900;
    if (!shouldSummarize) return content;

    const rawLines = content.split(/\r?\n/);
    const plainLines = rawLines.map((line) => normalizeMessengerTextLine(line));

    const requestLine =
      plainLines.find((line) => /(업무 완료 보고드립니다|reporting completion|完了をご報告します|汇报.+已完成)/i.test(line)) ?? "";
    const identityIntro = buildMessengerReportIdentityIntro(agent, content, requestLine);
    const progressLine =
      plainLines.find((line) =>
        /(?:전체|total)\s*:\s*\d+\s*\/\s*\d+|(?:완료율|completion|progress|진행)\s*[:：]?\s*(?:\d+\s*%|\d+\s*\/\s*\d+)/i.test(
          line,
        ),
      ) ?? "";

    const tableItems: string[] = [];
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) continue;
      const cells = trimmed
        .split("|")
        .map((cell) => normalizeMessengerTextLine(cell))
        .filter(Boolean);
      if (cells.length < 3) continue;
      const index = Number.parseInt(cells[0] ?? "", 10);
      if (!Number.isFinite(index)) continue;
      const issue = cells[1] || "-";
      const severity = cells[2] || "";
      tableItems.push(`${index}. ${severity ? `[${severity}] ` : ""}${truncateMessengerText(issue, 120)}`);
      if (tableItems.length >= 3) break;
    }

    const resultItems: string[] = [];
    let inResultSection = false;
    for (let i = 0; i < rawLines.length; i += 1) {
      const rawLine = rawLines[i] ?? "";
      const plain = plainLines[i] ?? "";
      if (!inResultSection) {
        if (/📋\s*(결과|Result|結果|结果)\s*:?/i.test(rawLine) || /^(결과|result|結果|结果)\s*:?$/i.test(plain)) {
          inResultSection = true;
        }
        continue;
      }
      if (!plain || plain === "...") continue;
      if (/^[📌📝]/.test(rawLine.trim())) break;
      if (/(보완\/협업 진행 요약|Remediation\/Collaboration Progress|変更点|변경사항|Changes)/i.test(plain)) break;
      if (rawLine.trim().startsWith("|")) continue;
      const cleaned = plain.replace(/^[-•]\s*/, "").trim();
      if (!cleaned) continue;
      resultItems.push(truncateMessengerText(cleaned, 150));
      if (resultItems.length >= 3) break;
    }

    const keyItems = tableItems.length > 0 ? tableItems : resultItems.map((line, idx) => `${idx + 1}. ${line}`);
    if (keyItems.length <= 0) return content;

    const hasKorean = /[가-힣]/.test(content);
    const title = hasKorean ? "업무 완료 요약" : "Task Completion Summary";
    const keyLabel = hasKorean ? "핵심 결과" : "Key Results";
    const progressLabel = hasKorean ? "진행 요약" : "Progress";
    const detailHint = hasKorean
      ? "상세 내용은 Claw-Empire 채팅창에서 확인하세요."
      : "See Claw-Empire chat for full details.";

    const out: string[] = [title, identityIntro];
    out.push(`${keyLabel}:`);
    out.push(...keyItems);
    if (progressLine) out.push(`${progressLabel}: ${truncateMessengerText(progressLine, 160)}`);
    out.push(detailHint);
    return out.join("\n");
  }

  function formatMessengerBroadcastContent(agent: AgentRow, messageType: string, rawContent: string): string {
    const content = rawContent.trim();
    if (!content) return "";
    if (messageType === "report") {
      return buildMessengerReportSummary(agent, content);
    }
    return content;
  }

  async function relayTaskBroadcastToAssignedMessengerSessions(
    taskId: string,
    agent: AgentRow,
    messageType: string,
    rawContent: string,
  ): Promise<void> {
    const content = formatMessengerBroadcastContent(agent, messageType, rawContent);
    if (!content) return;

    const route = resolveTaskMessengerRoute(taskId);
    if (!route) return;

    const chunks = splitMessageByLimit(content, getMessengerChunkLimit(route.channel));
    for (const chunk of chunks) {
      await sendMessengerMessage({
        channel: route.channel,
        targetId: route.targetId,
        text: chunk,
      });
    }
  }

  function shouldRelayTaskBroadcastToMessenger(
    messageType: string,
    receiverType: string,
    taskId: string | null,
  ): taskId is string {
    if (!taskId) return false;
    if (receiverType !== "all") return false;
    return TASK_MESSENGER_RELAY_MESSAGE_TYPES.has(messageType);
  }

  function sendAgentMessage(
    agent: AgentRow,
    content: string,
    messageType: string = "chat",
    receiverType: string = "agent",
    receiverId: string | null = null,
    taskId: string | null = null,
  ): void {
    const id = randomUUID();
    const t = nowMs();
    db.prepare(
      `
    INSERT INTO messages (id, sender_type, sender_id, receiver_type, receiver_id, content, message_type, task_id, created_at)
    VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?)
  `,
    ).run(id, agent.id, receiverType, receiverId, content, messageType, taskId, t);

    broadcast("new_message", {
      id,
      sender_type: "agent",
      sender_id: agent.id,
      receiver_type: receiverType,
      receiver_id: receiverId,
      content,
      message_type: messageType,
      task_id: taskId,
      created_at: t,
      sender_name: agent.name,
      sender_avatar: agent.avatar_emoji ?? "🤖",
    });

    if (shouldRelayTaskBroadcastToMessenger(messageType, receiverType, taskId)) {
      void relayTaskBroadcastToAssignedMessengerSessions(taskId, agent, messageType, content).catch((err) => {
        console.warn(
          `[messenger-relay] failed to relay task broadcast (task=${taskId}, type=${messageType}): ${String(err)}`,
        );
      });
    }
  }

  const {
    DEPT_KEYWORDS,
    pickRandom,
    getPreferredLanguage,
    resolveLang,
    detectLang,
    l,
    pickL,
    getFlairs,
    getRoleLabel,
    classifyIntent,
    analyzeDirectivePolicy,
    shouldExecuteDirectiveDelegation,
    detectTargetDepartments,
  } = initializeCollabLanguagePolicy({ db });

  const { generateChatReply } = createChatReplyGenerator({
    db,
    resolveLang,
    getDeptName,
    getRoleLabel,
    pickRandom,
    getFlairs,
    classifyIntent,
    l,
    pickL,
  });

  const { generateAnnouncementReply, scheduleAnnouncementReplies } = createAnnouncementReplyScheduler({
    db,
    resolveLang,
    getDeptName,
    getRoleLabel,
    l,
    pickL,
    sendAgentMessage,
  });

  Object.assign(__ctx, { generateChatReply, generateAnnouncementReply });

  const { normalizeTextField, resolveProjectFromOptions, buildRoundGoal } = initializeProjectResolution({ db });

  /** Detect @mentions in messages — returns department IDs and agent IDs */
  function detectMentions(message: string): { deptIds: string[]; agentIds: string[] } {
    const deptIds: string[] = [];
    const agentIds: string[] = [];

    // Match @부서이름 patterns (both with and without 팀 suffix)
    const depts = db.prepare("SELECT id, name, name_ko FROM departments").all() as {
      id: string;
      name: string;
      name_ko: string;
    }[];
    for (const dept of depts) {
      const nameKo = dept.name_ko.replace("팀", "");
      if (
        message.includes(`@${dept.name_ko}`) ||
        message.includes(`@${nameKo}`) ||
        message.includes(`@${dept.name}`) ||
        message.includes(`@${dept.id}`)
      ) {
        deptIds.push(dept.id);
      }
    }

    // Match @에이전트이름 patterns
    const agents = db.prepare("SELECT id, name, name_ko FROM agents").all() as {
      id: string;
      name: string;
      name_ko: string | null;
    }[];
    for (const agent of agents) {
      if ((agent.name_ko && message.includes(`@${agent.name_ko}`)) || message.includes(`@${agent.name}`)) {
        agentIds.push(agent.id);
      }
    }

    return { deptIds, agentIds };
  }

  /** Handle mention-based delegation: create task in mentioned department */
  function handleMentionDelegation(originLeader: AgentRow, targetDeptId: string, ceoMessage: string, lang: Lang): void {
    const crossLeader = findTeamLeader(targetDeptId);
    if (!crossLeader) return;
    const crossDeptName = getDeptName(targetDeptId);
    const crossLeaderName = lang === "ko" ? crossLeader.name_ko || crossLeader.name : crossLeader.name;
    const originLeaderName = lang === "ko" ? originLeader.name_ko || originLeader.name : originLeader.name;
    const taskTitle = ceoMessage.length > 60 ? ceoMessage.slice(0, 57) + "..." : ceoMessage;

    // Origin team leader sends mention request to target team leader
    const mentionReq = pickL(
      l(
        [
          `${crossLeaderName}님! 대표님 지시입니다: "${taskTitle}" — ${crossDeptName}에서 처리 부탁드립니다! 🏷️`,
          `${crossLeaderName}님, 대표님이 직접 요청하셨습니다. "${taskTitle}" 건, ${crossDeptName} 담당으로 진행해주세요!`,
        ],
        [
          `${crossLeaderName}! CEO directive for ${crossDeptName}: "${taskTitle}" — please handle this! 🏷️`,
          `${crossLeaderName}, CEO requested this for your team: "${taskTitle}"`,
        ],
        [`${crossLeaderName}さん！CEO指示です："${taskTitle}" — ${crossDeptName}で対応お願いします！🏷️`],
        [`${crossLeaderName}，CEO指示："${taskTitle}" — 请${crossDeptName}处理！🏷️`],
      ),
      lang,
    );
    sendAgentMessage(originLeader, mentionReq, "task_assign", "agent", crossLeader.id, null);

    // Broadcast delivery animation event for UI
    broadcast("cross_dept_delivery", {
      from_agent_id: originLeader.id,
      to_agent_id: crossLeader.id,
      task_title: taskTitle,
    });

    // Target team leader acknowledges and delegates
    const ackDelay = 1500 + Math.random() * 1000;
    setTimeout(() => {
      // Use the full delegation flow for the target department
      handleTaskDelegation(crossLeader, ceoMessage, "");
    }, ackDelay);
  }

  function findBestSubordinate(
    deptId: string,
    excludeId: string,
    candidateAgentIds?: string[] | null,
  ): AgentRow | null {
    // candidateAgentIds가 지정되면 해당 목록에서만 선택 (manual 모드, 부서 고정)
    if (Array.isArray(candidateAgentIds)) {
      if (candidateAgentIds.length === 0) {
        return null;
      }
      const placeholders = candidateAgentIds.map(() => "?").join(",");
      const agents = db
        .prepare(
          `SELECT * FROM agents WHERE id IN (${placeholders}) AND department_id = ? AND id != ? AND role != 'team_leader' ORDER BY
         CASE status WHEN 'idle' THEN 0 WHEN 'break' THEN 1 WHEN 'working' THEN 2 ELSE 3 END,
         CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 WHEN 'intern' THEN 2 ELSE 3 END`,
        )
        .all(...candidateAgentIds, deptId, excludeId) as unknown as AgentRow[];
      return agents[0] ?? null;
    }
    // 기존 로직: 부서 전체에서 선택
    const agents = db
      .prepare(
        `SELECT * FROM agents WHERE department_id = ? AND id != ? AND role != 'team_leader' ORDER BY
       CASE status WHEN 'idle' THEN 0 WHEN 'break' THEN 1 WHEN 'working' THEN 2 ELSE 3 END,
       CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 WHEN 'intern' THEN 2 ELSE 3 END`,
      )
      .all(deptId, excludeId) as unknown as AgentRow[];
    return agents[0] ?? null;
  }

  function findTeamLeader(deptId: string | null): AgentRow | null {
    if (!deptId) return null;
    return (
      (db.prepare("SELECT * FROM agents WHERE department_id = ? AND role = 'team_leader' LIMIT 1").get(deptId) as
        | AgentRow
        | undefined) ?? null
    );
  }

  function getDeptName(deptId: string): string {
    const lang = getPreferredLanguage();
    const d = db.prepare("SELECT name, name_ko FROM departments WHERE id = ?").get(deptId) as
      | {
          name: string;
          name_ko: string;
        }
      | undefined;
    if (!d) return deptId;
    return lang === "ko" ? d.name_ko || d.name : d.name || d.name_ko || deptId;
  }

  // Role enforcement: restrict agents to their department's domain
  function getDeptRoleConstraint(deptId: string, deptName: string): string {
    const constraints: Record<string, string> = {
      planning: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Planning). Focus ONLY on planning, strategy, market analysis, requirements, and documentation. Do NOT write production code, create design assets, or run tests. If coding/design is needed, describe requirements and specifications instead.`,
      dev: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Development). Focus ONLY on coding, debugging, code review, and technical implementation. Do NOT create design mockups, write business strategy documents, or perform QA testing.`,
      design: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Design). Focus ONLY on UI/UX design, visual assets, design specs, and prototyping. Do NOT write production backend code, run tests, or make infrastructure changes.`,
      qa: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (QA/QC). Focus ONLY on testing, quality assurance, test automation, and bug reporting. Do NOT write production code or create design assets.`,
      devsecops: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (DevSecOps). Focus ONLY on infrastructure, security audits, CI/CD pipelines, container orchestration, and deployment. Do NOT write business logic or create design assets.`,
      operations: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Operations). Focus ONLY on operations, automation, monitoring, maintenance, and process optimization. Do NOT write production code or create design assets.`,
    };
    return (
      constraints[deptId] ||
      `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName}. Focus on tasks within your department's expertise.`
    );
  }

  const {
    formatTaskSubtaskProgressSummary,
    hasOpenForeignSubtasks,
    processSubtaskDelegations,
    maybeNotifyAllSubtasksComplete,
  } = initializeSubtaskDelegation({
    db,
    l,
    pickL,
    resolveLang,
    getPreferredLanguage,
    getDeptName,
    getDeptRoleConstraint,
    getRecentConversationContext,
    getAgentDisplayName,
    buildTaskExecutionPrompt,
    hasExplicitWarningFixRequest,
    delegatedTaskToSubtask,
    subtaskDelegationCallbacks,
    subtaskDelegationDispatchInFlight,
    subtaskDelegationCompletionNoticeSent,
    notifyCeo,
    sendAgentMessage,
    appendTaskLog,
    finishReview,
    findTeamLeader,
    findBestSubordinate,
    nowMs,
    broadcast,
    handleTaskRunComplete,
    stopRequestedTasks,
    stopRequestModeByTask,
    recordTaskCreationAudit,
    resolveProjectPath: resolveProjectPathBase,
    createWorktree,
    logsDir,
    ensureTaskExecutionSession,
    ensureClaudeMd,
    getProviderModelConfig,
    spawnCliAgent,
    getNextHttpAgentPid,
    launchApiProviderAgent,
    launchHttpAgent,
    startProgressTimer,
  });

  const collabCoordination = initializeCollabCoordination({
    ...__ctx,
    resolveLang,
    l,
    pickL,
    sendAgentMessage,
    findBestSubordinate,
    findTeamLeader,
    getDeptName,
    getDeptRoleConstraint,
    maybeNotifyAllSubtasksComplete,
  });
  const {
    reconcileCrossDeptSubtasks,
    recoverCrossDeptQueueAfterMissingCallback,
    startCrossDeptCooperation,
    detectProjectPath,
    resolveProjectPath,
    getLatestKnownProjectPath,
    getDefaultProjectRoot,
    resolveDirectiveProjectPath,
    stripReportRequestPrefix,
    detectReportOutputFormat,
    pickPlanningReportAssignee,
    handleReportRequest,
  } = collabCoordination;

  const handleTaskDelegation = createTaskDelegationHandler({
    db,
    nowMs,
    resolveLang,
    getDeptName,
    getRoleLabel,
    detectTargetDepartments,
    findBestSubordinate,
    normalizeTextField,
    resolveProjectFromOptions,
    buildRoundGoal,
    resolveDirectiveProjectPath,
    recordTaskCreationAudit,
    appendTaskLog,
    broadcast,
    l,
    pickL,
    notifyCeo,
    isTaskWorkflowInterrupted,
    hasOpenForeignSubtasks,
    processSubtaskDelegations,
    startCrossDeptCooperation,
    seedApprovedPlanSubtasks,
    startPlannedApprovalMeeting,
    sendAgentMessage,
    registerTaskMessengerRoute,
    startTaskExecutionForAgent,
  });

  const { scheduleAgentReply } = createDirectChatHandlers({
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
    registerTaskMessengerRoute,
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
  });

  return {
    DEPT_KEYWORDS,
    sendAgentMessage,
    getPreferredLanguage,
    resolveLang,
    detectLang,
    l,
    pickL,
    getRoleLabel,
    scheduleAnnouncementReplies,
    normalizeTextField,
    analyzeDirectivePolicy,
    shouldExecuteDirectiveDelegation,
    detectTargetDepartments,
    detectMentions,
    handleMentionDelegation,
    findTeamLeader,
    getDeptName,
    getDeptRoleConstraint,
    formatTaskSubtaskProgressSummary,
    processSubtaskDelegations,
    reconcileCrossDeptSubtasks,
    recoverCrossDeptQueueAfterMissingCallback,
    resolveProjectPath,
    handleReportRequest,
    handleTaskDelegation,
    scheduleAgentReply,
  };
}
