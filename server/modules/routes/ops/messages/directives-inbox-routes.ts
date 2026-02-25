import os from "node:os";
import path from "node:path";
import { INBOX_WEBHOOK_SECRET } from "../../../../config/runtime.ts";
import { safeSecretEquals } from "../../../../security/auth.ts";
import type { RuntimeContext } from "../../../../types/runtime-context.ts";
import type { AgentRow, DelegationOptions, StoredMessage } from "../../shared/types.ts";

type DirectiveAndInboxRouteDeps = {
  IdempotencyConflictError: any;
  StorageBusyError: any;
  enforceDirectiveProjectBinding: boolean;
  resolveMessageIdempotencyKey: RuntimeContext["resolveMessageIdempotencyKey"];
  recordMessageIngressAuditOr503: RuntimeContext["recordMessageIngressAuditOr503"];
  insertMessageWithIdempotency: RuntimeContext["insertMessageWithIdempotency"];
  recordAcceptedIngressAuditOrRollback: RuntimeContext["recordAcceptedIngressAuditOrRollback"];
  normalizeTextField: RuntimeContext["normalizeTextField"];
  scheduleAnnouncementReplies: RuntimeContext["scheduleAnnouncementReplies"];
  analyzeDirectivePolicy: RuntimeContext["analyzeDirectivePolicy"];
  shouldExecuteDirectiveDelegation: RuntimeContext["shouldExecuteDirectiveDelegation"];
  findTeamLeader: RuntimeContext["findTeamLeader"];
  handleTaskDelegation: RuntimeContext["handleTaskDelegation"];
  detectMentions: RuntimeContext["detectMentions"];
};

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

export function registerDirectiveAndInboxRoutes(ctx: RuntimeContext, deps: DirectiveAndInboxRouteDeps): void {
  const { app, db, broadcast } = ctx;
  const {
    IdempotencyConflictError,
    StorageBusyError,
    enforceDirectiveProjectBinding,
    resolveMessageIdempotencyKey,
    recordMessageIngressAuditOr503,
    insertMessageWithIdempotency,
    recordAcceptedIngressAuditOrRollback,
    normalizeTextField,
    scheduleAnnouncementReplies,
    analyzeDirectivePolicy,
    shouldExecuteDirectiveDelegation,
    findTeamLeader,
    handleTaskDelegation,
    detectMentions,
  } = deps;

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

    if (enforceDirectiveProjectBinding && !explicitProjectId) {
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
        const conflictErr = err as { key: string };
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
        return res.status(409).json({ error: "idempotency_conflict", idempotency_key: conflictErr.key });
      }
      if (err instanceof StorageBusyError) {
        const busyErr = err as { operation: string; attempts: number };
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/directives",
            req,
            body,
            idempotencyKey,
            outcome: "storage_busy",
            statusCode: 503,
            detail: `operation=${busyErr.operation}, attempts=${busyErr.attempts}`,
          })
        )
          return;
        return res.status(503).json({ error: "storage_busy", retryable: true, operation: busyErr.operation });
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

    if (enforceDirectiveProjectBinding && isDirective && !inboxProjectId) {
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
        const conflictErr = err as { key: string };
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
        return res.status(409).json({ error: "idempotency_conflict", idempotency_key: conflictErr.key });
      }
      if (err instanceof StorageBusyError) {
        const busyErr = err as { operation: string; attempts: number };
        if (
          !recordMessageIngressAuditOr503(res, {
            endpoint: "/api/inbox",
            req,
            body,
            idempotencyKey,
            outcome: "storage_busy",
            statusCode: 503,
            detail: `operation=${busyErr.operation}, attempts=${busyErr.attempts}`,
          })
        )
          return;
        return res.status(503).json({ error: "storage_busy", retryable: true, operation: busyErr.operation });
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
}
