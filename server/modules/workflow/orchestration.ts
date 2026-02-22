// @ts-nocheck

import type { RuntimeContext, WorkflowOrchestrationExports } from "../../types/runtime-context.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  CLI_OUTPUT_DEDUP_WINDOW_MS,
  readNonNegativeIntEnv,
  REVIEW_MAX_MEMO_ITEMS_PER_DEPT,
  REVIEW_MAX_MEMO_ITEMS_PER_ROUND,
  REVIEW_MAX_REMEDIATION_REQUESTS,
  REVIEW_MAX_REVISION_SIGNALS_PER_DEPT_PER_ROUND,
  REVIEW_MAX_REVISION_SIGNALS_PER_ROUND,
  REVIEW_MAX_ROUNDS,
} from "../../db/runtime.ts";
import { BUILTIN_GOOGLE_CLIENT_ID, BUILTIN_GOOGLE_CLIENT_SECRET, decryptSecret, encryptSecret } from "../../oauth/helpers.ts";
import { notifyTaskStatus } from "../../gateway/client.ts";
import { createWsHub } from "../../ws/hub.ts";

import { initializeWorkflowMeetingTools } from "./orchestration/meetings.ts";

export function initializeWorkflowPartC(ctx: RuntimeContext): WorkflowOrchestrationExports {
  const __ctx: RuntimeContext = ctx;
  const db = __ctx.db;
  const ensureOAuthActiveAccount = __ctx.ensureOAuthActiveAccount;
  const getActiveOAuthAccountIds = __ctx.getActiveOAuthAccountIds;
  const logsDir = __ctx.logsDir;
  const nowMs = __ctx.nowMs;
  const CLI_STATUS_TTL = __ctx.CLI_STATUS_TTL;
  const CLI_TOOLS = __ctx.CLI_TOOLS;
  const MODELS_CACHE_TTL = __ctx.MODELS_CACHE_TTL;
  const activeProcesses = __ctx.activeProcesses;
  const analyzeSubtaskDepartment = __ctx.analyzeSubtaskDepartment;
  const appendTaskLog = __ctx.appendTaskLog;
  const broadcast = __ctx.broadcast;
  const buildCliFailureMessage = __ctx.buildCliFailureMessage;
  const buildDirectReplyPrompt = __ctx.buildDirectReplyPrompt;
  const buildTaskExecutionPrompt = __ctx.buildTaskExecutionPrompt;
  const buildAvailableSkillsPromptBlock = __ctx.buildAvailableSkillsPromptBlock || ((provider: string) => `[Available Skills][provider=${provider || "unknown"}][unavailable]`);
  const cachedCliStatus = __ctx.cachedCliStatus;
  const cachedModels = __ctx.cachedModels;
  const chooseSafeReply = __ctx.chooseSafeReply;
  const cleanupWorktree = __ctx.cleanupWorktree;
  const createWorktree = __ctx.createWorktree;
  const detectAllCli = __ctx.detectAllCli;
  const ensureClaudeMd = __ctx.ensureClaudeMd;
  const execWithTimeout = __ctx.execWithTimeout;
  const fetchClaudeUsage = __ctx.fetchClaudeUsage;
  const fetchCodexUsage = __ctx.fetchCodexUsage;
  const fetchGeminiUsage = __ctx.fetchGeminiUsage;
  const generateProjectContext = __ctx.generateProjectContext;
  const getAgentDisplayName = __ctx.getAgentDisplayName;
  const getDecryptedOAuthToken = __ctx.getDecryptedOAuthToken;
  const getNextOAuthLabel = __ctx.getNextOAuthLabel;
  const getOAuthAccounts = __ctx.getOAuthAccounts;
  const getPreferredOAuthAccounts = __ctx.getPreferredOAuthAccounts;
  const getProviderModelConfig = __ctx.getProviderModelConfig;
  const getRecentChanges = __ctx.getRecentChanges;
  const getRecentConversationContext = __ctx.getRecentConversationContext;
  const getTaskContinuationContext = __ctx.getTaskContinuationContext;
  const hasExplicitWarningFixRequest = __ctx.hasExplicitWarningFixRequest;
  const hasStructuredJsonLines = __ctx.hasStructuredJsonLines;
  let httpAgentCounter = __ctx.httpAgentCounter;
  const interruptPidTree = __ctx.interruptPidTree;
  const isPidAlive = __ctx.isPidAlive;
  const killPidTree = __ctx.killPidTree;
  const launchHttpAgent = __ctx.launchHttpAgent;
  const launchApiProviderAgent = __ctx.launchApiProviderAgent;
  const mergeWorktree = __ctx.mergeWorktree;
  const normalizeOAuthProvider = __ctx.normalizeOAuthProvider;
  const randomDelay = __ctx.randomDelay;
  const recordTaskCreationAudit = __ctx.recordTaskCreationAudit;
  const setTaskCreationAuditCompletion = __ctx.setTaskCreationAuditCompletion;
  const refreshGoogleToken = __ctx.refreshGoogleToken;
  const rollbackTaskWorktree = __ctx.rollbackTaskWorktree;
  const runAgentOneShot = __ctx.runAgentOneShot;
  const seedApprovedPlanSubtasks = __ctx.seedApprovedPlanSubtasks;
  const spawnCliAgent = __ctx.spawnCliAgent;
  const stopRequestModeByTask = __ctx.stopRequestModeByTask;
  const stopRequestedTasks = __ctx.stopRequestedTasks;
  const taskWorktrees = __ctx.taskWorktrees;
  const wsClients = __ctx.wsClients;
  const readTimeoutMsEnv = __ctx.readTimeoutMsEnv;
  const TASK_RUN_IDLE_TIMEOUT_MS = __ctx.TASK_RUN_IDLE_TIMEOUT_MS;
  const TASK_RUN_HARD_TIMEOUT_MS = __ctx.TASK_RUN_HARD_TIMEOUT_MS;
  const isGitRepo = __ctx.isGitRepo;
  const getWorktreeDiffSummary = __ctx.getWorktreeDiffSummary;
  const hasVisibleDiffSummary = __ctx.hasVisibleDiffSummary;
  const MVP_CODE_REVIEW_POLICY_BASE_LINES = __ctx.MVP_CODE_REVIEW_POLICY_BASE_LINES;
  const EXECUTION_CONTINUITY_POLICY_LINES = __ctx.EXECUTION_CONTINUITY_POLICY_LINES;
  const WARNING_FIX_OVERRIDE_LINE = __ctx.WARNING_FIX_OVERRIDE_LINE;
  const buildMvpCodeReviewPolicyBlock = __ctx.buildMvpCodeReviewPolicyBlock;
  const CONTEXT_IGNORE_DIRS = __ctx.CONTEXT_IGNORE_DIRS;
  const CONTEXT_IGNORE_FILES = __ctx.CONTEXT_IGNORE_FILES;
  const buildFileTree = __ctx.buildFileTree;
  const detectTechStack = __ctx.detectTechStack;
  const getKeyFiles = __ctx.getKeyFiles;
  const buildProjectContextContent = __ctx.buildProjectContextContent;
  const buildAgentArgs = __ctx.buildAgentArgs;
  const ANSI_ESCAPE_REGEX = __ctx.ANSI_ESCAPE_REGEX;
  const CLI_SPINNER_LINE_REGEX = __ctx.CLI_SPINNER_LINE_REGEX;
  const cliOutputDedupCache = __ctx.cliOutputDedupCache;
  const shouldSkipDuplicateCliOutput = __ctx.shouldSkipDuplicateCliOutput;
  const clearCliOutputDedup = __ctx.clearCliOutputDedup;
  const normalizeStreamChunk = __ctx.normalizeStreamChunk;
  const extractLatestProjectMemoBlock = __ctx.extractLatestProjectMemoBlock;
  const sleepMs = __ctx.sleepMs;
  const localeInstruction = __ctx.localeInstruction;
  const normalizeConversationReply = __ctx.normalizeConversationReply;
  const isInternalWorkNarration = __ctx.isInternalWorkNarration;
  const fallbackTurnReply = __ctx.fallbackTurnReply;
  const summarizeForMeetingBubble = __ctx.summarizeForMeetingBubble;
  const isMvpDeferralSignal = __ctx.isMvpDeferralSignal;
  const isHardBlockSignal = __ctx.isHardBlockSignal;
  const hasApprovalAgreementSignal = __ctx.hasApprovalAgreementSignal;
  const isDeferrableReviewHold = __ctx.isDeferrableReviewHold;
  const classifyMeetingReviewDecision = __ctx.classifyMeetingReviewDecision;
  const wantsReviewRevision = __ctx.wantsReviewRevision;
  const findLatestTranscriptContentByAgent = __ctx.findLatestTranscriptContentByAgent;
  const formatMeetingTranscript = __ctx.formatMeetingTranscript;
  const buildMeetingPrompt = __ctx.buildMeetingPrompt;
  const findExplicitDepartmentByMention = __ctx.findExplicitDepartmentByMention;
  const plannerSubtaskRoutingInFlight = __ctx.plannerSubtaskRoutingInFlight;
  const normalizeDeptAliasToken = __ctx.normalizeDeptAliasToken;
  const normalizePlannerTargetDeptId = __ctx.normalizePlannerTargetDeptId;
  const parsePlannerSubtaskAssignments = __ctx.parsePlannerSubtaskAssignments;
  const rerouteSubtasksByPlanningLeader = __ctx.rerouteSubtasksByPlanningLeader;
  const createSubtaskFromCli = __ctx.createSubtaskFromCli;
  const completeSubtaskFromCli = __ctx.completeSubtaskFromCli;
  const seedReviewRevisionSubtasks = __ctx.seedReviewRevisionSubtasks;
  const codexThreadToSubtask = __ctx.codexThreadToSubtask;
  const parseAndCreateSubtasks = __ctx.parseAndCreateSubtasks;
  const ANTIGRAVITY_ENDPOINTS = __ctx.ANTIGRAVITY_ENDPOINTS;
  const ANTIGRAVITY_DEFAULT_PROJECT = __ctx.ANTIGRAVITY_DEFAULT_PROJECT;
  const copilotTokenCache = __ctx.copilotTokenCache;
  const antigravityProjectCache = __ctx.antigravityProjectCache;
  const oauthProviderPrefix = __ctx.oauthProviderPrefix;
  const getOAuthAccountDisplayName = __ctx.getOAuthAccountDisplayName;
  const getOAuthAutoSwapEnabled = __ctx.getOAuthAutoSwapEnabled;
  const oauthDispatchCursor = __ctx.oauthDispatchCursor;
  const rotateOAuthAccounts = __ctx.rotateOAuthAccounts;
  const prioritizeOAuthAccount = __ctx.prioritizeOAuthAccount;
  const markOAuthAccountFailure = __ctx.markOAuthAccountFailure;
  const markOAuthAccountSuccess = __ctx.markOAuthAccountSuccess;
  const exchangeCopilotToken = __ctx.exchangeCopilotToken;
  const loadCodeAssistProject = __ctx.loadCodeAssistProject;
  const parseHttpAgentSubtasks = __ctx.parseHttpAgentSubtasks;
  const parseSSEStream = __ctx.parseSSEStream;
  const parseGeminiSSEStream = __ctx.parseGeminiSSEStream;
  const resolveCopilotModel = __ctx.resolveCopilotModel;
  const resolveAntigravityModel = __ctx.resolveAntigravityModel;
  const executeCopilotAgent = __ctx.executeCopilotAgent;
  const executeAntigravityAgent = __ctx.executeAntigravityAgent;
  const jsonHasKey = __ctx.jsonHasKey;
  const fileExistsNonEmpty = __ctx.fileExistsNonEmpty;
  const readClaudeToken = __ctx.readClaudeToken;
  const readCodexTokens = __ctx.readCodexTokens;
  const GEMINI_OAUTH_CLIENT_ID = __ctx.GEMINI_OAUTH_CLIENT_ID;
  const GEMINI_OAUTH_CLIENT_SECRET = __ctx.GEMINI_OAUTH_CLIENT_SECRET;
  const readGeminiCredsFromKeychain = __ctx.readGeminiCredsFromKeychain;
  const readGeminiCredsFromFile = __ctx.readGeminiCredsFromFile;
  const readGeminiCreds = __ctx.readGeminiCreds;
  const freshGeminiToken = __ctx.freshGeminiToken;
  const geminiProjectCache = __ctx.geminiProjectCache;
  const GEMINI_PROJECT_TTL = __ctx.GEMINI_PROJECT_TTL;
  const getGeminiProjectId = __ctx.getGeminiProjectId;
  const detectCliTool = __ctx.detectCliTool;
  const DEPT_KEYWORDS = __ctx.DEPT_KEYWORDS;
  const detectLang = (...args: any[]) => __ctx.detectLang(...args);
  const detectTargetDepartments = (...args: any[]) => __ctx.detectTargetDepartments(...args);
  const findTeamLeader = (...args: any[]) => __ctx.findTeamLeader(...args);
  const formatTaskSubtaskProgressSummary = (...args: any[]) => __ctx.formatTaskSubtaskProgressSummary(...args);
  const getDeptName = (...args: any[]) => __ctx.getDeptName(...args);
  const getDeptRoleConstraint = (...args: any[]) => __ctx.getDeptRoleConstraint(...args);
  const getPreferredLanguage = (...args: any[]) => __ctx.getPreferredLanguage(...args);
  const getRoleLabel = (...args: any[]) => __ctx.getRoleLabel(...args);
  const l = (...args: any[]) => __ctx.l(...args);
  const pickL = (...args: any[]) => __ctx.pickL(...args);
  const prettyStreamJson = (...args: any[]) => __ctx.prettyStreamJson(...args);
  const processSubtaskDelegations = (...args: any[]) => __ctx.processSubtaskDelegations(...args);
  const recoverCrossDeptQueueAfterMissingCallback = (...args: any[]) => __ctx.recoverCrossDeptQueueAfterMissingCallback(...args);
  const refreshCliUsageData = (...args: any[]) => __ctx.refreshCliUsageData(...args);
  const resolveLang = (...args: any[]) => __ctx.resolveLang(...args);
  const resolveProjectPath = (...args: any[]) => __ctx.resolveProjectPath(...args);
  const sendAgentMessage = (...args: any[]) => __ctx.sendAgentMessage(...args);

// ---------------------------------------------------------------------------
// Helpers: progress timers, CEO notifications
// ---------------------------------------------------------------------------

// Track progress report timers so we can cancel them when tasks finish
const progressTimers = new Map<string, ReturnType<typeof setInterval>>();

// Cross-department sequential queue: when a cross-dept task finishes,
// trigger the next department in line (instead of spawning all simultaneously).
// Key: cross-dept task ID → callback to start next department
const crossDeptNextCallbacks = new Map<string, () => void>();

// Subtask delegation sequential queue: delegated task ID → callback to start next delegation
const subtaskDelegationCallbacks = new Map<string, () => void>();
const subtaskDelegationDispatchInFlight = new Set<string>();

// Map delegated task ID → original subtask ID for completion tracking
const delegatedTaskToSubtask = new Map<string, string>();
const subtaskDelegationCompletionNoticeSent = new Set<string>();

// Review consensus workflow state: task_id → current review round
const reviewRoundState = new Map<string, number>();
const reviewInFlight = new Set<string>();
const meetingPresenceUntil = new Map<string, number>();
const meetingSeatIndexByAgent = new Map<string, number>();
const meetingPhaseByAgent = new Map<string, "kickoff" | "review">();
const meetingTaskIdByAgent = new Map<string, string>();
type MeetingReviewDecision = "reviewing" | "approved" | "hold";
const meetingReviewDecisionByAgent = new Map<string, MeetingReviewDecision>();
const projectReviewGateNotifiedAt = new Map<string, number>();

interface TaskExecutionSessionState {
  sessionId: string;
  taskId: string;
  agentId: string;
  provider: string;
  openedAt: number;
  lastTouchedAt: number;
}

const taskExecutionSessions = new Map<string, TaskExecutionSessionState>();

function ensureTaskExecutionSession(taskId: string, agentId: string, provider: string): TaskExecutionSessionState {
  const now = nowMs();
  const existing = taskExecutionSessions.get(taskId);
  if (existing && existing.agentId === agentId && existing.provider === provider) {
    existing.lastTouchedAt = now;
    taskExecutionSessions.set(taskId, existing);
    return existing;
  }

  const nextSession: TaskExecutionSessionState = {
    sessionId: randomUUID(),
    taskId,
    agentId,
    provider,
    openedAt: now,
    lastTouchedAt: now,
  };
  taskExecutionSessions.set(taskId, nextSession);
  appendTaskLog(
    taskId,
    "system",
    existing
      ? `Execution session rotated: ${existing.sessionId} -> ${nextSession.sessionId} (agent=${agentId}, provider=${provider})`
      : `Execution session opened: ${nextSession.sessionId} (agent=${agentId}, provider=${provider})`,
  );
  return nextSession;
}

function endTaskExecutionSession(taskId: string, reason: string): void {
  const existing = taskExecutionSessions.get(taskId);
  if (!existing) return;
  taskExecutionSessions.delete(taskId);
  appendTaskLog(
    taskId,
    "system",
    `Execution session closed: ${existing.sessionId} (reason=${reason}, duration_ms=${Math.max(0, nowMs() - existing.openedAt)})`,
  );
}

function getTaskStatusById(taskId: string): string | null {
  const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
  return row?.status ?? null;
}

function isTaskWorkflowInterrupted(taskId: string): boolean {
  const status = getTaskStatusById(taskId);
  if (!status) return true; // deleted
  if (stopRequestedTasks.has(taskId)) return true;
  return status === "cancelled" || status === "pending" || status === "done" || status === "inbox";
}

function clearTaskWorkflowState(taskId: string): void {
  clearCliOutputDedup(taskId);
  crossDeptNextCallbacks.delete(taskId);
  subtaskDelegationCallbacks.delete(taskId);
  subtaskDelegationDispatchInFlight.delete(taskId);
  delegatedTaskToSubtask.delete(taskId);
  subtaskDelegationCompletionNoticeSent.delete(taskId);
  reviewInFlight.delete(taskId);
  reviewInFlight.delete(`planned:${taskId}`);
  reviewRoundState.delete(taskId);
  reviewRoundState.delete(`planned:${taskId}`);
  const status = getTaskStatusById(taskId);
  if (status === "done" || status === "cancelled") {
    endTaskExecutionSession(taskId, `workflow_cleared_${status}`);
  }
}

type ReviewRoundMode = "parallel_remediation" | "merge_synthesis" | "final_decision";

function getReviewRoundMode(round: number): ReviewRoundMode {
  if (round <= 1) return "parallel_remediation";
  if (round === 2) return "merge_synthesis";
  return "final_decision";
}

function scheduleNextReviewRound(taskId: string, taskTitle: string, currentRound: number, lang: Lang): void {
  const nextRound = currentRound + 1;
  appendTaskLog(
    taskId,
    "system",
    `Review round ${currentRound}: scheduling round ${nextRound} finalization meeting`,
  );
  notifyCeo(pickL(l(
    [`[CEO OFFICE] '${taskTitle}' 리뷰 라운드 ${currentRound} 취합이 완료되어 라운드 ${nextRound} 최종 승인 회의로 즉시 전환합니다.`],
    [`[CEO OFFICE] '${taskTitle}' review round ${currentRound} consolidation is complete. Moving directly to final approval round ${nextRound}.`],
    [`[CEO OFFICE] '${taskTitle}' のレビューラウンド${currentRound}集約が完了したため、最終承認ラウンド${nextRound}へ即時移行します。`],
    [`[CEO OFFICE] '${taskTitle}' 第 ${currentRound} 轮评审已完成汇总，立即转入第 ${nextRound} 轮最终审批会议。`],
  ), lang), taskId);
  setTimeout(() => {
    const current = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!current || current.status !== "review") return;
    finishReview(taskId, taskTitle, {
      bypassProjectDecisionGate: true,
      trigger: "review_round_transition",
    });
  }, randomDelay(1200, 1900));
}

function getProjectReviewGateSnapshot(projectId: string): {
  activeTotal: number;
  activeReview: number;
  rootReviewTotal: number;
  ready: boolean;
} {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS active_total,
      SUM(CASE WHEN status NOT IN ('done', 'cancelled') AND status = 'review' THEN 1 ELSE 0 END) AS active_review,
      SUM(CASE WHEN status = 'review' AND source_task_id IS NULL THEN 1 ELSE 0 END) AS root_review_total
    FROM tasks
    WHERE project_id = ?
  `).get(projectId) as {
    active_total: number | null;
    active_review: number | null;
    root_review_total: number | null;
  } | undefined;
  const activeTotal = row?.active_total ?? 0;
  const activeReview = row?.active_review ?? 0;
  const rootReviewTotal = row?.root_review_total ?? 0;
  const ready = activeTotal > 0 && activeTotal === activeReview && rootReviewTotal > 0;
  return { activeTotal, activeReview, rootReviewTotal, ready };
}

const REPORT_FLOW_PREFIX = "[REPORT FLOW]";
const REPORT_DESIGN_TASK_PREFIX = "[REPORT DESIGN TASK]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readReportFlowValue(description: string | null | undefined, key: string): string | null {
  const source = String(description ?? "");
  const re = new RegExp(`${escapeRegExp(REPORT_FLOW_PREFIX)}\\s*${escapeRegExp(key)}=([^\\n\\r]+)`, "i");
  const m = source.match(re);
  return m ? m[1].trim() : null;
}

function upsertReportFlowValue(description: string | null | undefined, key: string, value: string): string {
  const source = String(description ?? "");
  const line = `${REPORT_FLOW_PREFIX} ${key}=${value}`;
  const re = new RegExp(`${escapeRegExp(REPORT_FLOW_PREFIX)}\\s*${escapeRegExp(key)}=[^\\n\\r]*`, "i");
  if (re.test(source)) return source.replace(re, line);
  return source.trimEnd() ? `${source.trimEnd()}\n${line}` : line;
}

function isReportRequestTask(task: { task_type?: string | null; description?: string | null } | null | undefined): boolean {
  if (!task) return false;
  const taskType = String(task.task_type ?? "");
  if (taskType !== "presentation" && taskType !== "documentation") return false;
  return /\[REPORT REQUEST\]/i.test(String(task.description ?? ""));
}

function isPresentationReportTask(task: { task_type?: string | null; description?: string | null } | null | undefined): boolean {
  if (!isReportRequestTask(task)) return false;
  return String(task?.task_type ?? "") === "presentation";
}

function isReportDesignCheckpointTask(task: { description?: string | null } | null | undefined): boolean {
  const re = new RegExp(escapeRegExp(REPORT_DESIGN_TASK_PREFIX), "i");
  return re.test(String(task?.description ?? ""));
}

function extractReportDesignParentTaskId(task: {
  description?: string | null;
  source_task_id?: string | null;
} | null | undefined): string | null {
  if (!task) return null;
  const desc = String(task.description ?? "");
  const marker = desc.match(new RegExp(`${escapeRegExp(REPORT_DESIGN_TASK_PREFIX)}\\s*parent_task_id=([A-Za-z0-9-]{8,})`, "i"));
  if (marker?.[1]) return marker[1];
  const fallback = String(task.source_task_id ?? "").trim();
  return fallback || null;
}

function extractReportPathByLabel(description: string | null | undefined, label: string): string | null {
  const desc = String(description ?? "");
  const re = new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im");
  const m = desc.match(re);
  if (!m?.[1]) return null;
  const value = m[1].trim();
  return value || null;
}

function pickDesignCheckpointAgent(): AgentRow | null {
  const candidates = db.prepare(`
    SELECT *
    FROM agents
    WHERE department_id = 'design'
      AND COALESCE(cli_provider, '') IN ('claude','codex','gemini','opencode','copilot','antigravity','api')
    ORDER BY
      CASE status
        WHEN 'idle' THEN 0
        WHEN 'break' THEN 1
        WHEN 'working' THEN 2
        WHEN 'offline' THEN 9
        ELSE 8
      END,
      CASE role
        WHEN 'team_leader' THEN 0
        WHEN 'senior' THEN 1
        WHEN 'junior' THEN 2
        WHEN 'intern' THEN 3
        ELSE 4
      END,
      id ASC
  `).all() as AgentRow[];
  return candidates[0] ?? null;
}

function emitTaskReportEvent(taskId: string): void {
  try {
    const reportTask = db.prepare(`
      SELECT t.id, t.title, t.description, t.department_id, t.assigned_agent_id,
             t.status, t.project_path, t.created_at, t.completed_at,
             COALESCE(a.name, '') AS agent_name,
             COALESCE(a.name_ko, '') AS agent_name_ko,
             COALESCE(a.role, '') AS agent_role,
             COALESCE(d.name, '') AS dept_name,
             COALESCE(d.name_ko, '') AS dept_name_ko
      FROM tasks t
      LEFT JOIN agents a ON a.id = t.assigned_agent_id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ?
    `).get(taskId) as Record<string, unknown> | undefined;
    const reportLogs = db.prepare(
      "SELECT kind, message, created_at FROM task_logs WHERE task_id = ? ORDER BY created_at ASC"
    ).all(taskId) as Array<{ kind: string; message: string; created_at: number }>;
    const reportSubtasks = db.prepare(
      "SELECT id, title, status, assigned_agent_id, completed_at FROM subtasks WHERE task_id = ? ORDER BY created_at ASC"
    ).all(taskId) as Array<Record<string, unknown>>;
    const reportMinutes = db.prepare(`
      SELECT
        mm.meeting_type,
        mm.round AS round_number,
        COALESCE((
          SELECT group_concat(entry_line, '\n')
          FROM (
            SELECT printf('[%s] %s', COALESCE(e.speaker_name, 'Unknown'), e.content) AS entry_line
            FROM meeting_minute_entries e
            WHERE e.meeting_id = mm.id
            ORDER BY e.seq ASC, e.id ASC
          )
        ), '') AS entries,
        mm.created_at
      FROM meeting_minutes mm
      WHERE mm.task_id = ?
      ORDER BY mm.created_at ASC
    `).all(taskId) as Array<Record<string, unknown>>;
    if (reportTask) {
      broadcast("task_report", {
        task: reportTask,
        logs: reportLogs.slice(-30),
        subtasks: reportSubtasks,
        meeting_minutes: reportMinutes,
      });
    }
  } catch (reportErr) {
    console.error("[Claw-Empire] task_report broadcast error:", reportErr);
  }
}

function shouldDeferTaskReportUntilPlanningArchive(task: {
  source_task_id?: string | null;
  department_id?: string | null;
}): boolean {
  if (task.source_task_id) return false;
  const planningLeader = findTeamLeader("planning") || findTeamLeader(task.department_id ?? "");
  return Boolean(planningLeader);
}

function completeTaskWithoutReview(
  task: {
    id: string;
    title: string;
    description: string | null;
    department_id: string | null;
    source_task_id: string | null;
    assigned_agent_id: string | null;
  },
  note: string,
): void {
  const t = nowMs();
  const lang = resolveLang(task.description ?? task.title);
  appendTaskLog(task.id, "system", note);
  db.prepare(
    "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?"
  ).run(t, t, task.id);
  setTaskCreationAuditCompletion(task.id, true);
  reviewRoundState.delete(task.id);
  reviewInFlight.delete(task.id);
  endTaskExecutionSession(task.id, "task_done_no_review");

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);
  broadcast("task_update", updatedTask);
  notifyTaskStatus(task.id, task.title, "done", lang);

  refreshCliUsageData().then((usage) => broadcast("cli_usage_update", usage)).catch(() => {});
  const deferTaskReport = shouldDeferTaskReportUntilPlanningArchive(task);
  if (deferTaskReport) {
    appendTaskLog(task.id, "system", "Task report popup deferred until planning consolidated archive is ready");
  } else {
    emitTaskReportEvent(task.id);
  }

  const reporter = task.assigned_agent_id
    ? (db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id) as AgentRow | undefined)
    : undefined;
  if (reporter) {
    sendAgentMessage(
      reporter,
      pickL(l(
        [`대표님, '${task.title}' 보고 업무를 검토 회의 없이 완료 처리했습니다.`],
        [`CEO, '${task.title}' report work was completed without review meeting.`],
        [`CEO、'${task.title}' の報告業務をレビュー会議なしで完了処理しました。`],
        [`CEO，'${task.title}' 报告任务已在无评审会议情况下完成。`],
      ), lang),
      "report",
      "all",
      null,
      task.id,
    );
  }

  const leader = findTeamLeader(task.department_id);
  const leaderName = leader
    ? getAgentDisplayName(leader, lang)
    : pickL(l(["팀장"], ["Team Lead"], ["チームリーダー"], ["组长"]), lang);
  notifyCeo(pickL(l(
    [`${leaderName}: '${task.title}' 보고 업무를 검토 회의 없이 마감했습니다.`],
    [`${leaderName}: '${task.title}' report task was closed without review meeting.`],
    [`${leaderName}: '${task.title}' の報告業務をレビュー会議なしでクローズしました。`],
    [`${leaderName}：'${task.title}' 报告任务已无评审会议直接关闭。`],
  ), lang), task.id);

  if (!task.source_task_id) {
    void archivePlanningConsolidatedReport(task.id);
  }

  const nextCallback = crossDeptNextCallbacks.get(task.id);
  if (nextCallback) {
    crossDeptNextCallbacks.delete(task.id);
    nextCallback();
  } else {
    recoverCrossDeptQueueAfterMissingCallback(task.id);
  }
  const subtaskNext = subtaskDelegationCallbacks.get(task.id);
  if (subtaskNext) {
    subtaskDelegationCallbacks.delete(task.id);
    subtaskNext();
  }
}

function startReportDesignCheckpoint(
  task: {
    id: string;
    title: string;
    description: string | null;
    project_id?: string | null;
    project_path: string | null;
    assigned_agent_id: string | null;
  },
): boolean {
  const lang = resolveLang(task.description ?? task.title);
  const designAgent = pickDesignCheckpointAgent();
  if (!designAgent) {
    appendTaskLog(task.id, "system", "Report design checkpoint skipped: no design agent available");
    return false;
  }

  const targetPath = extractReportPathByLabel(task.description, "Target file path");
  const researchPath = extractReportPathByLabel(task.description, "Research notes path");
  const fallbackMdPath = extractReportPathByLabel(task.description, "Fallback markdown path");
  const stampSource = targetPath || fallbackMdPath || `docs/reports/${new Date().toISOString().replace(/:/g, "-").slice(0, 16)}-report-deck.pptx`;
  const htmlWorkspaceHint = stampSource
    .replace(/-report-deck\.pptx$/i, "-slides/")
    .replace(/-report\.md$/i, "-slides/")
    .replace(/\.pptx$/i, "-slides/");
  const designHandoffPath = htmlWorkspaceHint.replace(/\/?$/, "").replace(/-slides$/i, "-design-handoff.md");

  const childTaskId = randomUUID();
  const t = nowMs();
  const designDescription = [
    `${REPORT_DESIGN_TASK_PREFIX} parent_task_id=${task.id}`,
    `${REPORT_FLOW_PREFIX} design_task=true`,
    `${REPORT_FLOW_PREFIX} design_checkpoint=single_pass`,
    "This is a report-design checkpoint task.",
    "Goal: review HTML slide sources used for PPT generation and improve visual quality where needed.",
    targetPath ? `Target PPT path: ${targetPath}` : "",
    `HTML workspace hint: ${htmlWorkspaceHint}`,
    researchPath ? `Research notes path: ${researchPath}` : "",
    fallbackMdPath ? `Fallback markdown path: ${fallbackMdPath}` : "",
    `Design handoff note path: ${designHandoffPath}`,
    "",
    "Rules:",
    "- Focus only on design quality and slide readability.",
    "- If HTML slide files exist, edit them directly and document changed files + rationale in handoff note.",
    "- If no HTML source exists, write clear recommendations and conversion guidance in handoff note.",
    "- Do not run final PPT submission; original report assignee will regenerate final PPT after your handoff.",
  ].filter(Boolean).join("\n");

  db.prepare(`
    INSERT INTO tasks (id, title, description, department_id, assigned_agent_id, project_id, status, priority, task_type, project_path, source_task_id, created_at, updated_at)
    VALUES (?, ?, ?, 'design', ?, ?, 'planned', 1, 'design', ?, ?, ?, ?)
  `).run(
    childTaskId,
    `[디자인 컨펌] ${task.title.length > 48 ? `${task.title.slice(0, 45).trimEnd()}...` : task.title}`,
    designDescription,
    designAgent.id,
    task.project_id ?? null,
    task.project_path ?? null,
    task.id,
    t,
    t,
  );
  recordTaskCreationAudit({
    taskId: childTaskId,
    taskTitle: `[디자인 컨펌] ${task.title.length > 48 ? `${task.title.slice(0, 45).trimEnd()}...` : task.title}`,
    taskStatus: "planned",
    departmentId: "design",
    assignedAgentId: designAgent.id,
    sourceTaskId: task.id,
    taskType: "design",
    projectPath: task.project_path ?? null,
    trigger: "workflow.report_design_checkpoint",
    triggerDetail: `parent_task=${task.id}`,
    actorType: "agent",
    actorId: designAgent.id,
    actorName: designAgent.name,
    body: {
      parent_task_id: task.id,
      html_workspace_hint: htmlWorkspaceHint,
      design_handoff_path: designHandoffPath,
    },
  });
  if (task.project_id) {
    db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(t, t, task.project_id);
  }

  const parentDescription = upsertReportFlowValue(
    upsertReportFlowValue(
      upsertReportFlowValue(
        upsertReportFlowValue(task.description, "design_review", "in_progress"),
        "final_regen", "pending",
      ),
      "html_workspace", htmlWorkspaceHint,
    ),
    "design_handoff_note", designHandoffPath,
  );
  db.prepare("UPDATE tasks SET status = 'pending', description = ?, updated_at = ? WHERE id = ?")
    .run(parentDescription, t, task.id);

  appendTaskLog(task.id, "system", `Status → pending (design checkpoint in progress by ${designAgent.name})`);
  appendTaskLog(task.id, "system", `Design checkpoint task created: ${childTaskId}`);
  broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id));
  broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(childTaskId));
  notifyTaskStatus(task.id, task.title, "pending", lang);

  notifyCeo(pickL(l(
    [`[REPORT FLOW] '${task.title}' 디자인 컨펌 1차를 위해 디자인팀(${designAgent.name})에게 HTML 점검 태스크를 위임했습니다.`],
    [`[REPORT FLOW] Delegated one-pass HTML design checkpoint for '${task.title}' to Design (${designAgent.name}).`],
    [`[REPORT FLOW] '${task.title}' の1回目デザイン確認として、Design (${designAgent.name}) にHTML点検タスクを委任しました。`],
    [`[REPORT FLOW] 已将 '${task.title}' 的一次性 HTML 设计确认任务委派给设计团队（${designAgent.name}）。`],
  ), lang), task.id);

  setTimeout(() => {
    const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(childTaskId) as { status: string } | undefined;
    if (!row || row.status !== "planned") return;
    startTaskExecutionForAgent(childTaskId, designAgent, "design", getDeptName("design"));
  }, randomDelay(700, 1400));

  return true;
}

function resumeReportAfterDesignCheckpoint(
  parentTaskId: string,
  triggerTaskId: string,
): void {
  const parent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(parentTaskId) as {
    id: string;
    title: string;
    description: string | null;
    status: string;
    assigned_agent_id: string | null;
    department_id: string | null;
  } | undefined;
  if (!parent) return;
  if (!parent.assigned_agent_id) return;
  if (!["pending", "planned", "collaborating", "review"].includes(parent.status)) return;

  const assignee = db.prepare("SELECT * FROM agents WHERE id = ?").get(parent.assigned_agent_id) as AgentRow | undefined;
  if (!assignee) return;
  if (assignee.status === "working" && assignee.current_task_id && assignee.current_task_id !== parent.id) {
    appendTaskLog(parent.id, "system", `Final regeneration delayed: assignee ${assignee.name} is busy on ${assignee.current_task_id}`);
    notifyCeo(
      pickL(l(
        [`[REPORT FLOW] '${parent.title}' 최종 재생성은 담당자 ${assignee.name}가 현재 다른 작업(${assignee.current_task_id})을 수행 중이라 대기합니다.`],
        [`[REPORT FLOW] Final regeneration for '${parent.title}' is waiting because assignee ${assignee.name} is busy with another task (${assignee.current_task_id}).`],
        [`[REPORT FLOW] '${parent.title}' の最終再生成は、担当者 ${assignee.name} が別タスク(${assignee.current_task_id})を実行中のため待機します。`],
        [`[REPORT FLOW] '${parent.title}' 最终重生成需等待，因负责人 ${assignee.name} 正在处理其他任务（${assignee.current_task_id}）。`],
      ), resolveLang(parent.description ?? parent.title)),
      parent.id,
    );
    return;
  }

  const nextDescription = upsertReportFlowValue(
    upsertReportFlowValue(parent.description, "design_review", "done"),
    "final_regen", "ready",
  );
  const htmlWorkspace = readReportFlowValue(nextDescription, "html_workspace");
  const handoffNotePath = readReportFlowValue(nextDescription, "design_handoff_note");
  db.prepare("UPDATE tasks SET description = ?, status = 'planned', updated_at = ? WHERE id = ?")
    .run(nextDescription, nowMs(), parent.id);
  appendTaskLog(
    parent.id,
    "system",
    `Design checkpoint completed by ${triggerTaskId}; final PPT regeneration scheduled${handoffNotePath ? ` (handoff: ${handoffNotePath})` : ""}`,
  );
  broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(parent.id));

  const lang = resolveLang(parent.description ?? parent.title);
  notifyCeo(pickL(l(
    [`[REPORT FLOW] 디자인팀 1차 컨펌이 완료되어 '${parent.title}' 최종 PPT 재생성을 시작합니다. 이번 실행 완료 시 2차 컨펌 없이 마감합니다.${htmlWorkspace ? ` HTML 작업 경로: ${htmlWorkspace}.` : ""}${handoffNotePath ? ` 핸드오프 노트: ${handoffNotePath}.` : ""}`],
    [`[REPORT FLOW] Design checkpoint is complete; restarting final PPT regeneration for '${parent.title}'. This run will close without a second design approval.${htmlWorkspace ? ` HTML workspace: ${htmlWorkspace}.` : ""}${handoffNotePath ? ` Handoff note: ${handoffNotePath}.` : ""}`],
    [`[REPORT FLOW] デザイン確認が完了したため、'${parent.title}' の最終PPT再生成を再開します。今回は2次確認なしでクローズします。${htmlWorkspace ? ` HTML作業パス: ${htmlWorkspace}。` : ""}${handoffNotePath ? ` 引き継ぎノート: ${handoffNotePath}。` : ""}`],
    [`[REPORT FLOW] 设计确认已完成，开始重新生成 '${parent.title}' 的最终 PPT。本轮完成后将不再进行二次确认。${htmlWorkspace ? ` HTML 工作路径：${htmlWorkspace}。` : ""}${handoffNotePath ? ` 交接说明：${handoffNotePath}。` : ""}`],
  ), lang), parent.id);

  setTimeout(() => {
    const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(parent.id) as { status: string } | undefined;
    if (!row || row.status !== "planned") return;
    const deptId = assignee.department_id || parent.department_id || "planning";
    startTaskExecutionForAgent(parent.id, assignee, deptId, getDeptName(deptId));
  }, randomDelay(700, 1300));
}

function startProgressTimer(taskId: string, taskTitle: string, departmentId: string | null): void {
  // Send progress report every 5min for long-running tasks
  const timer = setInterval(() => {
    const currentTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
    if (!currentTask || currentTask.status !== "in_progress") {
      clearInterval(timer);
      progressTimers.delete(taskId);
      return;
    }
    const leader = findTeamLeader(departmentId);
    if (leader) {
      const lang = resolveLang(taskTitle);
      sendAgentMessage(
        leader,
        pickL(l(
          [`대표님, '${taskTitle}' 작업 진행 중입니다. 현재 순조롭게 진행되고 있어요.`],
          [`CEO, '${taskTitle}' is in progress and currently going smoothly.`],
          [`CEO、'${taskTitle}' は進行中で、現在は順調です。`],
          [`CEO，'${taskTitle}' 正在进行中，目前进展顺利。`],
        ), lang),
        "report",
        "all",
        null,
        taskId,
      );
    }
  }, 300_000);
  progressTimers.set(taskId, timer);
}

function stopProgressTimer(taskId: string): void {
  const timer = progressTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    progressTimers.delete(taskId);
  }
}

// ---------------------------------------------------------------------------
// Send CEO notification for all significant workflow events (B4)
// ---------------------------------------------------------------------------
function notifyCeo(content: string, taskId: string | null = null, messageType: string = "status_update"): void {
  const msgId = randomUUID();
  const t = nowMs();
  db.prepare(
    `INSERT INTO messages (id, sender_type, sender_id, receiver_type, receiver_id, content, message_type, task_id, created_at)
     VALUES (?, 'system', NULL, 'all', NULL, ?, ?, ?, ?)`
  ).run(msgId, content, messageType, taskId, t);
  broadcast("new_message", {
    id: msgId,
    sender_type: "system",
    content,
    message_type: messageType,
    task_id: taskId,
    created_at: t,
  });
}

function cleanArchiveText(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "";
  const normalized = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\u001b\[[0-9;]*m/g, "");
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^{"type":/i.test(line)) return false;
      if (/^{"id":"item_/i.test(line)) return false;
      if (/"type":"(item\.completed|command_execution|reasoning|agent_message|item\.started|item\.in_progress)"/i.test(line)) return false;
      if (/"aggregated_output"|\"exit_code\"|\"session_id\"|\"total_cost_usd\"|\"usage\"/i.test(line)) return false;
      if (/^\(Use `node --trace-warnings/i.test(line)) return false;
      if (/^command\s+["'`]/i.test(line)) return false;
      if (/^\[[A-Za-z-]+\]\s+/.test(line) && line.includes("listening on http://")) return false;
      return true;
    });
  const text = lines.join("\n").replace(/[ \t]+\n/g, "\n").trim();
  return text;
}

function clipArchiveText(value: unknown, maxChars = 1800): string {
  const text = cleanArchiveText(value);
  if (!text) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function buildFallbackPlanningArchive(
  rootTask: Record<string, unknown>,
  entries: Array<Record<string, unknown>>,
  lang: string,
): string {
  const header = pickL(l(
    [`# ${rootTask.title ?? "프로젝트"} 최종 취합 보고서`],
    [`# Final Consolidated Report: ${rootTask.title ?? "Project"}`],
    [`# 最終統合レポート: ${rootTask.title ?? "プロジェクト"}`],
    [`# 最终汇总报告：${rootTask.title ?? "项目"}`],
  ), lang);
  const summaryTitle = pickL(l(
    ["## 요약"],
    ["## Executive Summary"],
    ["## 要約"],
    ["## 执行摘要"],
  ), lang);
  const teamTitle = pickL(l(
    ["## 팀별 취합"],
    ["## Team Consolidation"],
    ["## チーム別統合"],
    ["## 团队汇总"],
  ), lang);
  const lines = [
    header,
    "",
    summaryTitle,
    pickL(l(
      ["프로젝트 완료 기준으로 팀별 결과를 취합했습니다. 아래 섹션에서 팀별 최신 보고/결과 스니펫을 확인하세요."],
      ["Compiled team outputs at project completion. See the sections below for latest team report/result snippets."],
      ["プロジェクト完了時点でチーム成果を統合しました。以下で各チームの最新報告/結果要約を確認してください。"],
      ["已在项目完成时汇总各团队产出。请在下方查看各团队最新报告/结果摘要。"],
    ), lang),
    "",
    teamTitle,
    "",
  ];
  entries.forEach((entry, idx) => {
    const dept = String(entry.dept_name ?? entry.department_id ?? "-");
    const agent = String(entry.agent_name ?? "-");
    const status = String(entry.status ?? "-");
    const completedAt = Number(entry.completed_at ?? 0);
    const latestReport = String(entry.latest_report ?? "");
    const resultSnippet = String(entry.result_snippet ?? "");
    lines.push(`### ${idx + 1}. ${entry.title ?? "Task"}`);
    lines.push(`- Department: ${dept}`);
    lines.push(`- Agent: ${agent}`);
    lines.push(`- Status: ${status}`);
    lines.push(`- Completed: ${completedAt > 0 ? new Date(completedAt).toISOString() : "-"}`);
    lines.push(`- Latest report: ${latestReport || "-"}`);
    lines.push(`- Result snippet: ${resultSnippet || "-"}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

async function archivePlanningConsolidatedReport(rootTaskId: string): Promise<void> {
  try {
    const rootTask = db.prepare(`
      SELECT id, title, description, project_path, completed_at, department_id
      FROM tasks
      WHERE id = ?
    `).get(rootTaskId) as {
      id: string;
      title: string;
      description: string | null;
      project_path: string | null;
      completed_at: number | null;
      department_id: string | null;
    } | undefined;
    if (!rootTask) return;

    const planningLeader = findTeamLeader("planning") || findTeamLeader(rootTask.department_id ?? "");
    if (!planningLeader) return;

    const relatedTasks = db.prepare(`
      SELECT t.id, t.title, t.status, t.department_id, t.assigned_agent_id, t.result, t.completed_at,
             COALESCE(a.name, '') AS agent_name,
             COALESCE(a.name_ko, '') AS agent_name_ko,
             COALESCE(d.name, '') AS dept_name,
             COALESCE(d.name_ko, '') AS dept_name_ko
      FROM tasks t
      LEFT JOIN agents a ON a.id = t.assigned_agent_id
      LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ? OR t.source_task_id = ?
      ORDER BY CASE WHEN t.id = ? THEN 0 ELSE 1 END, t.created_at ASC
    `).all(rootTaskId, rootTaskId, rootTaskId) as Array<Record<string, unknown>>;
    if (!relatedTasks.length) return;

    const entries = relatedTasks.map((task) => {
      const latestReport = db.prepare(`
        SELECT m.content, m.created_at
        FROM messages m
        WHERE m.task_id = ? AND m.message_type = 'report'
          AND m.content NOT LIKE '%최종 취합본을 생성해 아카이빙%'
          AND m.content NOT LIKE '%consolidated final report has been generated and archived%'
          AND m.content NOT LIKE '%最終統合レポートを生成し、アーカイブ%'
          AND m.content NOT LIKE '%最终汇总报告已生成并归档%'
        ORDER BY m.created_at DESC
        LIMIT 1
      `).get(task.id) as { content: string; created_at: number } | undefined;
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        department_id: task.department_id,
        dept_name: task.dept_name,
        agent_name: task.agent_name,
        completed_at: task.completed_at,
        latest_report: clipArchiveText(latestReport?.content ?? "", 0),
        result_snippet: clipArchiveText(task.result ?? "", 0),
      };
    });

    const lang = resolveLang(rootTask.description ?? rootTask.title);
    const projectPath = rootTask.project_path || process.cwd();
    const evidenceBlock = entries.map((entry, idx) => [
      `### ${idx + 1}. ${entry.title ?? "Task"}`,
      `- Department: ${entry.dept_name || entry.department_id || "-"}`,
      `- Agent: ${entry.agent_name || "-"}`,
      `- Status: ${entry.status || "-"}`,
      `- Latest report: ${entry.latest_report || "-"}`,
      `- Result snippet: ${entry.result_snippet || "-"}`,
    ].join("\n")).join("\n\n");

    const consolidationPrompt = [
      `You are the planning lead (${planningLeader.name}).`,
      `Create one final consolidated markdown report for the CEO in language: ${lang}.`,
      "Requirements:",
      "- Must be concrete, not generic.",
      "- Include: Executive Summary, Team-by-team Consolidation, Evidence & Logs, Risks, Final Approval Note.",
      "- Mention all participating teams/tasks from the source.",
      "- Output only markdown.",
      `Project title: ${rootTask.title}`,
      `Project root task id: ${rootTaskId}`,
      "",
      "Source material:",
      evidenceBlock,
    ].join("\n");

    let summaryMarkdown = "";
    try {
      const run = await runAgentOneShot(planningLeader, consolidationPrompt, {
        projectPath,
        timeoutMs: 45_000,
      });
      summaryMarkdown = cleanArchiveText(normalizeConversationReply(run.text || "", 12_000, { maxSentences: 0 }).trim());
    } catch {
      summaryMarkdown = "";
    }

    if (!summaryMarkdown || summaryMarkdown.length < 240) {
      summaryMarkdown = buildFallbackPlanningArchive(rootTask as Record<string, unknown>, entries, lang);
    }
    const evidenceHeader = pickL(l(
      ["## 취합 근거 스냅샷"],
      ["## Consolidation Evidence Snapshot"],
      ["## 統合エビデンス概要"],
      ["## 汇总证据快照"],
    ), lang);
    const hasEvidenceHeader = summaryMarkdown.includes(evidenceHeader);
    if (!hasEvidenceHeader) {
      const evidenceLines = entries.map((entry, idx) => {
        const dept = String(entry.dept_name || entry.department_id || "-");
        const agent = String(entry.agent_name || "-");
        const latestReport = cleanArchiveText(entry.latest_report ?? "");
        const resultSnippet = cleanArchiveText(entry.result_snippet ?? "");
        return [
          `### ${idx + 1}. ${entry.title ?? "Task"}`,
          `- Department: ${dept}`,
          `- Agent: ${agent}`,
          `- Status: ${entry.status || "-"}`,
          `- Latest report: ${latestReport || "-"}`,
          `- Result snippet: ${resultSnippet || "-"}`,
        ].join("\n");
      }).join("\n\n");
      summaryMarkdown = `${summaryMarkdown}\n\n${evidenceHeader}\n\n${evidenceLines}`.trim();
    }

    const t = nowMs();
    const snapshot = JSON.stringify({
      root_task_id: rootTaskId,
      generated_at: t,
      entries,
    });
    db.prepare(`
      INSERT INTO task_report_archives (
        id, root_task_id, generated_by_agent_id, summary_markdown, source_snapshot_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_task_id) DO UPDATE SET
        generated_by_agent_id = excluded.generated_by_agent_id,
        summary_markdown = excluded.summary_markdown,
        source_snapshot_json = excluded.source_snapshot_json,
        updated_at = excluded.updated_at
    `).run(randomUUID(), rootTaskId, planningLeader.id, summaryMarkdown, snapshot, t, t);

    appendTaskLog(
      rootTaskId,
      "system",
      `Planning consolidated archive updated (${planningLeader.name}, chars=${summaryMarkdown.length})`,
    );
    sendAgentMessage(
      planningLeader,
      pickL(l(
        ["대표님, 기획팀장 최종 취합본을 생성해 아카이빙했습니다. 보고서 팝업에서 확인하실 수 있습니다."],
        ["CEO, the planning lead consolidated final report has been generated and archived. You can review it from the report popup."],
        ["CEO、企画リード最終統合レポートを生成し、アーカイブしました。レポートポップアップから確認できます。"],
        ["CEO，规划负责人最终汇总报告已生成并归档，可在报告弹窗中查看。"],
      ), lang),
      "report",
      "all",
      null,
      rootTaskId,
    );
    broadcast("task_report", { task: { id: rootTaskId } });
  } catch (err) {
    console.error("[Claw-Empire] planning archive generation error:", err);
  }
}

const workflowMeetingTools = initializeWorkflowMeetingTools(Object.assign(
  Object.create(__ctx),
  {
    progressTimers,
    reviewRoundState,
    reviewInFlight,
    meetingPresenceUntil,
    meetingSeatIndexByAgent,
    meetingPhaseByAgent,
    meetingTaskIdByAgent,
    meetingReviewDecisionByAgent,
    getTaskStatusById,
    getReviewRoundMode,
    scheduleNextReviewRound,
    startTaskExecutionForAgent,
    startProgressTimer,
    stopProgressTimer,
    notifyCeo,
  },
));
const {
  getLeadersByDepartmentIds,
  getAllActiveTeamLeaders,
  getTaskRelatedDepartmentIds,
  getTaskReviewLeaders,
  beginMeetingMinutes,
  appendMeetingMinuteEntry,
  finishMeetingMinutes,
  normalizeRevisionMemoNote,
  reserveReviewRevisionMemoItems,
  loadRecentReviewRevisionMemoItems,
  collectRevisionMemoItems,
  collectPlannedActionItems,
  appendTaskProjectMemo,
  appendTaskReviewFinalMemo,
  markAgentInMeeting,
  isAgentInMeeting,
  callLeadersToCeoOffice,
  dismissLeadersFromCeoOffice,
  emitMeetingSpeech,
  startReviewConsensusMeeting,
} = workflowMeetingTools;

function startTaskExecutionForAgent(
  taskId: string,
  execAgent: AgentRow,
  deptId: string | null,
  deptName: string,
): void {
  const execName = execAgent.name_ko || execAgent.name;
  const t = nowMs();
  db.prepare(
    "UPDATE tasks SET status = 'in_progress', assigned_agent_id = ?, started_at = ?, updated_at = ? WHERE id = ?"
  ).run(execAgent.id, t, t, taskId);
  db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(taskId, execAgent.id);
  appendTaskLog(taskId, "system", `${execName} started (approved)`);

  broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
  broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(execAgent.id));

  const provider = execAgent.cli_provider || "claude";
  if (!["claude", "codex", "gemini", "opencode", "copilot", "antigravity", "api"].includes(provider)) return;
  const executionSession = ensureTaskExecutionSession(taskId, execAgent.id, provider);

  const taskData = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as {
    title: string;
    description: string | null;
    project_id: string | null;
    project_path: string | null;
  } | undefined;
  if (!taskData) return;
  const taskLang = resolveLang(taskData.description ?? taskData.title);
  notifyTaskStatus(taskId, taskData.title, "in_progress", taskLang);

  const projPath = resolveProjectPath(taskData);
  const worktreePath = createWorktree(projPath, taskId, execAgent.name);
  const agentCwd = worktreePath || projPath;
  if (worktreePath) {
    appendTaskLog(taskId, "system", `Git worktree created: ${worktreePath} (branch: climpire/${taskId.slice(0, 8)})`);
  }
  const logFilePath = path.join(logsDir, `${taskId}.log`);
  const roleLabel = { team_leader: "Team Leader", senior: "Senior", junior: "Junior", intern: "Intern" }[execAgent.role] || execAgent.role;
  const deptConstraint = deptId ? getDeptRoleConstraint(deptId, deptName) : "";
  const conversationCtx = getRecentConversationContext(execAgent.id);
  const continuationCtx = getTaskContinuationContext(taskId);
  const recentChanges = getRecentChanges(projPath, taskId);
  if (worktreePath && provider === "claude") {
    ensureClaudeMd(projPath, worktreePath);
  }
  const continuationInstruction = continuationCtx
    ? pickL(l(
      ["연속 실행: 소유 컨텍스트를 유지하고 인사/착수 멘트 없이 미해결 검토 항목을 즉시 반영하세요."],
      ["Continuation run: keep ownership, skip greetings/kickoff narration, and execute unresolved review items immediately."],
      ["継続実行: オーナーシップを維持し、挨拶/開始ナレーションなしで未解決レビュー項目を即時反映してください。"],
      ["连续执行：保持责任上下文，跳过问候/开场说明，立即处理未解决评审项。"],
    ), taskLang)
    : pickL(l(
      ["긴 서론 없이 바로 실행하고, 메시지는 간결하게 유지하세요."],
      ["Execute directly without long preamble and keep messages concise."],
      ["長い前置きなしで直ちに実行し、メッセージは簡潔にしてください。"],
      ["无需冗长前言，直接执行并保持消息简洁。"],
    ), taskLang);
  const runInstruction = pickL(l(
    ["위 작업을 충분히 완수하세요. 필요 시 연속 실행 요약과 대화 맥락을 참고하세요."],
    ["Please complete the task above thoroughly. Use the continuation brief and conversation context above if relevant."],
    ["上記タスクを丁寧に完了してください。必要に応じて継続要約と会話コンテキストを参照してください。"],
    ["请完整地完成上述任务。可按需参考连续执行摘要与会话上下文。"],
  ), taskLang);
  const availableSkillsPromptBlock = buildAvailableSkillsPromptBlock(provider);
  const spawnPrompt = buildTaskExecutionPrompt([
    availableSkillsPromptBlock,
    `[Task Session] id=${executionSession.sessionId} owner=${executionSession.agentId} provider=${executionSession.provider}`,
    "This session is scoped to this task only. Keep context continuity inside this task session and do not mix with other projects.",
    recentChanges ? `[Recent Changes]\n${recentChanges}` : "",
    `[Task] ${taskData.title}`,
    taskData.description ? `\n${taskData.description}` : "",
    continuationCtx,
    conversationCtx,
    `\n---`,
    `Agent: ${execAgent.name} (${roleLabel}, ${deptName})`,
    execAgent.personality ? `Personality: ${execAgent.personality}` : "",
    deptConstraint,
    worktreePath ? `NOTE: You are working in an isolated Git worktree branch (climpire/${taskId.slice(0, 8)}). Commit your changes normally.` : "",
    continuationInstruction,
    runInstruction,
  ], {
    allowWarningFix: hasExplicitWarningFixRequest(taskData.title, taskData.description),
  });

  appendTaskLog(taskId, "system", `RUN start (agent=${execAgent.name}, provider=${provider})`);
  if (provider === "api") {
    const controller = new AbortController();
    const fakePid = -(++httpAgentCounter);
    launchApiProviderAgent(
      taskId,
      execAgent.api_provider_id ?? null,
      execAgent.api_model ?? null,
      spawnPrompt,
      agentCwd,
      logFilePath,
      controller,
      fakePid,
    );
  } else if (provider === "copilot" || provider === "antigravity") {
    const controller = new AbortController();
    const fakePid = -(++httpAgentCounter);
    launchHttpAgent(
      taskId,
      provider,
      spawnPrompt,
      agentCwd,
      logFilePath,
      controller,
      fakePid,
      execAgent.oauth_account_id ?? null,
    );
  } else {
    const modelConfig = getProviderModelConfig();
    const modelForProvider = modelConfig[provider]?.model || undefined;
    const reasoningLevel = modelConfig[provider]?.reasoningLevel || undefined;
    const child = spawnCliAgent(taskId, provider, spawnPrompt, agentCwd, logFilePath, modelForProvider, reasoningLevel);
    child.on("close", (code) => {
      handleTaskRunComplete(taskId, code ?? 1);
    });
  }

  const worktreeNote = worktreePath
    ? pickL(l(
      [` (격리 브랜치: climpire/${taskId.slice(0, 8)})`],
      [` (isolated branch: climpire/${taskId.slice(0, 8)})`],
      [` (分離ブランチ: climpire/${taskId.slice(0, 8)})`],
      [`（隔离分支: climpire/${taskId.slice(0, 8)}）`],
    ), taskLang)
    : "";
  notifyCeo(pickL(l(
    [`${execName}가 '${taskData.title}' 작업을 시작했습니다.${worktreeNote}`],
    [`${execName} started work on '${taskData.title}'.${worktreeNote}`],
    [`${execName}が '${taskData.title}' の作業を開始しました。${worktreeNote}`],
    [`${execName} 已开始处理 '${taskData.title}'。${worktreeNote}`],
  ), taskLang), taskId);
  startProgressTimer(taskId, taskData.title, deptId);
}

function startPlannedApprovalMeeting(
  taskId: string,
  taskTitle: string,
  departmentId: string | null,
  onApproved: (planningNotes?: string[]) => void,
): void {
  const lockKey = `planned:${taskId}`;
  if (reviewInFlight.has(lockKey)) {
    return;
  }
  reviewInFlight.add(lockKey);

  void (async () => {
    let meetingId: string | null = null;
    const leaders = getTaskReviewLeaders(taskId, departmentId);
    if (leaders.length === 0) {
      reviewInFlight.delete(lockKey);
      onApproved([]);
      return;
    }
    try {
      const round = (reviewRoundState.get(lockKey) ?? 0) + 1;
      reviewRoundState.set(lockKey, round);

      const planningLeader = leaders.find((l) => l.department_id === "planning") ?? leaders[0];
      const otherLeaders = leaders.filter((l) => l.id !== planningLeader.id);
      let hasSupplementSignals = false;
      const seatIndexByAgent = new Map(leaders.slice(0, 6).map((leader, idx) => [leader.id, idx]));

      const taskCtx = db.prepare(
        "SELECT description, project_path FROM tasks WHERE id = ?"
      ).get(taskId) as { description: string | null; project_path: string | null } | undefined;
      const taskDescription = taskCtx?.description ?? null;
      const projectPath = resolveProjectPath({
        title: taskTitle,
        description: taskDescription,
        project_path: taskCtx?.project_path ?? null,
      });
      const lang = resolveLang(taskDescription ?? taskTitle);
      const transcript: MeetingTranscriptEntry[] = [];
      const oneShotOptions = { projectPath, timeoutMs: 35_000 };
      const wantsRevision = (content: string): boolean => (
        /보완|수정|보류|리스크|추가.?필요|hold|revise|revision|required|pending|risk|block|保留|修正|补充|暂缓/i
      ).test(content);
      meetingId = beginMeetingMinutes(taskId, "planned", round, taskTitle);
      let minuteSeq = 1;
      const abortIfInactive = (): boolean => {
        if (!isTaskWorkflowInterrupted(taskId)) return false;
        const status = getTaskStatusById(taskId);
        if (meetingId) finishMeetingMinutes(meetingId, "failed");
        dismissLeadersFromCeoOffice(taskId, leaders);
        clearTaskWorkflowState(taskId);
        if (status) {
          appendTaskLog(taskId, "system", `Planned meeting aborted due to task state change (${status})`);
        }
        return true;
      };

      const pushTranscript = (leader: AgentRow, content: string) => {
        transcript.push({
          speaker_agent_id: leader.id,
          speaker: getAgentDisplayName(leader, lang),
          department: getDeptName(leader.department_id ?? ""),
          role: getRoleLabel(leader.role, lang as Lang),
          content,
        });
      };
      const speak = (leader: AgentRow, messageType: string, receiverType: string, receiverId: string | null, content: string) => {
        if (isTaskWorkflowInterrupted(taskId)) return;
        sendAgentMessage(leader, content, messageType, receiverType, receiverId, taskId);
        const seatIndex = seatIndexByAgent.get(leader.id) ?? 0;
        emitMeetingSpeech(leader.id, seatIndex, "kickoff", taskId, content, lang);
        pushTranscript(leader, content);
        if (meetingId) {
          appendMeetingMinuteEntry(meetingId, minuteSeq++, leader, lang, messageType, content);
        }
      };

      if (abortIfInactive()) return;
      callLeadersToCeoOffice(taskId, leaders, "kickoff");
      notifyCeo(pickL(l(
        [`[CEO OFFICE] '${taskTitle}' Planned 계획 라운드 ${round} 시작. 부서별 보완점 수집 후 실행계획(SubTask)으로 정리합니다.`],
        [`[CEO OFFICE] '${taskTitle}' planned round ${round} started. Collecting supplement points and turning them into executable subtasks.`],
        [`[CEO OFFICE] '${taskTitle}' のPlanned計画ラウンド${round}を開始。補完項目を収集し、実行SubTaskへ落とし込みます。`],
        [`[CEO OFFICE] 已开始'${taskTitle}'第${round}轮 Planned 规划，正在收集补充点并转为可执行 SubTask。`],
      ), lang), taskId);

      const openingPrompt = buildMeetingPrompt(planningLeader, {
        meetingType: "planned",
        round,
        taskTitle,
        taskDescription,
        transcript,
        turnObjective: "Open the planned kickoff meeting and ask each leader for concrete supplement points and planning actions.",
        stanceHint: "At Planned stage, do not block kickoff; convert concerns into executable planning items.",
        lang,
      });
      const openingRun = await runAgentOneShot(planningLeader, openingPrompt, oneShotOptions);
      if (abortIfInactive()) return;
      const openingText = chooseSafeReply(openingRun, lang, "opening", planningLeader);
      speak(planningLeader, "chat", "all", null, openingText);
      await sleepMs(randomDelay(700, 1260));
      if (abortIfInactive()) return;

      for (const leader of otherLeaders) {
        if (abortIfInactive()) return;
        const feedbackPrompt = buildMeetingPrompt(leader, {
          meetingType: "planned",
          round,
          taskTitle,
          taskDescription,
          transcript,
          turnObjective: "Share concise readiness feedback plus concrete supplement items to be planned as subtasks.",
          stanceHint: "Do not hold approval here; provide actionable plan additions with evidence/check item.",
          lang,
        });
        const feedbackRun = await runAgentOneShot(leader, feedbackPrompt, oneShotOptions);
        if (abortIfInactive()) return;
        const feedbackText = chooseSafeReply(feedbackRun, lang, "feedback", leader);
        speak(leader, "chat", "agent", planningLeader.id, feedbackText);
        if (wantsRevision(feedbackText)) {
          hasSupplementSignals = true;
        }
        await sleepMs(randomDelay(620, 1080));
        if (abortIfInactive()) return;
      }

      const summaryPrompt = buildMeetingPrompt(planningLeader, {
        meetingType: "planned",
        round,
        taskTitle,
        taskDescription,
        transcript,
        turnObjective: "Summarize supplement points and announce that they will be converted to subtasks before execution.",
        stanceHint: "Keep kickoff moving and show concrete planned next steps instead of blocking.",
        lang,
      });
      const summaryRun = await runAgentOneShot(planningLeader, summaryPrompt, oneShotOptions);
      if (abortIfInactive()) return;
      const summaryText = chooseSafeReply(summaryRun, lang, "summary", planningLeader);
      speak(planningLeader, "report", "all", null, summaryText);
      await sleepMs(randomDelay(640, 1120));
      if (abortIfInactive()) return;

      for (const leader of leaders) {
        if (abortIfInactive()) return;
        const actionPrompt = buildMeetingPrompt(leader, {
          meetingType: "planned",
          round,
          taskTitle,
          taskDescription,
          transcript,
          turnObjective: "Propose one immediate planning action item for your team in subtask style.",
          stanceHint: "State what to do next, what evidence to collect, and who owns it. Do not block kickoff at this stage.",
          lang,
        });
        const actionRun = await runAgentOneShot(leader, actionPrompt, oneShotOptions);
        if (abortIfInactive()) return;
        const actionText = chooseSafeReply(actionRun, lang, "approval", leader);
        speak(leader, "status_update", "all", null, actionText);
        if (wantsRevision(actionText)) {
          hasSupplementSignals = true;
        }
        await sleepMs(randomDelay(420, 840));
        if (abortIfInactive()) return;
      }

      await sleepMs(randomDelay(520, 900));
      if (abortIfInactive()) return;
      const planItems = collectPlannedActionItems(transcript, 10);
      appendTaskProjectMemo(taskId, "planned", round, planItems, lang);
      appendTaskLog(
        taskId,
        "system",
        `Planned meeting round ${round}: action items collected (${planItems.length}, supplement-signals=${hasSupplementSignals ? "yes" : "no"})`,
      );
      notifyCeo(pickL(l(
        [`[CEO OFFICE] '${taskTitle}' Planned 회의 종료. 보완점 ${planItems.length}건을 계획 항목으로 기록하고 In Progress로 진행합니다.`],
        [`[CEO OFFICE] Planned meeting for '${taskTitle}' is complete. Recorded ${planItems.length} improvement items and moving to In Progress.`],
        [`[CEO OFFICE] '${taskTitle}' のPlanned会議が完了。補完項目${planItems.length}件を計画化し、In Progressへ進みます。`],
        [`[CEO OFFICE] '${taskTitle}' 的 Planned 会议已结束，已记录 ${planItems.length} 个改进项并转入 In Progress。`],
      ), lang), taskId);
      if (meetingId) finishMeetingMinutes(meetingId, "completed");
      dismissLeadersFromCeoOffice(taskId, leaders);
      reviewRoundState.delete(lockKey);
      reviewInFlight.delete(lockKey);
      onApproved(planItems);
    } catch (err: any) {
      if (isTaskWorkflowInterrupted(taskId)) {
        if (meetingId) finishMeetingMinutes(meetingId, "failed");
        dismissLeadersFromCeoOffice(taskId, leaders);
        clearTaskWorkflowState(taskId);
        return;
      }
      const msg = err?.message ? String(err.message) : String(err);
      appendTaskLog(taskId, "error", `Planned meeting error: ${msg}`);
      const errLang = resolveLang(taskTitle);
      notifyCeo(pickL(l(
        [`[CEO OFFICE] '${taskTitle}' Planned 회의 처리 중 오류가 발생했습니다: ${msg}`],
        [`[CEO OFFICE] Error while processing planned meeting for '${taskTitle}': ${msg}`],
        [`[CEO OFFICE] '${taskTitle}' のPlanned会議処理中にエラーが発生しました: ${msg}`],
        [`[CEO OFFICE] 处理'${taskTitle}'的 Planned 会议时发生错误：${msg}`],
      ), errLang), taskId);
      if (meetingId) finishMeetingMinutes(meetingId, "failed");
      dismissLeadersFromCeoOffice(taskId, leaders);
      reviewInFlight.delete(lockKey);
    }
  })();
}

// ---------------------------------------------------------------------------
// Run completion handler — enhanced with review flow + CEO reporting
// ---------------------------------------------------------------------------
function handleTaskRunComplete(taskId: string, exitCode: number): void {
  activeProcesses.delete(taskId);
  stopProgressTimer(taskId);

  // Get latest task snapshot early for stop/delete race handling.
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as {
    assigned_agent_id: string | null;
    department_id: string | null;
    title: string;
    description: string | null;
    status: string;
    task_type: string | null;
    project_id: string | null;
    project_path: string | null;
    source_task_id: string | null;
  } | undefined;
  const stopRequested = stopRequestedTasks.has(taskId);
  const stopMode = stopRequestModeByTask.get(taskId);
  stopRequestedTasks.delete(taskId);
  stopRequestModeByTask.delete(taskId);

  // If task was stopped/deleted or no longer in-progress, ignore late close events.
  if (!task || stopRequested || task.status !== "in_progress") {
    if (task) {
      appendTaskLog(
        taskId,
        "system",
        `RUN completion ignored (status=${task.status}, exit=${exitCode}, stop_requested=${stopRequested ? "yes" : "no"}, stop_mode=${stopMode ?? "none"})`,
      );
    }
    const keepWorkflowForResume = stopRequested && stopMode === "pause";
    if (!keepWorkflowForResume) {
      clearTaskWorkflowState(taskId);
    }
    return;
  }

  // Clean up Codex thread→subtask mappings for this task's subtasks
  for (const [tid, itemId] of codexThreadToSubtask) {
    const row = db.prepare("SELECT id FROM subtasks WHERE cli_tool_use_id = ? AND task_id = ?").get(itemId, taskId);
    if (row) codexThreadToSubtask.delete(tid);
  }

  const t = nowMs();
  const logKind = exitCode === 0 ? "completed" : "failed";

  appendTaskLog(taskId, "system", `RUN ${logKind} (exit code: ${exitCode})`);

  // Read log file for result
  const logPath = path.join(logsDir, `${taskId}.log`);
  let result: string | null = null;
  try {
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, "utf8");
      result = raw.slice(-2000);
    }
  } catch { /* ignore */ }

  if (result) {
    db.prepare("UPDATE tasks SET result = ? WHERE id = ?").run(result, taskId);
  }

  // Auto-complete own-department subtasks on CLI success; foreign ones get delegated
  if (exitCode === 0) {
    const pendingSubtasks = db.prepare(
      "SELECT id, target_department_id FROM subtasks WHERE task_id = ? AND status != 'done'"
    ).all(taskId) as Array<{ id: string; target_department_id: string | null }>;
    if (pendingSubtasks.length > 0) {
      const now = nowMs();
      for (const sub of pendingSubtasks) {
        // Only auto-complete subtasks without a foreign department target
        if (!sub.target_department_id) {
          db.prepare(
            "UPDATE subtasks SET status = 'done', completed_at = ? WHERE id = ?"
          ).run(now, sub.id);
          const updated = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(sub.id);
          broadcast("subtask_update", updated);
        }
      }
    }
    // Trigger delegation for foreign-department subtasks
    processSubtaskDelegations(taskId);
  }

  // Update agent status back to idle
  if (task?.assigned_agent_id) {
    db.prepare(
      "UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?"
    ).run(task.assigned_agent_id);

    if (exitCode === 0) {
      db.prepare(
        "UPDATE agents SET stats_tasks_done = stats_tasks_done + 1, stats_xp = stats_xp + 10 WHERE id = ?"
      ).run(task.assigned_agent_id);
    }

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id) as Record<string, unknown> | undefined;
    broadcast("agent_status", agent);
  }

  if (exitCode === 0 && task) {
    if (isReportDesignCheckpointTask(task)) {
      const parentTaskId = extractReportDesignParentTaskId(task);
      completeTaskWithoutReview(
        {
          id: taskId,
          title: task.title,
          description: task.description,
          department_id: task.department_id,
          source_task_id: task.source_task_id,
          assigned_agent_id: task.assigned_agent_id,
        },
        "Status → done (report design checkpoint completed; review meeting skipped)",
      );
      if (parentTaskId) {
        resumeReportAfterDesignCheckpoint(parentTaskId, taskId);
      }
      return;
    }

    if (isPresentationReportTask(task)) {
      const designReview = (readReportFlowValue(task.description, "design_review") ?? "pending").toLowerCase();
      if (designReview !== "done") {
        const started = startReportDesignCheckpoint({
          id: taskId,
          title: task.title,
          description: task.description,
          project_id: task.project_id,
          project_path: task.project_path,
          assigned_agent_id: task.assigned_agent_id,
        });
        if (started) return;
        const fallbackDesc = upsertReportFlowValue(
          upsertReportFlowValue(task.description, "design_review", "skipped"),
          "final_regen", "ready",
        );
        db.prepare("UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?")
          .run(fallbackDesc, nowMs(), taskId);
      }

      completeTaskWithoutReview(
        {
          id: taskId,
          title: task.title,
          description: task.description,
          department_id: task.department_id,
          source_task_id: task.source_task_id,
          assigned_agent_id: task.assigned_agent_id,
        },
        "Status → done (report workflow: final PPT regenerated; second design confirmation skipped)",
      );
      return;
    }

    if (isReportRequestTask(task)) {
      completeTaskWithoutReview(
        {
          id: taskId,
          title: task.title,
          description: task.description,
          department_id: task.department_id,
          source_task_id: task.source_task_id,
          assigned_agent_id: task.assigned_agent_id,
        },
        "Status → done (report workflow: review meeting skipped for documentation/report task)",
      );
      return;
    }
  }

  if (exitCode === 0) {
    // ── SUCCESS: Move to 'review' for team leader check ──
    db.prepare(
      "UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?"
    ).run(t, taskId);

    appendTaskLog(taskId, "system", "Status → review (team leader review pending)");

    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    broadcast("task_update", updatedTask);
    if (task) notifyTaskStatus(taskId, task.title, "review", resolveLang(task.description ?? task.title));

    // Collaboration child tasks should wait in review until parent consolidation meeting.
    // Queue continuation is still triggered so sequential delegation does not stall.
    if (task?.source_task_id) {
      const sourceLang = resolveLang(task.description ?? task.title);
      appendTaskLog(taskId, "system", "Status → review (delegated collaboration task waiting for parent consolidation)");
      notifyCeo(pickL(l(
        [`'${task.title}' 협업 하위 태스크가 Review 대기 상태로 전환되었습니다. 상위 업무의 전체 취합 회의에서 일괄 검토/머지합니다.`],
        [`'${task.title}' collaboration child task is now waiting in Review. It will be consolidated in the parent task's single review/merge meeting.`],
        [`'${task.title}' の協業子タスクはReview待機に入りました。上位タスクの一括レビュー/マージ会議で統合処理します。`],
        [`'${task.title}' 协作子任务已进入 Review 等待。将在上级任务的一次性评审/合并会议中统一处理。`],
      ), sourceLang), taskId);

      const nextDelay = 800 + Math.random() * 600;
      const nextCallback = crossDeptNextCallbacks.get(taskId);
      if (nextCallback) {
        crossDeptNextCallbacks.delete(taskId);
        setTimeout(nextCallback, nextDelay);
      } else {
        recoverCrossDeptQueueAfterMissingCallback(taskId);
      }
      const subtaskNext = subtaskDelegationCallbacks.get(taskId);
      if (subtaskNext) {
        subtaskDelegationCallbacks.delete(taskId);
        setTimeout(subtaskNext, nextDelay);
      }
      return;
    }

    // Notify: task entering review
    if (task) {
      const lang = resolveLang(task.description ?? task.title);
      const leader = findTeamLeader(task.department_id);
      const leaderName = leader
        ? getAgentDisplayName(leader, lang)
        : pickL(l(["팀장"], ["Team Lead"], ["チームリーダー"], ["组长"]), lang);
      notifyCeo(pickL(l(
        [`${leaderName}이(가) '${task.title}' 결과를 검토 중입니다.`],
        [`${leaderName} is reviewing the result for '${task.title}'.`],
        [`${leaderName}が '${task.title}' の成果をレビュー中です。`],
        [`${leaderName} 正在审核 '${task.title}' 的结果。`],
      ), lang), taskId);
    }

    // Schedule team leader review message (2-3s delay)
    setTimeout(() => {
      if (!task) return;
      const leader = findTeamLeader(task.department_id);
      if (!leader) {
        // No team leader — auto-approve
        finishReview(taskId, task.title);
        return;
      }

      // Read the task result and pretty-parse it for the report
      let reportBody = "";
      try {
        const logFile = path.join(logsDir, `${taskId}.log`);
        if (fs.existsSync(logFile)) {
          const raw = fs.readFileSync(logFile, "utf8");
          const pretty = prettyStreamJson(raw);
          // Take the last ~500 chars of the pretty output as summary
          reportBody = pretty.length > 500 ? "..." + pretty.slice(-500) : pretty;
        }
      } catch { /* ignore */ }

      // If worktree exists, include diff summary in the report
      const wtInfo = taskWorktrees.get(taskId);
      let diffSummary = "";
      if (wtInfo) {
        diffSummary = getWorktreeDiffSummary(wtInfo.projectPath, taskId);
        if (hasVisibleDiffSummary(diffSummary)) {
          appendTaskLog(taskId, "system", `Worktree diff summary:\n${diffSummary}`);
        }
      }

      // Team leader sends completion report with actual result content + diff
      const reportLang = resolveLang(task.description ?? task.title);
      let reportContent = reportBody
        ? pickL(l(
          [`대표님, '${task.title}' 업무 완료 보고드립니다.\n\n📋 결과:\n${reportBody}`],
          [`CEO, reporting completion for '${task.title}'.\n\n📋 Result:\n${reportBody}`],
          [`CEO、'${task.title}' の完了をご報告します。\n\n📋 結果:\n${reportBody}`],
          [`CEO，汇报 '${task.title}' 已完成。\n\n📋 结果:\n${reportBody}`],
        ), reportLang)
        : pickL(l(
          [`대표님, '${task.title}' 업무 완료 보고드립니다. 작업이 성공적으로 마무리되었습니다.`],
          [`CEO, reporting completion for '${task.title}'. The work has been finished successfully.`],
          [`CEO、'${task.title}' の完了をご報告します。作業は正常に完了しました。`],
          [`CEO，汇报 '${task.title}' 已完成。任务已成功结束。`],
        ), reportLang);

      const subtaskProgressLabel = pickL(l(
        ["📌 보완/협업 진행 요약"],
        ["📌 Remediation/Collaboration Progress"],
        ["📌 補完/協業 進捗サマリー"],
        ["📌 整改/协作进度摘要"],
      ), reportLang);
      const subtaskProgress = formatTaskSubtaskProgressSummary(taskId, reportLang);
      if (subtaskProgress) {
        reportContent += `\n\n${subtaskProgressLabel}\n${subtaskProgress}`;
      }

      if (hasVisibleDiffSummary(diffSummary)) {
        reportContent += pickL(l(
          [`\n\n📝 변경사항 (branch: ${wtInfo?.branchName}):\n${diffSummary}`],
          [`\n\n📝 Changes (branch: ${wtInfo?.branchName}):\n${diffSummary}`],
          [`\n\n📝 変更点 (branch: ${wtInfo?.branchName}):\n${diffSummary}`],
          [`\n\n📝 变更内容 (branch: ${wtInfo?.branchName}):\n${diffSummary}`],
        ), reportLang);
      }

      sendAgentMessage(
        leader,
        reportContent,
        "report",
        "all",
        null,
        taskId,
      );

      // After another 2-3s: team leader approves → move to done
      setTimeout(() => {
        finishReview(taskId, task.title);
      }, 2500);
    }, 2500);

  } else {
    // ── FAILURE: Reset to inbox, team leader reports failure ──
    db.prepare(
      "UPDATE tasks SET status = 'inbox', updated_at = ? WHERE id = ?"
    ).run(t, taskId);

    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    broadcast("task_update", updatedTask);

    // Clean up worktree on failure — failed work shouldn't persist
    const failWtInfo = taskWorktrees.get(taskId);
    if (failWtInfo) {
      cleanupWorktree(failWtInfo.projectPath, taskId);
      appendTaskLog(taskId, "system", "Worktree cleaned up (task failed)");
    }

    if (task) {
      const leader = findTeamLeader(task.department_id);
      if (leader) {
        setTimeout(() => {
          // Read error output for failure report
          let errorBody = "";
          try {
            const logFile = path.join(logsDir, `${taskId}.log`);
            if (fs.existsSync(logFile)) {
              const raw = fs.readFileSync(logFile, "utf8");
              const pretty = prettyStreamJson(raw);
              errorBody = pretty.length > 300 ? "..." + pretty.slice(-300) : pretty;
            }
          } catch { /* ignore */ }

          const failLang = resolveLang(task.description ?? task.title);
          const failContent = errorBody
            ? pickL(l(
              [`대표님, '${task.title}' 작업에 문제가 발생했습니다 (종료코드: ${exitCode}).\n\n❌ 오류 내용:\n${errorBody}\n\n재배정하거나 업무 내용을 수정한 후 다시 시도해주세요.`],
              [`CEO, '${task.title}' failed with an issue (exit code: ${exitCode}).\n\n❌ Error:\n${errorBody}\n\nPlease reassign the agent or revise the task, then try again.`],
              [`CEO、'${task.title}' の処理中に問題が発生しました (終了コード: ${exitCode})。\n\n❌ エラー内容:\n${errorBody}\n\n担当再割り当てまたはタスク内容を修正して再試行してください。`],
              [`CEO，'${task.title}' 执行时发生问题（退出码：${exitCode}）。\n\n❌ 错误内容:\n${errorBody}\n\n请重新分配代理或修改任务后重试。`],
            ), failLang)
            : pickL(l(
              [`대표님, '${task.title}' 작업에 문제가 발생했습니다 (종료코드: ${exitCode}). 에이전트를 재배정하거나 업무 내용을 수정한 후 다시 시도해주세요.`],
              [`CEO, '${task.title}' failed with an issue (exit code: ${exitCode}). Please reassign the agent or revise the task, then try again.`],
              [`CEO、'${task.title}' の処理中に問題が発生しました (終了コード: ${exitCode})。担当再割り当てまたはタスク内容を修正して再試行してください。`],
              [`CEO，'${task.title}' 执行时发生问题（退出码：${exitCode}）。请重新分配代理或修改任务后重试。`],
            ), failLang);

          sendAgentMessage(
            leader,
            failContent,
            "report",
            "all",
            null,
            taskId,
          );
        }, 1500);
      }
      const failLang = resolveLang(task.description ?? task.title);
      notifyCeo(pickL(l(
        [`'${task.title}' 작업 실패 (exit code: ${exitCode}).`],
        [`Task '${task.title}' failed (exit code: ${exitCode}).`],
        [`'${task.title}' のタスクが失敗しました (exit code: ${exitCode})。`],
        [`任务 '${task.title}' 失败（exit code: ${exitCode}）。`],
      ), failLang), taskId);
    }

    // Even on failure, trigger next cross-dept cooperation so the queue doesn't stall
    const nextCallback = crossDeptNextCallbacks.get(taskId);
    if (nextCallback) {
      crossDeptNextCallbacks.delete(taskId);
      setTimeout(nextCallback, 3000);
    }

    // Even on failure, trigger next subtask delegation so the queue doesn't stall
    const subtaskNext = subtaskDelegationCallbacks.get(taskId);
    if (subtaskNext) {
      subtaskDelegationCallbacks.delete(taskId);
      setTimeout(subtaskNext, 3000);
    }
  }
}

// Move a reviewed task to 'done'
function finishReview(
  taskId: string,
  taskTitle: string,
  options?: { bypassProjectDecisionGate?: boolean; trigger?: string },
): void {
  const lang = resolveLang(taskTitle);
  const currentTask = db.prepare("SELECT status, department_id, source_task_id, project_id FROM tasks WHERE id = ?").get(taskId) as {
    status: string;
    department_id: string | null;
    source_task_id: string | null;
    project_id: string | null;
  } | undefined;
  if (!currentTask || currentTask.status !== "review") return; // Already moved or cancelled

  if (!options?.bypassProjectDecisionGate && !currentTask.source_task_id && currentTask.project_id) {
    const gateSnapshot = getProjectReviewGateSnapshot(currentTask.project_id);
    appendTaskLog(
      taskId,
      "system",
      `Review gate: waiting for project-level decision (${gateSnapshot.activeReview}/${gateSnapshot.activeTotal} active tasks in review)`,
    );
    if (gateSnapshot.ready) {
      const now = nowMs();
      const lastNotified = projectReviewGateNotifiedAt.get(currentTask.project_id) ?? 0;
      if (now - lastNotified > 30_000) {
        projectReviewGateNotifiedAt.set(currentTask.project_id, now);
        const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(currentTask.project_id) as { name: string | null } | undefined;
        const projectName = (project?.name || currentTask.project_id).trim();
        notifyCeo(pickL(l(
          [`[CEO OFFICE] 프로젝트 '${projectName}'의 활성 항목 ${gateSnapshot.activeTotal}건이 모두 Review 상태입니다. 의사결정 인박스에서 승인하면 팀장 회의를 시작합니다.`],
          [`[CEO OFFICE] Project '${projectName}' now has all ${gateSnapshot.activeTotal} active tasks in Review. Approve from Decision Inbox to start team-lead review meetings.`],
          [`[CEO OFFICE] プロジェクト'${projectName}'のアクティブタスク${gateSnapshot.activeTotal}件がすべてReviewに到達しました。Decision Inboxで承認するとチームリーダー会議を開始します。`],
          [`[CEO OFFICE] 项目'${projectName}'的 ${gateSnapshot.activeTotal} 个活跃任务已全部进入 Review。请在 Decision Inbox 批准后启动组长评审会议。`],
        ), lang), taskId);
      }
    } else {
      projectReviewGateNotifiedAt.delete(currentTask.project_id);
    }
    return;
  }
  if (options?.bypassProjectDecisionGate && currentTask.project_id) {
    projectReviewGateNotifiedAt.delete(currentTask.project_id);
    appendTaskLog(taskId, "system", `Review gate bypassed (trigger=${options.trigger ?? "manual"})`);
  }

  const remainingSubtasks = db.prepare(
    "SELECT COUNT(*) as cnt FROM subtasks WHERE task_id = ? AND status != 'done'"
  ).get(taskId) as { cnt: number };
  if (remainingSubtasks.cnt > 0) {
    notifyCeo(pickL(l(
      [`'${taskTitle}' 는 아직 ${remainingSubtasks.cnt}개 서브태스크가 남아 있어 Review 단계에서 대기합니다.`],
      [`'${taskTitle}' is waiting in Review because ${remainingSubtasks.cnt} subtasks are still unfinished.`],
      [`'${taskTitle}' は未完了サブタスクが${remainingSubtasks.cnt}件あるため、Reviewで待機しています。`],
      [`'${taskTitle}' 仍有 ${remainingSubtasks.cnt} 个 SubTask 未完成，当前在 Review 阶段等待。`],
    ), lang), taskId);
    appendTaskLog(taskId, "system", `Review hold: waiting for ${remainingSubtasks.cnt} unfinished subtasks`);
    return;
  }

  // Parent task must wait until all collaboration children reached review(done) checkpoint.
  if (!currentTask.source_task_id) {
    const childProgress = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review_cnt,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_cnt
      FROM tasks
      WHERE source_task_id = ?
    `).get(taskId) as { total: number; review_cnt: number | null; done_cnt: number | null } | undefined;
    const childTotal = childProgress?.total ?? 0;
    const childReview = childProgress?.review_cnt ?? 0;
    const childDone = childProgress?.done_cnt ?? 0;
    const childReady = childReview + childDone;
    if (childTotal > 0 && childReady < childTotal) {
      const waiting = childTotal - childReady;
      notifyCeo(pickL(l(
        [`'${taskTitle}' 는 협업 하위 태스크 ${waiting}건이 아직 Review 진입 전이라 전체 팀장회의를 대기합니다.`],
        [`'${taskTitle}' is waiting for ${waiting} collaboration child task(s) to reach review before the single team-lead meeting starts.`],
        [`'${taskTitle}' は協業子タスク${waiting}件がまだReview未到達のため、全体チームリーダー会議を待機しています。`],
        [`'${taskTitle}' 仍有 ${waiting} 个协作子任务尚未进入 Review，当前等待后再开启一次团队负责人会议。`],
      ), lang), taskId);
      appendTaskLog(taskId, "system", `Review hold: waiting for collaboration children to reach review (${childReady}/${childTotal})`);
      return;
    }
  }

  const finalizeApprovedReview = () => {
    const t = nowMs();
    const latestTask = db.prepare("SELECT status, department_id FROM tasks WHERE id = ?").get(taskId) as { status: string; department_id: string | null } | undefined;
    if (!latestTask || latestTask.status !== "review") return;

    // If task has a worktree, merge the branch back before marking done
    const wtInfo = taskWorktrees.get(taskId);
    let mergeNote = "";
    if (wtInfo) {
      const mergeResult = mergeWorktree(wtInfo.projectPath, taskId);

      if (mergeResult.success) {
        appendTaskLog(taskId, "system", `Git merge completed: ${mergeResult.message}`);
        cleanupWorktree(wtInfo.projectPath, taskId);
        appendTaskLog(taskId, "system", "Worktree cleaned up after successful merge");
        mergeNote = pickL(l(
          [" (병합 완료)"],
          [" (merged)"],
          [" (マージ完了)"],
          ["（已合并）"],
        ), lang);
      } else {
        appendTaskLog(taskId, "system", `Git merge failed: ${mergeResult.message}`);

        const conflictLeader = findTeamLeader(latestTask.department_id);
        const conflictLeaderName = conflictLeader
          ? getAgentDisplayName(conflictLeader, lang)
          : pickL(l(["팀장"], ["Team Lead"], ["チームリーダー"], ["组长"]), lang);
        const conflictFiles = mergeResult.conflicts?.length
          ? pickL(l(
            [`\n충돌 파일: ${mergeResult.conflicts.join(", ")}`],
            [`\nConflicting files: ${mergeResult.conflicts.join(", ")}`],
            [`\n競合ファイル: ${mergeResult.conflicts.join(", ")}`],
            [`\n冲突文件: ${mergeResult.conflicts.join(", ")}`],
          ), lang)
          : "";
        notifyCeo(
          pickL(l(
            [`${conflictLeaderName}: '${taskTitle}' 병합 중 충돌이 발생했습니다. 수동 해결이 필요합니다.${conflictFiles}\n브랜치: ${wtInfo.branchName}`],
            [`${conflictLeaderName}: Merge conflict while merging '${taskTitle}'. Manual resolution is required.${conflictFiles}\nBranch: ${wtInfo.branchName}`],
            [`${conflictLeaderName}: '${taskTitle}' のマージ中に競合が発生しました。手動解決が必要です。${conflictFiles}\nブランチ: ${wtInfo.branchName}`],
            [`${conflictLeaderName}：合并 '${taskTitle}' 时发生冲突，需要手动解决。${conflictFiles}\n分支: ${wtInfo.branchName}`],
          ), lang),
          taskId,
        );

        mergeNote = pickL(l(
          [" (병합 충돌 - 수동 해결 필요)"],
          [" (merge conflict - manual resolution required)"],
          [" (マージ競合 - 手動解決が必要)"],
          ["（合并冲突 - 需要手动解决）"],
        ), lang);
      }
    }

    db.prepare(
      "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?"
    ).run(t, t, taskId);
    setTaskCreationAuditCompletion(taskId, true);

    appendTaskLog(taskId, "system", "Status → done (all leaders approved)");
    endTaskExecutionSession(taskId, "task_done");

    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    broadcast("task_update", updatedTask);
    notifyTaskStatus(taskId, taskTitle, "done", lang);

    refreshCliUsageData().then((usage) => broadcast("cli_usage_update", usage)).catch(() => {});
    const deferTaskReport = shouldDeferTaskReportUntilPlanningArchive(currentTask);
    if (deferTaskReport) {
      appendTaskLog(taskId, "system", "Task report popup deferred until planning consolidated archive is ready");
    } else {
      emitTaskReportEvent(taskId);
    }

    const leader = findTeamLeader(latestTask.department_id);
    const leaderName = leader
      ? getAgentDisplayName(leader, lang)
      : pickL(l(["팀장"], ["Team Lead"], ["チームリーダー"], ["组长"]), lang);
    const subtaskProgressSummary = formatTaskSubtaskProgressSummary(taskId, lang);
    const progressSuffix = subtaskProgressSummary
      ? `\n${pickL(l(["보완/협업 완료 현황"], ["Remediation/Collaboration completion"], ["補完/協業 完了状況"], ["整改/协作完成情况"]), lang)}\n${subtaskProgressSummary}`
      : "";
    notifyCeo(pickL(l(
      [`${leaderName}: '${taskTitle}' 최종 승인 완료 보고드립니다.${mergeNote}${progressSuffix}`],
      [`${leaderName}: Final approval completed for '${taskTitle}'.${mergeNote}${progressSuffix}`],
      [`${leaderName}: '${taskTitle}' の最終承認が完了しました。${mergeNote}${progressSuffix}`],
      [`${leaderName}：'${taskTitle}' 最终审批已完成。${mergeNote}${progressSuffix}`],
    ), lang), taskId);

    reviewRoundState.delete(taskId);
    reviewInFlight.delete(taskId);

    // Parent final approval is the merge point for collaboration children in review.
    if (!currentTask.source_task_id) {
      const childRows = db.prepare(
        "SELECT id, title FROM tasks WHERE source_task_id = ? AND status = 'review' ORDER BY created_at ASC"
      ).all(taskId) as Array<{ id: string; title: string }>;
      if (childRows.length > 0) {
        appendTaskLog(taskId, "system", `Finalization: closing ${childRows.length} collaboration child task(s) after parent review`);
        for (const child of childRows) {
          finishReview(child.id, child.title);
        }
      }
      // Generate and archive one consolidated project report via planning leader model.
      void archivePlanningConsolidatedReport(taskId);
    }

    const nextCallback = crossDeptNextCallbacks.get(taskId);
    if (nextCallback) {
      crossDeptNextCallbacks.delete(taskId);
      nextCallback();
    } else {
      // pause/resume or restart can drop in-memory callback chain; reconstruct from DB when possible
      recoverCrossDeptQueueAfterMissingCallback(taskId);
    }

    const subtaskNext = subtaskDelegationCallbacks.get(taskId);
    if (subtaskNext) {
      subtaskDelegationCallbacks.delete(taskId);
      subtaskNext();
    }
  };

  if (currentTask.source_task_id) {
    appendTaskLog(taskId, "system", "Review consensus skipped for delegated collaboration task");
    finalizeApprovedReview();
    return;
  }

  startReviewConsensusMeeting(taskId, taskTitle, currentTask.department_id, finalizeApprovedReview);
}

  return {
    crossDeptNextCallbacks,
    subtaskDelegationCallbacks,
    subtaskDelegationDispatchInFlight,
    delegatedTaskToSubtask,
    subtaskDelegationCompletionNoticeSent,
    meetingPresenceUntil,
    meetingSeatIndexByAgent,
    meetingPhaseByAgent,
    meetingTaskIdByAgent,
    meetingReviewDecisionByAgent,
    taskExecutionSessions,
    ensureTaskExecutionSession,
    endTaskExecutionSession,
    isTaskWorkflowInterrupted,
    clearTaskWorkflowState,
    startProgressTimer,
    stopProgressTimer,
    notifyCeo,
    archivePlanningConsolidatedReport,
    isAgentInMeeting,
    startTaskExecutionForAgent,
    startPlannedApprovalMeeting,
    handleTaskRunComplete,
    finishReview,
  };
}
