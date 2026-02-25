import type { RuntimeContext } from "../../../types/runtime-context.ts";
import type { Lang } from "../../../types/lang.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { INBOX_WEBHOOK_SECRET, PKG_VERSION } from "../../../config/runtime.ts";
import { notifyTaskStatus, gatewayHttpInvoke } from "../../../gateway/client.ts";
import {
  BUILTIN_GITHUB_CLIENT_ID,
  BUILTIN_GOOGLE_CLIENT_ID,
  BUILTIN_GOOGLE_CLIENT_SECRET,
  OAUTH_BASE_URL,
  OAUTH_ENCRYPTION_SECRET,
  OAUTH_STATE_TTL_MS,
  appendOAuthQuery,
  b64url,
  pkceVerifier,
  sanitizeOAuthRedirect,
  encryptSecret,
  decryptSecret,
} from "../../../oauth/helpers.ts";
import { safeSecretEquals } from "../../../security/auth.ts";

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
}

type DelegationOptions = {
  skipPlannedMeeting?: boolean;
  skipPlanSubtasks?: boolean;
  projectId?: string | null;
  projectPath?: string | null;
  projectContext?: string | null;
};

export function initializeCollabCoordination(ctx: RuntimeContext): any {
  const __ctx: RuntimeContext = ctx;
  const CLI_STATUS_TTL = __ctx.CLI_STATUS_TTL;
  const CLI_TOOLS = __ctx.CLI_TOOLS;
  const MODELS_CACHE_TTL = __ctx.MODELS_CACHE_TTL;
  const IdempotencyConflictError = __ctx.IdempotencyConflictError;
  const StorageBusyError = __ctx.StorageBusyError;
  const activeProcesses = __ctx.activeProcesses;
  const analyzeSubtaskDepartment = __ctx.analyzeSubtaskDepartment;
  const app = __ctx.app;
  const appendTaskLog = __ctx.appendTaskLog;
  const broadcast = __ctx.broadcast;
  const buildCliFailureMessage = __ctx.buildCliFailureMessage;
  const buildDirectReplyPrompt = __ctx.buildDirectReplyPrompt;
  const buildTaskExecutionPrompt = __ctx.buildTaskExecutionPrompt;
  const buildAvailableSkillsPromptBlock =
    __ctx.buildAvailableSkillsPromptBlock ||
    ((provider: string) => `[Available Skills][provider=${provider || "unknown"}][unavailable]`);
  const cachedCliStatus = __ctx.cachedCliStatus;
  const cachedModels = __ctx.cachedModels;
  const chooseSafeReply = __ctx.chooseSafeReply;
  const cleanupWorktree = __ctx.cleanupWorktree;
  const clearTaskWorkflowState = __ctx.clearTaskWorkflowState;
  const createWorktree = __ctx.createWorktree;
  const crossDeptNextCallbacks = __ctx.crossDeptNextCallbacks;
  const db = __ctx.db;
  const dbPath = __ctx.dbPath;
  const delegatedTaskToSubtask = __ctx.delegatedTaskToSubtask;
  const deptCount = __ctx.deptCount;
  const detectAllCli = __ctx.detectAllCli;
  const endTaskExecutionSession = __ctx.endTaskExecutionSession;
  const ensureClaudeMd = __ctx.ensureClaudeMd;
  const ensureOAuthActiveAccount = __ctx.ensureOAuthActiveAccount;
  const ensureTaskExecutionSession = __ctx.ensureTaskExecutionSession;
  const execWithTimeout = __ctx.execWithTimeout;
  const fetchClaudeUsage = __ctx.fetchClaudeUsage;
  const fetchCodexUsage = __ctx.fetchCodexUsage;
  const fetchGeminiUsage = __ctx.fetchGeminiUsage;
  const finishReview = __ctx.finishReview;
  const firstQueryValue = __ctx.firstQueryValue;
  const generateProjectContext = __ctx.generateProjectContext;
  const getActiveOAuthAccountIds = __ctx.getActiveOAuthAccountIds;
  const getAgentDisplayName = __ctx.getAgentDisplayName;
  const getNextOAuthLabel = __ctx.getNextOAuthLabel;
  const getOAuthAccounts = __ctx.getOAuthAccounts;
  const getPreferredOAuthAccounts = __ctx.getPreferredOAuthAccounts;
  const getProviderModelConfig = __ctx.getProviderModelConfig;
  const getRecentChanges = __ctx.getRecentChanges;
  const getRecentConversationContext = __ctx.getRecentConversationContext;
  const getTaskContinuationContext = __ctx.getTaskContinuationContext;
  const handleTaskRunComplete = __ctx.handleTaskRunComplete;
  const hasExplicitWarningFixRequest = __ctx.hasExplicitWarningFixRequest;
  const hasStructuredJsonLines = __ctx.hasStructuredJsonLines;
  const httpAgentCounter = __ctx.httpAgentCounter;
  const insertMessageWithIdempotency = __ctx.insertMessageWithIdempotency;
  const interruptPidTree = __ctx.interruptPidTree;
  const isTaskWorkflowInterrupted = __ctx.isTaskWorkflowInterrupted;
  const killPidTree = __ctx.killPidTree;
  const launchHttpAgent = __ctx.launchHttpAgent;
  const logsDir = __ctx.logsDir;
  const meetingPhaseByAgent = __ctx.meetingPhaseByAgent;
  const meetingPresenceUntil = __ctx.meetingPresenceUntil;
  const meetingReviewDecisionByAgent = __ctx.meetingReviewDecisionByAgent;
  const meetingSeatIndexByAgent = __ctx.meetingSeatIndexByAgent;
  const meetingTaskIdByAgent = __ctx.meetingTaskIdByAgent;
  const mergeWorktree = __ctx.mergeWorktree;
  const normalizeOAuthProvider = __ctx.normalizeOAuthProvider;
  const notifyCeo = __ctx.notifyCeo;
  const nowMs = __ctx.nowMs;
  const randomDelay = __ctx.randomDelay;
  const recordAcceptedIngressAuditOrRollback = __ctx.recordAcceptedIngressAuditOrRollback;
  const recordMessageIngressAuditOr503 = __ctx.recordMessageIngressAuditOr503;
  const recordTaskCreationAudit = __ctx.recordTaskCreationAudit;
  const refreshGoogleToken = __ctx.refreshGoogleToken;
  const removeActiveOAuthAccount = __ctx.removeActiveOAuthAccount;
  const resolveMessageIdempotencyKey = __ctx.resolveMessageIdempotencyKey;
  const rollbackTaskWorktree = __ctx.rollbackTaskWorktree;
  const runAgentOneShot = __ctx.runAgentOneShot;
  const seedApprovedPlanSubtasks = __ctx.seedApprovedPlanSubtasks;
  const setActiveOAuthAccount = __ctx.setActiveOAuthAccount;
  const setOAuthActiveAccounts = __ctx.setOAuthActiveAccounts;
  const spawnCliAgent = __ctx.spawnCliAgent;
  const startPlannedApprovalMeeting = __ctx.startPlannedApprovalMeeting;
  const startProgressTimer = __ctx.startProgressTimer;
  const startTaskExecutionForAgent = __ctx.startTaskExecutionForAgent;
  const stopProgressTimer = __ctx.stopProgressTimer;
  const stopRequestModeByTask = __ctx.stopRequestModeByTask;
  const stopRequestedTasks = __ctx.stopRequestedTasks;
  const subtaskDelegationCallbacks = __ctx.subtaskDelegationCallbacks;
  const subtaskDelegationCompletionNoticeSent = __ctx.subtaskDelegationCompletionNoticeSent;
  const subtaskDelegationDispatchInFlight = __ctx.subtaskDelegationDispatchInFlight;
  const taskExecutionSessions = __ctx.taskExecutionSessions;
  const taskWorktrees = __ctx.taskWorktrees;
  const withSqliteBusyRetry = __ctx.withSqliteBusyRetry;
  const prettyStreamJson = __ctx.prettyStreamJson;
  const refreshCliUsageData = __ctx.refreshCliUsageData;
  const sendAgentMessage = __ctx.sendAgentMessage;
  const findBestSubordinate = __ctx.findBestSubordinate;
  const findTeamLeader = __ctx.findTeamLeader;
  const getDeptName = __ctx.getDeptName;
  const getDeptRoleConstraint = __ctx.getDeptRoleConstraint;
  const maybeNotifyAllSubtasksComplete = __ctx.maybeNotifyAllSubtasksComplete;
  const handleSubtaskDelegationComplete = __ctx.handleSubtaskDelegationComplete;
  const resolveLang = __ctx.resolveLang;
  const l = __ctx.l;
  const pickL = __ctx.pickL;
  const buildHealthPayload = __ctx.buildHealthPayload;
  const consumeOAuthState = __ctx.consumeOAuthState;
  const upsertOAuthCredential = __ctx.upsertOAuthCredential;
  const startGitHubOAuth = __ctx.startGitHubOAuth;
  const startGoogleAntigravityOAuth = __ctx.startGoogleAntigravityOAuth;
  const handleGitHubCallback = __ctx.handleGitHubCallback;
  const handleGoogleAntigravityCallback = __ctx.handleGoogleAntigravityCallback;
  const buildOAuthStatus = __ctx.buildOAuthStatus;
  const fetchOpenCodeModels = __ctx.fetchOpenCodeModels;
  const cachedCliModels = __ctx.cachedCliModels;
  const readCodexModelsCache = __ctx.readCodexModelsCache;
  const fetchGeminiModels = __ctx.fetchGeminiModels;
  const toModelInfo = __ctx.toModelInfo;
  const cachedSkills = __ctx.cachedSkills;
  const SKILLS_CACHE_TTL = __ctx.SKILLS_CACHE_TTL;
  const fetchSkillsFromSite = __ctx.fetchSkillsFromSite;
  const readCliUsageFromDb = __ctx.readCliUsageFromDb;

  // ---------------------------------------------------------------------------
  // Sequential cross-department cooperation: one department at a time
  // ---------------------------------------------------------------------------
  interface CrossDeptContext {
    teamLeader: AgentRow;
    taskTitle: string;
    ceoMessage: string;
    leaderDeptId: string;
    leaderDeptName: string;
    leaderName: string;
    lang: Lang;
    taskId: string;
  }

  function normalizeTextField(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function deriveSubtaskStateFromDelegatedTask(
    taskStatus: string,
    taskCompletedAt: number | null,
  ): { status: "done" | "in_progress" | "blocked"; blockedReason: string | null; completedAt: number | null } {
    if (taskStatus === "done") {
      return { status: "done", blockedReason: null, completedAt: taskCompletedAt ?? nowMs() };
    }
    // Collaboration child tasks can stay in review until parent consolidation meeting.
    // For parent subtask progress gating, treat child-review as checkpoint-complete.
    if (taskStatus === "review") {
      return { status: "done", blockedReason: null, completedAt: taskCompletedAt ?? nowMs() };
    }
    if (
      taskStatus === "in_progress" ||
      taskStatus === "collaborating" ||
      taskStatus === "planned" ||
      taskStatus === "pending"
    ) {
      return { status: "in_progress", blockedReason: null, completedAt: null };
    }
    return { status: "blocked", blockedReason: null, completedAt: null };
  }

  function pickUnlinkedTargetSubtask(parentTaskId: string, targetDeptId: string): { id: string } | undefined {
    const preferred = db
      .prepare(
        `
    SELECT id
    FROM subtasks
    WHERE task_id = ?
      AND target_department_id = ?
      AND status != 'done'
      AND (delegated_task_id IS NULL OR delegated_task_id = '')
      AND (
        title LIKE '[협업]%'
        OR title LIKE '[Collaboration]%'
        OR title LIKE '[協業]%'
        OR title LIKE '[协作]%'
      )
    ORDER BY created_at ASC
    LIMIT 1
  `,
      )
      .get(parentTaskId, targetDeptId) as { id: string } | undefined;
    if (preferred) return preferred;

    return db
      .prepare(
        `
    SELECT id
    FROM subtasks
    WHERE task_id = ?
      AND target_department_id = ?
      AND status != 'done'
      AND (delegated_task_id IS NULL OR delegated_task_id = '')
    ORDER BY created_at ASC
    LIMIT 1
  `,
      )
      .get(parentTaskId, targetDeptId) as { id: string } | undefined;
  }

  function syncSubtaskWithDelegatedTask(
    subtaskId: string,
    delegatedTaskId: string,
    delegatedTaskStatus: string,
    delegatedTaskCompletedAt: number | null,
  ): void {
    const current = db
      .prepare("SELECT delegated_task_id, status, blocked_reason, completed_at FROM subtasks WHERE id = ?")
      .get(subtaskId) as
      | {
          delegated_task_id: string | null;
          status: string;
          blocked_reason: string | null;
          completed_at: number | null;
        }
      | undefined;
    if (!current) return;

    const next = deriveSubtaskStateFromDelegatedTask(delegatedTaskStatus, delegatedTaskCompletedAt);
    const shouldUpdate =
      current.delegated_task_id !== delegatedTaskId ||
      current.status !== next.status ||
      (current.blocked_reason ?? null) !== next.blockedReason ||
      (current.completed_at ?? null) !== next.completedAt;
    if (!shouldUpdate) return;

    db.prepare(
      "UPDATE subtasks SET delegated_task_id = ?, status = ?, blocked_reason = ?, completed_at = ? WHERE id = ?",
    ).run(delegatedTaskId, next.status, next.blockedReason, next.completedAt, subtaskId);
    const updatedSub = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(subtaskId);
    broadcast("subtask_update", updatedSub);
  }

  function linkCrossDeptTaskToParentSubtask(
    parentTaskId: string,
    targetDeptId: string,
    delegatedTaskId: string,
  ): string | null {
    const sub = pickUnlinkedTargetSubtask(parentTaskId, targetDeptId);
    if (!sub) return null;
    syncSubtaskWithDelegatedTask(sub.id, delegatedTaskId, "planned", null);
    return sub.id;
  }

  function reconcileCrossDeptSubtasks(parentTaskId?: string): void {
    const rows = parentTaskId
      ? db
          .prepare(
            `
      SELECT id, source_task_id, department_id, status, completed_at
      FROM tasks
      WHERE source_task_id = ? AND department_id IS NOT NULL
      ORDER BY created_at ASC
    `,
          )
          .all(parentTaskId)
      : db
          .prepare(
            `
      SELECT id, source_task_id, department_id, status, completed_at
      FROM tasks
      WHERE source_task_id IS NOT NULL AND department_id IS NOT NULL
      ORDER BY created_at ASC
    `,
          )
          .all();

    for (const row of rows as Array<{
      id: string;
      source_task_id: string | null;
      department_id: string | null;
      status: string;
      completed_at: number | null;
    }>) {
      if (!row.source_task_id || !row.department_id) continue;

      const linked = db
        .prepare("SELECT id FROM subtasks WHERE task_id = ? AND delegated_task_id = ? LIMIT 1")
        .get(row.source_task_id, row.id) as { id: string } | undefined;
      const sub = linked ?? pickUnlinkedTargetSubtask(row.source_task_id, row.department_id);
      if (!sub) continue;

      syncSubtaskWithDelegatedTask(sub.id, row.id, row.status, row.completed_at ?? null);
      if (
        row.status === "in_progress" ||
        row.status === "review" ||
        row.status === "planned" ||
        row.status === "collaborating" ||
        row.status === "pending"
      ) {
        delegatedTaskToSubtask.set(row.id, sub.id);
      } else {
        delegatedTaskToSubtask.delete(row.id);
      }
    }
  }

  function recoverCrossDeptQueueAfterMissingCallback(completedChildTaskId: string): void {
    const child = db.prepare("SELECT source_task_id FROM tasks WHERE id = ?").get(completedChildTaskId) as
      | { source_task_id: string | null }
      | undefined;
    if (!child?.source_task_id) return;

    const parent = db
      .prepare(
        `
    SELECT id, title, description, department_id, status, assigned_agent_id, started_at
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

    const delegateMainTask = () => {
      const current = db
        .prepare("SELECT status, assigned_agent_id, started_at FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string; assigned_agent_id: string | null; started_at: number | null } | undefined;
      if (!current || current.status !== "collaborating") return;
      if (current.assigned_agent_id || current.started_at) return;

      const subordinate = findBestSubordinate(parent.department_id!, leader.id);
      const assignee = subordinate ?? leader;
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
    const crossDeptName = getDeptName(crossDeptId);
    const crossLeaderName = lang === "ko" ? crossLeader.name_ko || crossLeader.name : crossLeader.name;

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
          `${crossLeaderName}님, 안녕하세요! 대표님 지시로 "${taskTitle}" 업무 진행 중인데, ${crossDeptName} 협조가 필요합니다. 도움 부탁드려요! 🤝`,
          `${crossLeaderName}님! "${taskTitle}" 건으로 ${crossDeptName} 지원이 필요합니다. 시간 되시면 협의 부탁드립니다.`,
        ],
        [
          `Hi ${crossLeaderName}! We're working on "${taskTitle}" per CEO's directive and need ${crossDeptName}'s support. Could you help? 🤝`,
          `${crossLeaderName}, we need ${crossDeptName}'s input on "${taskTitle}". Let's sync when you have a moment.`,
        ],
        [`${crossLeaderName}さん、CEO指示の"${taskTitle}"で${crossDeptName}の協力が必要です。お願いします！🤝`],
        [`${crossLeaderName}，CEO安排的"${taskTitle}"需要${crossDeptName}配合，麻烦协调一下！🤝`],
      ),
      lang,
    );
    sendAgentMessage(teamLeader, coopReq, "chat", "agent", crossLeader.id, taskId);

    // Broadcast delivery animation event for UI
    broadcast("cross_dept_delivery", {
      from_agent_id: teamLeader.id,
      to_agent_id: crossLeader.id,
      task_title: taskTitle,
    });

    // Cross-department leader acknowledges AND creates a real task
    const crossAckDelay = 1500 + Math.random() * 1000;
    setTimeout(() => {
      const crossSub = findBestSubordinate(crossDeptId, crossLeader.id);
      const crossSubName = crossSub ? (lang === "ko" ? crossSub.name_ko || crossSub.name : crossSub.name) : null;

      const crossAckMsg = crossSub
        ? pickL(
            l(
              [
                `네, ${leaderName}님! 확인했습니다. ${crossSubName}에게 바로 배정하겠습니다 👍`,
                `알겠습니다! ${crossSubName}가 지원하도록 하겠습니다. 진행 상황 공유드릴게요.`,
              ],
              [
                `Sure, ${leaderName}! I'll assign ${crossSubName} to support right away 👍`,
                `Got it! ${crossSubName} will handle the ${crossDeptName} side. I'll keep you posted.`,
              ],
              [`了解しました、${leaderName}さん！${crossSubName}を割り当てます 👍`],
              [`好的，${leaderName}！安排${crossSubName}支援 👍`],
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
      sendAgentMessage(crossLeader, crossAckMsg, "chat", "agent", null, taskId);

      // Create actual task in the cross-department
      const crossTaskId = randomUUID();
      const ct = nowMs();
      const crossTaskTitle = pickL(
        l([`[협업] ${taskTitle}`], [`[Collaboration] ${taskTitle}`], [`[協業] ${taskTitle}`], [`[协作] ${taskTitle}`]),
        lang,
      );
      const parentTaskPath = db.prepare("SELECT project_id, project_path FROM tasks WHERE id = ?").get(taskId) as
        | {
            project_id: string | null;
            project_path: string | null;
          }
        | undefined;
      const crossDetectedPath = parentTaskPath?.project_path ?? detectProjectPath(ceoMessage);
      db.prepare(
        `
      INSERT INTO tasks (id, title, description, department_id, project_id, status, priority, task_type, project_path, source_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planned', 1, 'general', ?, ?, ?, ?)
    `,
      ).run(
        crossTaskId,
        crossTaskTitle,
        `[Cross-dept from ${leaderDeptName}] ${ceoMessage}`,
        crossDeptId,
        parentTaskPath?.project_id ?? null,
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
        actorId: crossLeader.id,
        actorName: crossLeader.name,
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
      const execAgent = crossSub || crossLeader;
      const execName = lang === "ko" ? execAgent.name_ko || execAgent.name : execAgent.name;
      const ct2 = nowMs();
      db.prepare(
        "UPDATE tasks SET assigned_agent_id = ?, status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?",
      ).run(execAgent.id, ct2, ct2, crossTaskId);
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(
        crossTaskId,
        execAgent.id,
      );
      appendTaskLog(crossTaskId, "system", `${crossLeaderName} → ${execName}`);

      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(crossTaskId));
      broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(execAgent.id));

      // Register callback to start next department when this one finishes
      if (index + 1 < deptIds.length) {
        crossDeptNextCallbacks.set(crossTaskId, () => {
          const nextDelay = 2000 + Math.random() * 1000;
          setTimeout(() => {
            startCrossDeptCooperation(deptIds, index + 1, ctx, onAllDone);
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
          const crossModel = crossModelConfig[execProvider]?.model || undefined;
          const crossReasoningLevel = crossModelConfig[execProvider]?.reasoningLevel || undefined;
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

  /**
   * Detect project path from CEO message.
   * Recognizes:
   * 1. Absolute paths: /home/user/Projects/foo, ~/Projects/bar
   * 2. Project names: "climpire 프로젝트", "claw-kanban에서"
   * 3. Known project directories under ~/Projects
   */
  function detectProjectPath(message: string): string | null {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, "Projects");
    const projectsDirLower = path.join(homeDir, "projects");

    // 1. Explicit absolute path in message
    const absMatch = message.match(/(?:^|\s)(\/[\w./-]+)/);
    if (absMatch) {
      const p = absMatch[1];
      // Check if it's a real directory
      try {
        if (fs.statSync(p).isDirectory()) return p;
      } catch {}
      // Check parent directory
      const parent = path.dirname(p);
      try {
        if (fs.statSync(parent).isDirectory()) return parent;
      } catch {}
    }

    // 2. ~ path
    const tildeMatch = message.match(/~\/([\w./-]+)/);
    if (tildeMatch) {
      const expanded = path.join(homeDir, tildeMatch[1]);
      try {
        if (fs.statSync(expanded).isDirectory()) return expanded;
      } catch {}
    }

    // 3. Scan known project directories and match by name
    let knownProjects: string[] = [];
    for (const pDir of [projectsDir, projectsDirLower]) {
      try {
        const entries = fs.readdirSync(pDir, { withFileTypes: true });
        knownProjects = knownProjects.concat(
          entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name),
        );
      } catch {}
    }

    // Match project names in the message (case-insensitive)
    const msgLower = message.toLowerCase();
    for (const proj of knownProjects) {
      if (msgLower.includes(proj.toLowerCase())) {
        // Return the actual path
        const fullPath = path.join(projectsDir, proj);
        try {
          if (fs.statSync(fullPath).isDirectory()) return fullPath;
        } catch {}
        const fullPathLower = path.join(projectsDirLower, proj);
        try {
          if (fs.statSync(fullPathLower).isDirectory()) return fullPathLower;
        } catch {}
      }
    }

    return null;
  }

  /**
   * Resolve project path (canonical-first):
   * 1) task.project_id -> projects.project_path
   * 2) task.project_path
   * 3) detect from description/title
   * 4) process.cwd()
   */
  function resolveProjectPath(task: {
    project_id?: string | null;
    project_path?: string | null;
    description?: string | null;
    title?: string;
  }): string {
    const projectId = String(task.project_id ?? "").trim();
    if (projectId) {
      const row = db
        .prepare(
          `
      SELECT project_path
      FROM projects
      WHERE id = ?
      LIMIT 1
    `,
        )
        .get(projectId) as { project_path: string | null } | undefined;
      const canonical = String(row?.project_path ?? "").trim();
      if (canonical) {
        const detectedCanonical = detectProjectPath(canonical);
        return detectedCanonical || canonical;
      }
    }

    const taskProjectPath = String(task.project_path ?? "").trim();
    if (taskProjectPath) {
      const detectedTaskPath = detectProjectPath(taskProjectPath);
      return detectedTaskPath || taskProjectPath;
    }

    const detected = detectProjectPath(task.description || "") || detectProjectPath(task.title || "");
    return detected || process.cwd();
  }

  function getLatestKnownProjectPath(): string | null {
    const row = db
      .prepare(
        `
    SELECT project_path
    FROM tasks
    WHERE project_path IS NOT NULL AND TRIM(project_path) != ''
    ORDER BY updated_at DESC
    LIMIT 1
  `,
      )
      .get() as { project_path: string | null } | undefined;
    const candidate = normalizeTextField(row?.project_path ?? null);
    if (!candidate) return null;
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {}
    return null;
  }

  function getDefaultProjectRoot(): string {
    const homeDir = os.homedir();
    const candidates = [path.join(homeDir, "Projects"), path.join(homeDir, "projects"), process.cwd()];
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isDirectory()) return candidate;
      } catch {}
    }
    return process.cwd();
  }

  function resolveDirectiveProjectPath(
    ceoMessage: string,
    options: DelegationOptions = {},
  ): { projectPath: string | null; source: string } {
    const explicitProjectId = normalizeTextField((options as { projectId?: unknown }).projectId);
    if (explicitProjectId) {
      const projectById = db
        .prepare(
          `
      SELECT project_path
      FROM projects
      WHERE id = ?
      LIMIT 1
    `,
        )
        .get(explicitProjectId) as { project_path: string | null } | undefined;
      const byIdPath = normalizeTextField(projectById?.project_path);
      if (byIdPath) {
        const detectedByIdPath = detectProjectPath(byIdPath) || byIdPath;
        return { projectPath: detectedByIdPath, source: "project_id" };
      }
    }

    const explicitProjectPath = normalizeTextField(options.projectPath);
    if (explicitProjectPath) {
      const detected = detectProjectPath(explicitProjectPath);
      if (detected) return { projectPath: detected, source: "project_path" };
    }

    const contextHint = normalizeTextField(options.projectContext);
    if (contextHint) {
      const detectedFromContext = detectProjectPath(contextHint);
      if (detectedFromContext) return { projectPath: detectedFromContext, source: "project_context" };

      const existingProjectHint =
        /기존\s*프로젝트|기존\s*작업|existing project|same project|current project|ongoing project|既存.*プロジェクト|現在.*プロジェクト|之前项目|当前项目/i.test(
          contextHint,
        );
      if (existingProjectHint) {
        const latest = getLatestKnownProjectPath();
        if (latest) return { projectPath: latest, source: "recent_project" };
      }

      const newProjectHint =
        /신규\s*프로젝트|새\s*프로젝트|new project|greenfield|from scratch|新規.*プロジェクト|新项目/i.test(
          contextHint,
        );
      if (newProjectHint) {
        return { projectPath: getDefaultProjectRoot(), source: "new_project_default" };
      }
    }

    const detectedFromMessage = detectProjectPath(ceoMessage);
    if (detectedFromMessage) return { projectPath: detectedFromMessage, source: "message" };

    return { projectPath: null, source: "none" };
  }

  function stripReportRequestPrefix(content: string): string {
    return content.replace(/^\s*\[(보고 요청|Report Request|レポート依頼|报告请求)\]\s*/i, "").trim();
  }

  type ReportOutputFormat = "ppt" | "md";

  function detectReportOutputFormat(requestText: string): ReportOutputFormat {
    const text = requestText.toLowerCase();
    const explicitMd =
      /(?:^|\s)(md|markdown)(?:\s|$)|마크다운|markdown 보고서|text report|텍스트 보고서|plain text|문서만|文档|テキスト/.test(
        text,
      );
    if (explicitMd) return "md";
    return "ppt";
  }

  const REPORT_CLAUDE_PRIORITY_DEPTS = ["planning", "dev", "design", "qa", "operations"] as const;
  const REPORT_PPT_TOOL_REPO = "https://github.com/GreenSheep01201/ppt_team_agent";
  const REPORT_PPT_TOOL_DIR = "tools/ppt_team_agent";
  const REPORT_PPT_DESIGN_SKILL = `${REPORT_PPT_TOOL_DIR}/.claude/skills/design-skill/SKILL.md`;
  const REPORT_PPT_PPTX_SKILL = `${REPORT_PPT_TOOL_DIR}/.claude/skills/pptx-skill/SKILL.md`;
  const REPORT_PPT_HTML2PPTX_SCRIPT = `${REPORT_PPT_TOOL_DIR}/.claude/skills/pptx-skill/scripts/html2pptx.js`;
  const REPORT_PPT_RESEARCH_AGENT_GUIDE = `${REPORT_PPT_TOOL_DIR}/.claude/agents/research-agent.md`;
  const REPORT_PPT_ORGANIZER_AGENT_GUIDE = `${REPORT_PPT_TOOL_DIR}/.claude/agents/organizer-agent.md`;
  const REPORT_PLAYWRIGHT_MCP_REPO = "https://github.com/microsoft/playwright-mcp.git";
  const REPORT_PLAYWRIGHT_MCP_DIR = "tools/playwright-mcp";

  const REPORT_DEPT_PRIORITY: Record<string, number> = {
    planning: 0,
    dev: 1,
    design: 2,
    qa: 3,
    operations: 4,
  };

  const REPORT_DEPT_LABELS: Record<string, string> = {
    planning: "Planning",
    dev: "Development",
    design: "Design",
    qa: "QA",
    operations: "Operations",
  };

  const REPORT_STATUS_PRIORITY: Record<string, number> = {
    idle: 0,
    break: 1,
    working: 2,
    offline: 3,
  };

  const REPORT_ROLE_PRIORITY: Record<string, number> = {
    team_leader: 0,
    senior: 1,
    junior: 2,
    intern: 3,
  };

  function sortReportCandidates(candidates: AgentRow[]): AgentRow[] {
    return [...candidates].sort((a, b) => {
      const ad = REPORT_DEPT_PRIORITY[a.department_id || ""] ?? 99;
      const bd = REPORT_DEPT_PRIORITY[b.department_id || ""] ?? 99;
      if (ad !== bd) return ad - bd;

      const as = REPORT_STATUS_PRIORITY[a.status || ""] ?? 99;
      const bs = REPORT_STATUS_PRIORITY[b.status || ""] ?? 99;
      if (as !== bs) return as - bs;

      const ar = REPORT_ROLE_PRIORITY[a.role || ""] ?? 99;
      const br = REPORT_ROLE_PRIORITY[b.role || ""] ?? 99;
      if (ar !== br) return ar - br;

      return a.name.localeCompare(b.name);
    });
  }

  function fetchAgentById(agentId: string | null): AgentRow | null {
    if (!agentId) return null;
    return db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as unknown as AgentRow | null;
  }

  function fetchClaudePriorityCandidates(): AgentRow[] {
    const placeholders = REPORT_CLAUDE_PRIORITY_DEPTS.map(() => "?").join(",");
    return sortReportCandidates(
      db
        .prepare(
          `
      SELECT * FROM agents
      WHERE status != 'offline'
        AND cli_provider = 'claude'
        AND department_id IN (${placeholders})
    `,
        )
        .all(...REPORT_CLAUDE_PRIORITY_DEPTS) as unknown as AgentRow[],
    );
  }

  function fetchFallbackCandidates(): AgentRow[] {
    return sortReportCandidates(
      db
        .prepare(
          `
      SELECT * FROM agents
      WHERE status != 'offline'
    `,
        )
        .all() as unknown as AgentRow[],
    );
  }

  function pickTopRecommendationsByDept(candidates: AgentRow[]): AgentRow[] {
    const used = new Set<string>();
    const out: AgentRow[] = [];
    for (const agent of candidates) {
      const deptId = String(agent.department_id || "");
      if (!REPORT_DEPT_PRIORITY.hasOwnProperty(deptId)) continue;
      if (used.has(deptId)) continue;
      used.add(deptId);
      out.push(agent);
    }
    return out;
  }

  function formatRecommendationList(candidates: AgentRow[]): string {
    if (candidates.length === 0) return "none";
    return candidates
      .map((agent, idx) => {
        const deptId = String(agent.department_id || "");
        const dept = REPORT_DEPT_LABELS[deptId] || deptId || "Unknown";
        return `${idx + 1}. ${dept}:${agent.name}`;
      })
      .join(" / ");
  }

  function resolveReportAssignee(targetAgentId: string | null): {
    requestedAgent: AgentRow | null;
    assignee: AgentRow | null;
    claudeRecommendations: AgentRow[];
    reroutedToClaude: boolean;
    claudeUnavailable: boolean;
  } {
    const requestedAgent = fetchAgentById(targetAgentId);
    const claudeCandidates = fetchClaudePriorityCandidates();
    const claudeRecommendations = pickTopRecommendationsByDept(claudeCandidates);

    if (claudeCandidates.length > 0) {
      if (requestedAgent && requestedAgent.status !== "offline" && requestedAgent.cli_provider === "claude") {
        return {
          requestedAgent,
          assignee: requestedAgent,
          claudeRecommendations,
          reroutedToClaude: false,
          claudeUnavailable: false,
        };
      }
      return {
        requestedAgent,
        assignee: claudeRecommendations[0] ?? claudeCandidates[0] ?? null,
        claudeRecommendations,
        reroutedToClaude: Boolean(requestedAgent && requestedAgent.cli_provider !== "claude"),
        claudeUnavailable: false,
      };
    }

    const fallbackCandidates = fetchFallbackCandidates();
    const fallbackAssignee =
      requestedAgent && requestedAgent.status !== "offline" ? requestedAgent : (fallbackCandidates[0] ?? null);

    return {
      requestedAgent,
      assignee: fallbackAssignee,
      claudeRecommendations: [],
      reroutedToClaude: false,
      claudeUnavailable: true,
    };
  }

  function pickPlanningReportAssignee(preferredAgentId: string | null): AgentRow | null {
    return resolveReportAssignee(preferredAgentId).assignee;
  }

  function handleReportRequest(targetAgentId: string, ceoMessage: string): boolean {
    const routing = resolveReportAssignee(targetAgentId);
    const reportAssignee = routing.assignee;
    if (!reportAssignee) return false;

    const lang = resolveLang(ceoMessage);
    const cleanRequest = stripReportRequestPrefix(ceoMessage) || ceoMessage.trim();
    const outputFormat = detectReportOutputFormat(cleanRequest);
    const outputLabel = outputFormat === "ppt" ? "PPT" : "MD";
    const outputExt = outputFormat === "ppt" ? "pptx" : "md";
    const taskType = outputFormat === "ppt" ? "presentation" : "documentation";
    const t = nowMs();
    const taskId = randomUUID();
    const assigneeDeptId = reportAssignee.department_id || "planning";
    const assigneeDeptName = REPORT_DEPT_LABELS[assigneeDeptId] || assigneeDeptId || "Planning";
    const requestPreview = cleanRequest.length > 64 ? `${cleanRequest.slice(0, 61).trimEnd()}...` : cleanRequest;
    const taskTitle =
      outputFormat === "ppt" ? `보고 자료(PPT) 작성: ${requestPreview}` : `보고 문서(MD) 작성: ${requestPreview}`;
    const detectedPath = detectProjectPath(cleanRequest);
    const fileStamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 16);
    const outputPath =
      outputFormat === "ppt"
        ? `docs/reports/${fileStamp}-report-deck.${outputExt}`
        : `docs/reports/${fileStamp}-report.${outputExt}`;
    const researchNotesPath = `docs/reports/${fileStamp}-research-notes.md`;
    const fallbackMdPath = `docs/reports/${fileStamp}-report-fallback.md`;
    let linkedProjectId: string | null = null;
    let linkedProjectPath: string | null = detectedPath ?? null;
    if (detectedPath) {
      const projectByPath = db
        .prepare(
          `
      SELECT id, project_path
      FROM projects
      WHERE project_path = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `,
        )
        .get(detectedPath) as { id: string; project_path: string } | undefined;
      if (projectByPath) {
        linkedProjectId = projectByPath.id;
        linkedProjectPath = projectByPath.project_path;
      }
    }
    if (!linkedProjectId && routing.requestedAgent?.current_task_id) {
      const currentProject = db
        .prepare(
          `
      SELECT t.project_id, p.project_path
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ?
      LIMIT 1
    `,
        )
        .get(routing.requestedAgent.current_task_id) as
        | {
            project_id: string | null;
            project_path: string | null;
          }
        | undefined;
      linkedProjectId = normalizeTextField(currentProject?.project_id);
      if (!linkedProjectPath) linkedProjectPath = normalizeTextField(currentProject?.project_path);
    }
    const recommendationText = formatRecommendationList(routing.claudeRecommendations);

    const description = [
      `[REPORT REQUEST] ${cleanRequest}`,
      "[REPORT FLOW] review_meeting=skip_for_report",
      outputFormat === "ppt" ? "[REPORT FLOW] design_review=pending" : "[REPORT FLOW] design_review=not_required",
      outputFormat === "ppt" ? "[REPORT FLOW] final_regen=pending" : "[REPORT FLOW] final_regen=not_required",
      "",
      `Primary output format: ${outputLabel}`,
      `Target file path: ${outputPath}`,
      `Research notes path: ${researchNotesPath}`,
      outputFormat === "ppt" ? `Fallback markdown path: ${fallbackMdPath}` : "",
      "Tool preset: web-search + playwright-mcp + ppt_team_agent",
      "",
      "Default Tooling (must apply):",
      "- Web search: research the requested topic first and include source URLs + access date for major claims.",
      `- Browser MCP tool: playwright-mcp (${REPORT_PLAYWRIGHT_MCP_REPO})`,
      `- Local browser MCP workspace: ${REPORT_PLAYWRIGHT_MCP_DIR}`,
      `- PPT generation tool (required for PPT output when available): ${REPORT_PPT_TOOL_REPO}`,
      `- Local tool workspace: ${REPORT_PPT_TOOL_DIR}`,
      outputFormat === "ppt"
        ? `- [PPT SKILL MANDATE] Read and apply design skill guide first: ${REPORT_PPT_DESIGN_SKILL}`
        : "",
      outputFormat === "ppt" ? `- [PPT SKILL MANDATE] Follow pptx workflow guide: ${REPORT_PPT_PPTX_SKILL}` : "",
      outputFormat === "ppt"
        ? `- [PPT SKILL MANDATE] Use html->pptx conversion workflow/script: ${REPORT_PPT_HTML2PPTX_SCRIPT}`
        : "",
      outputFormat === "ppt"
        ? `- [PPT SKILL MANDATE] Use research/organizer agent guides for quality bar: ${REPORT_PPT_RESEARCH_AGENT_GUIDE}, ${REPORT_PPT_ORGANIZER_AGENT_GUIDE}`
        : "",
      `- This repository tracks both tools as pinned git submodules at ${REPORT_PLAYWRIGHT_MCP_DIR} and ${REPORT_PPT_TOOL_DIR}; do not auto-clone from runtime.`,
      `- If submodule content is missing: git submodule update --init --recursive ${REPORT_PLAYWRIGHT_MCP_DIR} ${REPORT_PPT_TOOL_DIR}`,
      "Rules:",
      "- This is a report/documentation request only; do not execute implementation work.",
      "- Follow sequence: research -> evidence notes -> output artifact.",
      outputFormat === "ppt"
        ? "- For PPT workflow, generate and maintain editable HTML slide sources first (do not skip HTML intermediate artifacts)."
        : "",
      outputFormat === "ppt"
        ? `- For PPT output, do not skip ${REPORT_PPT_TOOL_DIR} skill workflow; apply design-skill and pptx-skill guidance before final deck generation.`
        : "",
      outputFormat === "ppt"
        ? "- Final PPT must be regenerated from the HTML sources after the design checkpoint handoff."
        : "",
      outputFormat === "ppt"
        ? "- Deliver .pptx first. If PPT generation fails, submit markdown fallback with failure reason and manual conversion guidance."
        : "- Create a complete markdown report with structured headings and evidence.",
      routing.claudeUnavailable
        ? "- Claude Code assignee is unavailable in the priority departments. You must attempt PPT creation yourself first; fallback to markdown only when PPT generation fails."
        : "- Claude Code priority routing is enabled for PPT reliability.",
      "- Include executive summary, key findings, quantitative evidence, risks, and next actions.",
    ].join("\n");

    db.prepare(
      `
    INSERT INTO tasks (id, title, description, department_id, assigned_agent_id, project_id, status, priority, task_type, project_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', 1, ?, ?, ?, ?)
  `,
    ).run(
      taskId,
      taskTitle,
      description,
      assigneeDeptId,
      reportAssignee.id,
      linkedProjectId,
      taskType,
      linkedProjectPath,
      t,
      t,
    );
    recordTaskCreationAudit({
      taskId,
      taskTitle,
      taskStatus: "planned",
      departmentId: assigneeDeptId,
      assignedAgentId: reportAssignee.id,
      taskType,
      projectPath: linkedProjectPath,
      trigger: "workflow.report_request",
      triggerDetail: `format=${outputFormat}; assignee=${reportAssignee.name}`,
      actorType: "agent",
      actorId: reportAssignee.id,
      actorName: reportAssignee.name,
      body: {
        clean_request: cleanRequest,
        output_format: outputFormat,
        output_path: outputPath,
        research_notes_path: researchNotesPath,
        fallback_md_path: fallbackMdPath,
      },
    });
    if (linkedProjectId) {
      db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(t, t, linkedProjectId);
    }

    db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(taskId, reportAssignee.id);
    appendTaskLog(taskId, "system", `Report request received via chat: ${cleanRequest}`);
    appendTaskLog(
      taskId,
      "system",
      `Report routing: assignee=${reportAssignee.name} provider=${reportAssignee.cli_provider || "unknown"} format=${outputLabel}`,
    );
    if (routing.reroutedToClaude && routing.requestedAgent) {
      appendTaskLog(
        taskId,
        "system",
        `Claude Code recommendation applied (requested=${routing.requestedAgent.name}/${routing.requestedAgent.cli_provider || "unknown"}): ${recommendationText}`,
      );
    }
    if (routing.claudeUnavailable) {
      appendTaskLog(
        taskId,
        "system",
        "No Claude Code candidate found in priority departments; fallback assignment used.",
      );
    }
    if (detectedPath) {
      appendTaskLog(taskId, "system", `Project path detected: ${detectedPath}`);
    }

    const assigneeName = getAgentDisplayName(reportAssignee, lang);
    const providerLabel = reportAssignee.cli_provider || "claude";
    sendAgentMessage(
      reportAssignee,
      pickL(
        l(
          [`${assigneeName}입니다. 보고 요청을 접수했습니다. ${outputLabel} 형식으로 작성해 제출하겠습니다.`],
          [`${assigneeName} here. Report request received. I'll deliver it in ${outputLabel} format.`],
          [`${assigneeName}です。レポート依頼を受領しました。${outputLabel}形式で作成して提出します。`],
          [`${assigneeName}收到报告请求，将按${outputLabel}格式完成并提交。`],
        ),
        lang,
      ),
      "report",
      "all",
      null,
      taskId,
    );

    notifyCeo(
      pickL(
        l(
          [
            `[REPORT ROUTING] '${taskTitle}' 요청을 ${assigneeName}(${providerLabel})에게 배정했습니다. 출력 형식: ${outputLabel}`,
          ],
          [
            `[REPORT ROUTING] Assigned '${taskTitle}' to ${assigneeName} (${providerLabel}). Output format: ${outputLabel}`,
          ],
          [
            `[REPORT ROUTING] '${taskTitle}' を ${assigneeName} (${providerLabel}) に割り当てました。出力形式: ${outputLabel}`,
          ],
          [`[REPORT ROUTING] 已将'${taskTitle}'分配给${assigneeName}（${providerLabel}）。输出格式：${outputLabel}`],
        ),
        lang,
      ),
      taskId,
    );
    if (routing.reroutedToClaude && routing.requestedAgent) {
      const requestedName = getAgentDisplayName(routing.requestedAgent, lang);
      notifyCeo(
        pickL(
          l(
            [
              `[CLAUDE RECOMMENDATION] 요청 대상 ${requestedName}(${routing.requestedAgent.cli_provider || "unknown"})는 Claude Code가 아니어서 Claude Code 우선 라우팅을 적용했습니다. 우선순위 추천: ${recommendationText}`,
            ],
            [
              `[CLAUDE RECOMMENDATION] Requested agent ${requestedName} (${routing.requestedAgent.cli_provider || "unknown"}) is not on Claude Code, so Claude-priority routing was applied. Priority recommendations: ${recommendationText}`,
            ],
            [
              `[CLAUDE RECOMMENDATION] 依頼先 ${requestedName}（${routing.requestedAgent.cli_provider || "unknown"}）は Claude Code ではないため、Claude 優先ルーティングを適用しました。優先候補: ${recommendationText}`,
            ],
            [
              `[CLAUDE RECOMMENDATION] 请求目标 ${requestedName}（${routing.requestedAgent.cli_provider || "unknown"}）不是 Claude Code，已启用 Claude 优先路由。优先推荐：${recommendationText}`,
            ],
          ),
          lang,
        ),
        taskId,
      );
    }
    if (routing.claudeUnavailable) {
      notifyCeo(
        pickL(
          l(
            [
              "[CLAUDE RECOMMENDATION] 우선순위 부서(기획>개발>디자인>QA>운영)에서 Claude Code 에이전트를 찾지 못해 현재 담당자가 PPT를 우선 시도하고, 실패 시 MD로 대체하도록 지시했습니다.",
            ],
            [
              "[CLAUDE RECOMMENDATION] No Claude Code agent was found in priority departments (Planning>Development>Design>QA>Operations). The current assignee was instructed to attempt PPT first, then fallback to MD on failure.",
            ],
            [
              "[CLAUDE RECOMMENDATION] 優先部門（企画>開発>デザイン>QA>運用）に Claude Code エージェントがいないため、現担当者にPPT優先・失敗時MD代替を指示しました。",
            ],
            [
              "[CLAUDE RECOMMENDATION] 在优先部门（企划>开发>设计>QA>运营）中未找到 Claude Code 代理，已要求当前负责人先尝试 PPT，失败时改为 MD。",
            ],
          ),
          lang,
        ),
        taskId,
      );
    }

    broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
    broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(reportAssignee.id));

    setTimeout(
      () => {
        if (isTaskWorkflowInterrupted(taskId)) return;
        startTaskExecutionForAgent(taskId, reportAssignee, assigneeDeptId, assigneeDeptName);
      },
      randomDelay(900, 1600),
    );

    return true;
  }

  return {
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
  };
}
