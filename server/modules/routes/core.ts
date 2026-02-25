import type { RuntimeContext } from "../../types/runtime-context.ts";
import type { SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
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
import { registerAgentRoutes } from "./core/agents/index.ts";
import { registerDepartmentRoutes } from "./core/departments.ts";
import { registerGitHubRoutes } from "./core/github-routes.ts";
import { registerProjectRoutes } from "./core/projects.ts";
import { registerTaskCrudRoutes } from "./core/tasks/crud.ts";
import { registerTaskExecutionRoutes } from "./core/tasks/execution.ts";
import { registerTaskSubtaskRoutes } from "./core/tasks/subtasks.ts";
import { registerUpdateAutoRoutes } from "./core/update-auto/register.ts";
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

  registerUpdateAutoRoutes(__ctx);

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
