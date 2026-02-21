// @ts-nocheck

import type { RuntimeContext } from "../../types/runtime-context.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { INBOX_WEBHOOK_SECRET, PKG_VERSION } from "../../config/runtime.ts";
import { notifyTaskStatus, gatewayHttpInvoke } from "../../gateway/client.ts";
import { BUILTIN_GITHUB_CLIENT_ID, BUILTIN_GOOGLE_CLIENT_ID, BUILTIN_GOOGLE_CLIENT_SECRET, OAUTH_BASE_URL, OAUTH_ENCRYPTION_SECRET, OAUTH_STATE_TTL_MS, appendOAuthQuery, b64url, pkceVerifier, sanitizeOAuthRedirect, encryptSecret, decryptSecret } from "../../oauth/helpers.ts";
import { isAuthenticated } from "../../security/auth.ts";
import {
  computeVersionDeltaKind,
  isDeltaAllowedByChannel,
  isRemoteVersionNewer,
  normalizeVersionTag,
  type AutoUpdateChannel,
  type UpdateDeltaKind,
} from "./update-auto-utils.ts";
import { parseSafeRestartCommand } from "./update-auto-command.ts";
import { needsForceConfirmation, parseAutoUpdateChannel, shouldSkipUpdateByGuards } from "./update-auto-policy.ts";
import { createAutoUpdateLock } from "./update-auto-lock.ts";

export function registerRoutesPartA(ctx: RuntimeContext): Record<string, never> {
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
  const buildAvailableSkillsPromptBlock = __ctx.buildAvailableSkillsPromptBlock || ((provider: string) => `[Available Skills][provider=${provider || "unknown"}][unavailable]`);
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
  let httpAgentCounter = __ctx.httpAgentCounter;
  const insertMessageWithIdempotency = __ctx.insertMessageWithIdempotency;
  const interruptPidTree = __ctx.interruptPidTree;
  const isTaskWorkflowInterrupted = __ctx.isTaskWorkflowInterrupted;
  const killPidTree = __ctx.killPidTree;
  const launchApiProviderAgent = __ctx.launchApiProviderAgent;
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
  const setTaskCreationAuditCompletion = __ctx.setTaskCreationAuditCompletion;
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
  const DEPT_KEYWORDS = __ctx.DEPT_KEYWORDS;
  const detectLang = __ctx.detectLang;
  const detectTargetDepartments = __ctx.detectTargetDepartments;
  const findTeamLeader = __ctx.findTeamLeader;
  const formatTaskSubtaskProgressSummary = __ctx.formatTaskSubtaskProgressSummary;
  const getDeptName = __ctx.getDeptName;
  const getDeptRoleConstraint = __ctx.getDeptRoleConstraint;
  const getPreferredLanguage = __ctx.getPreferredLanguage;
  const getRoleLabel = __ctx.getRoleLabel;
  const l = __ctx.l;
  const pickL = __ctx.pickL;
  const prettyStreamJson = __ctx.prettyStreamJson;
  const processSubtaskDelegations = __ctx.processSubtaskDelegations;
  const recoverCrossDeptQueueAfterMissingCallback = __ctx.recoverCrossDeptQueueAfterMissingCallback;
  const refreshCliUsageData = __ctx.refreshCliUsageData;
  const resolveLang = __ctx.resolveLang;
  const resolveProjectPath = __ctx.resolveProjectPath;
  const sendAgentMessage = __ctx.sendAgentMessage;
  const reconcileCrossDeptSubtasks = __ctx.reconcileCrossDeptSubtasks;
  const ROLE_PRIORITY = __ctx.ROLE_PRIORITY;
  const ROLE_LABEL = __ctx.ROLE_LABEL;
  const pickRandom = __ctx.pickRandom;
  const SUPPORTED_LANGS = __ctx.SUPPORTED_LANGS;
  const isLang = __ctx.isLang;
  const readSettingString = __ctx.readSettingString;
  const getFlairs = __ctx.getFlairs;
  const ROLE_LABEL_L10N = __ctx.ROLE_LABEL_L10N;
  const classifyIntent = __ctx.classifyIntent;
  const generateChatReply = __ctx.generateChatReply;
  const generateAnnouncementReply = __ctx.generateAnnouncementReply;
  const scheduleAnnouncementReplies = __ctx.scheduleAnnouncementReplies;
  const normalizeTextField = __ctx.normalizeTextField;
  const analyzeDirectivePolicy = __ctx.analyzeDirectivePolicy;
  const shouldExecuteDirectiveDelegation = __ctx.shouldExecuteDirectiveDelegation;
  const detectMentions = __ctx.detectMentions;
  const handleMentionDelegation = __ctx.handleMentionDelegation;
  const findBestSubordinate = __ctx.findBestSubordinate;
  const REMEDIATION_SUBTASK_PREFIXES = __ctx.REMEDIATION_SUBTASK_PREFIXES;
  const COLLABORATION_SUBTASK_PREFIXES = __ctx.COLLABORATION_SUBTASK_PREFIXES;
  const hasAnyPrefix = __ctx.hasAnyPrefix;
  const getTaskSubtaskProgressSummary = __ctx.getTaskSubtaskProgressSummary;
  const groupSubtasksByTargetDepartment = __ctx.groupSubtasksByTargetDepartment;
  const getSubtaskDeptExecutionPriority = __ctx.getSubtaskDeptExecutionPriority;
  const orderSubtaskQueuesByDepartment = __ctx.orderSubtaskQueuesByDepartment;
  const buildSubtaskDelegationPrompt = __ctx.buildSubtaskDelegationPrompt;
  const hasOpenForeignSubtasks = __ctx.hasOpenForeignSubtasks;
  const maybeNotifyAllSubtasksComplete = __ctx.maybeNotifyAllSubtasksComplete;
  const delegateSubtaskBatch = __ctx.delegateSubtaskBatch;
  const finalizeDelegatedSubtasks = __ctx.finalizeDelegatedSubtasks;
  const handleSubtaskDelegationComplete = __ctx.handleSubtaskDelegationComplete;
  const handleSubtaskDelegationBatchComplete = __ctx.handleSubtaskDelegationBatchComplete;
  const deriveSubtaskStateFromDelegatedTask = __ctx.deriveSubtaskStateFromDelegatedTask;
  const pickUnlinkedTargetSubtask = __ctx.pickUnlinkedTargetSubtask;
  const syncSubtaskWithDelegatedTask = __ctx.syncSubtaskWithDelegatedTask;
  const linkCrossDeptTaskToParentSubtask = __ctx.linkCrossDeptTaskToParentSubtask;
  const startCrossDeptCooperation = __ctx.startCrossDeptCooperation;
  const detectProjectPath = __ctx.detectProjectPath;
  const getLatestKnownProjectPath = __ctx.getLatestKnownProjectPath;
  const getDefaultProjectRoot = __ctx.getDefaultProjectRoot;
  const resolveDirectiveProjectPath = __ctx.resolveDirectiveProjectPath;
  const stripReportRequestPrefix = __ctx.stripReportRequestPrefix;
  const detectReportOutputFormat = __ctx.detectReportOutputFormat;
  const pickPlanningReportAssignee = __ctx.pickPlanningReportAssignee;
  const handleReportRequest = __ctx.handleReportRequest;
  const handleTaskDelegation = __ctx.handleTaskDelegation;
  const shouldTreatDirectChatAsTask = __ctx.shouldTreatDirectChatAsTask;
  const createDirectAgentTaskAndRun = __ctx.createDirectAgentTaskAndRun;
  const scheduleAgentReply = __ctx.scheduleAgentReply;
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

// ===========================================================================
// API ENDPOINTS
// ===========================================================================

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
const UPDATE_CHECK_ENABLED = String(process.env.UPDATE_CHECK_ENABLED ?? "1").trim() !== "0";
const UPDATE_CHECK_REPO = String(process.env.UPDATE_CHECK_REPO ?? "GreenSheep01201/claw-empire").trim();
const UPDATE_CHECK_TTL_MS = Math.max(60_000, Number(process.env.UPDATE_CHECK_TTL_MS ?? 30 * 60 * 1000) || (30 * 60 * 1000));
const UPDATE_CHECK_TIMEOUT_MS = Math.max(1_000, Number(process.env.UPDATE_CHECK_TIMEOUT_MS ?? 4_000) || 4_000);

type UpdateStatusPayload = {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  release_url: string | null;
  checked_at: number;
  enabled: boolean;
  repo: string;
  error: string | null;
};

let updateStatusCache: UpdateStatusPayload | null = null;
let updateStatusCachedAt = 0;
let updateStatusInFlight: Promise<UpdateStatusPayload> | null = null;

type AutoUpdateRestartMode = "notify" | "exit" | "command";

type UpdateApplyStatus = "applied" | "skipped" | "failed";

type UpdateApplyResult = {
  status: UpdateApplyStatus;
  trigger: "manual" | "auto";
  dry_run: boolean;
  started_at: number;
  finished_at: number;
  current_version: string;
  latest_version: string | null;
  delta_kind: UpdateDeltaKind;
  channel: AutoUpdateChannel;
  reasons: string[];
  before_head: string | null;
  after_head: string | null;
  commands: Array<{ cmd: string; ok: boolean; code: number; stdout_tail: string; stderr_tail: string }>;
  restart: { mode: AutoUpdateRestartMode; scheduled: boolean; command?: string; scheduled_exit_at?: number };
  error: string | null;
};

const AUTO_UPDATE_ENABLED = String(process.env.AUTO_UPDATE_ENABLED ?? "0").trim() === "1";
const parsedAutoUpdateChannel = parseAutoUpdateChannel(process.env.AUTO_UPDATE_CHANNEL);
const AUTO_UPDATE_CHANNEL = parsedAutoUpdateChannel.channel;
if (parsedAutoUpdateChannel.warning) {
  console.warn(`[auto-update] ${parsedAutoUpdateChannel.warning}`);
}
const AUTO_UPDATE_IDLE_ONLY = String(process.env.AUTO_UPDATE_IDLE_ONLY ?? "1").trim() !== "0";
const AUTO_UPDATE_CHECK_INTERVAL_MS = Math.max(60_000, Number(process.env.AUTO_UPDATE_CHECK_INTERVAL_MS ?? UPDATE_CHECK_TTL_MS) || UPDATE_CHECK_TTL_MS);
// Delay before first automatic update check after startup (AUTO_UPDATE_INITIAL_DELAY_MS, default/minimum 60s).
const AUTO_UPDATE_INITIAL_DELAY_MS = Math.max(60_000, Number(process.env.AUTO_UPDATE_INITIAL_DELAY_MS ?? 60_000) || 60_000);
const AUTO_UPDATE_RESTART_MODE = (() => {
  const raw = String(process.env.AUTO_UPDATE_RESTART_MODE ?? "notify").trim().toLowerCase();
  if (raw === "exit" || raw === "command") return raw as AutoUpdateRestartMode;
  return "notify";
})();
const AUTO_UPDATE_RESTART_COMMAND = String(process.env.AUTO_UPDATE_RESTART_COMMAND ?? "").trim();
const AUTO_UPDATE_EXIT_DELAY_MS = Math.max(1_200, Number(process.env.AUTO_UPDATE_EXIT_DELAY_MS ?? 10_000) || 10_000);
const AUTO_UPDATE_TOTAL_TIMEOUT_MS = Math.max(60_000, Number(process.env.AUTO_UPDATE_TOTAL_TIMEOUT_MS ?? 900_000) || 900_000);

const updateCommandTimeoutMs = {
  // AUTO_UPDATE_GIT_FETCH_TIMEOUT_MS / AUTO_UPDATE_GIT_PULL_TIMEOUT_MS / AUTO_UPDATE_INSTALL_TIMEOUT_MS
  gitFetch: Math.max(10_000, Number(process.env.AUTO_UPDATE_GIT_FETCH_TIMEOUT_MS ?? 120_000) || 120_000),
  gitPull: Math.max(10_000, Number(process.env.AUTO_UPDATE_GIT_PULL_TIMEOUT_MS ?? 180_000) || 180_000),
  pnpmInstall: Math.max(20_000, Number(process.env.AUTO_UPDATE_INSTALL_TIMEOUT_MS ?? 300_000) || 300_000),
};

let autoUpdateActive = AUTO_UPDATE_ENABLED;

const autoUpdateState: {
  running: boolean;
  last_checked_at: number | null;
  last_result: UpdateApplyResult | null;
  last_error: string | null;
  last_runtime_error: string | null;
  next_check_at: number | null;
} = {
  running: false,
  last_checked_at: null,
  last_result: null,
  last_error: null,
  last_runtime_error: null,
  next_check_at: null,
};

let autoUpdateInFlight: Promise<UpdateApplyResult> | null = null;
const autoUpdateLock = createAutoUpdateLock();
let autoUpdateBootTimer: ReturnType<typeof setTimeout> | null = null;
let autoUpdateInterval: ReturnType<typeof setInterval> | null = null;
let autoUpdateExitTimer: ReturnType<typeof setTimeout> | null = null;

function stopAutoUpdateTimers(): void {
  if (autoUpdateBootTimer) {
    clearTimeout(autoUpdateBootTimer);
    autoUpdateBootTimer = null;
  }
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
  }
  if (autoUpdateExitTimer) {
    clearTimeout(autoUpdateExitTimer);
    autoUpdateExitTimer = null;
  }
}

function maybeUnrefTimer(timer: { unref?: () => void } | null): void {
  timer?.unref?.();
}

function tryAcquireAutoUpdateLock(): boolean {
  return autoUpdateLock.tryAcquire();
}

function releaseAutoUpdateLock(): void {
  autoUpdateLock.release();
}

// helper functions moved to ./update-auto-utils.ts

function tailText(value: string, maxChars = 600): string {
  const txt = String(value ?? "").trim();
  if (!txt) return "";
  return txt.length > maxChars ? `...${txt.slice(-maxChars)}` : txt;
}

const RUN_COMMAND_CAPTURE_MAX_CHARS = Math.max(
  16_384,
  Number(process.env.AUTO_UPDATE_COMMAND_OUTPUT_MAX_CHARS ?? 200_000) || 200_000,
);

function limitChunkToTail(chunk: Buffer | string, maxChars: number): Buffer | string {
  if (typeof chunk === "string") {
    return chunk.length > maxChars ? chunk.slice(-maxChars) : chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.length > maxChars ? chunk.subarray(chunk.length - maxChars) : chunk;
  }
  return String(chunk ?? "");
}

function appendChunkTail(current: string, chunk: Buffer | string, maxChars: number): string {
  const next = current + String(chunk ?? "");
  if (next.length <= maxChars) return next;
  return next.slice(-maxChars);
}

function runCommandCaptureSync(cmd: string, args: string[], timeoutMs: number): { ok: boolean; code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    }) as unknown as string;
    return { ok: true, code: 0, stdout: String(stdout ?? ""), stderr: "" };
  } catch (err: any) {
    const stdout = err?.stdout ? String(err.stdout) : "";
    const stderr = err?.stderr ? String(err.stderr) : (err?.message ? String(err.message) : "");
    return {
      ok: false,
      code: Number.isFinite(err?.status) ? Number(err.status) : 1,
      stdout,
      stderr,
    };
  }
}

async function runCommandCapture(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const finalize = (result: { ok: boolean; code: number; stdout: string; stderr: string }) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      finalize({
        ok: false,
        code: 1,
        stdout,
        stderr: err?.message ? String(err.message) : "spawn_failed",
      });
      return;
    }

    const timer = setTimeout(() => {
      const pid = Number(child.pid ?? 0);
      if (pid > 0) {
        killPidTree(pid);
      } else {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
      stderr = appendChunkTail(stderr, `\ncommand_timeout_${timeoutMs}ms`, RUN_COMMAND_CAPTURE_MAX_CHARS);
      finalize({
        ok: false,
        code: 124,
        stdout,
        stderr: stderr.trim(),
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const limitedChunk = limitChunkToTail(chunk, RUN_COMMAND_CAPTURE_MAX_CHARS);
      stdout = appendChunkTail(stdout, limitedChunk, RUN_COMMAND_CAPTURE_MAX_CHARS);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const limitedChunk = limitChunkToTail(chunk, RUN_COMMAND_CAPTURE_MAX_CHARS);
      stderr = appendChunkTail(stderr, limitedChunk, RUN_COMMAND_CAPTURE_MAX_CHARS);
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      finalize({ ok: false, code: 1, stdout, stderr: err?.message ? String(err.message) : stderr });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const exit = Number.isFinite(code as number) ? Number(code) : 1;
      finalize({ ok: exit === 0, code: exit, stdout, stderr });
    });
  });
}

function getInProgressTaskCount(): number {
  try {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'in_progress'").get() as { cnt?: number } | undefined;
    return Number(row?.cnt ?? 0);
  } catch {
    return 0;
  }
}

function validateAutoUpdateDependencies(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const cmd of ["git", "pnpm"]) {
    const check = runCommandCaptureSync(cmd, ["--version"], 5_000);
    if (!check.ok) missing.push(cmd);
  }
  return { ok: missing.length === 0, missing };
}

function logAutoUpdate(message: string): void {
  try {
    appendTaskLog(null, "system", `[auto-update] ${message}`);
  } catch {
    // ignore log failures
  }
}

// note: service health verification for newly updated code should happen after restart, not pre-restart.

async function applyUpdateNow(options: {
  trigger: "manual" | "auto";
  dryRun?: boolean;
  force?: boolean;
  forceConfirmed?: boolean;
}): Promise<UpdateApplyResult> {
  const startedAt = Date.now();
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const forceConfirmed = Boolean(options.forceConfirmed);
  const reasons: string[] = [];
  const commands: UpdateApplyResult["commands"] = [];
  let beforeHead: string | null = null;
  let afterHead: string | null = null;
  let error: string | null = null;
  const addManualRecoveryReason = () => {
    if (!reasons.includes("manual_recovery_may_be_required")) {
      reasons.push("manual_recovery_may_be_required");
    }
  };
  const deadlineMs = startedAt + AUTO_UPDATE_TOTAL_TIMEOUT_MS;
  const remainingTimeout = (fallbackMs: number): number => {
    const remain = deadlineMs - Date.now();
    return Math.max(1_000, Math.min(fallbackMs, remain));
  };
  const hasExceededTotalTimeout = (): boolean => Date.now() >= deadlineMs;

  if (needsForceConfirmation(force, forceConfirmed)) {
    const finishedAt = Date.now();
    return {
      status: "skipped",
      trigger: options.trigger,
      dry_run: dryRun,
      started_at: startedAt,
      finished_at: finishedAt,
      current_version: PKG_VERSION,
      latest_version: null,
      delta_kind: "none",
      channel: AUTO_UPDATE_CHANNEL,
      reasons: ["force_confirmation_required"],
      before_head: null,
      after_head: null,
      commands: [],
      restart: { mode: AUTO_UPDATE_RESTART_MODE, scheduled: false, command: AUTO_UPDATE_RESTART_COMMAND || undefined },
      error: null,
    };
  }

  const forceRefresh = options.trigger === "manual" && !dryRun;
  const status = await fetchUpdateStatus(forceRefresh);
  const deltaKind = computeVersionDeltaKind(PKG_VERSION, status.latest_version);

  if (!status.update_available) reasons.push("no_update_available");
  if (deltaKind !== "none" && !isDeltaAllowedByChannel(deltaKind, AUTO_UPDATE_CHANNEL)) {
    reasons.push(`channel_blocked:${deltaKind}`);
  }

  const branchRes = await runCommandCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], 10_000);
  const branchName = branchRes.stdout.trim();
  if (!branchRes.ok || !branchName) {
    reasons.push("git_branch_unknown");
  } else if (branchName !== "main") {
    reasons.push(`branch_not_main:${branchName}`);
  }

  const remoteRes = await runCommandCapture("git", ["remote", "get-url", "origin"], 10_000);
  if (!remoteRes.ok || !remoteRes.stdout.trim()) {
    reasons.push("git_remote_origin_missing");
  }

  const dirtyRes = await runCommandCapture("git", ["status", "--porcelain"], 10_000);
  if (!dirtyRes.ok) {
    reasons.push("git_status_failed");
  } else if (dirtyRes.stdout.trim()) {
    reasons.push("dirty_worktree");
  }

  const inProgress = getInProgressTaskCount();
  if (AUTO_UPDATE_IDLE_ONLY && inProgress > 0) reasons.push(`busy_tasks:${inProgress}`);
  if (AUTO_UPDATE_IDLE_ONLY && activeProcesses.size > 0) reasons.push(`active_cli_processes:${activeProcesses.size}`);

  const skipByGuard = shouldSkipUpdateByGuards(reasons, force);
  if (skipByGuard || dryRun) {
    const finishedAt = Date.now();
    if (dryRun) reasons.push("dry_run");
    logAutoUpdate(`${options.trigger} check skipped (${reasons.join(",") || "no_reason"})`);
    return {
      status: "skipped",
      trigger: options.trigger,
      dry_run: dryRun,
      started_at: startedAt,
      finished_at: finishedAt,
      current_version: PKG_VERSION,
      latest_version: status.latest_version,
      delta_kind: deltaKind,
      channel: AUTO_UPDATE_CHANNEL,
      reasons,
      before_head: beforeHead,
      after_head: afterHead,
      commands,
      restart: { mode: AUTO_UPDATE_RESTART_MODE, scheduled: false, command: AUTO_UPDATE_RESTART_COMMAND || undefined },
      error: null,
    };
  }

  const beforeRes = await runCommandCapture("git", ["rev-parse", "--short", "HEAD"], 10_000);
  beforeHead = beforeRes.ok ? beforeRes.stdout.trim() : null;

  if (hasExceededTotalTimeout()) {
    error = "update_total_timeout_exceeded";
    reasons.push("update_total_timeout_exceeded");
  }

  if (!error) {
    const fetchRes = await runCommandCapture("git", ["fetch", "--tags", "--prune", "origin", "main"], remainingTimeout(updateCommandTimeoutMs.gitFetch));
    commands.push({ cmd: "git fetch --tags --prune origin main", ok: fetchRes.ok, code: fetchRes.code, stdout_tail: tailText(fetchRes.stdout), stderr_tail: tailText(fetchRes.stderr) });
    if (!fetchRes.ok) {
      logAutoUpdate("git fetch failed; repository state should be verified before retrying update");
      addManualRecoveryReason();
      error = "git_fetch_failed";
    }
  }

  if (!error) {
    if (hasExceededTotalTimeout()) {
      error = "update_total_timeout_exceeded";
      reasons.push("update_total_timeout_exceeded");
    } else {
      const pullRes = await runCommandCapture("git", ["pull", "--ff-only", "origin", "main"], remainingTimeout(updateCommandTimeoutMs.gitPull));
      commands.push({ cmd: "git pull --ff-only origin main", ok: pullRes.ok, code: pullRes.code, stdout_tail: tailText(pullRes.stdout), stderr_tail: tailText(pullRes.stderr) });
      if (!pullRes.ok) {
        // fetch succeeded but pull failed: local repo may need manual recovery.
        logAutoUpdate("git pull failed after successful fetch; manual recovery may be required");
        addManualRecoveryReason();
        error = "git_pull_failed";
      }
    }
  }

  if (!error) {
    if (hasExceededTotalTimeout()) {
      error = "update_total_timeout_exceeded";
      reasons.push("update_total_timeout_exceeded");
    } else {
      const installRes = await runCommandCapture("pnpm", ["install", "--frozen-lockfile"], remainingTimeout(updateCommandTimeoutMs.pnpmInstall));
      commands.push({ cmd: "pnpm install --frozen-lockfile", ok: installRes.ok, code: installRes.code, stdout_tail: tailText(installRes.stdout), stderr_tail: tailText(installRes.stderr) });
      if (!installRes.ok) error = "install_failed";
    }
  }

  if (!error && AUTO_UPDATE_RESTART_MODE === "notify") {
    reasons.push("manual_restart_required");
  }

  const afterRes = await runCommandCapture("git", ["rev-parse", "--short", "HEAD"], 10_000);
  afterHead = afterRes.ok ? afterRes.stdout.trim() : null;

  const finishedAt = Date.now();
  const applied = !error;
  const restart: UpdateApplyResult["restart"] = { mode: AUTO_UPDATE_RESTART_MODE, scheduled: false, command: AUTO_UPDATE_RESTART_COMMAND || undefined };

  if (applied) {
    if (options.trigger === "auto") {
      const summary = `[Auto Update] applied ${beforeHead || "?"} -> ${afterHead || "?"} (latest=${status.latest_version || "unknown"}, mode=${AUTO_UPDATE_RESTART_MODE})`;
      try { notifyCeo(summary, null, "status_update"); } catch { /* ignore */ }
    }

    if (AUTO_UPDATE_RESTART_MODE === "exit") {
      // Best-effort delayed graceful exit. Prefer running under a process manager.
      logAutoUpdate(`restart mode=exit scheduled (delay_ms=${AUTO_UPDATE_EXIT_DELAY_MS})`);
      restart.scheduled = true;
      if (autoUpdateExitTimer) clearTimeout(autoUpdateExitTimer);
      restart.scheduled_exit_at = Date.now() + AUTO_UPDATE_EXIT_DELAY_MS;
      autoUpdateExitTimer = setTimeout(() => {
        logAutoUpdate("auto-update initiating graceful shutdown (mode=exit)");
        process.exitCode = 0;
        let signaled = false;
        if (process.listenerCount("SIGTERM") > 0) {
          try {
            process.kill(process.pid, "SIGTERM");
            signaled = true;
          } catch {
            // ignore and fallback to hard exit below
          }
        }
        if (process.listenerCount("beforeExit") > 0) {
          try {
            process.emit("beforeExit", process.exitCode ?? 0);
          } catch {
            // ignore and fallback to hard exit below
          }
        }
        setTimeout(() => process.exit(0), signaled ? 1500 : 0);
      }, AUTO_UPDATE_EXIT_DELAY_MS);
      maybeUnrefTimer(autoUpdateExitTimer);
    } else if (AUTO_UPDATE_RESTART_MODE === "command" && AUTO_UPDATE_RESTART_COMMAND) {
      const parsed = parseSafeRestartCommand(AUTO_UPDATE_RESTART_COMMAND);
      if (!parsed) {
        logAutoUpdate("restart mode=command rejected (unsafe command format)");
        restart.scheduled = false;
      } else {
        logAutoUpdate(`restart mode=command executing ${parsed.cmd} (args=${parsed.args.length})`);
        try {
          const child = spawn(parsed.cmd, parsed.args, {
            cwd: process.cwd(),
            shell: false,
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          restart.scheduled = true;
        } catch (err) {
          restart.scheduled = false;
          logAutoUpdate(
            `restart mode=command failed to spawn ${parsed.cmd}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  logAutoUpdate(`${options.trigger} apply ${applied ? "completed" : "failed"} (${beforeHead || "?"}->${afterHead || "?"}${error ? `, error=${error}` : ""})`);

  return {
    status: applied ? "applied" : "failed",
    trigger: options.trigger,
    dry_run: false,
    started_at: startedAt,
    finished_at: finishedAt,
    current_version: PKG_VERSION,
    latest_version: status.latest_version,
    delta_kind: deltaKind,
    channel: AUTO_UPDATE_CHANNEL,
    reasons,
    before_head: beforeHead,
    after_head: afterHead,
    commands,
    restart,
    error,
  };
}

async function runAutoUpdateCycle(): Promise<void> {
  if (!AUTO_UPDATE_ENABLED) return;
  if (autoUpdateInFlight) return;
  if (!tryAcquireAutoUpdateLock()) return;

  autoUpdateInFlight = (async () => {
    autoUpdateState.running = true;
    const now = Date.now();
    autoUpdateState.last_checked_at = now;
    autoUpdateState.next_check_at = now + AUTO_UPDATE_CHECK_INTERVAL_MS;
    autoUpdateState.last_runtime_error = null;
    logAutoUpdate("auto check started");

    try {
      const result = await applyUpdateNow({ trigger: "auto", dryRun: false });
      autoUpdateState.last_result = result;
      autoUpdateState.last_error = result.error;
    } catch (err) {
      autoUpdateState.last_runtime_error = err instanceof Error ? err.message : String(err);
      logAutoUpdate(`auto check runtime error (${autoUpdateState.last_runtime_error})`);
    } finally {
      autoUpdateState.running = false;
      autoUpdateInFlight = null;
      releaseAutoUpdateLock();
    }
  })();

  await autoUpdateInFlight;
}

if (AUTO_UPDATE_ENABLED) {
  const dep = validateAutoUpdateDependencies();
  if (!dep.ok) {
    autoUpdateActive = false;
    autoUpdateState.last_error = `missing_dependencies:${dep.missing.join(",")}`;
    logAutoUpdate(`disabled - missing dependencies (${dep.missing.join(",")})`);
  } else {
    autoUpdateActive = true;
    autoUpdateState.next_check_at = Date.now() + AUTO_UPDATE_INITIAL_DELAY_MS;
    logAutoUpdate(`enabled (first_check_in_ms=${AUTO_UPDATE_INITIAL_DELAY_MS}, interval_ms=${AUTO_UPDATE_CHECK_INTERVAL_MS})`);

    autoUpdateBootTimer = setTimeout(() => {
      void runAutoUpdateCycle();
    }, AUTO_UPDATE_INITIAL_DELAY_MS);

    autoUpdateInterval = setInterval(() => {
      void runAutoUpdateCycle();
    }, AUTO_UPDATE_CHECK_INTERVAL_MS);

    process.once("SIGTERM", stopAutoUpdateTimers);
    process.once("SIGINT", stopAutoUpdateTimers);
    process.once("beforeExit", stopAutoUpdateTimers);
  }
}

async function fetchUpdateStatus(forceRefresh = false): Promise<UpdateStatusPayload> {
  const now = Date.now();
  if (!UPDATE_CHECK_ENABLED) {
    return {
      current_version: PKG_VERSION,
      latest_version: null,
      update_available: false,
      release_url: null,
      checked_at: now,
      enabled: false,
      repo: UPDATE_CHECK_REPO,
      error: null,
    };
  }

  const cacheValid = updateStatusCache && now - updateStatusCachedAt < UPDATE_CHECK_TTL_MS;
  if (!forceRefresh && cacheValid && updateStatusCache) return updateStatusCache;
  if (!forceRefresh && updateStatusInFlight) return updateStatusInFlight;

  updateStatusInFlight = (async () => {
    let latestVersion: string | null = null;
    let releaseUrl: string | null = null;
    let error: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
      try {
        const response = await fetch(`https://api.github.com/repos/${UPDATE_CHECK_REPO}/releases/latest`, {
          method: "GET",
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "claw-empire-update-check",
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`github_http_${response.status}`);
        }
        const body = await response.json().catch(() => null) as { tag_name?: unknown; html_url?: unknown } | null;
        latestVersion = typeof body?.tag_name === "string" ? normalizeVersionTag(body.tag_name) : null;
        releaseUrl = typeof body?.html_url === "string" ? body.html_url : null;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const next = {
      current_version: PKG_VERSION,
      latest_version: latestVersion,
      update_available: Boolean(latestVersion && isRemoteVersionNewer(latestVersion, PKG_VERSION)),
      release_url: releaseUrl,
      checked_at: Date.now(),
      enabled: true,
      repo: UPDATE_CHECK_REPO,
      error,
    };
    updateStatusCache = next;
    updateStatusCachedAt = Date.now();
    return next;
  })().finally(() => {
    updateStatusInFlight = null;
  });

  return updateStatusInFlight;
}

const buildHealthPayload = () => ({
  ok: true,
  version: PKG_VERSION,
  app: "Claw-Empire",
  dbPath,
});

app.get("/health", (_req, res) => res.json(buildHealthPayload()));
app.get("/healthz", (_req, res) => res.json(buildHealthPayload()));
app.get("/api/health", (_req, res) => res.json(buildHealthPayload()));
app.get("/api/update-status", async (req, res) => {
  const refresh = String(req.query?.refresh ?? "").trim() === "1";
  const status = await fetchUpdateStatus(refresh);
  res.json({ ok: true, ...status });
});

app.get("/api/update-auto-status", async (req, res) => {
  // This endpoint is also protected by global /api auth middleware.
  // Keep an explicit guard here because it exposes operational update state.
  if (!isAuthenticated(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const status = await fetchUpdateStatus(false);
  res.json({
    ok: true,
    auto_update: {
      enabled: autoUpdateActive,
      configured_enabled: AUTO_UPDATE_ENABLED,
      channel: AUTO_UPDATE_CHANNEL,
      idle_only: AUTO_UPDATE_IDLE_ONLY,
      interval_ms: AUTO_UPDATE_CHECK_INTERVAL_MS,
      restart_mode: AUTO_UPDATE_RESTART_MODE,
      restart_command_configured: Boolean(AUTO_UPDATE_RESTART_COMMAND),
    },
    runtime: {
      running: autoUpdateState.running,
      lock_held: autoUpdateLock.isHeld(),
      last_checked_at: autoUpdateState.last_checked_at,
      last_result: autoUpdateState.last_result,
      last_error: autoUpdateState.last_error,
      last_runtime_error: autoUpdateState.last_runtime_error,
      next_check_at: autoUpdateState.next_check_at,
    },
    update_status: status,
  });
});

app.post("/api/update-apply", async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const body = req.body ?? {};
  const dryRun = body?.dry_run === true || String(body?.dry_run ?? "").trim() === "1";
  const force = body?.force === true || String(body?.force ?? "").trim() === "1";
  const forceConfirm = body?.force_confirm === true || String(body?.force_confirm ?? "").trim() === "1";

  if (!tryAcquireAutoUpdateLock()) {
    return res.status(409).json({ ok: false, error: "update_already_running" });
  }

  autoUpdateInFlight = (async () => {
    autoUpdateState.running = true;
    autoUpdateState.last_checked_at = Date.now();
    autoUpdateState.last_runtime_error = null;
    logAutoUpdate(`manual apply requested (dry_run=${dryRun ? "1" : "0"}, force=${force ? "1" : "0"})`);

    const result = await applyUpdateNow({ trigger: "manual", dryRun, force, forceConfirmed: forceConfirm });
    autoUpdateState.last_result = result;
    autoUpdateState.last_error = result.error;
    return result;
  })()
    .catch((err) => {
      autoUpdateState.last_runtime_error = err instanceof Error ? err.message : String(err);
      throw err;
    })
    .finally(() => {
      autoUpdateState.running = false;
      autoUpdateInFlight = null;
      if (!updateStatusInFlight) {
        updateStatusCachedAt = 0;
        updateStatusCache = null;
      }
      releaseAutoUpdateLock();
    });

  try {
    const result = await autoUpdateInFlight;
    if (result.reasons.includes("force_confirmation_required")) {
      return res.status(400).json({
        ok: false,
        error: "force_confirmation_required",
        message: "force=true requires force_confirm=true because it bypasses safety guards",
        result,
      });
    }
    const code = result.status === "failed" ? 500 : 200;
    return res.status(code).json({ ok: result.status !== "failed", result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// Gateway Channel Messaging
// ---------------------------------------------------------------------------
app.get("/api/gateway/targets", async (_req, res) => {
  try {
    const result = await gatewayHttpInvoke({
      tool: "sessions_list", action: "json",
      args: { limit: 100, activeMinutes: 60 * 24 * 7, messageLimit: 0 },
    });
    const sessions = Array.isArray(result?.details?.sessions) ? result.details.sessions : [];
    const targets = sessions
      .filter((s: any) => s?.deliveryContext?.channel && s?.deliveryContext?.to)
      .map((s: any) => ({
        sessionKey: s.key,
        displayName: s.displayName || `${s.deliveryContext.channel}:${s.deliveryContext.to}`,
        channel: s.deliveryContext.channel,
        to: s.deliveryContext.to,
      }));
    res.json({ ok: true, targets });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/gateway/send", async (req, res) => {
  try {
    const { sessionKey, text } = req.body ?? {};
    if (!sessionKey || !text?.trim()) {
      return res.status(400).json({ ok: false, error: "sessionKey and text required" });
    }
    const result = await gatewayHttpInvoke({
      tool: "sessions_list", action: "json",
      args: { limit: 200, activeMinutes: 60 * 24 * 30, messageLimit: 0 },
    });
    const sessions = Array.isArray(result?.details?.sessions) ? result.details.sessions : [];
    const session = sessions.find((s: any) => s?.key === sessionKey);
    if (!session?.deliveryContext?.channel || !session?.deliveryContext?.to) {
      return res.status(404).json({ ok: false, error: "session not found or no delivery target" });
    }
    await gatewayHttpInvoke({
      tool: "message", action: "send",
      args: { channel: session.deliveryContext.channel, target: session.deliveryContext.to, message: text.trim() },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
app.get("/api/departments", (_req, res) => {
  const departments = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM agents a WHERE a.department_id = d.id) AS agent_count
    FROM departments d
    ORDER BY d.sort_order ASC
  `).all();
  res.json({ departments });
});

app.get("/api/departments/:id", (req, res) => {
  const id = String(req.params.id);
  const department = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
  if (!department) return res.status(404).json({ error: "not_found" });

  const agents = db.prepare("SELECT * FROM agents WHERE department_id = ? ORDER BY role, name").all(id);
  res.json({ department, agents });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
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

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM projects p
    ${where}
  `).get(...(params as SQLInputValue[])) as { cnt: number };
  const total = Number(totalRow?.cnt ?? 0) || 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
    FROM projects p
    ${where}
    ORDER BY COALESCE(p.last_used_at, p.updated_at) DESC, p.updated_at DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...([...(params as SQLInputValue[]), pageSize, offset] as SQLInputValue[]));

  res.json({
    projects: rows,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  });
});

app.post("/api/projects", (req, res) => {
  const body = req.body ?? {};
  const name = normalizeTextField(body.name);
  const projectPath = normalizeTextField(body.project_path);
  const coreGoal = normalizeTextField(body.core_goal);
  if (!name) return res.status(400).json({ error: "name_required" });
  if (!projectPath) return res.status(400).json({ error: "project_path_required" });
  if (!coreGoal) return res.status(400).json({ error: "core_goal_required" });

  const id = randomUUID();
  const t = nowMs();
  db.prepare(`
    INSERT INTO projects (id, name, project_path, core_goal, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, projectPath, coreGoal, t, t, t);

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  res.json({ ok: true, project });
});

app.patch("/api/projects/:id", (req, res) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const body = req.body ?? {};
  const updates: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowMs()];

  if ("name" in body) {
    const value = normalizeTextField(body.name);
    if (!value) return res.status(400).json({ error: "name_required" });
    updates.push("name = ?");
    params.push(value);
  }
  if ("project_path" in body) {
    const value = normalizeTextField(body.project_path);
    if (!value) return res.status(400).json({ error: "project_path_required" });
    updates.push("project_path = ?");
    params.push(value);
  }
  if ("core_goal" in body) {
    const value = normalizeTextField(body.core_goal);
    if (!value) return res.status(400).json({ error: "core_goal_required" });
    updates.push("core_goal = ?");
    params.push(value);
  }

  if (updates.length <= 1) {
    return res.status(400).json({ error: "no_fields" });
  }

  params.push(id);
  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...(params as SQLInputValue[]));
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  res.json({ ok: true, project });
});

app.delete("/api/projects/:id", (req, res) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });

  // Keep task history while removing relation.
  db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get("/api/projects/:id", (req, res) => {
  const id = String(req.params.id);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) return res.status(404).json({ error: "not_found" });

  const tasks = db.prepare(`
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
  `).all(id);

  const reports = db.prepare(`
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
  `).all(id);

  res.json({ project, tasks, reports });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
app.get("/api/agents", (_req, res) => {
  const agents = db.prepare(`
    SELECT a.*, d.name AS department_name, d.name_ko AS department_name_ko, d.color AS department_color
    FROM agents a
    LEFT JOIN departments d ON a.department_id = d.id
    ORDER BY a.department_id, a.role, a.name
  `).all();
  res.json({ agents });
});

app.get("/api/meeting-presence", (_req, res) => {
  const now = nowMs();
  const presence: Array<{
    agent_id: string;
    seat_index: number;
    phase: "kickoff" | "review";
    task_id: string | null;
    decision: MeetingReviewDecision | null;
    until: number;
  }> = [];

  for (const [agentId, until] of meetingPresenceUntil.entries()) {
    if (until < now) {
      meetingPresenceUntil.delete(agentId);
      meetingSeatIndexByAgent.delete(agentId);
      meetingPhaseByAgent.delete(agentId);
      meetingTaskIdByAgent.delete(agentId);
      meetingReviewDecisionByAgent.delete(agentId);
      continue;
    }
    const phase = meetingPhaseByAgent.get(agentId) ?? "kickoff";
    presence.push({
      agent_id: agentId,
      seat_index: meetingSeatIndexByAgent.get(agentId) ?? 0,
      phase,
      task_id: meetingTaskIdByAgent.get(agentId) ?? null,
      decision: phase === "review" ? (meetingReviewDecisionByAgent.get(agentId) ?? "reviewing") : null,
      until,
    });
  }

  presence.sort((a, b) => a.seat_index - b.seat_index);
  res.json({ presence });
});

type SystemProcessInfo = {
  pid: number;
  ppid: number | null;
  name: string;
  command: string;
};

type ManagedProcessProvider = "claude" | "codex" | "gemini" | "opencode" | "node" | "python";

const CLI_EXECUTABLE_PROVIDER_MAP: Record<string, ManagedProcessProvider> = {
  "claude": "claude",
  "claude.exe": "claude",
  "codex": "codex",
  "codex.exe": "codex",
  "gemini": "gemini",
  "gemini.exe": "gemini",
  "opencode": "opencode",
  "opencode.exe": "opencode",
  "node": "node",
  "node.exe": "node",
  "python": "python",
  "python.exe": "python",
  "python3": "python",
  "python3.exe": "python",
  "py": "python",
  "py.exe": "python",
};

function detectCliProviderFromExecutable(name: string): ManagedProcessProvider | null {
  const normalized = path.basename(String(name ?? "")).trim().toLowerCase();
  if (CLI_EXECUTABLE_PROVIDER_MAP[normalized]) return CLI_EXECUTABLE_PROVIDER_MAP[normalized];
  // e.g. python3.11, python3.12 on macOS/Linux
  if (normalized.startsWith("python")) return "python";
  return null;
}

function runExecFileText(cmd: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          (err as any).stderr = stderr;
          reject(err);
          return;
        }
        resolve(String(stdout ?? ""));
      },
    );
  });
}

function parseUnixProcessTable(raw: string): SystemProcessInfo[] {
  const lines = raw.split(/\r?\n/);
  const rows: SystemProcessInfo[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    const name = String(match[3] ?? "").trim();
    const args = String(match[4] ?? "").trim();
    if (!Number.isFinite(pid) || pid <= 0) continue;
    rows.push({
      pid,
      ppid: Number.isFinite(ppid) && ppid >= 0 ? ppid : null,
      name,
      command: args || name,
    });
  }
  return rows;
}

function parseWindowsProcessJson(raw: string): SystemProcessInfo[] {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  const rows: SystemProcessInfo[] = [];
  for (const item of items) {
    const pid = Number(item?.ProcessId ?? item?.processid ?? item?.pid);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const ppidRaw = Number(item?.ParentProcessId ?? item?.parentprocessid ?? item?.ppid);
    const name = String(item?.Name ?? item?.name ?? "").trim();
    const commandLine = String(item?.CommandLine ?? item?.commandline ?? "").trim();
    rows.push({
      pid,
      ppid: Number.isFinite(ppidRaw) && ppidRaw >= 0 ? ppidRaw : null,
      name,
      command: commandLine || name,
    });
  }
  return rows;
}

async function listSystemProcesses(): Promise<SystemProcessInfo[]> {
  if (process.platform === "win32") {
    const psCommand = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
    const candidates = ["powershell.exe", "powershell", "pwsh.exe", "pwsh"];
    for (const shell of candidates) {
      try {
        const stdout = await runExecFileText(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], 20000);
        const parsed = parseWindowsProcessJson(stdout);
        if (parsed.length) return parsed;
      } catch {
        // try next shell binary
      }
    }
    // Fallback: tasklist (command line is unavailable, but PID/name are enough for kill).
    try {
      const stdout = await runExecFileText("tasklist", ["/FO", "CSV", "/NH"], 20000);
      const rows: SystemProcessInfo[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^"([^"]+)","([^"]+)"/);
        if (!match) continue;
        const name = String(match[1] ?? "").trim();
        const pid = Number.parseInt(String(match[2] ?? "").replace(/[^\d]/g, ""), 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        rows.push({ pid, ppid: null, name, command: name });
      }
      return rows;
    } catch {
      return [];
    }
  }

  const stdout = await runExecFileText("ps", ["-eo", "pid=,ppid=,comm=,args="], 15000);
  return parseUnixProcessTable(stdout);
}

function isTaskExecutionStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "planned" || normalized === "collaborating" || normalized === "in_progress" || normalized === "review";
}

// ── Active Agents Status (must be before /api/agents/:id to avoid param capture) ──
app.get("/api/agents/active", (_req, res) => {
  try {
    const workingAgents = db.prepare(`
      SELECT a.id, a.name, a.name_ko, a.avatar_emoji, a.role, a.status, a.current_task_id,
             a.department_id, a.cli_provider,
             COALESCE(d.name, '') AS dept_name,
             COALESCE(d.name_ko, '') AS dept_name_ko,
             t.id AS task_id, t.title AS task_title, t.status AS task_status,
             t.started_at AS task_started_at
      FROM agents a
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN tasks t ON t.id = a.current_task_id
      WHERE a.status = 'working'
      ORDER BY a.name
    `).all() as Array<Record<string, unknown>>;

    const now = Date.now();
    const result = workingAgents.map((row) => {
      const taskId = row.task_id as string | null;
      const session = taskId ? taskExecutionSessions.get(taskId) : undefined;
      const hasProcess = taskId ? activeProcesses.has(taskId) : false;
      return {
        ...row,
        has_active_process: hasProcess,
        session_opened_at: session?.openedAt ?? null,
        last_activity_at: session?.lastTouchedAt ?? null,
        idle_seconds: session?.lastTouchedAt ? Math.round((now - session.lastTouchedAt) / 1000) : null,
      };
    });

    res.json({ ok: true, agents: result });
  } catch (err) {
    console.error("[active-agents]", err);
    res.status(500).json({ ok: false, error: "Failed to fetch active agents" });
  }
});

app.get("/api/agents/cli-processes", async (_req, res) => {
  try {
    const allProcesses = await listSystemProcesses();
    const cliProcesses = allProcesses
      .map((proc) => {
        const provider = detectCliProviderFromExecutable(proc.name);
        return provider ? { ...proc, provider } : null;
      })
      .filter(Boolean) as Array<SystemProcessInfo & { provider: ManagedProcessProvider }>;

    const trackedTaskByPid = new Map<number, string>();
    for (const [taskId, child] of activeProcesses.entries()) {
      const pid = Number(child?.pid ?? 0);
      if (Number.isFinite(pid) && pid > 0) trackedTaskByPid.set(pid, taskId);
    }

    const trackedTaskIds = Array.from(new Set(Array.from(trackedTaskByPid.values())));
    const taskMetaById = new Map<string, {
      task_id: string;
      task_title: string | null;
      task_status: string | null;
      agent_id: string | null;
      agent_name: string | null;
      agent_name_ko: string | null;
      agent_status: string | null;
      agent_current_task_id: string | null;
    }>();
    for (const taskId of trackedTaskIds) {
      const meta = db.prepare(`
        SELECT
          t.id AS task_id,
          t.title AS task_title,
          t.status AS task_status,
          a.id AS agent_id,
          a.name AS agent_name,
          a.name_ko AS agent_name_ko,
          a.status AS agent_status,
          a.current_task_id AS agent_current_task_id
        FROM tasks t
        LEFT JOIN agents a ON a.current_task_id = t.id
        WHERE t.id = ?
      `).get(taskId) as {
        task_id: string;
        task_title: string | null;
        task_status: string | null;
        agent_id: string | null;
        agent_name: string | null;
        agent_name_ko: string | null;
        agent_status: string | null;
        agent_current_task_id: string | null;
      } | undefined;
      if (meta) taskMetaById.set(taskId, meta);
    }

    const now = Date.now();
    const result = cliProcesses.map((proc) => {
      const trackedTaskId = trackedTaskByPid.get(proc.pid) ?? null;
      const taskMeta = trackedTaskId ? taskMetaById.get(trackedTaskId) : undefined;
      const session = trackedTaskId ? taskExecutionSessions.get(trackedTaskId) : undefined;
      const idleSeconds = session?.lastTouchedAt ? Math.max(0, Math.round((now - session.lastTouchedAt) / 1000)) : null;
      let isIdle = false;
      let idleReason = "";

      if (!trackedTaskId) {
        isIdle = true;
        idleReason = "untracked_process";
      } else if (!taskMeta) {
        isIdle = true;
        idleReason = "task_missing";
      } else if (!isTaskExecutionStatus(taskMeta.task_status)) {
        isIdle = true;
        idleReason = "task_not_running";
      } else if (taskMeta.agent_status !== "working" || taskMeta.agent_current_task_id !== trackedTaskId) {
        isIdle = true;
        idleReason = "agent_not_working";
      } else if (!session?.lastTouchedAt) {
        isIdle = true;
        idleReason = "no_session_activity";
      } else if (idleSeconds !== null && idleSeconds >= 300) {
        isIdle = true;
        idleReason = "inactive_over_5m";
      }

      return {
        pid: proc.pid,
        ppid: proc.ppid,
        provider: proc.provider,
        executable: proc.name,
        command: String(proc.command ?? "").slice(0, 1000),
        is_tracked: Boolean(trackedTaskId),
        is_idle: isIdle,
        idle_reason: idleReason || null,
        task_id: trackedTaskId,
        task_title: taskMeta?.task_title ?? null,
        task_status: taskMeta?.task_status ?? null,
        agent_id: taskMeta?.agent_id ?? null,
        agent_name: taskMeta?.agent_name ?? null,
        agent_name_ko: taskMeta?.agent_name_ko ?? null,
        agent_status: taskMeta?.agent_status ?? null,
        session_opened_at: session?.openedAt ?? null,
        last_activity_at: session?.lastTouchedAt ?? null,
        idle_seconds: idleSeconds,
      };
    }).sort((a, b) => {
      if (a.is_idle !== b.is_idle) return a.is_idle ? -1 : 1;
      const byProvider = String(a.provider).localeCompare(String(b.provider));
      if (byProvider !== 0) return byProvider;
      return a.pid - b.pid;
    });

    res.json({ ok: true, processes: result });
  } catch (err) {
    console.error("[cli-processes]", err);
    res.status(500).json({ ok: false, error: "Failed to inspect CLI processes" });
  }
});

app.delete("/api/agents/cli-processes/:pid", (req, res) => {
  const pid = Number.parseInt(String(req.params.pid), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_pid" });
  }
  if (pid === process.pid) {
    return res.status(400).json({ ok: false, error: "cannot_kill_server_process" });
  }

  let trackedTaskId: string | null = null;
  for (const [taskId, child] of activeProcesses.entries()) {
    if (Number(child?.pid ?? 0) === pid) {
      trackedTaskId = taskId;
      break;
    }
  }

  try {
    killPidTree(pid);
  } catch {
    // best effort
  }

  if (trackedTaskId) {
    stopRequestedTasks.add(trackedTaskId);
    stopRequestModeByTask.set(trackedTaskId, "cancel");
    stopProgressTimer(trackedTaskId);
    endTaskExecutionSession(trackedTaskId, "cli_process_killed");
    clearTaskWorkflowState(trackedTaskId);
    activeProcesses.delete(trackedTaskId);

    const task = db.prepare("SELECT id, title, status FROM tasks WHERE id = ?").get(trackedTaskId) as {
      id: string;
      title: string;
      status: string;
    } | undefined;
    if (task) {
      appendTaskLog(trackedTaskId, "system", `CLI process force-killed from inspector (pid=${pid})`);
      const normalizedStatus = String(task.status ?? "").toLowerCase();
      if (normalizedStatus !== "done" && normalizedStatus !== "cancelled" && normalizedStatus !== "pending" && normalizedStatus !== "inbox") {
        db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowMs(), trackedTaskId);
      }
      const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(trackedTaskId);
      broadcast("task_update", updatedTask);
    }

    const linkedAgents = db.prepare("SELECT id FROM agents WHERE current_task_id = ?").all(trackedTaskId) as Array<{ id: string }>;
    db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE current_task_id = ?").run(trackedTaskId);
    for (const linked of linkedAgents) {
      const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(linked.id);
      if (updatedAgent) broadcast("agent_status", updatedAgent);
    }
  }

  res.json({ ok: true, pid, tracked_task_id: trackedTaskId });
});

app.get("/api/agents/:id", (req, res) => {
  const id = String(req.params.id);
  const agent = db.prepare(`
    SELECT a.*, d.name AS department_name, d.name_ko AS department_name_ko, d.color AS department_color
    FROM agents a
    LEFT JOIN departments d ON a.department_id = d.id
    WHERE a.id = ?
  `).get(id);
  if (!agent) return res.status(404).json({ error: "not_found" });

  // Include recent tasks
  const recentTasks = db.prepare(
    "SELECT * FROM tasks WHERE assigned_agent_id = ? ORDER BY updated_at DESC LIMIT 10"
  ).all(id);

  res.json({ agent, recent_tasks: recentTasks });
});

app.patch("/api/agents/:id", (req, res) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const nextProviderRaw = ("cli_provider" in body ? body.cli_provider : existing.cli_provider) as string | null | undefined;
  const nextProvider = nextProviderRaw ?? "claude";
  const nextOAuthProvider = nextProvider === "copilot"
    ? "github"
    : nextProvider === "antigravity"
    ? "google_antigravity"
    : null;

  if (!nextOAuthProvider && !("oauth_account_id" in body) && ("cli_provider" in body)) {
    // Auto-clear pinned OAuth account when switching to non-OAuth provider.
    body.oauth_account_id = null;
  }
  if (nextProvider !== "api" && !("api_provider_id" in body) && ("cli_provider" in body)) {
    // Auto-clear API provider fields when switching to non-API provider.
    body.api_provider_id = null;
    body.api_model = null;
  }

  if ("oauth_account_id" in body) {
    if (body.oauth_account_id === "" || typeof body.oauth_account_id === "undefined") {
      body.oauth_account_id = null;
    }
    if (body.oauth_account_id !== null && typeof body.oauth_account_id !== "string") {
      return res.status(400).json({ error: "invalid_oauth_account_id" });
    }
    if (body.oauth_account_id && !nextOAuthProvider) {
      return res.status(400).json({ error: "oauth_account_requires_oauth_provider" });
    }
    if (body.oauth_account_id && nextOAuthProvider) {
      const oauthAccount = db.prepare(
        "SELECT id, status FROM oauth_accounts WHERE id = ? AND provider = ?"
      ).get(body.oauth_account_id, nextOAuthProvider) as { id: string; status: "active" | "disabled" } | undefined;
      if (!oauthAccount) {
        return res.status(400).json({ error: "oauth_account_not_found_for_provider" });
      }
      if (oauthAccount.status !== "active") {
        return res.status(400).json({ error: "oauth_account_disabled" });
      }
    }
  }

  const allowedFields = [
    "name", "name_ko", "department_id", "role", "cli_provider",
    "oauth_account_id", "api_provider_id", "api_model",
    "avatar_emoji", "personality", "status", "current_task_id",
  ];

  const updates: string[] = [];
  const params: unknown[] = [];

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "no_fields_to_update" });
  }

  params.push(id);
  db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...(params as SQLInputValue[]));

  const updated = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  broadcast("agent_status", updated);
  res.json({ ok: true, agent: updated });
});

app.post("/api/agents/:id/spawn", (req, res) => {
  const id = String(req.params.id);
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as {
    id: string;
    name: string;
    cli_provider: string | null;
    oauth_account_id: string | null;
    api_provider_id: string | null;
    api_model: string | null;
    current_task_id: string | null;
    status: string;
  } | undefined;
  if (!agent) return res.status(404).json({ error: "not_found" });

  const provider = agent.cli_provider || "claude";
  if (!["claude", "codex", "gemini", "opencode", "copilot", "antigravity", "api"].includes(provider)) {
    return res.status(400).json({ error: "unsupported_provider", provider });
  }

  const taskId = agent.current_task_id;
  if (!taskId) {
    return res.status(400).json({ error: "no_task_assigned", message: "Assign a task to this agent first." });
  }

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as {
    id: string;
    title: string;
    description: string | null;
    project_path: string | null;
  } | undefined;
  if (!task) {
    return res.status(400).json({ error: "task_not_found" });
  }
  const taskLang = resolveLang(task.description ?? task.title);

  const projectPath = task.project_path || process.cwd();
  const logPath = path.join(logsDir, `${taskId}.log`);
  const executionSession = ensureTaskExecutionSession(taskId, agent.id, provider);
  const availableSkillsPromptBlock = buildAvailableSkillsPromptBlock(provider);

  const prompt = buildTaskExecutionPrompt([
    availableSkillsPromptBlock,
    `[Task Session] id=${executionSession.sessionId} owner=${executionSession.agentId} provider=${executionSession.provider}`,
    "This session is scoped to this task only.",
    `[Task] ${task.title}`,
    task.description ? `\n${task.description}` : "",
    pickL(l(
      ["위 작업을 충분히 완수하세요."],
      ["Please complete the task above thoroughly."],
      ["上記タスクを丁寧に完了してください。"],
      ["请完整地完成上述任务。"],
    ), taskLang),
  ], {
    allowWarningFix: hasExplicitWarningFixRequest(task.title, task.description),
  });

  appendTaskLog(taskId, "system", `RUN start (agent=${agent.name}, provider=${provider})`);

  const spawnModelConfig = getProviderModelConfig();
  const spawnModel = spawnModelConfig[provider]?.model || undefined;
  const spawnReasoningLevel = spawnModelConfig[provider]?.reasoningLevel || undefined;

  if (provider === "api") {
    const controller = new AbortController();
    const fakePid = -(++httpAgentCounter);
    db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(id);
    db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?")
      .run(nowMs(), nowMs(), taskId);
    const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
    broadcast("agent_status", updatedAgent);
    broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
    notifyTaskStatus(taskId, task.title, "in_progress", taskLang);
    launchApiProviderAgent(taskId, agent.api_provider_id ?? null, agent.api_model ?? null, prompt, projectPath, logPath, controller, fakePid);
    return res.json({ ok: true, pid: fakePid, logPath, cwd: projectPath });
  }

  if (provider === "copilot" || provider === "antigravity") {
    const controller = new AbortController();
    const fakePid = -(++httpAgentCounter);
    // Update agent status before launching
    db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(id);
    db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?")
      .run(nowMs(), nowMs(), taskId);
    const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
    broadcast("agent_status", updatedAgent);
    broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
    notifyTaskStatus(taskId, task.title, "in_progress", taskLang);
    launchHttpAgent(taskId, provider, prompt, projectPath, logPath, controller, fakePid, agent.oauth_account_id ?? null);
    return res.json({ ok: true, pid: fakePid, logPath, cwd: projectPath });
  }

  const child = spawnCliAgent(taskId, provider, prompt, projectPath, logPath, spawnModel, spawnReasoningLevel);

  child.on("close", (code) => {
    handleTaskRunComplete(taskId, code ?? 1);
  });

  // Update agent status
  db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(id);
  db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?")
    .run(nowMs(), nowMs(), taskId);

  const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  broadcast("agent_status", updatedAgent);
  broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
  notifyTaskStatus(taskId, task.title, "in_progress", taskLang);

  res.json({ ok: true, pid: child.pid ?? null, logPath, cwd: projectPath });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
app.get("/api/tasks", (req, res) => {
  reconcileCrossDeptSubtasks();
  const statusFilter = firstQueryValue(req.query.status);
  const deptFilter = firstQueryValue(req.query.department_id);
  const agentFilter = firstQueryValue(req.query.agent_id);
  const projectFilter = firstQueryValue(req.query.project_id);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (statusFilter) {
    conditions.push("t.status = ?");
    params.push(statusFilter);
  }
  if (deptFilter) {
    conditions.push("t.department_id = ?");
    params.push(deptFilter);
  }
  if (agentFilter) {
    conditions.push("t.assigned_agent_id = ?");
    params.push(agentFilter);
  }
  if (projectFilter) {
    conditions.push("t.project_id = ?");
    params.push(projectFilter);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const subtaskTotalExpr = `(
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id)
    +
    (SELECT COUNT(*)
     FROM tasks c
     WHERE c.source_task_id = t.id
       AND NOT EXISTS (
         SELECT 1
         FROM subtasks s2
         WHERE s2.task_id = t.id
           AND s2.delegated_task_id = c.id
       )
    )
  )`;
  const subtaskDoneExpr = `(
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.status = 'done')
    +
    (SELECT COUNT(*)
     FROM tasks c
     WHERE c.source_task_id = t.id
       AND c.status = 'done'
       AND NOT EXISTS (
         SELECT 1
         FROM subtasks s2
         WHERE s2.task_id = t.id
           AND s2.delegated_task_id = c.id
       )
    )
  )`;

  const tasks = db.prepare(`
    SELECT t.*,
      a.name AS agent_name,
      a.avatar_emoji AS agent_avatar,
      d.name AS department_name,
      d.icon AS department_icon,
      p.name AS project_name,
      p.core_goal AS project_core_goal,
      ${subtaskTotalExpr} AS subtask_total,
      ${subtaskDoneExpr} AS subtask_done
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent_id = a.id
    LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN projects p ON t.project_id = p.id
    ${where}
    ORDER BY t.priority DESC, t.updated_at DESC
  `).all(...(params as SQLInputValue[]));

  res.json({ tasks });
});

app.post("/api/tasks", (req, res) => {
  const body = req.body ?? {};
  const id = randomUUID();
  const t = nowMs();

  const title = body.title;
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "title_required" });
  }

  const requestedProjectId = normalizeTextField(body.project_id);
  let resolvedProjectId: string | null = null;
  let resolvedProjectPath = normalizeTextField(body.project_path);
  if (requestedProjectId) {
    const project = db.prepare("SELECT id, project_path FROM projects WHERE id = ?").get(requestedProjectId) as {
      id: string;
      project_path: string;
    } | undefined;
    if (!project) return res.status(400).json({ error: "project_not_found" });
    resolvedProjectId = project.id;
    if (!resolvedProjectPath) resolvedProjectPath = normalizeTextField(project.project_path);
  }

  db.prepare(`
    INSERT INTO tasks (id, title, description, department_id, assigned_agent_id, project_id, status, priority, task_type, project_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    body.description ?? null,
    body.department_id ?? null,
    body.assigned_agent_id ?? null,
    resolvedProjectId,
    body.status ?? "inbox",
    body.priority ?? 0,
    body.task_type ?? "general",
    resolvedProjectPath,
    t,
    t,
  );
  recordTaskCreationAudit({
    taskId: id,
    taskTitle: title,
    taskStatus: String(body.status ?? "inbox"),
    departmentId: typeof body.department_id === "string" ? body.department_id : null,
    assignedAgentId: typeof body.assigned_agent_id === "string" ? body.assigned_agent_id : null,
    taskType: typeof body.task_type === "string" ? body.task_type : "general",
    projectPath: resolvedProjectPath,
    trigger: "api.tasks.create",
    triggerDetail: "POST /api/tasks",
    actorType: "api_client",
    req,
    body: typeof body === "object" && body ? body as Record<string, unknown> : null,
  });

  if (resolvedProjectId) {
    db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(t, t, resolvedProjectId);
  }

  appendTaskLog(id, "system", `Task created: ${title}`);

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  broadcast("task_update", task);
  res.json({ id, task });
});

app.get("/api/tasks/:id", (req, res) => {
  const id = String(req.params.id);
  reconcileCrossDeptSubtasks(id);
  const subtaskTotalExpr = `(
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id)
    +
    (SELECT COUNT(*)
     FROM tasks c
     WHERE c.source_task_id = t.id
       AND NOT EXISTS (
         SELECT 1
         FROM subtasks s2
         WHERE s2.task_id = t.id
           AND s2.delegated_task_id = c.id
       )
    )
  )`;
  const subtaskDoneExpr = `(
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.status = 'done')
    +
    (SELECT COUNT(*)
     FROM tasks c
     WHERE c.source_task_id = t.id
       AND c.status = 'done'
       AND NOT EXISTS (
         SELECT 1
         FROM subtasks s2
         WHERE s2.task_id = t.id
           AND s2.delegated_task_id = c.id
       )
    )
  )`;
  const task = db.prepare(`
    SELECT t.*,
      a.name AS agent_name,
      a.avatar_emoji AS agent_avatar,
      a.cli_provider AS agent_provider,
      d.name AS department_name,
      d.icon AS department_icon,
      p.name AS project_name,
      p.core_goal AS project_core_goal,
      ${subtaskTotalExpr} AS subtask_total,
      ${subtaskDoneExpr} AS subtask_done
    FROM tasks t
    LEFT JOIN agents a ON t.assigned_agent_id = a.id
    LEFT JOIN departments d ON t.department_id = d.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `).get(id);
  if (!task) return res.status(404).json({ error: "not_found" });

  const logs = db.prepare(
    "SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 200"
  ).all(id);

  const subtasks = db.prepare(
    "SELECT * FROM subtasks WHERE task_id = ? ORDER BY created_at"
  ).all(id);

  res.json({ task, logs, subtasks });
});

app.get("/api/tasks/:id/meeting-minutes", (req, res) => {
  const id = String(req.params.id);
  const task = db.prepare("SELECT id, source_task_id FROM tasks WHERE id = ?").get(id) as { id: string; source_task_id: string | null } | undefined;
  if (!task) return res.status(404).json({ error: "not_found" });

  // Include meeting minutes from the source (original) task if this is a collaboration task
  const taskIds = [id];
  if (task.source_task_id) taskIds.push(task.source_task_id);

  const meetings = db.prepare(
    `SELECT * FROM meeting_minutes WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY started_at DESC, round DESC`
  ).all(...taskIds) as unknown as MeetingMinutesRow[];

  const data = meetings.map((meeting) => {
    const entries = db.prepare(
      "SELECT * FROM meeting_minute_entries WHERE meeting_id = ? ORDER BY seq ASC, id ASC"
    ).all(meeting.id) as unknown as MeetingMinuteEntryRow[];
    return { ...meeting, entries };
  });

  res.json({ meetings: data });
});

app.patch("/api/tasks/:id", (req, res) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const body = req.body ?? {};
  const allowedFields = [
    "title", "description", "department_id", "assigned_agent_id",
    "status", "priority", "task_type", "project_path", "result",
  ];

  const updates: string[] = ["updated_at = ?"];
  const updateTs = nowMs();
  const params: unknown[] = [updateTs];
  let touchedProjectId: string | null = null;

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
    }
  }

  if ("project_id" in body) {
    const requestedProjectId = normalizeTextField(body.project_id);
    if (!requestedProjectId) {
      updates.push("project_id = ?");
      params.push(null);
    } else {
      const project = db.prepare("SELECT id, project_path FROM projects WHERE id = ?").get(requestedProjectId) as {
        id: string;
        project_path: string;
      } | undefined;
      if (!project) return res.status(400).json({ error: "project_not_found" });
      updates.push("project_id = ?");
      params.push(project.id);
      touchedProjectId = project.id;
      if (!("project_path" in body)) {
        updates.push("project_path = ?");
        params.push(project.project_path);
      }
    }
  }

  // Handle completed_at for status changes
  if (body.status === "done" && !("completed_at" in body)) {
    updates.push("completed_at = ?");
    params.push(nowMs());
  }
  if (body.status === "in_progress" && !("started_at" in body)) {
    updates.push("started_at = ?");
    params.push(nowMs());
  }

  params.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...(params as SQLInputValue[]));
  if (touchedProjectId) {
    db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(updateTs, updateTs, touchedProjectId);
  }

  const nextStatus = typeof body.status === "string" ? body.status : null;
  if (nextStatus) {
    setTaskCreationAuditCompletion(id, nextStatus === "done");
  }
  if (nextStatus && (nextStatus === "cancelled" || nextStatus === "pending" || nextStatus === "done" || nextStatus === "inbox")) {
    clearTaskWorkflowState(id);
    if (nextStatus === "done" || nextStatus === "cancelled") {
      endTaskExecutionSession(id, `task_status_${nextStatus}`);
    }
  }

  appendTaskLog(id, "system", `Task updated: ${Object.keys(body).join(", ")}`);

  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  broadcast("task_update", updated);
  res.json({ ok: true, task: updated });
});

app.delete("/api/tasks/:id", (req, res) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as {
    assigned_agent_id: string | null;
  } | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  endTaskExecutionSession(id, "task_deleted");
  clearTaskWorkflowState(id);

  // Kill any running process
  const activeChild = activeProcesses.get(id);
  if (activeChild?.pid) {
    stopRequestedTasks.add(id);
    if (activeChild.pid < 0) {
      activeChild.kill();
    } else {
      killPidTree(activeChild.pid);
    }
    activeProcesses.delete(id);
  }

  // Reset agent if assigned
  if (existing.assigned_agent_id) {
    db.prepare(
      "UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ? AND current_task_id = ?"
    ).run(existing.assigned_agent_id, id);
  }

  db.prepare("DELETE FROM task_logs WHERE task_id = ?").run(id);
  db.prepare("DELETE FROM messages WHERE task_id = ?").run(id);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);

  // Clean up log files
  for (const suffix of [".log", ".prompt.txt"]) {
    const filePath = path.join(logsDir, `${id}${suffix}`);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  broadcast("task_update", { id, deleted: true });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// SubTask endpoints
// ---------------------------------------------------------------------------

// GET /api/subtasks?active=1 — active subtasks for in_progress tasks
app.get("/api/subtasks", (req, res) => {
  const active = firstQueryValue(req.query.active);
  let subtasks;
  if (active === "1") {
    subtasks = db.prepare(`
      SELECT s.* FROM subtasks s
      JOIN tasks t ON s.task_id = t.id
      WHERE t.status IN ('planned', 'collaborating', 'in_progress', 'review')
      ORDER BY s.created_at
    `).all();
  } else {
    subtasks = db.prepare("SELECT * FROM subtasks ORDER BY created_at").all();
  }
  res.json({ subtasks });
});

// POST /api/tasks/:id/subtasks — create subtask manually
app.post("/api/tasks/:id/subtasks", (req, res) => {
  const taskId = String(req.params.id);
  const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId);
  if (!task) return res.status(404).json({ error: "task_not_found" });

  const body = req.body ?? {};
  if (!body.title || typeof body.title !== "string") {
    return res.status(400).json({ error: "title_required" });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO subtasks (id, task_id, title, description, status, assigned_agent_id, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, taskId, body.title, body.description ?? null, body.assigned_agent_id ?? null, nowMs());

  // Detect foreign department for manual subtask creation too
  const parentTaskDept = db.prepare(
    "SELECT department_id FROM tasks WHERE id = ?"
  ).get(taskId) as { department_id: string | null } | undefined;
  const targetDeptId = analyzeSubtaskDepartment(body.title, parentTaskDept?.department_id ?? null);
  if (targetDeptId) {
    const targetDeptName = getDeptName(targetDeptId);
    db.prepare(
      "UPDATE subtasks SET target_department_id = ?, status = 'blocked', blocked_reason = ? WHERE id = ?"
    ).run(targetDeptId, `${targetDeptName} 협업 대기`, id);
  }

  const subtask = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(id);
  broadcast("subtask_update", subtask);
  res.json(subtask);
});

// PATCH /api/subtasks/:id — update subtask
app.patch("/api/subtasks/:id", (req, res) => {
  const id = String(req.params.id);
  const existing = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: "not_found" });

  const body = req.body ?? {};
  const allowedFields = ["title", "description", "status", "assigned_agent_id", "blocked_reason", "target_department_id", "delegated_task_id"];
  const updates: string[] = [];
  const params: unknown[] = [];

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
    }
  }

  // Auto-set completed_at when transitioning to done
  if (body.status === "done" && existing.status !== "done") {
    updates.push("completed_at = ?");
    params.push(nowMs());
  }

  if (updates.length === 0) return res.status(400).json({ error: "no_fields" });

  params.push(id);
  db.prepare(`UPDATE subtasks SET ${updates.join(", ")} WHERE id = ?`).run(...(params as SQLInputValue[]));

  const subtask = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(id);
  broadcast("subtask_update", subtask);
  res.json(subtask);
});

app.post("/api/tasks/:id/assign", (req, res) => {
  const id = String(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as {
    id: string;
    assigned_agent_id: string | null;
    title: string;
  } | undefined;
  if (!task) return res.status(404).json({ error: "not_found" });

  const agentId = req.body?.agent_id;
  if (!agentId || typeof agentId !== "string") {
    return res.status(400).json({ error: "agent_id_required" });
  }

  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as {
    id: string;
    name: string;
    department_id: string | null;
  } | undefined;
  if (!agent) return res.status(404).json({ error: "agent_not_found" });

  const t = nowMs();

  // Unassign previous agent if different
  if (task.assigned_agent_id && task.assigned_agent_id !== agentId) {
    db.prepare(
      "UPDATE agents SET current_task_id = NULL WHERE id = ? AND current_task_id = ?"
    ).run(task.assigned_agent_id, id);
  }

  // Update task
  db.prepare(
    "UPDATE tasks SET assigned_agent_id = ?, department_id = COALESCE(department_id, ?), status = CASE WHEN status = 'inbox' THEN 'planned' ELSE status END, updated_at = ? WHERE id = ?"
  ).run(agentId, agent.department_id, t, id);

  // Update agent
  db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(id, agentId);

  appendTaskLog(id, "system", `Assigned to agent: ${agent.name}`);

  // Create assignment message
  const msgId = randomUUID();
  db.prepare(
    `INSERT INTO messages (id, sender_type, sender_id, receiver_type, receiver_id, content, message_type, task_id, created_at)
     VALUES (?, 'ceo', NULL, 'agent', ?, ?, 'task_assign', ?, ?)`
  ).run(msgId, agentId, `New task assigned: ${task.title}`, id, t);

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);

  broadcast("task_update", updatedTask);
  broadcast("agent_status", updatedAgent);
  broadcast("new_message", {
    id: msgId,
    sender_type: "ceo",
    receiver_type: "agent",
    receiver_id: agentId,
    content: `New task assigned: ${task.title}`,
    message_type: "task_assign",
    task_id: id,
    created_at: t,
  });

  // B4: Notify CEO about assignment via team leader
  const leader = findTeamLeader(agent.department_id);
  if (leader) {
    const lang = resolveLang(task.title);
    const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
    const agentName = agentRow ? getAgentDisplayName(agentRow, lang) : agent.name;
    const leaderName = getAgentDisplayName(leader, lang);
    sendAgentMessage(
      leader,
      pickL(l(
        [`${leaderName}이(가) ${agentName}에게 '${task.title}' 업무를 할당했습니다.`],
        [`${leaderName} assigned '${task.title}' to ${agentName}.`],
        [`${leaderName}が '${task.title}' を${agentName}に割り当てました。`],
        [`${leaderName} 已将 '${task.title}' 分配给 ${agentName}。`],
      ), lang),
      "status_update",
      "all",
      null,
      id,
    );
  }

  res.json({ ok: true, task: updatedTask, agent: updatedAgent });
});

app.post("/api/tasks/:id/run", (req, res) => {
  const id = String(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as {
    id: string;
    title: string;
    description: string | null;
    assigned_agent_id: string | null;
    project_path: string | null;
    status: string;
  } | undefined;
  if (!task) return res.status(404).json({ error: "not_found" });
  const taskLang = resolveLang(task.description ?? task.title);

  // --- Stale process cleanup ---
  // activeProcesses에 있지만 PID가 실제로 죽은 경우 정리
  if (activeProcesses.has(id)) {
    const staleChild = activeProcesses.get(id);
    const stalePid = typeof staleChild?.pid === "number" ? staleChild.pid : null;
    // HTTP agents use negative fake PIDs (always dead after restart); CLI agents check process.kill(pid, 0)
    let pidIsAlive = false;
    if (stalePid !== null && stalePid > 0) {
      try { process.kill(stalePid, 0); pidIsAlive = true; } catch { pidIsAlive = false; }
    }
    if (!pidIsAlive) {
      activeProcesses.delete(id);
      appendTaskLog(id, "system", `Cleaned up stale process handle (pid=${stalePid}) on re-run attempt`);
    }
  }

  // task가 in_progress이지만 실제 프로세스가 없으면 (서버 재시작 등) 상태 리셋 후 재실행 허용
  if (task.status === "in_progress" || task.status === "collaborating") {
    if (activeProcesses.has(id)) {
      return res.status(400).json({ error: "already_running" });
    }
    // 프로세스 없이 in_progress 상태 → stale. 리셋하고 재실행 허용
    const t = nowMs();
    db.prepare("UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ?").run(t, id);
    task.status = "pending";
    appendTaskLog(id, "system", `Reset stale in_progress status (no active process) for re-run`);
  }

  // 실제 활성 프로세스가 있으면 실행 거부
  if (activeProcesses.has(id)) {
    return res.status(409).json({
      error: "process_still_active",
      message: "Previous run is still stopping. Please retry after a moment.",
    });
  }

  // Get the agent (or use provided agent_id)
  const agentId = task.assigned_agent_id || (req.body?.agent_id as string | undefined);
  if (!agentId) {
    return res.status(400).json({ error: "no_agent_assigned", message: "Assign an agent before running." });
  }

  const agent = db.prepare(`
    SELECT a.*, d.name AS department_name, d.name_ko AS department_name_ko
    FROM agents a LEFT JOIN departments d ON a.department_id = d.id
    WHERE a.id = ?
  `).get(agentId) as {
    id: string;
    name: string;
    name_ko: string | null;
    role: string;
    cli_provider: string | null;
    oauth_account_id: string | null;
    api_provider_id: string | null;
    api_model: string | null;
    personality: string | null;
    department_id: string | null;
    department_name: string | null;
    department_name_ko: string | null;
  } | undefined;
  if (!agent) return res.status(400).json({ error: "agent_not_found" });

  // Guard: agent already working on another task
  const agentBusy = activeProcesses.has(
    (db.prepare("SELECT current_task_id FROM agents WHERE id = ? AND status = 'working'").get(agentId) as { current_task_id: string | null } | undefined)?.current_task_id ?? ""
  );
  if (agentBusy) {
    return res.status(400).json({ error: "agent_busy", message: `${agent.name} is already working on another task.` });
  }

  const provider = agent.cli_provider || "claude";
  if (!["claude", "codex", "gemini", "opencode", "copilot", "antigravity", "api"].includes(provider)) {
    return res.status(400).json({ error: "unsupported_provider", provider });
  }
  const executionSession = ensureTaskExecutionSession(id, agentId, provider);

  const projectPath = resolveProjectPath(task) || (req.body?.project_path as string | undefined) || process.cwd();
  const logPath = path.join(logsDir, `${id}.log`);

  // Try to create a Git worktree for agent isolation
  const worktreePath = createWorktree(projectPath, id, agent.name);
  const agentCwd = worktreePath || projectPath;

  if (worktreePath) {
    appendTaskLog(id, "system", `Git worktree created: ${worktreePath} (branch: climpire/${id.slice(0, 8)})`);
  }

  // Generate project context (cached by git HEAD) and recent changes
  const projectContext = generateProjectContext(projectPath);
  const recentChanges = getRecentChanges(projectPath, id);

  // For Claude provider: ensure CLAUDE.md exists in worktree
  if (worktreePath && provider === "claude") {
    ensureClaudeMd(projectPath, worktreePath);
  }

  // Build rich prompt with agent context + conversation history + role constraint
  const roleLabel = { team_leader: "Team Leader", senior: "Senior", junior: "Junior", intern: "Intern" }[agent.role] || agent.role;
  const deptConstraint = agent.department_id ? getDeptRoleConstraint(agent.department_id, agent.department_name || agent.department_id) : "";
  const conversationCtx = getRecentConversationContext(agentId);
  const continuationCtx = getTaskContinuationContext(id);
  const continuationInstruction = continuationCtx
    ? pickL(l(
      ["연속 실행: 동일 소유 컨텍스트를 유지하고, 불필요한 파일 재탐색 없이 미해결 항목만 반영하세요."],
      ["Continuation run: keep the same ownership context, avoid re-reading unrelated files, and apply only unresolved deltas."],
      ["継続実行: 同一オーナーシップを維持し、不要な再探索を避けて未解決差分のみ反映してください。"],
      ["连续执行：保持同一责任上下文，避免重复阅读无关文件，仅处理未解决差异。"],
    ), taskLang)
    : pickL(l(
      ["반복적인 착수 멘트 없이 바로 실행하세요."],
      ["Execute directly without repeated kickoff narration."],
      ["繰り返しの開始ナレーションなしで直ちに実行してください。"],
      ["无需重复开场说明，直接执行。"],
    ), taskLang);
  const projectStructureBlock = continuationCtx
    ? ""
    : (projectContext
      ? `[Project Structure]\n${projectContext.length > 4000 ? projectContext.slice(0, 4000) + "\n... (truncated)" : projectContext}`
      : "");
  // Non-CLI or non-multi-agent providers: instruct agent to output subtask plan as JSON
  const needsPlanInstruction = provider === "gemini" || provider === "copilot" || provider === "antigravity";
  const subtaskInstruction = needsPlanInstruction
    ? `\n\n${pickL(l(
      [`[작업 계획 출력 규칙]
작업을 시작하기 전에 아래 JSON 형식으로 계획을 출력하세요:
\`\`\`json
{"subtasks": [{"title": "서브태스크 제목1"}, {"title": "서브태스크 제목2"}]}
\`\`\`
각 서브태스크를 완료할 때마다 아래 형식으로 보고하세요:
\`\`\`json
{"subtask_done": "완료된 서브태스크 제목"}
\`\`\``],
      [`[Task Plan Output Rules]
Before starting work, print a plan in the JSON format below:
\`\`\`json
{"subtasks": [{"title": "Subtask title 1"}, {"title": "Subtask title 2"}]}
\`\`\`
Whenever you complete a subtask, report it in this format:
\`\`\`json
{"subtask_done": "Completed subtask title"}
\`\`\``],
      [`[作業計画の出力ルール]
作業開始前に、次の JSON 形式で計画を出力してください:
\`\`\`json
{"subtasks": [{"title": "サブタスク1"}, {"title": "サブタスク2"}]}
\`\`\`
各サブタスクを完了するたびに、次の形式で報告してください:
\`\`\`json
{"subtask_done": "完了したサブタスク"}
\`\`\``],
      [`[任务计划输出规则]
开始工作前，请按下述 JSON 格式输出计划:
\`\`\`json
{"subtasks": [{"title": "子任务1"}, {"title": "子任务2"}]}
\`\`\`
每完成一个子任务，请按下述格式汇报:
\`\`\`json
{"subtask_done": "已完成的子任务"}
\`\`\``],
    ), taskLang)}\n`
    : "";

  // Resolve model config for this provider
  const modelConfig = getProviderModelConfig();
  const mainModel = modelConfig[provider]?.model || undefined;
  const subModel = modelConfig[provider]?.subModel || undefined;
  const mainReasoningLevel = modelConfig[provider]?.reasoningLevel || undefined;

  // Sub-agent model hint (best-effort via prompt for claude/codex)
  const subReasoningLevel = modelConfig[provider]?.subModelReasoningLevel || undefined;
  const subModelHint = subModel && (provider === "claude" || provider === "codex")
    ? `\n[Sub-agent model preference] When spawning sub-agents (Task tool), prefer using model: ${subModel}${subReasoningLevel ? ` with reasoning effort: ${subReasoningLevel}` : ""}`
    : "";
  const runInstruction = pickL(l(
    ["위 작업을 충분히 완수하세요. 위 대화 맥락과 프로젝트 구조를 참고해도 좋지만, 프로젝트 구조 탐색에 시간을 쓰지 마세요. 필요한 구조는 이미 제공되었습니다."],
    ["Please complete the task above thoroughly. Use the continuation brief, conversation context, and project structure above if relevant. Do NOT spend time exploring the project structure again unless required by unresolved checklist items."],
    ["上記タスクを丁寧に完了してください。必要に応じて継続要約・会話コンテキスト・プロジェクト構成を参照できますが、未解決チェックリストに必要な場合を除き、構成探索に時間を使わないでください。"],
    ["请完整地完成上述任务。可按需参考连续执行摘要、会话上下文和项目结构，但除非未解决清单确有需要，不要再次花时间探索项目结构。"],
  ), taskLang);

  const prompt = buildTaskExecutionPrompt([
    buildAvailableSkillsPromptBlock(provider),
    `[Task Session] id=${executionSession.sessionId} owner=${executionSession.agentId} provider=${executionSession.provider}`,
    "This session is task-scoped. Keep continuity for this task only and do not cross-contaminate context from other projects.",
    projectStructureBlock,
    recentChanges ? `[Recent Changes]\n${recentChanges}` : "",
    `[Task] ${task.title}`,
    task.description ? `\n${task.description}` : "",
    continuationCtx,
    conversationCtx,
    `\n---`,
    `Agent: ${agent.name} (${roleLabel}, ${agent.department_name || "Unassigned"})`,
    agent.personality ? `Personality: ${agent.personality}` : "",
    deptConstraint,
    worktreePath ? `NOTE: You are working in an isolated Git worktree branch (climpire/${id.slice(0, 8)}). Commit your changes normally.` : "",
    subtaskInstruction,
    subModelHint,
    continuationInstruction,
    runInstruction,
  ], {
    allowWarningFix: hasExplicitWarningFixRequest(task.title, task.description),
  });

  appendTaskLog(id, "system", `RUN start (agent=${agent.name}, provider=${provider})`);

  // API provider agent
  if (provider === "api") {
    const controller = new AbortController();
    const fakePid = -(++httpAgentCounter);

    const t = nowMs();
    db.prepare(
      "UPDATE tasks SET status = 'in_progress', assigned_agent_id = ?, started_at = ?, updated_at = ? WHERE id = ?"
    ).run(agentId, t, t, id);
    db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(id, agentId);

    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    broadcast("task_update", updatedTask);
    broadcast("agent_status", updatedAgent);
    notifyTaskStatus(id, task.title, "in_progress", taskLang);

    const assigneeName = getAgentDisplayName(agent as unknown as AgentRow, taskLang);
    const worktreeNote = worktreePath
      ? pickL(l(
        [` (격리 브랜치: climpire/${id.slice(0, 8)})`],
        [` (isolated branch: climpire/${id.slice(0, 8)})`],
        [` (分離ブランチ: climpire/${id.slice(0, 8)})`],
        [`（隔离分支: climpire/${id.slice(0, 8)}）`],
      ), taskLang)
      : "";
    notifyCeo(pickL(l(
      [`${assigneeName}가 '${task.title}' 작업을 시작했습니다.${worktreeNote}`],
      [`${assigneeName} started work on '${task.title}'.${worktreeNote}`],
      [`${assigneeName}が '${task.title}' の作業を開始しました。${worktreeNote}`],
      [`${assigneeName} 已开始处理 '${task.title}'。${worktreeNote}`],
    ), taskLang), id);

    const taskRow = db.prepare("SELECT department_id FROM tasks WHERE id = ?").get(id) as { department_id: string | null } | undefined;
    startProgressTimer(id, task.title, taskRow?.department_id ?? null);

    launchApiProviderAgent(id, agent.api_provider_id ?? null, agent.api_model ?? null, prompt, agentCwd, logPath, controller, fakePid);
    return res.json({ ok: true, pid: fakePid, logPath, cwd: agentCwd, worktree: !!worktreePath });
  }

  // HTTP agent for copilot/antigravity
  if (provider === "copilot" || provider === "antigravity") {
    const controller = new AbortController();
    const fakePid = -(++httpAgentCounter);

    const t = nowMs();
    db.prepare(
      "UPDATE tasks SET status = 'in_progress', assigned_agent_id = ?, started_at = ?, updated_at = ? WHERE id = ?"
    ).run(agentId, t, t, id);
    db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(id, agentId);

    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    broadcast("task_update", updatedTask);
    broadcast("agent_status", updatedAgent);
    notifyTaskStatus(id, task.title, "in_progress", taskLang);

    const assigneeName = getAgentDisplayName(agent as unknown as AgentRow, taskLang);
    const worktreeNote = worktreePath
      ? pickL(l(
        [` (격리 브랜치: climpire/${id.slice(0, 8)})`],
        [` (isolated branch: climpire/${id.slice(0, 8)})`],
        [` (分離ブランチ: climpire/${id.slice(0, 8)})`],
        [`（隔离分支: climpire/${id.slice(0, 8)}）`],
      ), taskLang)
      : "";
    notifyCeo(pickL(l(
      [`${assigneeName}가 '${task.title}' 작업을 시작했습니다.${worktreeNote}`],
      [`${assigneeName} started work on '${task.title}'.${worktreeNote}`],
      [`${assigneeName}が '${task.title}' の作業を開始しました。${worktreeNote}`],
      [`${assigneeName} 已开始处理 '${task.title}'。${worktreeNote}`],
    ), taskLang), id);

    const taskRow = db.prepare("SELECT department_id FROM tasks WHERE id = ?").get(id) as { department_id: string | null } | undefined;
    startProgressTimer(id, task.title, taskRow?.department_id ?? null);

    launchHttpAgent(id, provider, prompt, agentCwd, logPath, controller, fakePid, agent.oauth_account_id ?? null);
    return res.json({ ok: true, pid: fakePid, logPath, cwd: agentCwd, worktree: !!worktreePath });
  }

  const child = spawnCliAgent(id, provider, prompt, agentCwd, logPath, mainModel, mainReasoningLevel);

  child.on("close", (code) => {
    handleTaskRunComplete(id, code ?? 1);
  });

  const t = nowMs();

  // Update task status
  db.prepare(
    "UPDATE tasks SET status = 'in_progress', assigned_agent_id = ?, started_at = ?, updated_at = ? WHERE id = ?"
  ).run(agentId, t, t, id);

  // Update agent status
  db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(id, agentId);

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
  broadcast("task_update", updatedTask);
  broadcast("agent_status", updatedAgent);
  notifyTaskStatus(id, task.title, "in_progress", taskLang);

  // B4: Notify CEO that task started
  const assigneeName = getAgentDisplayName(agent as unknown as AgentRow, taskLang);
  const worktreeNote = worktreePath
    ? pickL(l(
      [` (격리 브랜치: climpire/${id.slice(0, 8)})`],
      [` (isolated branch: climpire/${id.slice(0, 8)})`],
      [` (分離ブランチ: climpire/${id.slice(0, 8)})`],
      [`（隔离分支: climpire/${id.slice(0, 8)}）`],
    ), taskLang)
    : "";
  notifyCeo(pickL(l(
    [`${assigneeName}가 '${task.title}' 작업을 시작했습니다.${worktreeNote}`],
    [`${assigneeName} started work on '${task.title}'.${worktreeNote}`],
    [`${assigneeName}が '${task.title}' の作業を開始しました。${worktreeNote}`],
    [`${assigneeName} 已开始处理 '${task.title}'。${worktreeNote}`],
  ), taskLang), id);

  // B2: Start progress report timer for long-running tasks
  const taskRow = db.prepare("SELECT department_id FROM tasks WHERE id = ?").get(id) as { department_id: string | null } | undefined;
  startProgressTimer(id, task.title, taskRow?.department_id ?? null);

  res.json({ ok: true, pid: child.pid ?? null, logPath, cwd: agentCwd, worktree: !!worktreePath });
});

app.post("/api/tasks/:id/stop", (req, res) => {
  const id = String(req.params.id);
  // mode=pause → pending (can resume), mode=cancel or default → cancelled
  const mode = String(req.body?.mode ?? req.query.mode ?? "cancel");
  const targetStatus = mode === "pause" ? "pending" : "cancelled";

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as {
    id: string;
    title: string;
    assigned_agent_id: string | null;
    department_id: string | null;
  } | undefined;
  if (!task) return res.status(404).json({ error: "not_found" });
  const lang = resolveLang(task.title);

  stopProgressTimer(id);

  const activeChild = activeProcesses.get(id);
  if (!activeChild?.pid) {
    // No active process; just update status
    if (targetStatus !== "pending") {
      clearTaskWorkflowState(id);
      endTaskExecutionSession(id, `stop_${targetStatus}`);
    }
    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(targetStatus, nowMs(), id);
    const shouldRollback = targetStatus !== "pending";
    const rolledBack = shouldRollback
      ? rollbackTaskWorktree(id, `stop_${targetStatus}_no_active_process`)
      : false;
    if (task.assigned_agent_id) {
      db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?").run(task.assigned_agent_id);
    }
    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    broadcast("task_update", updatedTask);
    if (targetStatus === "pending") {
      notifyCeo(pickL(l(
        [`'${task.title}' 작업이 보류 상태로 전환되었습니다. 세션은 유지되며 재개 시 이어서 진행됩니다.${rolledBack ? " 코드 변경분은 git rollback 처리되었습니다." : ""}`],
        [`'${task.title}' was moved to pending. The session is preserved and will continue on resume.${rolledBack ? " Code changes were rolled back via git." : ""}`],
        [`'${task.title}' は保留状態に変更されました。セッションは維持され、再開時に継続します。${rolledBack ? " コード変更は git でロールバックされました。" : ""}`],
        [`'${task.title}' 已转为待处理状态。会话会被保留，恢复后将继续执行。${rolledBack ? " 代码变更已通过 git 回滚。" : ""}`],
      ), lang), id);
    } else {
      notifyCeo(pickL(l(
        [`'${task.title}' 작업이 취소되었습니다.${rolledBack ? " 코드 변경분은 git rollback 처리되었습니다." : ""}`],
        [`'${task.title}' was cancelled.${rolledBack ? " Code changes were rolled back via git." : ""}`],
        [`'${task.title}' はキャンセルされました。${rolledBack ? " コード変更は git でロールバックされました。" : ""}`],
        [`'${task.title}' 已取消。${rolledBack ? " 代码变更已通过 git 回滚。" : ""}`],
      ), lang), id);
    }
    return res.json({
      ok: true,
      stopped: false,
      status: targetStatus,
      rolled_back: rolledBack,
      message: "No active process found.",
    });
  }

  // For HTTP agents (negative PID), call kill() which triggers AbortController
  // For CLI agents (positive PID), use OS-level process kill
  stopRequestedTasks.add(id);
  stopRequestModeByTask.set(id, targetStatus === "pending" ? "pause" : "cancel");
  if (targetStatus === "pending") {
    if (activeChild.pid < 0) {
      activeChild.kill();
    } else {
      interruptPidTree(activeChild.pid);
    }
  } else {
    if (activeChild.pid < 0) {
      activeChild.kill();
    } else {
      killPidTree(activeChild.pid);
    }
  }

  const actionLabel = targetStatus === "pending" ? "PAUSE_BREAK" : "STOP";
  appendTaskLog(
    id,
    "system",
    targetStatus === "pending"
      ? `${actionLabel} sent to pid ${activeChild.pid} (graceful interrupt, session_kept=true)`
      : `${actionLabel} sent to pid ${activeChild.pid}`,
  );

  const shouldRollback = targetStatus !== "pending";
  const rolledBack = shouldRollback ? rollbackTaskWorktree(id, `stop_${targetStatus}`) : false;

  const t = nowMs();
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(targetStatus, t, id);
  if (targetStatus !== "pending") {
    clearTaskWorkflowState(id);
    endTaskExecutionSession(id, `stop_${targetStatus}`);
  }

  if (task.assigned_agent_id) {
    db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?").run(task.assigned_agent_id);
    const updatedAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id);
    broadcast("agent_status", updatedAgent);
  }

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  broadcast("task_update", updatedTask);

  // CEO notification
  if (targetStatus === "pending") {
    notifyCeo(pickL(l(
      [`'${task.title}' 작업이 보류 상태로 전환되었습니다. 인터럽트(SIGINT)로 브레이크를 걸었고 세션은 유지됩니다.${rolledBack ? " 코드 변경분은 git rollback 처리되었습니다." : ""}`],
      [`'${task.title}' was moved to pending. A graceful interrupt (SIGINT) was sent and the session is preserved.${rolledBack ? " Code changes were rolled back via git." : ""}`],
      [`'${task.title}' は保留状態に変更されました。SIGINT による中断を送り、セッションは維持されます。${rolledBack ? " コード変更は git でロールバックされました。" : ""}`],
      [`'${task.title}' 已转为待处理状态。已发送 SIGINT 中断，且会话将被保留。${rolledBack ? " 代码变更已通过 git 回滚。" : ""}`],
    ), lang), id);
  } else {
    notifyCeo(pickL(l(
      [`'${task.title}' 작업이 취소되었습니다.${rolledBack ? " 코드 변경분은 git rollback 처리되었습니다." : ""}`],
      [`'${task.title}' was cancelled.${rolledBack ? " Code changes were rolled back via git." : ""}`],
      [`'${task.title}' はキャンセルされました。${rolledBack ? " コード変更は git でロールバックされました。" : ""}`],
      [`'${task.title}' 已取消。${rolledBack ? " 代码变更已通过 git 回滚。" : ""}`],
    ), lang), id);
  }

  res.json({ ok: true, stopped: true, status: targetStatus, pid: activeChild.pid, rolled_back: rolledBack });
});

// Resume a pending or cancelled task → move back to planned (ready to re-run)
app.post("/api/tasks/:id/resume", (req, res) => {
  const id = String(req.params.id);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as {
    id: string;
    title: string;
    status: string;
    assigned_agent_id: string | null;
  } | undefined;
  if (!task) return res.status(404).json({ error: "not_found" });
  const lang = resolveLang(task.title);
  if (activeProcesses.has(id)) {
    return res.status(409).json({
      error: "already_running",
      message: "Task process is already active.",
    });
  }

  if (task.status !== "pending" && task.status !== "cancelled") {
    return res.status(400).json({ error: "invalid_status", message: `Cannot resume from '${task.status}'` });
  }

  const wasPaused = task.status === "pending";
  const targetStatus = task.assigned_agent_id ? "planned" : "inbox";
  const t = nowMs();
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(targetStatus, t, id);

  appendTaskLog(id, "system", `RESUME: ${task.status} → ${targetStatus}`);

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  broadcast("task_update", updatedTask);

  let autoResumed = false;
  const existingSession = taskExecutionSessions.get(id);
  if (wasPaused && task.assigned_agent_id) {
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id) as AgentRow | undefined;
    if (agent && agent.status !== "offline") {
      autoResumed = true;
      const deptId = agent.department_id ?? null;
      const deptName = deptId ? getDeptName(deptId) : "Unassigned";
      appendTaskLog(
        id,
        "system",
        `RESUME auto-run scheduled (session=${existingSession?.sessionId ?? "new"})`,
      );
      setTimeout(() => {
        if (isTaskWorkflowInterrupted(id) || activeProcesses.has(id)) return;
        startTaskExecutionForAgent(id, agent, deptId, deptName);
      }, randomDelay(450, 900));
    }
  }

  if (autoResumed) {
    notifyCeo(pickL(l(
      [`'${task.title}' 작업이 복구되었습니다. (${targetStatus}) 기존 세션을 유지한 채 자동 재개를 시작합니다.`],
      [`'${task.title}' was resumed. (${targetStatus}) Auto-resume is starting with the existing session preserved.`],
      [`'${task.title}' が復旧されました。(${targetStatus}) 既存セッションを保持したまま自動再開します。`],
      [`'${task.title}' 已恢复。(${targetStatus}) 将在保留原会话的情况下自动继续执行。`],
    ), lang), id);
  } else {
    notifyCeo(pickL(l(
      [`'${task.title}' 작업이 복구되었습니다. (${targetStatus})`],
      [`'${task.title}' was resumed. (${targetStatus})`],
      [`'${task.title}' が復旧されました。(${targetStatus})`],
      [`'${task.title}' 已恢复。(${targetStatus})`],
    ), lang), id);
  }

  res.json({ ok: true, status: targetStatus, auto_resumed: autoResumed, session_id: existingSession?.sessionId ?? null });
});

  return {

  };
}
