import type { RuntimeContext } from "../../../types/runtime-context.ts";
import type { SQLInputValue } from "node:sqlite";
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
import type { AgentRow, DelegationOptions, StoredMessage } from "../shared/types.ts";

export function registerOpsMessageRoutes(ctx: RuntimeContext): any {
  // Default policy: enforce latest AGENTS rules.
  // Set ENFORCE_DIRECTIVE_PROJECT_BINDING=0 only for temporary local debugging.
  const ENFORCE_DIRECTIVE_PROJECT_BINDING = String(process.env.ENFORCE_DIRECTIVE_PROJECT_BINDING ?? "1").trim() !== "0";
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
  const scheduleNextReviewRound = __ctx.scheduleNextReviewRound;
  const seedReviewRevisionSubtasks = __ctx.seedReviewRevisionSubtasks;
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
  const processSubtaskDelegations = __ctx.processSubtaskDelegations;
  const recoverCrossDeptQueueAfterMissingCallback = __ctx.recoverCrossDeptQueueAfterMissingCallback;
  const resolveLang = __ctx.resolveLang;
  const resolveProjectPath = __ctx.resolveProjectPath;
  const sendAgentMessage = __ctx.sendAgentMessage;
  const reconcileCrossDeptSubtasks = __ctx.reconcileCrossDeptSubtasks;
  const buildHealthPayload = __ctx.buildHealthPayload;
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

  const buildAgentUpgradeRequiredPayload = () => {
    const repoRoot = process.cwd();
    const installerPaths = {
      mac_linux: path.join(repoRoot, "scripts", "openclaw-setup.sh"),
      windows_powershell: path.join(repoRoot, "scripts", "openclaw-setup.ps1"),
      agents_template: path.join(repoRoot, "templates", "AGENTS-empire.md"),
    };
    const agentsTargetPath = path.join(os.homedir(), ".openclaw", "workspace", "AGENTS.md");
    const installCommands = {
      mac_linux: "bash scripts/openclaw-setup.sh",
      windows_powershell: "powershell -ExecutionPolicy Bypass -File .\\scripts\\openclaw-setup.ps1",
      agents_only: "pnpm setup -- --agents-path ~/.openclaw/workspace/AGENTS.md",
    };
    const absoluteInstallCommands = {
      mac_linux: `bash "${installerPaths.mac_linux}"`,
      windows_powershell: `powershell -ExecutionPolicy Bypass -File "${installerPaths.windows_powershell}"`,
      agents_only: `pnpm setup -- --agents-path "${agentsTargetPath}"`,
    };
    const recommendedInstallCommand =
      process.platform === "win32" ? absoluteInstallCommands.windows_powershell : absoluteInstallCommands.mac_linux;

    return {
      error: "agent_upgrade_required",
      reason: "install_first",
      message: `OpenClaw AGENTS is outdated (HTTP 428). Install path: ${installerPaths.mac_linux} (or ${installerPaths.windows_powershell}). Target AGENTS path: ${agentsTargetPath}. Should I install it now?`,
      message_ko: `OpenClaw AGENTS가 구버전입니다(HTTP 428). 설치 경로: ${installerPaths.mac_linux} (또는 ${installerPaths.windows_powershell}), 대상 AGENTS: ${agentsTargetPath}. 지금 제가 직접 설치해드릴까요?`,
      required_agent_rules_version: 2,
      required_action: "install_latest_agents_rules",
      installer_files: ["scripts/openclaw-setup.sh", "scripts/openclaw-setup.ps1", "templates/AGENTS-empire.md"],
      installer_absolute_paths: installerPaths,
      agents_target_path: agentsTargetPath,
      install_commands: installCommands,
      install_commands_absolute: absoluteInstallCommands,
      recommended_install_command: recommendedInstallCommand,
      user_prompt: {
        ko: `OpenClaw AGENTS 규칙이 구버전입니다. 설치 파일: ${installerPaths.mac_linux} / ${installerPaths.windows_powershell}, 대상 AGENTS: ${agentsTargetPath}. 지금 제가 직접 설치해드릴까요? (예/아니오)`,
        en: `OpenClaw AGENTS rules are outdated. Installer files: ${installerPaths.mac_linux} / ${installerPaths.windows_powershell}, target AGENTS: ${agentsTargetPath}. Should I install it now? (yes/no)`,
      },
      next_step_ko: "사용자가 동의하면 설치 스크립트를 실행한 뒤 같은 directive를 1회 재시도하세요.",
      next_step_en: "If the user agrees, run installer script and retry the same directive once.",
    };
  };

  type DecisionInboxRouteItem = {
    id: string;
    kind: "project_review_ready" | "task_timeout_resume" | "review_round_pick";
    created_at: number;
    summary: string;
    agent_id?: string | null;
    agent_name?: string | null;
    agent_name_ko?: string | null;
    agent_avatar?: string | null;
    project_id: string | null;
    project_name: string | null;
    project_path: string | null;
    task_id: string | null;
    task_title: string | null;
    meeting_id?: string | null;
    review_round?: number | null;
    options: Array<{ number: number; action: string; label: string }>;
  };

  const PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX = "Decision inbox: project review task option selected";
  const REVIEW_DECISION_RESOLVED_LOG_PREFIX = "Decision inbox: review decision resolved";
  const projectReviewDecisionConsolidationInFlight = new Set<string>();
  const reviewRoundDecisionConsolidationInFlight = new Set<string>();

  type ProjectReviewDecisionStateRow = {
    project_id: string;
    snapshot_hash: string;
    status: "collecting" | "ready" | "failed";
    planner_summary: string | null;
    planner_agent_id: string | null;
    planner_agent_name: string | null;
    created_at: number | null;
    updated_at: number | null;
  };

  type ReviewRoundDecisionStateRow = {
    meeting_id: string;
    snapshot_hash: string;
    status: "collecting" | "ready" | "failed";
    planner_summary: string | null;
    planner_agent_id: string | null;
    planner_agent_name: string | null;
    created_at: number | null;
    updated_at: number | null;
  };

  function buildProjectReviewSnapshotHash(
    projectId: string,
    reviewTaskChoices: Array<{ id: string; updated_at: number }>,
  ): string {
    const base = [...reviewTaskChoices]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => `${task.id}:${task.updated_at}`)
      .join("|");
    return createHash("sha256").update(`${projectId}|${base}`).digest("hex").slice(0, 24);
  }

  function getProjectReviewDecisionState(projectId: string): ProjectReviewDecisionStateRow | null {
    const row = db
      .prepare(
        `
      SELECT
        project_id,
        snapshot_hash,
        status,
        planner_summary,
        planner_agent_id,
        planner_agent_name,
        created_at,
        updated_at
      FROM project_review_decision_states
      WHERE project_id = ?
    `,
      )
      .get(projectId) as ProjectReviewDecisionStateRow | undefined;
    return row ?? null;
  }

  function upsertProjectReviewDecisionState(
    projectId: string,
    snapshotHash: string,
    status: "collecting" | "ready" | "failed",
    plannerSummary: string | null,
    plannerAgentId: string | null,
    plannerAgentName: string | null,
  ): void {
    const ts = nowMs();
    db.prepare(
      `
      INSERT INTO project_review_decision_states (
        project_id,
        snapshot_hash,
        status,
        planner_summary,
        planner_agent_id,
        planner_agent_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        snapshot_hash = excluded.snapshot_hash,
        status = excluded.status,
        planner_summary = excluded.planner_summary,
        planner_agent_id = excluded.planner_agent_id,
        planner_agent_name = excluded.planner_agent_name,
        updated_at = excluded.updated_at
    `,
    ).run(projectId, snapshotHash, status, plannerSummary, plannerAgentId, plannerAgentName, ts, ts);
  }

  function buildReviewRoundSnapshotHash(meetingId: string, reviewRound: number, notes: string[]): string {
    const base = [...notes]
      .map((note) =>
        String(note ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .join("|");
    return createHash("sha256").update(`${meetingId}|round=${reviewRound}|${base}`).digest("hex").slice(0, 24);
  }

  function getReviewRoundDecisionState(meetingId: string): ReviewRoundDecisionStateRow | null {
    const row = db
      .prepare(
        `
      SELECT
        meeting_id,
        snapshot_hash,
        status,
        planner_summary,
        planner_agent_id,
        planner_agent_name,
        created_at,
        updated_at
      FROM review_round_decision_states
      WHERE meeting_id = ?
    `,
      )
      .get(meetingId) as ReviewRoundDecisionStateRow | undefined;
    return row ?? null;
  }

  function upsertReviewRoundDecisionState(
    meetingId: string,
    snapshotHash: string,
    status: "collecting" | "ready" | "failed",
    plannerSummary: string | null,
    plannerAgentId: string | null,
    plannerAgentName: string | null,
  ): void {
    const ts = nowMs();
    db.prepare(
      `
      INSERT INTO review_round_decision_states (
        meeting_id,
        snapshot_hash,
        status,
        planner_summary,
        planner_agent_id,
        planner_agent_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meeting_id) DO UPDATE SET
        snapshot_hash = excluded.snapshot_hash,
        status = excluded.status,
        planner_summary = excluded.planner_summary,
        planner_agent_id = excluded.planner_agent_id,
        planner_agent_name = excluded.planner_agent_name,
        updated_at = excluded.updated_at
    `,
    ).run(meetingId, snapshotHash, status, plannerSummary, plannerAgentId, plannerAgentName, ts, ts);
  }

  function recordProjectReviewDecisionEvent(input: {
    project_id: string;
    snapshot_hash?: string | null;
    event_type: "planning_summary" | "representative_pick" | "followup_request" | "start_review_meeting";
    summary: string;
    selected_options_json?: string | null;
    note?: string | null;
    task_id?: string | null;
    meeting_id?: string | null;
  }): void {
    db.prepare(
      `
      INSERT INTO project_review_decision_events (
        project_id,
        snapshot_hash,
        event_type,
        summary,
        selected_options_json,
        note,
        task_id,
        meeting_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      input.project_id,
      input.snapshot_hash ?? null,
      input.event_type,
      input.summary,
      input.selected_options_json ?? null,
      input.note ?? null,
      input.task_id ?? null,
      input.meeting_id ?? null,
      nowMs(),
    );
  }

  function parseDecisionEventSelectedLabels(rawJson: string | null | undefined, limit = 4): string[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit || 4), 12));
    if (!rawJson || !String(rawJson).trim()) return [];
    try {
      const parsed = JSON.parse(String(rawJson));
      if (!Array.isArray(parsed)) return [];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of parsed) {
        const label = String((item as { label?: unknown })?.label ?? "")
          .replace(/\s+/g, " ")
          .trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(label);
        if (out.length >= boundedLimit) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function getProjectReviewRoundDecisionContext(projectId: string, lang: string, limit = 8): string[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit || 8), 20));
    const rows = db
      .prepare(
        `
      SELECT
        e.summary,
        e.selected_options_json,
        e.note,
        e.task_id,
        e.created_at,
        COALESCE(t.title, '') AS task_title
      FROM project_review_decision_events e
      LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.project_id = ?
        AND e.meeting_id IS NOT NULL
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ?
    `,
      )
      .all(projectId, Math.max(boundedLimit * 3, boundedLimit)) as Array<{
      summary: string | null;
      selected_options_json: string | null;
      note: string | null;
      task_id: string | null;
      created_at: number | null;
      task_title: string | null;
    }>;

    const clip = (text: string, max = 200) => {
      const normalized = String(text ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) return "";
      return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
    };
    const taskLabel = pickL(l(["작업"], ["Task"], ["タスク"], ["任务"]), lang);
    const selectedLabel = pickL(l(["선택"], ["Picked"], ["選択"], ["已选"]), lang);
    const noteLabel = pickL(l(["추가의견"], ["Note"], ["追加意見"], ["追加意见"]), lang);
    const out: string[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const summary = clip(row.summary ?? "", 220);
      const selected = parseDecisionEventSelectedLabels(row.selected_options_json, 4)
        .map((label) => clip(label, 140))
        .filter(Boolean);
      const note = clip(row.note ?? "", 180);
      const taskTitle = clip(row.task_title ?? "", 120);
      const segments: string[] = [];
      if (taskTitle) segments.push(`${taskLabel}=${taskTitle}`);
      if (summary) segments.push(summary);
      if (selected.length > 0) segments.push(`${selectedLabel}=${selected.join(" | ")}`);
      if (note) segments.push(`${noteLabel}=${note}`);
      if (segments.length <= 0) continue;

      const line = `- ${segments.join(" / ")}`;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
      if (out.length >= boundedLimit) break;
    }

    return out;
  }

  function buildProjectReviewPlanningFallbackSummary(
    lang: string,
    projectName: string,
    taskTitles: string[],
    roundDecisionLines: string[] = [],
  ): string {
    const topTasks = taskTitles.slice(0, 6);
    const lines = topTasks.map((title, idx) => `${idx + 1}. ${title}`);
    const noTaskLine = pickL(
      l(
        ["- 검토 항목 정보 없음"],
        ["- No review-item details available"],
        ["- レビュー項目情報なし"],
        ["- 无可用评审项信息"],
      ),
      lang,
    );
    const taskBlock = lines.length > 0 ? lines.join("\n") : noTaskLine;
    const noRoundDecisionLine = pickL(
      l(
        ["- 라운드 의사결정 이력 없음"],
        ["- No round-level decision history yet"],
        ["- ラウンド判断履歴なし"],
        ["- 暂无轮次决策记录"],
      ),
      lang,
    );
    const roundDecisionBlock =
      roundDecisionLines.length > 0 ? roundDecisionLines.slice(0, 8).join("\n") : noRoundDecisionLine;
    return pickL(
      l(
        [
          `프로젝트 '${projectName}' 검토 항목을 기획팀장 기준으로 취합했습니다.\n- 주요 검토 포인트를 기준으로 대표 항목을 선택한 뒤 팀장 회의를 시작하세요.\n- 필요 시 추가요청 입력으로 보완 작업을 먼저 열 수 있습니다.\n\n검토 대상:\n${taskBlock}\n\n최근 리뷰 라운드 의사결정:\n${roundDecisionBlock}`,
        ],
        [
          `Planning-lead consolidation is complete for project '${projectName}'.\n- Choose representative review item(s) from key checkpoints, then start the team-lead meeting.\n- If needed, open remediation first with Add Follow-up Request.\n\nReview targets:\n${taskBlock}\n\nRecent review-round decisions:\n${roundDecisionBlock}`,
        ],
        [
          `プロジェクト'${projectName}'のレビュー項目を企画リード基準で集約しました。\n- 主要チェックポイントを基準に代表項目を選択してからチームリーダー会議を開始してください。\n- 必要に応じて追加要請入力で先に補完作業を開けます。\n\nレビュー対象:\n${taskBlock}\n\n最近のレビューラウンド判断:\n${roundDecisionBlock}`,
        ],
        [
          `项目'${projectName}'的评审项已按规划负责人标准完成汇总。\n- 请先按关键检查点选择代表项，再启动组长评审会议。\n- 如有需要，可先通过追加请求开启补充整改。\n\n评审目标:\n${taskBlock}\n\n最近评审轮次决策:\n${roundDecisionBlock}`,
        ],
      ),
      lang,
    );
  }

  function formatPlannerSummaryForDisplay(input: string): string {
    let text = String(input ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) return "";

    text = text
      .replace(/\s*;\s*/g, ";\n")
      .replace(/\s+(?=\d+[.)]\s)/g, "\n")
      .replace(/\s+(?=-\s)/g, "\n");

    if (!text.includes("\n") && text.length > 220) {
      text = text.replace(/([.!?])\s+/g, "$1\n").replace(/(합니다\.|입니다\.|됩니다\.|습니다\.|요\.)\s+/g, "$1\n");
    }

    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  type PlanningLeadStateLike = {
    planner_agent_id?: string | null;
    planner_agent_name?: string | null;
  };

  function resolvePlanningLeadMeta(
    lang: string,
    decisionState?: PlanningLeadStateLike | null,
  ): {
    agent_id: string | null;
    agent_name: string;
    agent_name_ko: string;
    agent_avatar: string;
  } {
    const fallbackLead = findTeamLeader("planning");
    const stateAgentId = String(decisionState?.planner_agent_id ?? "").trim();
    const stateAgent = stateAgentId
      ? (db
          .prepare(
            `
          SELECT id, name, name_ko, avatar_emoji
          FROM agents
          WHERE id = ?
          LIMIT 1
        `,
          )
          .get(stateAgentId) as
          | {
              id: string;
              name: string;
              name_ko: string;
              avatar_emoji: string | null;
            }
          | undefined)
      : undefined;
    const picked = stateAgent ?? fallbackLead;
    const defaultName = pickL(l(["기획팀장"], ["Planning Lead"], ["企画リード"], ["规划负责人"]), lang);
    const normalizePlanningLeadAvatar = (rawAvatar: string | null | undefined): string => {
      const avatar = String(rawAvatar ?? "").trim();
      if (!avatar || avatar === "🧠") return "🧑‍💼";
      return avatar;
    };
    return {
      agent_id: picked?.id ?? null,
      agent_name: (picked?.name || decisionState?.planner_agent_name || defaultName).trim(),
      agent_name_ko: (picked?.name_ko || decisionState?.planner_agent_name || "기획팀장").trim(),
      agent_avatar: normalizePlanningLeadAvatar(picked?.avatar_emoji),
    };
  }

  function queueProjectReviewPlanningConsolidation(
    projectId: string,
    projectName: string,
    projectPath: string | null,
    snapshotHash: string,
    lang: string,
  ): void {
    const inFlightKey = `${projectId}:${snapshotHash}`;
    if (projectReviewDecisionConsolidationInFlight.has(inFlightKey)) return;
    projectReviewDecisionConsolidationInFlight.add(inFlightKey);

    void (async () => {
      try {
        const currentState = getProjectReviewDecisionState(projectId);
        if (!currentState || currentState.snapshot_hash !== snapshotHash) return;
        if (currentState.status !== "collecting") return;

        const taskRows = db
          .prepare(
            `
          SELECT
            t.id,
            t.title,
            t.updated_at,
            COALESCE((
              SELECT m.content
              FROM messages m
              WHERE m.task_id = t.id
                AND m.message_type = 'report'
              ORDER BY m.created_at DESC
              LIMIT 1
            ), '') AS latest_report
          FROM tasks t
          WHERE t.project_id = ?
            AND t.status = 'review'
            AND t.source_task_id IS NULL
          ORDER BY t.updated_at ASC, t.created_at ASC
          LIMIT 20
        `,
          )
          .all(projectId) as Array<{
          id: string;
          title: string;
          updated_at: number;
          latest_report: string;
        }>;

        if (taskRows.length <= 0) return;
        const planningLeader = findTeamLeader("planning");
        const clip = (text: string, max = 180) => {
          const normalized = String(text ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (!normalized) return "-";
          return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
        };
        const roundDecisionLines = getProjectReviewRoundDecisionContext(projectId, lang, 8);
        const noRoundDecisionPromptLine = pickL(
          l(
            ["- 라운드 의사결정 이력 없음"],
            ["- No round-level decision history yet"],
            ["- ラウンド判断履歴なし"],
            ["- 暂无轮次决策记录"],
          ),
          lang,
        );
        const roundDecisionPromptBlock =
          roundDecisionLines.length > 0 ? roundDecisionLines.join("\n") : noRoundDecisionPromptLine;
        const fallbackSummary = buildProjectReviewPlanningFallbackSummary(
          lang,
          projectName,
          taskRows.map((task) => task.title),
          roundDecisionLines,
        );

        let plannerSummary = fallbackSummary;
        if (planningLeader) {
          const sourceLines = taskRows
            .map((task, idx) => `${idx + 1}) ${task.title}\n- latest_report: ${clip(task.latest_report)}`)
            .join("\n");
          const prompt = [
            `You are the planning lead (${planningLeader.name}).`,
            `Consolidate project-level review status for '${projectName}'.`,
            `Language: ${lang}`,
            "Output requirements:",
            "- Provide one concise paragraph for CEO decision support.",
            "- Include: representative selection guidance, meeting start condition, and follow-up request usage hint.",
            "- If round-level decisions exist, reflect them explicitly in the recommendation.",
            "- Keep it under 10 lines.",
            "",
            "Review item sources:",
            sourceLines,
            "",
            "Recent review-round decision context:",
            roundDecisionPromptBlock,
          ].join("\n");
          try {
            const run = await runAgentOneShot(planningLeader, prompt, {
              projectPath: projectPath || process.cwd(),
              timeoutMs: 45_000,
            });
            const preferred = String(chooseSafeReply(run, lang, "summary", planningLeader) || "").trim();
            const raw = String(run?.text || "").trim();
            const merged = preferred || raw;
            if (merged) {
              const clipped = merged.length > 1800 ? `${merged.slice(0, 1797).trimEnd()}...` : merged;
              plannerSummary = formatPlannerSummaryForDisplay(clipped);
            }
          } catch {
            plannerSummary = fallbackSummary;
          }
        }
        plannerSummary = formatPlannerSummaryForDisplay(plannerSummary);

        const updateResult = db
          .prepare(
            `
          UPDATE project_review_decision_states
          SET status = 'ready',
              planner_summary = ?,
              planner_agent_id = ?,
              planner_agent_name = ?,
              updated_at = ?
          WHERE project_id = ?
            AND snapshot_hash = ?
            AND status = 'collecting'
        `,
          )
          .run(
            plannerSummary,
            planningLeader?.id ?? null,
            planningLeader ? getAgentDisplayName(planningLeader, lang) : null,
            nowMs(),
            projectId,
            snapshotHash,
          ) as { changes?: number } | undefined;

        if ((updateResult?.changes ?? 0) > 0) {
          recordProjectReviewDecisionEvent({
            project_id: projectId,
            snapshot_hash: snapshotHash,
            event_type: "planning_summary",
            summary: plannerSummary,
          });
        }
      } catch {
        const failMsg = pickL(
          l(
            ["기획팀장 의견 취합이 일시 지연되었습니다. 자동 재시도 중입니다."],
            ["Planning-lead consolidation is temporarily delayed. Auto retry in progress."],
            ["企画リード意見の集約が一時遅延しました。自動再試行中です。"],
            ["规划负责人意见汇总暂时延迟，正在自动重试。"],
          ),
          lang,
        );
        const ts = nowMs();
        db.prepare(
          `
          UPDATE project_review_decision_states
          SET status = 'failed',
              planner_summary = ?,
              updated_at = ?
          WHERE project_id = ?
            AND snapshot_hash = ?
        `,
        ).run(failMsg, ts, projectId, snapshotHash);
      } finally {
        projectReviewDecisionConsolidationInFlight.delete(inFlightKey);
      }
    })();
  }

  function buildReviewRoundPlanningFallbackSummary(
    lang: string,
    taskTitle: string,
    reviewRound: number,
    optionNotes: string[],
    projectName?: string | null,
  ): string {
    const clip = (text: string, max = 240) => {
      const normalized = String(text ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) return "";
      return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
    };
    const lines = optionNotes
      .slice(0, 6)
      .map((note, idx) => `${idx + 1}. ${clip(note)}`)
      .filter(Boolean);
    const optionBlock =
      lines.length > 0
        ? lines.join("\n")
        : pickL(
            l(
              ["- 취합할 라운드 의견이 없습니다."],
              ["- No round opinions to consolidate."],
              ["- 集約対象のラウンド意見がありません。"],
              ["- 暂无可汇总的轮次意见。"],
            ),
            lang,
          );
    return pickL(
      l(
        [
          `라운드 ${reviewRound} 의견을 기획팀장이 우선 취합했습니다.\n작업: '${taskTitle}'\n${projectName ? `프로젝트: '${projectName}'\n` : ""}아래 번호 중 우선순위가 높은 보완 항목을 먼저 선택하고, 필요 시 추가 의견을 함께 넣어 보완 라운드를 여세요.\n\n검토 선택지:\n${optionBlock}`,
        ],
        [
          `Planning lead pre-consolidated round ${reviewRound} opinions.\nTask: '${taskTitle}'\n${projectName ? `Project: '${projectName}'\n` : ""}Pick the highest-priority remediation options first, and add an extra note only when needed.\n\nCandidate options:\n${optionBlock}`,
        ],
        [
          `企画リードがラウンド${reviewRound}意見を先行集約しました。\nタスク: '${taskTitle}'\n${projectName ? `プロジェクト: '${projectName}'\n` : ""}優先度の高い補完項目から選択し、必要な場合のみ追加意見を入力してください。\n\n候補選択肢:\n${optionBlock}`,
        ],
        [
          `规划负责人已先行汇总第 ${reviewRound} 轮意见。\n任务：'${taskTitle}'\n${projectName ? `项目：'${projectName}'\n` : ""}请先选择优先级最高的补充整改项，必要时再补充追加意见。\n\n候选选项：\n${optionBlock}`,
        ],
      ),
      lang,
    );
  }

  function queueReviewRoundPlanningConsolidation(input: {
    projectId: string | null;
    projectName: string | null;
    projectPath: string | null;
    taskId: string;
    taskTitle: string;
    meetingId: string;
    reviewRound: number;
    optionNotes: string[];
    snapshotHash: string;
    lang: string;
  }): void {
    const inFlightKey = `${input.meetingId}:${input.snapshotHash}`;
    if (reviewRoundDecisionConsolidationInFlight.has(inFlightKey)) return;
    reviewRoundDecisionConsolidationInFlight.add(inFlightKey);

    void (async () => {
      try {
        const currentState = getReviewRoundDecisionState(input.meetingId);
        if (!currentState || currentState.snapshot_hash !== input.snapshotHash) return;
        if (currentState.status !== "collecting") return;

        const planningLeader = findTeamLeader("planning");
        const clip = (text: string, max = 240) => {
          const normalized = String(text ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (!normalized) return "-";
          return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized;
        };
        const fallbackSummary = buildReviewRoundPlanningFallbackSummary(
          input.lang,
          input.taskTitle,
          input.reviewRound,
          input.optionNotes,
          input.projectName,
        );

        let plannerSummary = fallbackSummary;
        if (planningLeader) {
          const sourceBlock =
            input.optionNotes.length > 0
              ? input.optionNotes.map((note, idx) => `${idx + 1}) ${clip(note, 320)}`).join("\n")
              : pickL(
                  l(["- 라운드 의견 없음"], ["- No round opinions"], ["- ラウンド意見なし"], ["- 无轮次意见"]),
                  input.lang,
                );
          const prompt = [
            `You are the planning lead (${planningLeader.name}).`,
            `Task: '${input.taskTitle}'`,
            `Review round: ${input.reviewRound}`,
            input.projectName ? `Project: '${input.projectName}'` : "Project: (none)",
            `Language: ${input.lang}`,
            "Goal:",
            "- Read all round options and summarize each team's stance.",
            "- Recommend which option numbers the CEO should pick (multiple allowed), or explicitly recommend SKIP.",
            "- Keep it concise and decision-oriented.",
            "",
            "Round option sources:",
            sourceBlock,
          ].join("\n");
          try {
            const run = await runAgentOneShot(planningLeader, prompt, {
              projectPath: input.projectPath || process.cwd(),
              timeoutMs: 45_000,
            });
            const preferred = String(chooseSafeReply(run, input.lang, "summary", planningLeader) || "").trim();
            const raw = String(run?.text || "").trim();
            const merged = preferred || raw;
            if (merged) {
              const clipped = merged.length > 1800 ? `${merged.slice(0, 1797).trimEnd()}...` : merged;
              plannerSummary = formatPlannerSummaryForDisplay(clipped);
            }
          } catch {
            plannerSummary = fallbackSummary;
          }
        }
        plannerSummary = formatPlannerSummaryForDisplay(plannerSummary);

        const updateResult = db
          .prepare(
            `
          UPDATE review_round_decision_states
          SET status = 'ready',
              planner_summary = ?,
              planner_agent_id = ?,
              planner_agent_name = ?,
              updated_at = ?
          WHERE meeting_id = ?
            AND snapshot_hash = ?
            AND status = 'collecting'
        `,
          )
          .run(
            plannerSummary,
            planningLeader?.id ?? null,
            planningLeader ? getAgentDisplayName(planningLeader, input.lang) : null,
            nowMs(),
            input.meetingId,
            input.snapshotHash,
          ) as { changes?: number } | undefined;

        if ((updateResult?.changes ?? 0) > 0 && input.projectId) {
          recordProjectReviewDecisionEvent({
            project_id: input.projectId,
            snapshot_hash: getProjectReviewDecisionState(input.projectId)?.snapshot_hash ?? null,
            event_type: "planning_summary",
            summary: pickL(
              l(
                [`라운드 ${input.reviewRound} 기획팀장 취합\n${plannerSummary}`],
                [`Round ${input.reviewRound} planning consolidation\n${plannerSummary}`],
                [`ラウンド${input.reviewRound} 企画リード集約\n${plannerSummary}`],
                [`第 ${input.reviewRound} 轮规划负责人汇总\n${plannerSummary}`],
              ),
              input.lang,
            ),
            task_id: input.taskId,
            meeting_id: input.meetingId,
          });
        }
      } catch {
        const failMsg = pickL(
          l(
            ["리뷰 라운드 기획팀장 취합이 일시 지연되었습니다. 자동 재시도 중입니다."],
            ["Review-round planning consolidation is temporarily delayed. Auto retry in progress."],
            ["レビューラウンド企画リード集約が一時遅延しました。自動再試行中です。"],
            ["评审轮次规划汇总暂时延迟，正在自动重试。"],
          ),
          input.lang,
        );
        const ts = nowMs();
        db.prepare(
          `
          UPDATE review_round_decision_states
          SET status = 'failed',
              planner_summary = ?,
              updated_at = ?
          WHERE meeting_id = ?
            AND snapshot_hash = ?
        `,
        ).run(failMsg, ts, input.meetingId, input.snapshotHash);
      } finally {
        reviewRoundDecisionConsolidationInFlight.delete(inFlightKey);
      }
    })();
  }

  function getProjectReviewTaskChoices(projectId: string): Array<{
    id: string;
    title: string;
    updated_at: number;
    selected: boolean;
  }> {
    const selectionPattern = `${PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX}%`;
    const rows = db
      .prepare(
        `
      SELECT
        t.id,
        t.title,
        t.updated_at,
        (
          SELECT MAX(tl.created_at)
          FROM task_logs tl
          WHERE tl.task_id = t.id
            AND tl.kind = 'system'
            AND tl.message LIKE ?
        ) AS selected_at
      FROM tasks t
      WHERE t.project_id = ?
        AND t.status = 'review'
        AND t.source_task_id IS NULL
      ORDER BY t.updated_at ASC, t.created_at ASC
    `,
      )
      .all(selectionPattern, projectId) as Array<{
      id: string;
      title: string;
      updated_at: number;
      selected_at: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updated_at: row.updated_at,
      selected: (row.selected_at ?? 0) >= (row.updated_at ?? 0),
    }));
  }

  function buildProjectReviewDecisionItems(): DecisionInboxRouteItem[] {
    const lang = getPreferredLanguage();
    const t = (ko: string, en: string, ja: string, zh: string) => pickL(l([ko], [en], [ja], [zh]), lang);

    const rows = db
      .prepare(
        `
      SELECT
        p.id AS project_id,
        p.name AS project_name,
        p.project_path AS project_path,
        MAX(t.updated_at) AS updated_at,
        SUM(CASE WHEN t.status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS active_total,
        SUM(CASE WHEN t.status NOT IN ('done', 'cancelled') AND t.status = 'review' THEN 1 ELSE 0 END) AS active_review,
        SUM(CASE WHEN t.status = 'review' AND t.source_task_id IS NULL THEN 1 ELSE 0 END) AS root_review_total
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.project_id IS NOT NULL
      GROUP BY p.id, p.name, p.project_path
    `,
      )
      .all() as Array<{
      project_id: string;
      project_name: string | null;
      project_path: string | null;
      updated_at: number | null;
      active_total: number | null;
      active_review: number | null;
      root_review_total: number | null;
    }>;

    const out: DecisionInboxRouteItem[] = [];
    for (const row of rows) {
      const activeTotal = row.active_total ?? 0;
      const activeReview = row.active_review ?? 0;
      const rootReviewTotal = row.root_review_total ?? 0;
      if (activeTotal <= 0) continue;
      if (activeTotal !== activeReview) continue;
      if (rootReviewTotal <= 0) continue;

      const inProgressMeeting = db
        .prepare(
          `
        SELECT COUNT(*) AS cnt
        FROM meeting_minutes mm
        JOIN tasks t ON t.id = mm.task_id
        WHERE t.project_id = ?
          AND t.status = 'review'
          AND t.source_task_id IS NULL
          AND mm.meeting_type = 'review'
          AND mm.status = 'in_progress'
      `,
        )
        .get(row.project_id) as { cnt: number } | undefined;
      if ((inProgressMeeting?.cnt ?? 0) > 0) continue;

      // Do not show project-level decision while any round 1/2 review decision is pending.
      // Round-level cherry-pick/skip should be resolved first to avoid simultaneous mixed cards.
      const pendingRoundDecision = db
        .prepare(
          `
        SELECT COUNT(*) AS cnt
        FROM tasks t
        JOIN meeting_minutes mm ON mm.task_id = t.id
        WHERE t.project_id = ?
          AND t.status = 'review'
          AND t.source_task_id IS NULL
          AND mm.meeting_type = 'review'
          AND mm.round IN (1, 2)
          AND mm.status = 'revision_requested'
          AND mm.id = (
            SELECT mm2.id
            FROM meeting_minutes mm2
            WHERE mm2.task_id = t.id
              AND mm2.meeting_type = 'review'
            ORDER BY mm2.started_at DESC, mm2.created_at DESC
            LIMIT 1
          )
      `,
        )
        .get(row.project_id) as { cnt: number } | undefined;
      if ((pendingRoundDecision?.cnt ?? 0) > 0) continue;

      const reviewTaskChoices = getProjectReviewTaskChoices(row.project_id);
      if (reviewTaskChoices.length <= 0) continue;
      const requiresRepresentativeSelection = reviewTaskChoices.length > 1;
      const pendingChoices = requiresRepresentativeSelection ? reviewTaskChoices.filter((task) => !task.selected) : [];
      const selectedCount = reviewTaskChoices.length - pendingChoices.length;
      const decisionTargetTotal = reviewTaskChoices.length;
      const projectName = (row.project_name || row.project_id).trim();
      const taskProgressLine = t(
        `항목 선택 진행: ${selectedCount}/${reviewTaskChoices.length}`,
        `Selection progress: ${selectedCount}/${reviewTaskChoices.length}`,
        `選択進捗: ${selectedCount}/${reviewTaskChoices.length}`,
        `选择进度: ${selectedCount}/${reviewTaskChoices.length}`,
      );
      const continueExistingLabel = t(
        "기존 작업 이어서 진행",
        "Continue Existing Work",
        "既存作業を継続",
        "继续现有工作",
      );
      const pendingList =
        pendingChoices.length > 0
          ? pendingChoices.length === 1
            ? `- ${continueExistingLabel}`
            : pendingChoices
                .slice(0, 6)
                .map((task) => `- ${task.title}`)
                .join("\n")
          : t(
              "모든 활성 항목 선택이 완료되었습니다.",
              "All active items are selected.",
              "すべてのアクティブ項目の選択が完了しました。",
              "所有活跃项已完成选择。",
            );
      const summary =
        pendingChoices.length > 0
          ? t(
              `프로젝트 '${projectName}'의 활성 항목 ${activeTotal}건이 모두 Review 상태입니다.\n대표 선택 대상 ${decisionTargetTotal}건을 먼저 선택해 주세요.\n${taskProgressLine}\n${pendingList}`,
              `Project '${projectName}' has all ${activeTotal} active items in Review.\nSelect the ${decisionTargetTotal} target item(s) first.\n${taskProgressLine}\n${pendingList}`,
              `プロジェクト'${projectName}'のアクティブ項目${activeTotal}件はすべてReview状態です。\n代表者の選択対象${decisionTargetTotal}件を先に選択してください。\n${taskProgressLine}\n${pendingList}`,
              `项目'${projectName}'的 ${activeTotal} 个活跃项已全部进入 Review。\n请先选择代表决策目标 ${decisionTargetTotal} 项。\n${taskProgressLine}\n${pendingList}`,
            )
          : requiresRepresentativeSelection
            ? t(
                `프로젝트 '${projectName}'의 활성 항목 ${activeTotal}건이 모두 Review 상태입니다.\n대표 선택 대상 ${decisionTargetTotal}건 선택이 완료되었습니다.\n아래 선택지에서 다음 단계를 선택해 주세요.`,
                `Project '${projectName}' has all ${activeTotal} active items in Review.\nSelection for ${decisionTargetTotal} target item(s) is complete.\nChoose the next step from the options below.`,
                `プロジェクト'${projectName}'のアクティブ項目${activeTotal}件はすべてReview状態です。\n代表者の選択対象${decisionTargetTotal}件の選択が完了しました。\n以下の選択肢から次のステップを選んでください。`,
                `项目'${projectName}'的 ${activeTotal} 个活跃项已全部进入 Review。\n代表决策目标 ${decisionTargetTotal} 项已选择完成。\n请从下方选项中选择下一步。`,
              )
            : t(
                `프로젝트 '${projectName}'의 활성 항목 ${activeTotal}건이 모두 Review 상태입니다.\n대표 선택 단계는 필요하지 않습니다.\n아래 선택지에서 진행 방식을 선택해 주세요.`,
                `Project '${projectName}' has all ${activeTotal} active items in Review.\nA representative pick step is not required.\nChoose how to proceed from the options below.`,
                `プロジェクト'${projectName}'のアクティブ項目${activeTotal}件はすべてReview状態です。\n代表選択ステップは不要です。\n以下の選択肢から進行方法を選択してください。`,
                `项目'${projectName}'的 ${activeTotal} 个活跃项已全部进入 Review。\n无需代表选择步骤。\n请从下方选项中选择推进方式。`,
              );
      const readyOptions =
        pendingChoices.length > 0
          ? [
              ...pendingChoices.map((task, index) => ({
                number: index + 1,
                action: `approve_task_review:${task.id}`,
                label:
                  pendingChoices.length === 1
                    ? continueExistingLabel
                    : t(
                        `항목 선택: ${task.title}`,
                        `Select Item: ${task.title}`,
                        `項目選択: ${task.title}`,
                        `选择项: ${task.title}`,
                      ),
              })),
              {
                number: pendingChoices.length + 1,
                action: "add_followup_request",
                label: t("추가요청 입력", "Add Follow-up Request", "追加要請を入力", "输入追加请求"),
              },
            ]
          : [
              {
                number: 1,
                action: "start_project_review",
                label: t("팀장 회의 진행", "Start Team-Lead Meeting", "チームリーダー会議を進行", "启动组长评审会议"),
              },
              {
                number: 2,
                action: "add_followup_request",
                label: t("추가요청 입력", "Add Follow-up Request", "追加要請を入力", "输入追加请求"),
              },
            ];

      const snapshotHash = buildProjectReviewSnapshotHash(
        row.project_id,
        reviewTaskChoices.map((task) => ({ id: task.id, updated_at: task.updated_at })),
      );
      const existingState = getProjectReviewDecisionState(row.project_id);
      const now = nowMs();
      const stateNeedsReset = !existingState || existingState.snapshot_hash !== snapshotHash;
      if (stateNeedsReset) {
        upsertProjectReviewDecisionState(row.project_id, snapshotHash, "collecting", null, null, null);
      } else if (existingState.status === "failed" && now - (existingState.updated_at ?? 0) > 3000) {
        upsertProjectReviewDecisionState(row.project_id, snapshotHash, "collecting", null, null, null);
      }
      const decisionState = getProjectReviewDecisionState(row.project_id);
      const planningLeadMeta = resolvePlanningLeadMeta(lang, decisionState);
      if (!decisionState || decisionState.status !== "ready") {
        queueProjectReviewPlanningConsolidation(row.project_id, projectName, row.project_path, snapshotHash, lang);
        const collectingSummary = t(
          `프로젝트 '${projectName}'의 활성 항목 ${activeTotal}건이 모두 Review 상태입니다.\n기획팀장 의견 취합중...\n취합 완료 후 대표 선택지와 회의 진행 선택지가 나타납니다.`,
          `Project '${projectName}' has all ${activeTotal} active items in Review.\nPlanning lead is consolidating opinions...\nRepresentative options and meeting action will appear after consolidation.`,
          `プロジェクト'${projectName}'のアクティブ項目${activeTotal}件はすべてReview状態です。\n企画リードが意見を集約中...\n集約完了後に代表選択肢と会議進行選択肢が表示されます。`,
          `项目'${projectName}'的 ${activeTotal} 个活跃项已全部进入 Review。\n规划负责人正在汇总意见...\n汇总完成后将显示代表选择项与会议启动选项。`,
        );
        out.push({
          id: `project-review-ready:${row.project_id}`,
          kind: "project_review_ready",
          created_at: row.updated_at ?? now,
          summary: collectingSummary,
          agent_id: planningLeadMeta.agent_id,
          agent_name: planningLeadMeta.agent_name,
          agent_name_ko: planningLeadMeta.agent_name_ko,
          agent_avatar: planningLeadMeta.agent_avatar,
          project_id: row.project_id,
          project_name: row.project_name,
          project_path: row.project_path,
          task_id: null,
          task_title: null,
          options: [],
        });
        continue;
      }

      const plannerHeader = t(
        "기획팀장 의견 취합 완료",
        "Planning consolidation complete",
        "企画リード意見集約完了",
        "规划负责人意见汇总完成",
      );
      const plannerSummary = formatPlannerSummaryForDisplay(String(decisionState.planner_summary ?? "").trim());
      const optionGuide =
        pendingChoices.length <= 0 ? readyOptions.map((option) => `${option.number}. ${option.label}`).join("\n") : "";
      const optionGuideBlock = optionGuide
        ? t(
            `현재 선택 가능한 항목:\n${optionGuide}`,
            `Available options now:\n${optionGuide}`,
            `現在選択可能な項目:\n${optionGuide}`,
            `当前可选项:\n${optionGuide}`,
          )
        : "";
      const combinedSummaryBase = plannerSummary
        ? `${plannerHeader}\n${plannerSummary}\n\n${summary}`
        : `${plannerHeader}\n\n${summary}`;
      const combinedSummary = optionGuideBlock ? `${combinedSummaryBase}\n\n${optionGuideBlock}` : combinedSummaryBase;

      out.push({
        id: `project-review-ready:${row.project_id}`,
        kind: "project_review_ready",
        created_at: row.updated_at ?? now,
        summary: combinedSummary,
        agent_id: planningLeadMeta.agent_id,
        agent_name: planningLeadMeta.agent_name,
        agent_name_ko: planningLeadMeta.agent_name_ko,
        agent_avatar: planningLeadMeta.agent_avatar,
        project_id: row.project_id,
        project_name: row.project_name,
        project_path: row.project_path,
        task_id: null,
        task_title: null,
        options: readyOptions,
      });
    }

    return out;
  }

  function buildTimeoutResumeDecisionItems(): DecisionInboxRouteItem[] {
    const lang = getPreferredLanguage();
    const t = (ko: string, en: string, ja: string, zh: string) => pickL(l([ko], [en], [ja], [zh]), lang);

    const rows = db
      .prepare(
        `
      SELECT
        t.id AS task_id,
        t.title AS task_title,
        t.project_id AS project_id,
        p.name AS project_name,
        t.project_path AS project_path,
        t.updated_at AS updated_at,
        (
          SELECT MAX(tl.created_at)
          FROM task_logs tl
          WHERE tl.task_id = t.id
            AND tl.message LIKE '%RUN TIMEOUT%'
        ) AS timeout_at
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'inbox'
        AND EXISTS (
          SELECT 1
          FROM task_logs tl
          WHERE tl.task_id = t.id
            AND tl.message LIKE '%RUN TIMEOUT%'
        )
      ORDER BY COALESCE(timeout_at, t.updated_at) DESC, t.updated_at DESC
      LIMIT 200
    `,
      )
      .all() as Array<{
      task_id: string;
      task_title: string;
      project_id: string | null;
      project_name: string | null;
      project_path: string | null;
      updated_at: number | null;
      timeout_at: number | null;
    }>;

    return rows.map((row) => ({
      id: `task-timeout-resume:${row.task_id}`,
      kind: "task_timeout_resume",
      created_at: row.timeout_at ?? row.updated_at ?? nowMs(),
      summary: t(
        `작업 '${row.task_title}' 이(가) timeout 후 Inbox로 이동했습니다. 이어서 진행할까요?`,
        `Task '${row.task_title}' moved to Inbox after timeout. Continue from where it left off?`,
        `タスク'${row.task_title}'はタイムアウト後にInboxへ移動しました。続行しますか？`,
        `任务'${row.task_title}'超时后已移至 Inbox，是否继续执行？`,
      ),
      project_id: row.project_id,
      project_name: row.project_name,
      project_path: row.project_path,
      task_id: row.task_id,
      task_title: row.task_title,
      options: [
        {
          number: 1,
          action: "resume_timeout_task",
          label: t("이어서 진행 (재개)", "Resume Task", "続行する（再開）", "继续执行（恢复）"),
        },
        {
          number: 2,
          action: "keep_inbox",
          label: t("Inbox 유지", "Keep in Inbox", "Inboxで保留", "保留在 Inbox"),
        },
      ],
    }));
  }

  function getReviewDecisionFallbackLabel(lang: string): string {
    return pickL(l(["기존 작업 이어서 진행"], ["Continue Existing Work"], ["既存作業を継続"], ["继续现有工作"]), lang);
  }

  function getReviewDecisionNotes(taskId: string, reviewRound: number, limit = 6): string[] {
    const boundedLimit = Math.max(1, Math.min(limit, 12));
    const rawRows = db
      .prepare(
        `
      SELECT raw_note
      FROM review_revision_history
      WHERE task_id = ?
        AND first_round <= ?
      ORDER BY
        CASE WHEN first_round = ? THEN 0 ELSE 1 END ASC,
        first_round DESC,
        id DESC
      LIMIT ?
    `,
      )
      .all(taskId, reviewRound, reviewRound, Math.max(boundedLimit * 3, boundedLimit)) as Array<{
      raw_note: string | null;
    }>;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rawRows) {
      const normalized = String(row.raw_note ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      if (out.length >= limit) break;
    }
    return out;
  }

  function buildReviewRoundDecisionItems(): DecisionInboxRouteItem[] {
    const lang = getPreferredLanguage();
    const t = (ko: string, en: string, ja: string, zh: string) => pickL(l([ko], [en], [ja], [zh]), lang);
    const rows = db
      .prepare(
        `
      SELECT
        t.id AS task_id,
        t.title AS task_title,
        t.project_id AS project_id,
        p.name AS project_name,
        t.project_path AS project_path,
        mm.id AS meeting_id,
        mm.round AS meeting_round,
        mm.started_at AS meeting_started_at,
        mm.completed_at AS meeting_completed_at
      FROM tasks t
      JOIN meeting_minutes mm ON mm.task_id = t.id
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'review'
        AND t.source_task_id IS NULL
        AND mm.meeting_type = 'review'
        AND mm.round IN (1, 2)
        AND mm.status = 'revision_requested'
        AND mm.id = (
          SELECT mm2.id
          FROM meeting_minutes mm2
          WHERE mm2.task_id = t.id
            AND mm2.meeting_type = 'review'
          ORDER BY mm2.started_at DESC, mm2.created_at DESC
          LIMIT 1
        )
      ORDER BY COALESCE(mm.completed_at, mm.started_at) DESC
      LIMIT 120
    `,
      )
      .all() as Array<{
      task_id: string;
      task_title: string | null;
      project_id: string | null;
      project_name: string | null;
      project_path: string | null;
      meeting_id: string;
      meeting_round: number;
      meeting_started_at: number | null;
      meeting_completed_at: number | null;
    }>;

    const out: DecisionInboxRouteItem[] = [];
    for (const row of rows) {
      const notesRaw = getReviewDecisionNotes(row.task_id, row.meeting_round, 6);
      const notes = notesRaw.length > 0 ? notesRaw : [getReviewDecisionFallbackLabel(lang)];

      const taskTitle = (row.task_title || row.task_id).trim();
      const projectName = row.project_name ? row.project_name.trim() : null;
      const nextRound = Math.max(2, row.meeting_round + 1);
      const options = notes.map((note, index) => {
        return {
          number: index + 1,
          action: "apply_review_pick",
          label: note,
        };
      });
      options.push({
        number: notes.length + 1,
        action: "skip_to_next_round",
        label: t("다음 라운드로 SKIP", "Skip to Next Round", "次ラウンドへスキップ", "跳到下一轮"),
      });

      const summary = t(
        `라운드 ${row.meeting_round} 팀장 의견이 취합되었습니다.\n작업: '${taskTitle}'\n${projectName ? `프로젝트: '${projectName}'\n` : ""}필요한 의견을 여러 개 체리피킹하고, 추가 의견도 함께 입력해 보완 작업을 진행할 수 있습니다.\n또는 '다음 라운드로 SKIP'을 선택해 라운드 ${nextRound}(으)로 바로 진행할 수 있습니다.`,
        `Round ${row.meeting_round} team-lead opinions are consolidated.\nTask: '${taskTitle}'\n${projectName ? `Project: '${projectName}'\n` : ""}You can cherry-pick multiple opinions and include an extra note for remediation in one batch.\nOr choose 'Skip to Next Round' to move directly to round ${nextRound}.`,
        `ラウンド${row.meeting_round}のチームリーダー意見が集約されました。\nタスク: '${taskTitle}'\n${projectName ? `プロジェクト: '${projectName}'\n` : ""}必要な意見を複数チェリーピックし、追加意見も入力して一括補完できます。\nまたは「次ラウンドへスキップ」でラウンド${nextRound}へ進めます。`,
        `第 ${row.meeting_round} 轮组长意见已汇总。\n任务：'${taskTitle}'\n${projectName ? `项目：'${projectName}'\n` : ""}可多选意见并追加输入补充意见，一次性执行整改。\n也可选择“跳到下一轮”直接进入第 ${nextRound} 轮。`,
      );

      const snapshotHash = buildReviewRoundSnapshotHash(row.meeting_id, row.meeting_round, notes);
      const existingState = getReviewRoundDecisionState(row.meeting_id);
      const now = nowMs();
      const stateNeedsReset = !existingState || existingState.snapshot_hash !== snapshotHash;
      if (stateNeedsReset) {
        upsertReviewRoundDecisionState(row.meeting_id, snapshotHash, "collecting", null, null, null);
      } else if (existingState.status === "failed" && now - (existingState.updated_at ?? 0) > 3000) {
        upsertReviewRoundDecisionState(row.meeting_id, snapshotHash, "collecting", null, null, null);
      }
      const decisionState = getReviewRoundDecisionState(row.meeting_id);
      const planningLeadMeta = resolvePlanningLeadMeta(lang, decisionState);
      if (!decisionState || decisionState.status !== "ready") {
        queueReviewRoundPlanningConsolidation({
          projectId: row.project_id,
          projectName: row.project_name,
          projectPath: row.project_path,
          taskId: row.task_id,
          taskTitle,
          meetingId: row.meeting_id,
          reviewRound: row.meeting_round,
          optionNotes: notes,
          snapshotHash,
          lang,
        });
        const collectingSummary = t(
          `라운드 ${row.meeting_round} 팀장 의견이 취합되었습니다.\n작업: '${taskTitle}'\n${projectName ? `프로젝트: '${projectName}'\n` : ""}기획팀장 의견 취합중...\n취합 완료 후 팀별 의견 요약과 권장 선택안이 표시됩니다.`,
          `Round ${row.meeting_round} team-lead opinions are consolidated.\nTask: '${taskTitle}'\n${projectName ? `Project: '${projectName}'\n` : ""}Planning lead is consolidating recommendations...\nTeam summary and recommended picks will appear after consolidation.`,
          `ラウンド${row.meeting_round}のチームリーダー意見が集約されました。\nタスク: '${taskTitle}'\n${projectName ? `プロジェクト: '${projectName}'\n` : ""}企画リードが推奨案を集約中...\n集約完了後、チーム別要約と推奨選択が表示されます。`,
          `第 ${row.meeting_round} 轮组长意见已汇总。\n任务：'${taskTitle}'\n${projectName ? `项目：'${projectName}'\n` : ""}规划负责人正在汇总建议...\n完成后将显示各团队摘要与推荐选项。`,
        );
        out.push({
          id: `review-round-pick:${row.task_id}:${row.meeting_id}`,
          kind: "review_round_pick",
          created_at: row.meeting_completed_at ?? row.meeting_started_at ?? now,
          summary: collectingSummary,
          agent_id: planningLeadMeta.agent_id,
          agent_name: planningLeadMeta.agent_name,
          agent_name_ko: planningLeadMeta.agent_name_ko,
          agent_avatar: planningLeadMeta.agent_avatar,
          project_id: row.project_id,
          project_name: row.project_name,
          project_path: row.project_path,
          task_id: row.task_id,
          task_title: row.task_title,
          meeting_id: row.meeting_id,
          review_round: row.meeting_round,
          options: [],
        });
        continue;
      }

      const plannerHeader = t(
        "기획팀장 의견 취합 완료",
        "Planning consolidation complete",
        "企画リード意見集約完了",
        "规划负责人意见汇总完成",
      );
      const plannerSummary = formatPlannerSummaryForDisplay(String(decisionState.planner_summary ?? "").trim());
      const optionGuide = options.map((option) => `${option.number}. ${option.label}`).join("\n");
      const optionGuideBlock = optionGuide
        ? t(
            `현재 선택 가능한 항목:\n${optionGuide}`,
            `Available options now:\n${optionGuide}`,
            `現在選択可能な項目:\n${optionGuide}`,
            `当前可选项:\n${optionGuide}`,
          )
        : "";
      const combinedSummaryBase = plannerSummary
        ? `${plannerHeader}\n${plannerSummary}\n\n${summary}`
        : `${plannerHeader}\n\n${summary}`;
      const combinedSummary = optionGuideBlock ? `${combinedSummaryBase}\n\n${optionGuideBlock}` : combinedSummaryBase;

      out.push({
        id: `review-round-pick:${row.task_id}:${row.meeting_id}`,
        kind: "review_round_pick",
        created_at: row.meeting_completed_at ?? row.meeting_started_at ?? now,
        summary: combinedSummary,
        agent_id: planningLeadMeta.agent_id,
        agent_name: planningLeadMeta.agent_name,
        agent_name_ko: planningLeadMeta.agent_name_ko,
        agent_avatar: planningLeadMeta.agent_avatar,
        project_id: row.project_id,
        project_name: row.project_name,
        project_path: row.project_path,
        task_id: row.task_id,
        task_title: row.task_title,
        meeting_id: row.meeting_id,
        review_round: row.meeting_round,
        options,
      });
    }
    return out;
  }

  function openSupplementRound(
    taskId: string,
    assignedAgentId: string | null,
    fallbackDepartmentId: string | null,
    logPrefix = "Decision inbox",
  ): { started: boolean; reason: string } {
    const branchTs = nowMs();
    db.prepare("UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ?").run(branchTs, taskId);
    const pendingTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    broadcast("task_update", pendingTask);
    appendTaskLog(taskId, "system", `${logPrefix}: supplement round opened (review -> pending)`);

    if (!assignedAgentId) {
      appendTaskLog(taskId, "system", `${logPrefix}: supplement round pending (no assigned agent)`);
      return { started: false, reason: "no_assignee" };
    }

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(assignedAgentId) as AgentRow | undefined;
    if (!agent) {
      appendTaskLog(taskId, "system", `${logPrefix}: supplement round pending (assigned agent not found)`);
      return { started: false, reason: "agent_not_found" };
    }
    if (agent.status === "offline") {
      appendTaskLog(taskId, "system", `${logPrefix}: supplement round pending (assigned agent offline)`);
      return { started: false, reason: "agent_offline" };
    }
    if (activeProcesses.has(taskId)) {
      return { started: false, reason: "already_running" };
    }
    if (
      agent.status === "working" &&
      agent.current_task_id &&
      agent.current_task_id !== taskId &&
      activeProcesses.has(agent.current_task_id)
    ) {
      appendTaskLog(
        taskId,
        "system",
        `${logPrefix}: supplement round pending (agent busy on ${agent.current_task_id})`,
      );
      return { started: false, reason: "agent_busy" };
    }

    const deptId = agent.department_id ?? fallbackDepartmentId ?? null;
    const deptName = deptId ? getDeptName(deptId) : "Unassigned";
    appendTaskLog(taskId, "system", `${logPrefix}: supplement round execution started`);
    startTaskExecutionForAgent(taskId, agent, deptId, deptName);
    return { started: true, reason: "started" };
  }

  function getDecisionInboxItems(): DecisionInboxRouteItem[] {
    const items = [
      ...buildProjectReviewDecisionItems(),
      ...buildReviewRoundDecisionItems(),
      ...buildTimeoutResumeDecisionItems(),
    ];
    items.sort((a, b) => b.created_at - a.created_at);
    return items;
  }

  // ---------------------------------------------------------------------------
  // Messages / Chat
  // ---------------------------------------------------------------------------
  app.get("/api/decision-inbox", (_req, res) => {
    const items = getDecisionInboxItems();
    res.json({ items });
  });

  app.post("/api/decision-inbox/:id/reply", (req, res) => {
    const decisionId = String(req.params.id || "");
    const optionNumber = Number(req.body?.option_number ?? req.body?.optionNumber ?? req.body?.option);
    if (!Number.isFinite(optionNumber)) {
      return res.status(400).json({ error: "option_number_required" });
    }

    const currentItem = getDecisionInboxItems().find((item) => item.id === decisionId);
    if (!currentItem) {
      return res.status(404).json({ error: "decision_not_found" });
    }
    const selectedOption = currentItem.options.find((option) => option.number === optionNumber);
    if (!selectedOption) {
      if (currentItem.options.length <= 0) {
        return res.status(409).json({
          error: "decision_options_not_ready",
          kind: currentItem.kind,
        });
      }
      return res.status(400).json({ error: "option_not_found", option_number: optionNumber });
    }

    if (currentItem.kind === "project_review_ready") {
      const projectId = currentItem.project_id;
      if (!projectId) return res.status(400).json({ error: "project_id_required" });
      const selectedAction = selectedOption.action;
      const decisionSnapshotHash = getProjectReviewDecisionState(projectId)?.snapshot_hash ?? null;

      if (selectedAction === "keep_waiting") {
        return res.json({
          ok: true,
          resolved: false,
          kind: "project_review_ready",
          action: "keep_waiting",
        });
      }

      if (selectedAction.startsWith("approve_task_review:")) {
        const selectedTaskId = selectedAction.slice("approve_task_review:".length).trim();
        if (!selectedTaskId) return res.status(400).json({ error: "task_id_required" });
        const targetTask = db
          .prepare(
            `
        SELECT id, title
        FROM tasks
        WHERE id = ?
          AND project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
      `,
          )
          .get(selectedTaskId, projectId) as { id: string; title: string } | undefined;
        if (!targetTask) return res.status(404).json({ error: "project_review_task_not_found" });

        appendTaskLog(
          targetTask.id,
          "system",
          `${PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX} (project_id=${projectId}, option=${optionNumber})`,
        );
        recordProjectReviewDecisionEvent({
          project_id: projectId,
          snapshot_hash: decisionSnapshotHash,
          event_type: "representative_pick",
          summary: `대표 선택: ${targetTask.title}`,
          selected_options_json: JSON.stringify([
            {
              number: optionNumber,
              action: selectedAction,
              label: selectedOption.label || targetTask.title,
              task_id: targetTask.id,
            },
          ]),
          task_id: targetTask.id,
        });
        const remaining = getProjectReviewTaskChoices(projectId).filter((task) => !task.selected).length;
        return res.json({
          ok: true,
          resolved: false,
          kind: "project_review_ready",
          action: "approve_task_review",
          task_id: targetTask.id,
          pending_task_choices: remaining,
        });
      }

      if (selectedAction === "add_followup_request") {
        const note = normalizeTextField(req.body?.note);
        if (!note) {
          return res.status(400).json({ error: "followup_note_required" });
        }
        const lang = getPreferredLanguage();
        const followupTitlePrefix = pickL(
          l(["[의사결정 추가요청]"], ["[Decision Follow-up]"], ["[意思決定追加要請]"], ["[决策追加请求]"]),
          lang,
        );
        const targetTaskIdInput = normalizeTextField(req.body?.target_task_id);
        const targetTask = targetTaskIdInput
          ? (db
              .prepare(
                `
            SELECT id, title, status, assigned_agent_id, department_id
            FROM tasks
            WHERE id = ?
              AND project_id = ?
              AND status = 'review'
              AND source_task_id IS NULL
          `,
              )
              .get(targetTaskIdInput, projectId) as
              | {
                  id: string;
                  title: string;
                  status: string;
                  assigned_agent_id: string | null;
                  department_id: string | null;
                }
              | undefined)
          : undefined;
        const fallbackTargetTask = db
          .prepare(
            `
        SELECT id, title, status, assigned_agent_id, department_id
        FROM tasks
        WHERE project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
        ORDER BY updated_at ASC, created_at ASC
        LIMIT 1
      `,
          )
          .get(projectId) as
          | {
              id: string;
              title: string;
              status: string;
              assigned_agent_id: string | null;
              department_id: string | null;
            }
          | undefined;
        const resolvedTarget = targetTask ?? fallbackTargetTask;
        if (!resolvedTarget) {
          return res.status(404).json({ error: "project_review_task_not_found" });
        }

        const subtaskId = randomUUID();
        const createdAt = nowMs();
        const noteCompact = note.replace(/\s+/g, " ").trim();
        const noteTitle = noteCompact.length > 72 ? `${noteCompact.slice(0, 69).trimEnd()}...` : noteCompact;
        const title = `${followupTitlePrefix} ${noteTitle}`;
        db.prepare(
          `
        INSERT INTO subtasks (id, task_id, title, description, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `,
        ).run(subtaskId, resolvedTarget.id, title, note, createdAt);

        appendTaskLog(resolvedTarget.id, "system", `Decision inbox follow-up request added: ${note}`);
        recordProjectReviewDecisionEvent({
          project_id: projectId,
          snapshot_hash: decisionSnapshotHash,
          event_type: "followup_request",
          summary: selectedOption.label || "추가요청 입력",
          selected_options_json: JSON.stringify([
            {
              number: optionNumber,
              action: selectedAction,
              label: selectedOption.label || "add_followup_request",
              task_id: resolvedTarget.id,
            },
          ]),
          note,
          task_id: resolvedTarget.id,
        });
        const insertedSubtask = db.prepare("SELECT * FROM subtasks WHERE id = ?").get(subtaskId);
        broadcast("subtask_update", insertedSubtask);

        const supplement = openSupplementRound(
          resolvedTarget.id,
          resolvedTarget.assigned_agent_id,
          resolvedTarget.department_id,
          "Decision inbox",
        );

        return res.json({
          ok: true,
          resolved: false,
          kind: "project_review_ready",
          action: "add_followup_request",
          task_id: resolvedTarget.id,
          subtask_id: subtaskId,
          supplement_round_started: supplement.started,
          supplement_round_reason: supplement.reason,
        });
      }

      if (selectedAction === "start_project_review") {
        const reviewTaskChoices = getProjectReviewTaskChoices(projectId);
        const requiresRepresentativeSelection = reviewTaskChoices.length > 1;
        const pendingChoices = requiresRepresentativeSelection
          ? reviewTaskChoices.filter((task) => !task.selected)
          : [];
        if (requiresRepresentativeSelection && pendingChoices.length > 0) {
          return res.status(409).json({
            error: "project_task_options_pending",
            pending_task_choices: pendingChoices.map((task) => ({ id: task.id, title: task.title })),
          });
        }

        const readiness = db
          .prepare(
            `
        SELECT
          SUM(CASE WHEN status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS active_total,
          SUM(CASE WHEN status NOT IN ('done', 'cancelled') AND status = 'review' THEN 1 ELSE 0 END) AS active_review
        FROM tasks
        WHERE project_id = ?
      `,
          )
          .get(projectId) as { active_total: number | null; active_review: number | null } | undefined;
        const activeTotal = readiness?.active_total ?? 0;
        const activeReview = readiness?.active_review ?? 0;
        if (!(activeTotal > 0 && activeTotal === activeReview)) {
          return res.status(409).json({
            error: "project_not_ready_for_review_meeting",
            active_total: activeTotal,
            active_review: activeReview,
          });
        }

        const reviewTasks = db
          .prepare(
            `
        SELECT id, title
        FROM tasks
        WHERE project_id = ?
          AND status = 'review'
          AND source_task_id IS NULL
        ORDER BY updated_at ASC
      `,
          )
          .all(projectId) as Array<{ id: string; title: string }>;

        for (const task of reviewTasks) {
          appendTaskLog(task.id, "system", "Decision inbox: project-level review meeting approved by CEO");
          finishReview(task.id, task.title, {
            bypassProjectDecisionGate: true,
            trigger: "decision_inbox",
          });
        }
        recordProjectReviewDecisionEvent({
          project_id: projectId,
          snapshot_hash: decisionSnapshotHash,
          event_type: "start_review_meeting",
          summary: selectedOption.label || "팀장 회의 진행",
          selected_options_json: JSON.stringify([
            {
              number: optionNumber,
              action: selectedAction,
              label: selectedOption.label || "start_project_review",
              task_count: reviewTasks.length,
            },
          ]),
        });

        return res.json({
          ok: true,
          resolved: true,
          kind: "project_review_ready",
          action: "start_project_review",
          started_task_ids: reviewTasks.map((task) => task.id),
        });
      }

      return res.status(400).json({ error: "unsupported_project_action", action: selectedAction });
    }

    if (currentItem.kind === "review_round_pick") {
      const taskId = currentItem.task_id;
      const meetingId = normalizeTextField((currentItem as { meeting_id?: string | null }).meeting_id);
      if (!taskId || !meetingId) return res.status(400).json({ error: "task_or_meeting_required" });

      const task = db
        .prepare(
          `
      SELECT id, title, status, project_id, department_id, assigned_agent_id, description
      FROM tasks
      WHERE id = ?
    `,
        )
        .get(taskId) as
        | {
            id: string;
            title: string;
            status: string;
            project_id: string | null;
            department_id: string | null;
            assigned_agent_id: string | null;
            description: string | null;
          }
        | undefined;
      if (!task) return res.status(404).json({ error: "task_not_found" });
      if (task.status !== "review") {
        return res.status(409).json({ error: "task_not_in_review", status: task.status });
      }

      const meeting = db
        .prepare(
          `
      SELECT id, round, status
      FROM meeting_minutes
      WHERE id = ?
        AND task_id = ?
        AND meeting_type = 'review'
    `,
        )
        .get(meetingId, taskId) as
        | {
            id: string;
            round: number;
            status: string;
          }
        | undefined;
      if (!meeting) return res.status(404).json({ error: "meeting_not_found" });
      if (meeting.status !== "revision_requested") {
        return res.status(409).json({ error: "meeting_not_pending", status: meeting.status });
      }
      const reviewRound = Number.isFinite(meeting.round) ? Math.max(1, Math.trunc(meeting.round)) : 1;
      const lang = resolveLang(task.description ?? task.title);
      const resolvedProjectId = normalizeTextField(currentItem.project_id) ?? normalizeTextField(task.project_id);
      const decisionSnapshotHash = resolvedProjectId
        ? (getProjectReviewDecisionState(resolvedProjectId)?.snapshot_hash ?? null)
        : null;
      const notesRaw = getReviewDecisionNotes(taskId, reviewRound, 6);
      const notes = notesRaw.length > 0 ? notesRaw : [getReviewDecisionFallbackLabel(lang)];

      const skipNumber = notes.length + 1;
      const payloadNumbers = Array.isArray(req.body?.selected_option_numbers) ? req.body.selected_option_numbers : null;
      const selectedNumbers = (payloadNumbers !== null ? payloadNumbers : [optionNumber])
        .map((value: unknown) => Number(value))
        .filter((num: number) => Number.isFinite(num))
        .map((num: number) => Math.trunc(num));
      const dedupedSelected: number[] = Array.from(new Set<number>(selectedNumbers));
      const extraNote = normalizeTextField(req.body?.note);

      if (dedupedSelected.includes(skipNumber)) {
        if (dedupedSelected.length > 1) {
          return res.status(400).json({ error: "skip_option_must_be_alone" });
        }
        if (extraNote) {
          return res.status(400).json({ error: "skip_option_disallows_extra_note" });
        }
        const resolvedAt = nowMs();
        db.prepare("UPDATE meeting_minutes SET status = 'completed', completed_at = ? WHERE id = ?").run(
          resolvedAt,
          meetingId,
        );
        appendTaskLog(
          taskId,
          "system",
          `${REVIEW_DECISION_RESOLVED_LOG_PREFIX} (action=skip_to_next_round, round=${reviewRound}, meeting_id=${meetingId})`,
        );
        if (resolvedProjectId) {
          const skipOptionLabel =
            currentItem.options.find((option) => option.number === skipNumber)?.label ||
            selectedOption.label ||
            "skip_to_next_round";
          recordProjectReviewDecisionEvent({
            project_id: resolvedProjectId,
            snapshot_hash: decisionSnapshotHash,
            event_type: "representative_pick",
            summary: pickL(
              l(
                [`리뷰 라운드 ${reviewRound} 의사결정: 다음 라운드로 SKIP`],
                [`Review round ${reviewRound} decision: skip to next round`],
                [`レビューラウンド${reviewRound}判断: 次ラウンドへスキップ`],
                [`评审第 ${reviewRound} 轮决策：跳到下一轮`],
              ),
              lang,
            ),
            selected_options_json: JSON.stringify([
              {
                number: skipNumber,
                action: "skip_to_next_round",
                label: skipOptionLabel,
                review_round: reviewRound,
              },
            ]),
            task_id: taskId,
            meeting_id: meetingId,
          });
        }
        try {
          scheduleNextReviewRound(taskId, task.title, reviewRound, lang);
        } catch (err: any) {
          db.prepare("UPDATE meeting_minutes SET status = 'revision_requested', completed_at = NULL WHERE id = ?").run(
            meetingId,
          );
          const msg = err?.message ? String(err.message) : String(err);
          appendTaskLog(
            taskId,
            "error",
            `Decision inbox skip rollback: next round scheduling failed (round=${reviewRound}, meeting_id=${meetingId}, reason=${msg})`,
          );
          return res.status(500).json({ error: "schedule_next_review_round_failed", message: msg });
        }
        return res.json({
          ok: true,
          resolved: true,
          kind: "review_round_pick",
          action: "skip_to_next_round",
          task_id: taskId,
          review_round: reviewRound,
        });
      }

      const pickedNumbers = dedupedSelected.filter((num) => num >= 1 && num <= notes.length).sort((a, b) => a - b);
      const pickedNotes = pickedNumbers.map((num) => notes[num - 1]).filter(Boolean);
      const mergedNotes: string[] = [];
      const seen = new Set<string>();
      for (const note of pickedNotes) {
        const cleaned = String(note || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        mergedNotes.push(cleaned);
      }
      if (extraNote) {
        const key = extraNote.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          mergedNotes.push(extraNote);
        }
      }
      if (mergedNotes.length <= 0) {
        return res.status(400).json({ error: "review_pick_or_note_required" });
      }

      const subtaskCount = seedReviewRevisionSubtasks(taskId, task.department_id, mergedNotes);
      processSubtaskDelegations(taskId);
      const resolvedAt = nowMs();
      db.prepare("UPDATE meeting_minutes SET status = 'completed', completed_at = ? WHERE id = ?").run(
        resolvedAt,
        meetingId,
      );
      appendTaskLog(
        taskId,
        "system",
        `${REVIEW_DECISION_RESOLVED_LOG_PREFIX} (action=apply_review_pick, round=${reviewRound}, picks=${pickedNumbers.join(",") || "-"}, extra_note=${extraNote ? "yes" : "no"}, meeting_id=${meetingId}, subtasks=${subtaskCount})`,
      );
      if (resolvedProjectId) {
        const pickedPayload = pickedNumbers.map((num) => ({
          number: num,
          action: "apply_review_pick",
          label: notes[num - 1] || `option_${num}`,
          review_round: reviewRound,
        }));
        recordProjectReviewDecisionEvent({
          project_id: resolvedProjectId,
          snapshot_hash: decisionSnapshotHash,
          event_type: "representative_pick",
          summary: pickL(
            l(
              [`리뷰 라운드 ${reviewRound} 의사결정: 보완 항목 선택 ${pickedNumbers.length}건`],
              [`Review round ${reviewRound} decision: ${pickedNumbers.length} remediation pick(s)`],
              [`レビューラウンド${reviewRound}判断: 補完項目 ${pickedNumbers.length} 件を選択`],
              [`评审第 ${reviewRound} 轮决策：已选择 ${pickedNumbers.length} 项补充整改`],
            ),
            lang,
          ),
          selected_options_json: pickedPayload.length > 0 ? JSON.stringify(pickedPayload) : null,
          note: extraNote ?? null,
          task_id: taskId,
          meeting_id: meetingId,
        });
      }

      const supplement = openSupplementRound(
        taskId,
        task.assigned_agent_id,
        task.department_id,
        `Decision inbox round${reviewRound}`,
      );
      return res.json({
        ok: true,
        resolved: true,
        kind: "review_round_pick",
        action: "apply_review_pick",
        task_id: taskId,
        selected_option_numbers: pickedNumbers,
        review_round: reviewRound,
        revision_subtask_count: subtaskCount,
        supplement_round_started: supplement.started,
        supplement_round_reason: supplement.reason,
      });
    }

    if (currentItem.kind === "task_timeout_resume") {
      const taskId = currentItem.task_id;
      if (!taskId) return res.status(400).json({ error: "task_id_required" });
      const selectedAction = selectedOption.action;

      if (selectedAction === "keep_inbox") {
        return res.json({
          ok: true,
          resolved: false,
          kind: "task_timeout_resume",
          action: "keep_inbox",
        });
      }
      if (selectedAction !== "resume_timeout_task") {
        return res.status(400).json({ error: "unsupported_timeout_action", action: selectedAction });
      }

      const task = db
        .prepare(
          `
      SELECT id, title, description, status, assigned_agent_id, department_id
      FROM tasks
      WHERE id = ?
    `,
        )
        .get(taskId) as
        | {
            id: string;
            title: string;
            description: string | null;
            status: string;
            assigned_agent_id: string | null;
            department_id: string | null;
          }
        | undefined;
      if (!task) return res.status(404).json({ error: "task_not_found" });
      if (task.status !== "inbox") {
        return res.status(409).json({ error: "task_not_in_inbox", status: task.status });
      }
      if (!task.assigned_agent_id) {
        return res.status(409).json({ error: "task_has_no_assigned_agent" });
      }

      const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id) as AgentRow | undefined;
      if (!agent) return res.status(404).json({ error: "agent_not_found" });

      if (activeProcesses.has(taskId)) {
        return res.status(409).json({ error: "already_running" });
      }
      if (
        agent.status === "working" &&
        agent.current_task_id &&
        agent.current_task_id !== taskId &&
        activeProcesses.has(agent.current_task_id)
      ) {
        return res.status(409).json({
          error: "agent_busy",
          current_task_id: agent.current_task_id,
        });
      }

      const deptId = agent.department_id ?? task.department_id ?? null;
      const deptName = deptId ? getDeptName(deptId) : "Unassigned";
      appendTaskLog(taskId, "system", "Decision inbox: timeout resume approved by CEO");
      startTaskExecutionForAgent(taskId, agent, deptId, deptName);

      return res.json({
        ok: true,
        resolved: true,
        kind: "task_timeout_resume",
        action: "resume_timeout_task",
        task_id: taskId,
      });
    }

    return res.status(400).json({ error: "unknown_decision_id" });
  });

  app.get("/api/messages", (req, res) => {
    const receiverType = firstQueryValue(req.query.receiver_type);
    const receiverId = firstQueryValue(req.query.receiver_id);
    const limitRaw = firstQueryValue(req.query.limit);
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 500);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (receiverType && receiverId) {
      // Conversation with a specific agent: show messages TO and FROM that agent
      conditions.push(
        "((receiver_type = ? AND receiver_id = ?) OR (sender_type = 'agent' AND sender_id = ?) OR receiver_type = 'all')",
      );
      params.push(receiverType, receiverId, receiverId);
    } else if (receiverType) {
      conditions.push("receiver_type = ?");
      params.push(receiverType);
    } else if (receiverId) {
      conditions.push("(receiver_id = ? OR receiver_type = 'all')");
      params.push(receiverId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const messages = db
      .prepare(
        `
    SELECT m.*,
      a.name AS sender_name,
      a.avatar_emoji AS sender_avatar
    FROM messages m
    LEFT JOIN agents a ON m.sender_type = 'agent' AND m.sender_id = a.id
    ${where}
    ORDER BY m.created_at DESC
    LIMIT ?
  `,
      )
      .all(...(params as SQLInputValue[]));

    res.json({ messages: messages.reverse() }); // return in chronological order
  });

  app.post("/api/messages", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const idempotencyKey = resolveMessageIdempotencyKey(req, body, "api.messages");
    const content = body.content;
    if (!content || typeof content !== "string") {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/messages",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 400,
          detail: "content_required",
        })
      )
        return;
      return res.status(400).json({ error: "content_required" });
    }

    const senderType = typeof body.sender_type === "string" ? body.sender_type : "ceo";
    const senderId = typeof body.sender_id === "string" ? body.sender_id : null;
    const receiverType = typeof body.receiver_type === "string" ? body.receiver_type : "all";
    const receiverId = typeof body.receiver_id === "string" ? body.receiver_id : null;
    const messageType = typeof body.message_type === "string" ? body.message_type : "chat";
    const taskId = typeof body.task_id === "string" ? body.task_id : null;
    const projectId = normalizeTextField(body.project_id);
    const projectPath = normalizeTextField(body.project_path);
    const projectContext = normalizeTextField(body.project_context);

    let storedMessage: StoredMessage;
    let created: boolean;
    try {
      ({ message: storedMessage, created } = await insertMessageWithIdempotency({
        senderType,
        senderId,
        receiverType,
        receiverId,
        content,
        messageType,
        taskId,
        idempotencyKey,
      }));
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/messages",
            req,
            body,
            idempotencyKey,
            outcome: "idempotency_conflict",
            statusCode: 409,
            detail: "payload_mismatch",
          })
        )
          return;
        return res.status(409).json({ error: "idempotency_conflict", idempotency_key: err.key });
      }
      if (err instanceof StorageBusyError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/messages",
            req,
            body,
            idempotencyKey,
            outcome: "storage_busy",
            statusCode: 503,
            detail: `operation=${err.operation}, attempts=${err.attempts}`,
          })
        )
          return;
        return res.status(503).json({ error: "storage_busy", retryable: true, operation: err.operation });
      }
      throw err;
    }

    const msg = { ...storedMessage };

    if (!created) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/messages",
          req,
          body,
          idempotencyKey,
          outcome: "duplicate",
          statusCode: 200,
          messageId: msg.id,
          detail: "idempotent_replay",
        })
      )
        return;
      return res.json({ ok: true, message: msg, duplicate: true });
    }

    if (
      !(await recordAcceptedIngressAuditOrRollback(
        res,
        {
          endpoint: "/api/messages",
          req,
          body,
          idempotencyKey,
          outcome: "accepted",
          statusCode: 200,
          detail: "created",
        },
        msg.id,
      ))
    )
      return;
    broadcast("new_message", msg);

    // Schedule agent auto-reply when CEO messages an agent
    if (senderType === "ceo" && receiverType === "agent" && receiverId) {
      if (messageType === "report") {
        const handled = handleReportRequest(receiverId, content);
        if (!handled) {
          scheduleAgentReply(receiverId, content, messageType, {
            projectId,
            projectPath,
            projectContext,
          });
        }
        return res.json({ ok: true, message: msg });
      }

      scheduleAgentReply(receiverId, content, messageType, {
        projectId,
        projectPath,
        projectContext,
      });

      // Check for @mentions to other departments/agents
      const mentions = detectMentions(content);
      if (mentions.deptIds.length > 0 || mentions.agentIds.length > 0) {
        const senderAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(receiverId) as AgentRow | undefined;
        if (senderAgent) {
          const lang = resolveLang(content);
          const mentionDelay = 4000 + Math.random() * 2000; // After the main delegation starts
          setTimeout(() => {
            // Handle department mentions
            for (const deptId of mentions.deptIds) {
              if (deptId === senderAgent.department_id) continue; // Skip own department
              handleMentionDelegation(senderAgent, deptId, content, lang);
            }
            // Handle agent mentions — find their department and delegate there
            for (const agentId of mentions.agentIds) {
              const mentioned = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
              if (mentioned && mentioned.department_id && mentioned.department_id !== senderAgent.department_id) {
                if (!mentions.deptIds.includes(mentioned.department_id)) {
                  handleMentionDelegation(senderAgent, mentioned.department_id, content, lang);
                }
              }
            }
          }, mentionDelay);
        }
      }
    }

    res.json({ ok: true, message: msg });
  });

  app.post("/api/announcements", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const idempotencyKey = resolveMessageIdempotencyKey(req, body, "api.announcements");
    const content = body.content;
    if (!content || typeof content !== "string") {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/announcements",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 400,
          detail: "content_required",
        })
      )
        return;
      return res.status(400).json({ error: "content_required" });
    }

    let storedMessage: StoredMessage;
    let created: boolean;
    try {
      ({ message: storedMessage, created } = await insertMessageWithIdempotency({
        senderType: "ceo",
        senderId: null,
        receiverType: "all",
        receiverId: null,
        content,
        messageType: "announcement",
        idempotencyKey,
      }));
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/announcements",
            req,
            body,
            idempotencyKey,
            outcome: "idempotency_conflict",
            statusCode: 409,
            detail: "payload_mismatch",
          })
        )
          return;
        return res.status(409).json({ error: "idempotency_conflict", idempotency_key: err.key });
      }
      if (err instanceof StorageBusyError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/announcements",
            req,
            body,
            idempotencyKey,
            outcome: "storage_busy",
            statusCode: 503,
            detail: `operation=${err.operation}, attempts=${err.attempts}`,
          })
        )
          return;
        return res.status(503).json({ error: "storage_busy", retryable: true, operation: err.operation });
      }
      throw err;
    }
    const msg = { ...storedMessage };

    if (!created) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/announcements",
          req,
          body,
          idempotencyKey,
          outcome: "duplicate",
          statusCode: 200,
          messageId: msg.id,
          detail: "idempotent_replay",
        })
      )
        return;
      return res.json({ ok: true, message: msg, duplicate: true });
    }

    if (
      !(await recordAcceptedIngressAuditOrRollback(
        res,
        {
          endpoint: "/api/announcements",
          req,
          body,
          idempotencyKey,
          outcome: "accepted",
          statusCode: 200,
          detail: "created",
        },
        msg.id,
      ))
    )
      return;
    broadcast("announcement", msg);

    // Team leaders respond to announcements with staggered delays
    scheduleAnnouncementReplies(content);

    // Check for @mentions in announcements — trigger delegation
    const mentions = detectMentions(content);
    if (mentions.deptIds.length > 0 || mentions.agentIds.length > 0) {
      const mentionDelay = 5000 + Math.random() * 2000;
      setTimeout(() => {
        const processedDepts = new Set<string>();

        for (const deptId of mentions.deptIds) {
          if (processedDepts.has(deptId)) continue;
          processedDepts.add(deptId);
          const leader = findTeamLeader(deptId);
          if (leader) {
            handleTaskDelegation(leader, content, "");
          }
        }

        for (const agentId of mentions.agentIds) {
          const mentioned = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
          if (mentioned?.department_id && !processedDepts.has(mentioned.department_id)) {
            processedDepts.add(mentioned.department_id);
            const leader = findTeamLeader(mentioned.department_id);
            if (leader) {
              handleTaskDelegation(leader, content, "");
            }
          }
        }
      }, mentionDelay);
    }

    res.json({ ok: true, message: msg });
  });

  // ── Directives (CEO ! command) ──────────────────────────────────────────────
  app.post("/api/directives", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const idempotencyKey = resolveMessageIdempotencyKey(req, body, "api.directives");
    const content = body.content;
    let explicitProjectId = normalizeTextField(body.project_id);
    let explicitProjectPath = normalizeTextField(body.project_path);
    let explicitProjectContext = normalizeTextField(body.project_context);
    if (!content || typeof content !== "string") {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/directives",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 400,
          detail: "content_required",
        })
      )
        return;
      return res.status(400).json({ error: "content_required" });
    }

    if (ENFORCE_DIRECTIVE_PROJECT_BINDING && !explicitProjectId) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/directives",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 428,
          detail: "agent_upgrade_required:install_first",
        })
      )
        return;
      return res.status(428).json(buildAgentUpgradeRequiredPayload());
    }

    let storedMessage: StoredMessage;
    let created: boolean;
    try {
      ({ message: storedMessage, created } = await insertMessageWithIdempotency({
        senderType: "ceo",
        senderId: null,
        receiverType: "all",
        receiverId: null,
        content,
        messageType: "directive",
        idempotencyKey,
      }));
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/directives",
            req,
            body,
            idempotencyKey,
            outcome: "idempotency_conflict",
            statusCode: 409,
            detail: "payload_mismatch",
          })
        )
          return;
        return res.status(409).json({ error: "idempotency_conflict", idempotency_key: err.key });
      }
      if (err instanceof StorageBusyError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/directives",
            req,
            body,
            idempotencyKey,
            outcome: "storage_busy",
            statusCode: 503,
            detail: `operation=${err.operation}, attempts=${err.attempts}`,
          })
        )
          return;
        return res.status(503).json({ error: "storage_busy", retryable: true, operation: err.operation });
      }
      throw err;
    }
    const msg = { ...storedMessage };

    if (!created) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/directives",
          req,
          body,
          idempotencyKey,
          outcome: "duplicate",
          statusCode: 200,
          messageId: msg.id,
          detail: "idempotent_replay",
        })
      )
        return;
      return res.json({ ok: true, message: msg, duplicate: true });
    }

    if (
      !(await recordAcceptedIngressAuditOrRollback(
        res,
        {
          endpoint: "/api/directives",
          req,
          body,
          idempotencyKey,
          outcome: "accepted",
          statusCode: 200,
          detail: "created",
        },
        msg.id,
      ))
    )
      return;
    // 2. Broadcast to all
    broadcast("announcement", msg);

    // 3. Team leaders respond
    scheduleAnnouncementReplies(content);
    const directivePolicy = analyzeDirectivePolicy(content);
    const explicitSkip = body.skipPlannedMeeting === true;
    const shouldDelegate = shouldExecuteDirectiveDelegation(directivePolicy, explicitSkip);
    const delegationOptions: DelegationOptions = {
      skipPlannedMeeting: explicitSkip || directivePolicy.skipPlannedMeeting,
      skipPlanSubtasks: explicitSkip || directivePolicy.skipPlanSubtasks,
      projectId: explicitProjectId,
      projectPath: explicitProjectPath,
      projectContext: explicitProjectContext,
    };

    if (shouldDelegate) {
      // 4. Auto-delegate to planning team leader
      const planningLeader = findTeamLeader("planning");
      if (planningLeader) {
        const delegationDelay = 3000 + Math.random() * 2000;
        setTimeout(() => {
          handleTaskDelegation(planningLeader, content, "", delegationOptions);
        }, delegationDelay);
      }

      // 5. Additional @mentions trigger delegation to other departments
      const mentions = detectMentions(content);
      if (mentions.deptIds.length > 0 || mentions.agentIds.length > 0) {
        const mentionDelay = 5000 + Math.random() * 2000;
        setTimeout(() => {
          const processedDepts = new Set<string>(["planning"]);

          for (const deptId of mentions.deptIds) {
            if (processedDepts.has(deptId)) continue;
            processedDepts.add(deptId);
            const leader = findTeamLeader(deptId);
            if (leader) {
              handleTaskDelegation(leader, content, "", delegationOptions);
            }
          }

          for (const agentId of mentions.agentIds) {
            const mentioned = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
            if (mentioned?.department_id && !processedDepts.has(mentioned.department_id)) {
              processedDepts.add(mentioned.department_id);
              const leader = findTeamLeader(mentioned.department_id);
              if (leader) {
                handleTaskDelegation(leader, content, "", delegationOptions);
              }
            }
          }
        }, mentionDelay);
      }
    }

    res.json({ ok: true, message: msg });
  });

  // ── Inbound webhook (Telegram / external) ───────────────────────────────────
  app.post("/api/inbox", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const idempotencyKey = resolveMessageIdempotencyKey(req, body, "api.inbox");
    if (!INBOX_WEBHOOK_SECRET) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 503,
          detail: "inbox_webhook_secret_not_configured",
        })
      )
        return;
      return res.status(503).json({ error: "inbox_webhook_secret_not_configured" });
    }
    const providedSecret = req.header("x-inbox-secret") ?? "";
    if (!safeSecretEquals(providedSecret, INBOX_WEBHOOK_SECRET)) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 401,
          detail: "invalid_webhook_secret",
        })
      )
        return;
      return res.status(401).json({ error: "unauthorized" });
    }

    const text = body.text;
    if (!text || typeof text !== "string" || !text.trim()) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 400,
          detail: "text_required",
        })
      )
        return;
      return res.status(400).json({ error: "text_required" });
    }

    const raw = text.trimStart();
    const isDirective = raw.startsWith("$");
    const content = isDirective ? raw.slice(1).trimStart() : raw;
    let inboxProjectId = normalizeTextField(body.project_id);
    let inboxProjectPath = normalizeTextField(body.project_path);
    let inboxProjectContext = normalizeTextField(body.project_context);
    if (!content) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 400,
          detail: "empty_content",
        })
      )
        return;
      return res.status(400).json({ error: "empty_content" });
    }

    if (ENFORCE_DIRECTIVE_PROJECT_BINDING && isDirective && !inboxProjectId) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "validation_error",
          statusCode: 428,
          detail: "agent_upgrade_required:install_first",
        })
      )
        return;
      return res.status(428).json(buildAgentUpgradeRequiredPayload());
    }

    const messageType = isDirective ? "directive" : "announcement";
    let storedMessage: StoredMessage;
    let created: boolean;
    try {
      ({ message: storedMessage, created } = await insertMessageWithIdempotency({
        senderType: "ceo",
        senderId: null,
        receiverType: "all",
        receiverId: null,
        content,
        messageType,
        idempotencyKey,
      }));
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/inbox",
            req,
            body,
            idempotencyKey,
            outcome: "idempotency_conflict",
            statusCode: 409,
            detail: "payload_mismatch",
          })
        )
          return;
        return res.status(409).json({ error: "idempotency_conflict", idempotency_key: err.key });
      }
      if (err instanceof StorageBusyError) {
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/inbox",
            req,
            body,
            idempotencyKey,
            outcome: "storage_busy",
            statusCode: 503,
            detail: `operation=${err.operation}, attempts=${err.attempts}`,
          })
        )
          return;
        return res.status(503).json({ error: "storage_busy", retryable: true, operation: err.operation });
      }
      throw err;
    }
    const msg = { ...storedMessage };

    if (!created) {
      if (
        !recordMessageIngressAuditOr503(res, {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "duplicate",
          statusCode: 200,
          messageId: msg.id,
          detail: "idempotent_replay",
        })
      )
        return;
      return res.json({ ok: true, id: msg.id, directive: isDirective, duplicate: true });
    }

    if (
      !(await recordAcceptedIngressAuditOrRollback(
        res,
        {
          endpoint: "/api/inbox",
          req,
          body,
          idempotencyKey,
          outcome: "accepted",
          statusCode: 200,
          detail: isDirective ? "created:directive" : "created:announcement",
        },
        msg.id,
      ))
    )
      return;
    // Broadcast
    broadcast("announcement", msg);

    // Team leaders respond
    scheduleAnnouncementReplies(content);
    const directivePolicy = isDirective ? analyzeDirectivePolicy(content) : null;
    const inboxExplicitSkip = body.skipPlannedMeeting === true;
    const shouldDelegateDirective =
      isDirective && directivePolicy ? shouldExecuteDirectiveDelegation(directivePolicy, inboxExplicitSkip) : false;
    const directiveDelegationOptions: DelegationOptions = {
      skipPlannedMeeting: inboxExplicitSkip || !!directivePolicy?.skipPlannedMeeting,
      skipPlanSubtasks: inboxExplicitSkip || !!directivePolicy?.skipPlanSubtasks,
      projectId: inboxProjectId,
      projectPath: inboxProjectPath,
      projectContext: inboxProjectContext,
    };

    if (shouldDelegateDirective) {
      // Auto-delegate to planning team leader
      const planningLeader = findTeamLeader("planning");
      if (planningLeader) {
        const delegationDelay = 3000 + Math.random() * 2000;
        setTimeout(() => {
          handleTaskDelegation(planningLeader, content, "", directiveDelegationOptions);
        }, delegationDelay);
      }
    }

    // Handle @mentions
    const mentions = detectMentions(content);
    const shouldHandleMentions = !isDirective || shouldDelegateDirective;
    if (shouldHandleMentions && (mentions.deptIds.length > 0 || mentions.agentIds.length > 0)) {
      const mentionDelay = 5000 + Math.random() * 2000;
      setTimeout(() => {
        const processedDepts = new Set<string>(isDirective ? ["planning"] : []);

        for (const deptId of mentions.deptIds) {
          if (processedDepts.has(deptId)) continue;
          processedDepts.add(deptId);
          const leader = findTeamLeader(deptId);
          if (leader) {
            handleTaskDelegation(leader, content, "", isDirective ? directiveDelegationOptions : {});
          }
        }

        for (const agentId of mentions.agentIds) {
          const mentioned = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
          if (mentioned?.department_id && !processedDepts.has(mentioned.department_id)) {
            processedDepts.add(mentioned.department_id);
            const leader = findTeamLeader(mentioned.department_id);
            if (leader) {
              handleTaskDelegation(leader, content, "", isDirective ? directiveDelegationOptions : {});
            }
          }
        }
      }, mentionDelay);
    }

    res.json({ ok: true, id: msg.id, directive: isDirective });
  });

  // Delete conversation messages
  app.delete("/api/messages", (req, res) => {
    const agentId = firstQueryValue(req.query.agent_id);
    const scope = firstQueryValue(req.query.scope) || "conversation"; // "conversation" or "all"

    if (scope === "all") {
      // Delete all messages (announcements + conversations)
      const result = db.prepare("DELETE FROM messages").run();
      broadcast("messages_cleared", { scope: "all" });
      return res.json({ ok: true, deleted: result.changes });
    }

    if (agentId) {
      // Delete messages for a specific agent conversation + announcements shown in that chat
      const result = db
        .prepare(
          `DELETE FROM messages WHERE
        (sender_type = 'ceo' AND receiver_type = 'agent' AND receiver_id = ?)
        OR (sender_type = 'agent' AND sender_id = ?)
        OR receiver_type = 'all'
        OR message_type = 'announcement'`,
        )
        .run(agentId, agentId);
      broadcast("messages_cleared", { scope: "agent", agent_id: agentId });
      return res.json({ ok: true, deleted: result.changes });
    }

    // Delete only announcements/broadcasts
    const result = db
      .prepare("DELETE FROM messages WHERE receiver_type = 'all' OR message_type = 'announcement'")
      .run();
    broadcast("messages_cleared", { scope: "announcements" });
    res.json({ ok: true, deleted: result.changes });
  });

  return {};
}
