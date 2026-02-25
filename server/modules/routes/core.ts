import type { RuntimeContext } from "../../types/runtime-context.ts";
import type { SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { INBOX_WEBHOOK_SECRET, PKG_VERSION } from "../../config/runtime.ts";
import { notifyTaskStatus, gatewayHttpInvoke } from "../../gateway/client.ts";
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
} from "../../oauth/helpers.ts";
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
import { registerAgentRoutes } from "./core/agents/index.ts";
import { registerDepartmentRoutes } from "./core/departments.ts";
import { registerGitHubRoutes } from "./core/github-routes.ts";
import { registerProjectRoutes } from "./core/projects.ts";
import { registerTaskCrudRoutes } from "./core/tasks/crud.ts";
import { registerTaskExecutionRoutes } from "./core/tasks/execution.ts";
import { registerTaskSubtaskRoutes } from "./core/tasks/subtasks.ts";
import type { AgentRow, MeetingMinuteEntryRow, MeetingMinutesRow, MeetingReviewDecision } from "./shared/types.ts";

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
  const getNextHttpAgentPid = __ctx.getNextHttpAgentPid;
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
  const runInTransaction = __ctx.runInTransaction;
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
  const UPDATE_CHECK_TTL_MS = Math.max(
    60_000,
    Number(process.env.UPDATE_CHECK_TTL_MS ?? 30 * 60 * 1000) || 30 * 60 * 1000,
  );
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

  const AUTO_UPDATE_DEFAULT_ENABLED = String(process.env.AUTO_UPDATE_ENABLED ?? "0").trim() === "1";
  const AUTO_UPDATE_ENABLED_SETTING_KEY = "autoUpdateEnabled";
  const parsedAutoUpdateChannel = parseAutoUpdateChannel(process.env.AUTO_UPDATE_CHANNEL);
  const AUTO_UPDATE_CHANNEL = parsedAutoUpdateChannel.channel;
  if (parsedAutoUpdateChannel.warning) {
    console.warn(`[auto-update] ${parsedAutoUpdateChannel.warning}`);
  }
  const AUTO_UPDATE_IDLE_ONLY = String(process.env.AUTO_UPDATE_IDLE_ONLY ?? "1").trim() !== "0";
  const AUTO_UPDATE_CHECK_INTERVAL_MS = Math.max(
    60_000,
    Number(process.env.AUTO_UPDATE_CHECK_INTERVAL_MS ?? UPDATE_CHECK_TTL_MS) || UPDATE_CHECK_TTL_MS,
  );
  // Delay before first automatic update check after startup (AUTO_UPDATE_INITIAL_DELAY_MS, default/minimum 60s).
  const AUTO_UPDATE_INITIAL_DELAY_MS = Math.max(
    60_000,
    Number(process.env.AUTO_UPDATE_INITIAL_DELAY_MS ?? 60_000) || 60_000,
  );
  const AUTO_UPDATE_TARGET_BRANCH = String(process.env.AUTO_UPDATE_TARGET_BRANCH ?? "main").trim() || "main";
  const AUTO_UPDATE_RESTART_MODE = (() => {
    const raw = String(process.env.AUTO_UPDATE_RESTART_MODE ?? "notify")
      .trim()
      .toLowerCase();
    if (raw === "exit" || raw === "command") return raw as AutoUpdateRestartMode;
    return "notify";
  })();
  const AUTO_UPDATE_RESTART_COMMAND = String(process.env.AUTO_UPDATE_RESTART_COMMAND ?? "").trim();
  const AUTO_UPDATE_EXIT_DELAY_MS = Math.max(1_200, Number(process.env.AUTO_UPDATE_EXIT_DELAY_MS ?? 10_000) || 10_000);
  const AUTO_UPDATE_TOTAL_TIMEOUT_MS = Math.max(
    60_000,
    Number(process.env.AUTO_UPDATE_TOTAL_TIMEOUT_MS ?? 900_000) || 900_000,
  );

  const updateCommandTimeoutMs = {
    // AUTO_UPDATE_GIT_FETCH_TIMEOUT_MS / AUTO_UPDATE_GIT_PULL_TIMEOUT_MS / AUTO_UPDATE_INSTALL_TIMEOUT_MS
    gitFetch: Math.max(10_000, Number(process.env.AUTO_UPDATE_GIT_FETCH_TIMEOUT_MS ?? 120_000) || 120_000),
    gitPull: Math.max(10_000, Number(process.env.AUTO_UPDATE_GIT_PULL_TIMEOUT_MS ?? 180_000) || 180_000),
    pnpmInstall: Math.max(20_000, Number(process.env.AUTO_UPDATE_INSTALL_TIMEOUT_MS ?? 300_000) || 300_000),
  };

  let autoUpdateActive = AUTO_UPDATE_DEFAULT_ENABLED;
  let autoUpdateSchedulerReady = false;

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

  let autoUpdateInFlight: Promise<unknown> | null = null;
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

  function runCommandCaptureSync(
    cmd: string,
    args: string[],
    timeoutMs: number,
  ): { ok: boolean; code: number; stdout: string; stderr: string } {
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
      const stderr = err?.stderr ? String(err.stderr) : err?.message ? String(err.message) : "";
      return {
        ok: false,
        code: Number.isFinite(err?.status) ? Number(err.status) : 1,
        stdout,
        stderr,
      };
    }
  }

  async function runCommandCapture(
    cmd: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
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
        clearTimeout(timer);
        const pid = Number(child.pid ?? 0);
        if (pid > 0) {
          killPidTree(pid);
        } else {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
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
      const row = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'in_progress'").get() as
        | { cnt?: number }
        | undefined;
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

  function parseUpdateBooleanFlag(body: any, key: string): boolean {
    const raw = body?.[key];
    if (raw === true || raw === false) return raw;

    const value = String(raw ?? "").trim();
    if (!value || value === "0") return false;
    if (value === "1") return true;

    logAutoUpdate(
      `warning: invalid boolean value for "${key}" in /api/update-apply: ${JSON.stringify(raw)}; treating as false`,
    );
    return false;
  }

  function parseStoredBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw == null) return fallback;
    const value = String(raw).trim().toLowerCase();
    if (!value) return fallback;
    if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
    if (value === "0" || value === "false" || value === "no" || value === "off") return false;
    return fallback;
  }

  function readAutoUpdateEnabledSetting(): boolean {
    return parseStoredBoolean(readSettingString(AUTO_UPDATE_ENABLED_SETTING_KEY), AUTO_UPDATE_DEFAULT_ENABLED);
  }

  function writeAutoUpdateEnabledSetting(enabled: boolean): void {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(AUTO_UPDATE_ENABLED_SETTING_KEY, enabled ? "true" : "false");
  }

  function refreshAutoUpdateActiveState(): boolean {
    autoUpdateActive = readAutoUpdateEnabledSetting();
    return autoUpdateActive;
  }

  function isLikelyManagedRuntime(): boolean {
    return Boolean(
      process.env.pm_id ||
      process.env.PM2_HOME ||
      process.env.INVOCATION_ID ||
      process.env.KUBERNETES_SERVICE_HOST ||
      process.env.CONTAINER ||
      process.env.DOCKER_CONTAINER,
    );
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
    const startedTickMs = performance.now();
    const elapsedMs = (): number => Math.max(0, performance.now() - startedTickMs);
    const remainingTimeout = (fallbackMs: number): number => {
      const remain = AUTO_UPDATE_TOTAL_TIMEOUT_MS - elapsedMs();
      return Math.max(1_000, Math.min(fallbackMs, remain));
    };
    const hasExceededTotalTimeout = (): boolean => elapsedMs() >= AUTO_UPDATE_TOTAL_TIMEOUT_MS;

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
        restart: {
          mode: AUTO_UPDATE_RESTART_MODE,
          scheduled: false,
          command: AUTO_UPDATE_RESTART_COMMAND || undefined,
        },
        error: null,
      };
    }

    const forceRefresh = options.trigger === "manual" && !dryRun;
    const status = await fetchUpdateStatus(forceRefresh);
    const deltaKind = computeVersionDeltaKind(PKG_VERSION, status.latest_version);

    if (!status.update_available) reasons.push("no_update_available");
    // Fail closed when channel enforcement needs release metadata but latest version is unavailable.
    if (AUTO_UPDATE_CHANNEL !== "all" && !status.latest_version) {
      reasons.push("channel_check_unavailable");
    }
    if (deltaKind !== "none" && !isDeltaAllowedByChannel(deltaKind, AUTO_UPDATE_CHANNEL)) {
      reasons.push(`channel_blocked:${deltaKind}`);
    }

    const branchRes = await runCommandCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], 10_000);
    const branchName = branchRes.stdout.trim();
    if (!branchRes.ok || !branchName) {
      reasons.push("git_branch_unknown");
    } else if (branchName !== AUTO_UPDATE_TARGET_BRANCH) {
      reasons.push(`branch_not_${AUTO_UPDATE_TARGET_BRANCH}:${branchName}`);
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
        restart: {
          mode: AUTO_UPDATE_RESTART_MODE,
          scheduled: false,
          command: AUTO_UPDATE_RESTART_COMMAND || undefined,
        },
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
      const fetchRes = await runCommandCapture(
        "git",
        ["fetch", "--tags", "--prune", "origin", AUTO_UPDATE_TARGET_BRANCH],
        remainingTimeout(updateCommandTimeoutMs.gitFetch),
      );
      commands.push({
        cmd: `git fetch --tags --prune origin ${AUTO_UPDATE_TARGET_BRANCH}`,
        ok: fetchRes.ok,
        code: fetchRes.code,
        stdout_tail: tailText(fetchRes.stdout),
        stderr_tail: tailText(fetchRes.stderr),
      });
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
        const pullRes = await runCommandCapture(
          "git",
          ["pull", "--ff-only", "origin", AUTO_UPDATE_TARGET_BRANCH],
          remainingTimeout(updateCommandTimeoutMs.gitPull),
        );
        commands.push({
          cmd: `git pull --ff-only origin ${AUTO_UPDATE_TARGET_BRANCH}`,
          ok: pullRes.ok,
          code: pullRes.code,
          stdout_tail: tailText(pullRes.stdout),
          stderr_tail: tailText(pullRes.stderr),
        });
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
        const installRes = await runCommandCapture(
          "pnpm",
          ["install", "--frozen-lockfile"],
          remainingTimeout(updateCommandTimeoutMs.pnpmInstall),
        );
        commands.push({
          cmd: "pnpm install --frozen-lockfile",
          ok: installRes.ok,
          code: installRes.code,
          stdout_tail: tailText(installRes.stdout),
          stderr_tail: tailText(installRes.stderr),
        });
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
    const restart: UpdateApplyResult["restart"] = {
      mode: AUTO_UPDATE_RESTART_MODE,
      scheduled: false,
      command: AUTO_UPDATE_RESTART_COMMAND || undefined,
    };

    if (applied) {
      if (options.trigger === "auto") {
        const summary = `[Auto Update] applied ${beforeHead || "?"} -> ${afterHead || "?"} (latest=${status.latest_version || "unknown"}, mode=${AUTO_UPDATE_RESTART_MODE})`;
        try {
          notifyCeo(summary, null, "status_update");
        } catch {
          /* ignore */
        }
      }

      if (AUTO_UPDATE_RESTART_MODE === "exit") {
        // Best-effort delayed graceful exit. Prefer running under a process manager.
        logAutoUpdate(`restart mode=exit scheduled (delay_ms=${AUTO_UPDATE_EXIT_DELAY_MS})`);
        restart.scheduled = true;
        if (autoUpdateExitTimer) clearTimeout(autoUpdateExitTimer);
        restart.scheduled_exit_at = Date.now() + AUTO_UPDATE_EXIT_DELAY_MS;
        autoUpdateExitTimer = setTimeout(() => {
          logAutoUpdate(
            "auto-update initiating graceful shutdown (mode=exit); shutdown handlers should listen to SIGTERM",
          );
          process.exitCode = 0;
          let gracefulDelayMs = 0;
          if (process.listenerCount("SIGTERM") > 0) {
            try {
              process.kill(process.pid, "SIGTERM");
              gracefulDelayMs = 1500;
            } catch {
              // ignore and fallback to hard exit below
            }
          }
          setTimeout(() => process.exit(0), gracefulDelayMs);
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
            // `restart.scheduled` reflects spawn-time acceptance only.
            // Post-spawn failures are logged asynchronously below.
            child.once("error", (err) => {
              logAutoUpdate(
                `restart mode=command process error for ${parsed.cmd}: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
            child.once("exit", (code, signal) => {
              if (code !== 0) {
                logAutoUpdate(
                  `restart mode=command process for ${parsed.cmd} exited with code=${code}${signal ? ` signal=${signal}` : ""}`,
                );
              }
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

    logAutoUpdate(
      `${options.trigger} apply ${applied ? "completed" : "failed"} (${beforeHead || "?"}->${afterHead || "?"}${error ? `, error=${error}` : ""})`,
    );

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
    if (!autoUpdateSchedulerReady) return;
    refreshAutoUpdateActiveState();
    if (!autoUpdateActive) {
      autoUpdateState.next_check_at = Date.now() + AUTO_UPDATE_CHECK_INTERVAL_MS;
      return;
    }
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

  {
    const dep = validateAutoUpdateDependencies();
    if (!dep.ok) {
      autoUpdateSchedulerReady = false;
      autoUpdateActive = false;
      autoUpdateState.last_error = `missing_dependencies:${dep.missing.join(",")}`;
      logAutoUpdate(`disabled - missing dependencies (${dep.missing.join(",")})`);
    } else {
      autoUpdateSchedulerReady = true;
      refreshAutoUpdateActiveState();
      autoUpdateState.next_check_at = Date.now() + AUTO_UPDATE_INITIAL_DELAY_MS;
      logAutoUpdate(
        `scheduler ready (enabled=${autoUpdateActive ? "1" : "0"}, first_check_in_ms=${AUTO_UPDATE_INITIAL_DELAY_MS}, interval_ms=${AUTO_UPDATE_CHECK_INTERVAL_MS})`,
      );
      if (AUTO_UPDATE_RESTART_MODE === "exit" && !isLikelyManagedRuntime()) {
        logAutoUpdate(
          "warning: restart_mode=exit is enabled but no process manager was detected; process may stop after update",
        );
      }

      autoUpdateBootTimer = setTimeout(() => {
        void runAutoUpdateCycle();
      }, AUTO_UPDATE_INITIAL_DELAY_MS);
      maybeUnrefTimer(autoUpdateBootTimer);

      autoUpdateInterval = setInterval(() => {
        void runAutoUpdateCycle();
      }, AUTO_UPDATE_CHECK_INTERVAL_MS);
      maybeUnrefTimer(autoUpdateInterval);

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
          const body = (await response.json().catch(() => null)) as { tag_name?: unknown; html_url?: unknown } | null;
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

    const settingsEnabled = readAutoUpdateEnabledSetting();
    autoUpdateActive = autoUpdateSchedulerReady ? settingsEnabled : false;
    const status = await fetchUpdateStatus(false);
    res.json({
      ok: true,
      auto_update: {
        enabled: autoUpdateActive,
        configured_enabled: AUTO_UPDATE_DEFAULT_ENABLED,
        settings_enabled: settingsEnabled,
        scheduler_ready: autoUpdateSchedulerReady,
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

  app.post("/api/update-auto-config", async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const body = req.body ?? {};
    const enabled = parseUpdateBooleanFlag(body, "enabled");
    writeAutoUpdateEnabledSetting(enabled);
    autoUpdateActive = autoUpdateSchedulerReady ? enabled : false;

    if (autoUpdateSchedulerReady && enabled) {
      autoUpdateState.next_check_at = Date.now();
      setTimeout(() => {
        void runAutoUpdateCycle();
      }, 250);
    } else {
      autoUpdateState.next_check_at = Date.now() + AUTO_UPDATE_CHECK_INTERVAL_MS;
    }

    logAutoUpdate(
      `runtime toggle updated (enabled=${autoUpdateActive ? "1" : "0"}, scheduler_ready=${autoUpdateSchedulerReady ? "1" : "0"})`,
    );
    return res.json({
      ok: true,
      auto_update: {
        enabled: autoUpdateActive,
        configured_enabled: AUTO_UPDATE_DEFAULT_ENABLED,
        settings_enabled: enabled,
        scheduler_ready: autoUpdateSchedulerReady,
      },
    });
  });

  app.post("/api/update-apply", async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const body = req.body ?? {};
    const dryRun = parseUpdateBooleanFlag(body, "dry_run");
    const force = parseUpdateBooleanFlag(body, "force");
    const forceConfirm = parseUpdateBooleanFlag(body, "force_confirm");

    if (!tryAcquireAutoUpdateLock()) {
      return res.status(409).json({ ok: false, error: "update_already_running" });
    }

    let inFlight: Promise<UpdateApplyResult>;
    try {
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
          updateStatusCachedAt = 0;
          updateStatusCache = null;
          releaseAutoUpdateLock();
        });
      inFlight = autoUpdateInFlight as Promise<UpdateApplyResult>;
    } catch (err: any) {
      autoUpdateState.running = false;
      autoUpdateInFlight = null;
      updateStatusCachedAt = 0;
      updateStatusCache = null;
      releaseAutoUpdateLock();
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }

    try {
      const result = await inFlight;
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
        tool: "sessions_list",
        action: "json",
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
        tool: "sessions_list",
        action: "json",
        args: { limit: 200, activeMinutes: 60 * 24 * 30, messageLimit: 0 },
      });
      const sessions = Array.isArray(result?.details?.sessions) ? result.details.sessions : [];
      const session = sessions.find((s: any) => s?.key === sessionKey);
      if (!session?.deliveryContext?.channel || !session?.deliveryContext?.to) {
        return res.status(404).json({ ok: false, error: "session not found or no delivery target" });
      }
      await gatewayHttpInvoke({
        tool: "message",
        action: "send",
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
  registerDepartmentRoutes(__ctx);

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  registerProjectRoutes({
    app,
    db,
    firstQueryValue,
    normalizeTextField,
    runInTransaction,
    nowMs,
  });

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------
  registerAgentRoutes(__ctx);

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  registerTaskCrudRoutes(__ctx);

  // ---------------------------------------------------------------------------
  // SubTask endpoints
  // ---------------------------------------------------------------------------
  registerTaskSubtaskRoutes(__ctx);

  registerTaskExecutionRoutes(__ctx);

  registerGitHubRoutes(__ctx);

  return {};
}
