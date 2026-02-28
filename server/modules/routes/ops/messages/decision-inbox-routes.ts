import type { RuntimeContext } from "../../../../types/runtime-context.ts";
import { createHash } from "node:crypto";
import { sendMessengerMessage, type MessengerChannel } from "../../../../gateway/client.ts";
import { isMessengerChannel } from "../../../../messenger/channels.ts";
import { resolveSourceChatRoute } from "../../../../messenger/session-agent-routing.ts";
import type { AgentRow } from "../../shared/types.ts";
import type { DecisionInboxRouteItem } from "./decision-inbox/types.ts";
import { handleProjectReviewDecisionReply } from "./decision-inbox/project-review-reply.ts";
import { handleReviewRoundDecisionReply } from "./decision-inbox/review-round-reply.ts";
import { handleTimeoutResumeDecisionReply } from "./decision-inbox/timeout-reply.ts";
import { createProjectAndTimeoutDecisionItems } from "./decision-inbox/project-timeout-items.ts";
import { createReviewRoundDecisionItems } from "./decision-inbox/review-round-items.ts";
import { createDecisionStateHelpers } from "./decision-inbox/state-helpers.ts";
import { createProjectReviewPlanningHelpers } from "./decision-inbox/project-review-planning.ts";
import { createReviewRoundPlanningHelpers } from "./decision-inbox/review-round-planning.ts";

export type DecisionReplyBridgeInput = {
  text: string;
  body?: Record<string, unknown>;
  source?: string | null;
  chat?: string | null;
  channel?: MessengerChannel;
  targetId?: string | null;
};

export type DecisionReplyBridgeResult = {
  handled: boolean;
  status: number;
  payload: Record<string, unknown>;
};

export type DecisionInboxRouteBridge = {
  tryHandleInboxDecisionReply: (input: DecisionReplyBridgeInput) => Promise<DecisionReplyBridgeResult>;
};

export function registerDecisionInboxRoutes(ctx: RuntimeContext): DecisionInboxRouteBridge {
  const __ctx: RuntimeContext = ctx;
  const {
    app,
    db,
    nowMs,
    activeProcesses,
    appendTaskLog,
    broadcast,
    finishReview,
    getAgentDisplayName,
    getDeptName,
    getPreferredLanguage,
    l,
    pickL,
    findTeamLeader,
    normalizeTextField,
    processSubtaskDelegations,
    resolveLang,
    runAgentOneShot,
    scheduleNextReviewRound,
    seedReviewRevisionSubtasks,
    startTaskExecutionForAgent,
    chooseSafeReply,
  } = __ctx;

  const PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX = "Decision inbox: project review task option selected";
  const REVIEW_DECISION_RESOLVED_LOG_PREFIX = "Decision inbox: review decision resolved";

  const {
    buildProjectReviewSnapshotHash,
    getProjectReviewDecisionState,
    upsertProjectReviewDecisionState,
    buildReviewRoundSnapshotHash,
    getReviewRoundDecisionState,
    upsertReviewRoundDecisionState,
    recordProjectReviewDecisionEvent,
  } = createDecisionStateHelpers({ db, nowMs });

  const { formatPlannerSummaryForDisplay, resolvePlanningLeadMeta, queueProjectReviewPlanningConsolidation } =
    createProjectReviewPlanningHelpers({
      db,
      nowMs,
      l,
      pickL,
      findTeamLeader,
      runAgentOneShot,
      chooseSafeReply,
      getAgentDisplayName,
      getProjectReviewDecisionState,
      recordProjectReviewDecisionEvent,
    });

  const { queueReviewRoundPlanningConsolidation } = createReviewRoundPlanningHelpers({
    db,
    nowMs,
    l,
    pickL,
    findTeamLeader,
    runAgentOneShot,
    chooseSafeReply,
    getAgentDisplayName,
    getReviewRoundDecisionState,
    formatPlannerSummaryForDisplay,
    recordProjectReviewDecisionEvent,
    getProjectReviewDecisionState,
  });

  const { getProjectReviewTaskChoices, buildProjectReviewDecisionItems, buildTimeoutResumeDecisionItems } =
    createProjectAndTimeoutDecisionItems({
      db,
      nowMs,
      getPreferredLanguage,
      pickL,
      l,
      buildProjectReviewSnapshotHash,
      getProjectReviewDecisionState,
      upsertProjectReviewDecisionState,
      resolvePlanningLeadMeta,
      formatPlannerSummaryForDisplay,
      queueProjectReviewPlanningConsolidation,
      PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX,
    });

  const { getReviewDecisionFallbackLabel, getReviewDecisionNotes, buildReviewRoundDecisionItems } =
    createReviewRoundDecisionItems({
      db,
      nowMs,
      getPreferredLanguage,
      pickL,
      l,
      buildReviewRoundSnapshotHash,
      getReviewRoundDecisionState,
      upsertReviewRoundDecisionState,
      resolvePlanningLeadMeta,
      formatPlannerSummaryForDisplay,
      queueReviewRoundPlanningConsolidation,
    });

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

  type DecisionRoute = { channel: MessengerChannel; targetId: string };

  const TASK_MESSENGER_ROUTE_PREFIX = "[messenger-route]";
  const DECISION_NOTICE_CACHE_MAX = 1024;
  const DECISION_NOTICE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const DECISION_NOTICE_SENT_KEY_PREFIX = "decision_notice_sent:";
  const sentDecisionNoticeSignatureById = new Map<string, { signature: string; sentAt: number }>();
  const decisionRouteByDecisionId = new Map<
    string,
    { channel: MessengerChannel; targetId: string; updatedAt: number }
  >();
  const DECISION_REPLY_MARKER_RE = /\[(의사결정\s*회신|decision\s*reply|意思決定返信|决策回复)\]/i;
  const DECISION_TOKEN_RE = /\[DECISION:([A-Za-z0-9_-]{6,128})\]/i;
  const DECISION_APPROVE_WORD_RE =
    /^(승인|진행|go|ok|okay|yes|yep|approve|approved|확인|동의|承認|進行|はい|同意|通过|批准|好的|可以|行)$/i;
  const DECISION_NOTE_RE = /(?:추가\s*(?:코멘트|의견|메모)|note|비고|备注)\s*[:：]\s*(.+)$/i;

  function pickDecisionL10n(ko: string, en: string, ja: string, zh: string): string {
    const lang = getPreferredLanguage();
    if (lang === "en") return en;
    if (lang === "ja") return ja;
    if (lang === "zh") return zh;
    return ko;
  }

  function pruneDecisionCaches(now: number, activeDecisionIds?: Set<string>): void {
    for (const [decisionId, sent] of sentDecisionNoticeSignatureById.entries()) {
      if (now - sent.sentAt > DECISION_NOTICE_CACHE_TTL_MS) sentDecisionNoticeSignatureById.delete(decisionId);
    }
    for (const [decisionId, route] of decisionRouteByDecisionId.entries()) {
      if (now - route.updatedAt > DECISION_NOTICE_CACHE_TTL_MS) decisionRouteByDecisionId.delete(decisionId);
    }
    if (activeDecisionIds) {
      for (const decisionId of sentDecisionNoticeSignatureById.keys()) {
        if (!activeDecisionIds.has(decisionId)) sentDecisionNoticeSignatureById.delete(decisionId);
      }
      for (const decisionId of decisionRouteByDecisionId.keys()) {
        if (!activeDecisionIds.has(decisionId)) decisionRouteByDecisionId.delete(decisionId);
      }
    }
    while (sentDecisionNoticeSignatureById.size > DECISION_NOTICE_CACHE_MAX) {
      const oldest = sentDecisionNoticeSignatureById.keys().next().value;
      if (!oldest) break;
      sentDecisionNoticeSignatureById.delete(oldest);
    }
    while (decisionRouteByDecisionId.size > DECISION_NOTICE_CACHE_MAX) {
      const oldest = decisionRouteByDecisionId.keys().next().value;
      if (!oldest) break;
      decisionRouteByDecisionId.delete(oldest);
    }
  }

  function parseTaskMessengerRouteLine(line: string): DecisionRoute | null {
    if (!line.startsWith(`${TASK_MESSENGER_ROUTE_PREFIX} `)) return null;
    const payload = line.slice(TASK_MESSENGER_ROUTE_PREFIX.length).trim();
    const separator = payload.indexOf(":");
    if (separator <= 0) return null;
    const channelRaw = payload.slice(0, separator).trim().toLowerCase();
    const targetId = payload.slice(separator + 1).trim();
    if (!isMessengerChannel(channelRaw) || !targetId) return null;
    return { channel: channelRaw, targetId };
  }

  function buildDecisionNoticeSettingKey(decisionId: string, route: DecisionRoute): string {
    return `${DECISION_NOTICE_SENT_KEY_PREFIX}${decisionId}:${route.channel}:${route.targetId}`;
  }

  function buildDecisionNoticeSignature(item: DecisionInboxRouteItem): string {
    const normalizedSummary = String(item.summary || "")
      .replace(/\s+/g, " ")
      .trim();
    const optionBlock = item.options
      .map(
        (option) =>
          `${option.number}:${option.action}:${String(option.label || "")
            .replace(/\s+/g, " ")
            .trim()}`,
      )
      .join("|");
    const raw = [
      item.id,
      item.kind,
      String(item.created_at ?? 0),
      normalizeTextField(item.project_id) ?? "",
      normalizeTextField(item.task_id) ?? "",
      normalizeTextField(item.meeting_id) ?? "",
      String(item.review_round ?? ""),
      normalizedSummary,
      optionBlock,
    ].join("||");
    return createHash("sha1").update(raw).digest("hex");
  }

  function reserveDecisionNoticeSend(
    item: DecisionInboxRouteItem,
    route: DecisionRoute,
  ): { key: string; token: string; signature: string } | "already_sent" | null {
    const key = buildDecisionNoticeSettingKey(item.id, route);
    const signature = buildDecisionNoticeSignature(item);
    const token = `sending:${signature}:${nowMs()}:${Math.random().toString(36).slice(2, 10)}`;
    try {
      const result = db
        .prepare(
          `
          INSERT INTO settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO NOTHING
        `,
        )
        .run(key, token) as { changes?: number };
      if ((result?.changes ?? 0) > 0) return { key, token, signature };

      const existing = db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(key) as
        | { value?: unknown }
        | undefined;
      const existingValue = normalizeTextField(existing?.value) ?? "";
      if (existingValue === signature) return "already_sent";
      if (existingValue.startsWith("sending:")) return null;

      const takeover = db
        .prepare("UPDATE settings SET value = ? WHERE key = ? AND value = ?")
        .run(token, key, existingValue) as { changes?: number };
      if ((takeover?.changes ?? 0) > 0) return { key, token, signature };

      const latest = db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(key) as
        | { value?: unknown }
        | undefined;
      const latestValue = normalizeTextField(latest?.value) ?? "";
      if (latestValue === signature) return "already_sent";
      return null;
    } catch {
      return null;
    }
  }

  function markDecisionNoticeSent(reserved: { key: string; token: string; signature: string }): void {
    const updated = db
      .prepare("UPDATE settings SET value = ? WHERE key = ? AND value = ?")
      .run(reserved.signature, reserved.key, reserved.token) as { changes?: number } | undefined;
    if ((updated?.changes ?? 0) > 0) return;

    const existing = db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(reserved.key) as
      | { value?: unknown }
      | undefined;
    const currentValue = normalizeTextField(existing?.value) ?? "";
    if (!currentValue || currentValue.startsWith("sending:")) {
      db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(reserved.signature, reserved.key);
    }
  }

  function releaseDecisionNoticeReservation(reserved: { key: string; token: string; signature: string }): void {
    void reserved.signature;
    db.prepare("DELETE FROM settings WHERE key = ? AND value = ?").run(reserved.key, reserved.token);
  }

  function resolveTaskDecisionRoute(taskId: string): DecisionRoute | null {
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
      .get(taskId, `${TASK_MESSENGER_ROUTE_PREFIX} %`) as { message?: string } | undefined;
    return typeof row?.message === "string" ? parseTaskMessengerRouteLine(row.message) : null;
  }

  function resolveProjectDecisionRoute(projectId: string): DecisionRoute | null {
    const row = db
      .prepare(
        `
        SELECT tl.message
        FROM task_logs tl
        JOIN tasks t ON t.id = tl.task_id
        WHERE t.project_id = ?
          AND tl.kind = 'system'
          AND tl.message LIKE ?
        ORDER BY tl.created_at DESC
        LIMIT 1
      `,
      )
      .get(projectId, `${TASK_MESSENGER_ROUTE_PREFIX} %`) as { message?: string } | undefined;
    return typeof row?.message === "string" ? parseTaskMessengerRouteLine(row.message) : null;
  }

  function resolveDecisionRoute(item: DecisionInboxRouteItem): DecisionRoute | null {
    const now = nowMs();
    const cached = decisionRouteByDecisionId.get(item.id);
    if (cached) return { channel: cached.channel, targetId: cached.targetId };

    const taskId = normalizeTextField(item.task_id);
    const projectId = normalizeTextField(item.project_id);
    const route =
      (taskId ? resolveTaskDecisionRoute(taskId) : null) ??
      (projectId ? resolveProjectDecisionRoute(projectId) : null) ??
      null;
    if (!route) return null;

    decisionRouteByDecisionId.set(item.id, { channel: route.channel, targetId: route.targetId, updatedAt: now });
    pruneDecisionCaches(now);
    return route;
  }

  function truncateLine(value: string, max = 220): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 3).trimEnd()}...`;
  }

  function summarizeDecisionText(value: string, max = 120): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return "-";
    const cleaned = normalized
      .replace(/[*`]+/g, "")
      .replace(/^\s*[-•]\s*/g, "")
      .trim();
    return truncateLine(cleaned, max);
  }

  function buildDecisionOptionPreview(option: { number: number; label: string; action: string }): string {
    const raw = option.label || option.action || "-";
    const compact = summarizeDecisionText(raw, 180);
    return `${option.number}. ${compact}`;
  }

  function buildDecisionMessengerNotice(item: DecisionInboxRouteItem): string {
    const projectLabel =
      normalizeTextField(item.project_name) ||
      normalizeTextField(item.project_path) ||
      normalizeTextField(item.project_id) ||
      "-";
    const taskLabel = normalizeTextField(item.task_title);
    const summary = summarizeDecisionText(item.summary || "Decision required", 150);
    const options = item.options.slice(0, 8).map((option) => buildDecisionOptionPreview(option));
    const defaultOption = String(item.options[0]?.number ?? options[0]?.match(/^(\d+)/)?.[1] ?? 1);
    const isMultiPick = item.kind === "review_round_pick";
    const replyGuide =
      options.length > 0
        ? pickDecisionL10n(
            isMultiPick
              ? `회신: 번호를 하나/여러 개 보내주세요 (예: ${defaultOption} 또는 ${defaultOption},3)`
              : `회신: 숫자만 보내주세요 (예: ${defaultOption})`,
            isMultiPick
              ? `Reply: send one or multiple option numbers (e.g., ${defaultOption} or ${defaultOption},3)`
              : `Reply: send only the option number (e.g., ${defaultOption})`,
            isMultiPick
              ? `返信: 選択番号を1つ/複数送ってください（例: ${defaultOption} または ${defaultOption},3）`
              : `返信: 選択番号だけ送ってください（例: ${defaultOption}）`,
            isMultiPick
              ? `回复：可发送单个或多个选项编号（例如：${defaultOption} 或 ${defaultOption},3）`
              : `回复：仅发送选项编号（例如：${defaultOption}）`,
          )
        : pickDecisionL10n(
            "회신: 선택 번호를 보내주세요",
            "Reply with an option number",
            "返信: 選択番号を送ってください",
            "回复：请发送选项编号",
          );
    const lines = [
      `${pickDecisionL10n("의사결정 요청", "Decision Request", "意思決定リクエスト", "决策请求")}`,
      `${pickDecisionL10n("프로젝트", "Project", "プロジェクト", "项目")}: ${projectLabel}`,
      ...(taskLabel
        ? [`${pickDecisionL10n("태스크", "Task", "タスク", "任务")}: ${truncateLine(taskLabel, 140)}`]
        : []),
      `${pickDecisionL10n("요약", "Summary", "要約", "摘要")}: ${summary}`,
      ...(options.length > 0 ? [pickDecisionL10n("선택지", "Options", "選択肢", "选项") + ":", ...options] : []),
      replyGuide,
    ];
    return lines.join("\n");
  }

  function parseOptionNumbersFromText(text: string): number[] {
    const sanitized = text.replace(DECISION_TOKEN_RE, " ").replace(DECISION_REPLY_MARKER_RE, " ");
    const numbers: number[] = [];
    for (const match of sanitized.matchAll(/(?:^|[^\d])([1-9]\d?)(?:\s*(?:번|番|号|option))?(?=$|[^\d])/gi)) {
      const raw = match[1];
      if (!raw) continue;
      const num = Number.parseInt(raw, 10);
      if (!Number.isFinite(num)) continue;
      numbers.push(num);
    }
    return Array.from(new Set(numbers));
  }

  function isPlainDecisionChoiceText(text: string): boolean {
    const sanitized = text.replace(DECISION_TOKEN_RE, " ").replace(DECISION_REPLY_MARKER_RE, " ").trim();
    if (!sanitized) return false;
    if (DECISION_APPROVE_WORD_RE.test(sanitized)) return true;
    const tokens = sanitized
      .split(/[\s,，/|]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length <= 0) return false;
    return tokens.every((token) => /^[1-9]\d?(?:번|option|号|番)?$/i.test(token));
  }

  function extractDecisionNote(text: string, body: Record<string, unknown>): string | null {
    const bodyNote = normalizeTextField(body.note);
    if (bodyNote) return bodyNote;
    const matched = text.match(DECISION_NOTE_RE);
    if (!matched?.[1]) return null;
    const candidate = normalizeTextField(matched[1]);
    return candidate || null;
  }

  function applyDecisionReply(
    decisionId: string,
    body: Record<string, unknown>,
  ): {
    status: number;
    payload: Record<string, unknown>;
  } {
    const optionNumber = Number(body.option_number ?? body.optionNumber ?? body.option);
    if (!Number.isFinite(optionNumber)) {
      return { status: 400, payload: { error: "option_number_required" } };
    }

    const currentItem = getDecisionInboxItems().find((item) => item.id === decisionId);
    if (!currentItem) {
      return { status: 404, payload: { error: "decision_not_found" } };
    }
    const selectedOption = currentItem.options.find((option) => option.number === optionNumber);
    if (!selectedOption) {
      if (currentItem.options.length <= 0) {
        return { status: 409, payload: { error: "decision_options_not_ready", kind: currentItem.kind } };
      }
      return { status: 400, payload: { error: "option_not_found", option_number: optionNumber } };
    }

    let status = 200;
    let payload: Record<string, unknown> = { ok: true };
    const req = { body } as any;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: Record<string, unknown>) {
        payload = value;
        return this;
      },
    } as any;

    if (
      handleProjectReviewDecisionReply({
        req,
        res,
        currentItem,
        selectedOption,
        optionNumber,
        deps: {
          db,
          appendTaskLog,
          nowMs,
          normalizeTextField,
          getPreferredLanguage,
          pickL,
          l,
          broadcast,
          finishReview,
          getProjectReviewDecisionState,
          recordProjectReviewDecisionEvent,
          getProjectReviewTaskChoices,
          openSupplementRound,
          PROJECT_REVIEW_TASK_SELECTED_LOG_PREFIX,
        },
      })
    ) {
      return { status, payload };
    }

    if (
      handleReviewRoundDecisionReply({
        req,
        res,
        currentItem,
        selectedOption,
        optionNumber,
        deps: {
          db,
          l,
          pickL,
          nowMs,
          resolveLang,
          normalizeTextField,
          appendTaskLog,
          processSubtaskDelegations,
          seedReviewRevisionSubtasks,
          scheduleNextReviewRound,
          getProjectReviewDecisionState,
          getReviewDecisionNotes,
          getReviewDecisionFallbackLabel,
          recordProjectReviewDecisionEvent,
          openSupplementRound,
          REVIEW_DECISION_RESOLVED_LOG_PREFIX,
        },
      })
    ) {
      return { status, payload };
    }

    if (
      handleTimeoutResumeDecisionReply({
        res,
        currentItem,
        selectedOption,
        deps: {
          db,
          activeProcesses,
          getDeptName,
          appendTaskLog,
          startTaskExecutionForAgent,
        },
      })
    ) {
      return { status, payload };
    }

    return { status: 400, payload: { error: "unknown_decision_id" } };
  }

  function findLatestDecisionForRoute(
    route: DecisionRoute,
    explicitDecisionId?: string | null,
  ): DecisionInboxRouteItem | null {
    const items = getDecisionInboxItems();
    if (explicitDecisionId) {
      const item = items.find((candidate) => candidate.id === explicitDecisionId);
      if (item) return item;
    }
    for (const item of items) {
      const candidateRoute = resolveDecisionRoute(item);
      if (!candidateRoute) continue;
      if (candidateRoute.channel === route.channel && candidateRoute.targetId === route.targetId) {
        return item;
      }
    }
    return null;
  }

  function buildDecisionReplyAck(
    item: DecisionInboxRouteItem,
    optionNumber: number,
    status: number,
    payload: Record<string, unknown>,
  ): string {
    if (status >= 400) {
      const reason = normalizeTextField(payload.error) || `status_${status}`;
      return pickDecisionL10n(
        `⚠️ 의사결정 회신 처리 실패 (${reason})`,
        `⚠️ Decision reply failed (${reason})`,
        `⚠️ 意思決定返信に失敗しました (${reason})`,
        `⚠️ 决策回复失败（${reason}）`,
      );
    }
    const optionLabel =
      item.options.find((option) => option.number === optionNumber)?.label || `option ${optionNumber}`;
    const resolved = payload.resolved === true;
    if (resolved) {
      return pickDecisionL10n(
        `✅ 의사결정 반영 완료: ${optionLabel}`,
        `✅ Decision applied: ${optionLabel}`,
        `✅ 意思決定を反映しました: ${optionLabel}`,
        `✅ 已应用决策：${optionLabel}`,
      );
    }
    return pickDecisionL10n(
      `☑️ 의사결정 기록 완료: ${optionLabel}`,
      `☑️ Decision recorded: ${optionLabel}`,
      `☑️ 意思決定を記録しました: ${optionLabel}`,
      `☑️ 已记录决策：${optionLabel}`,
    );
  }

  async function flushDecisionInboxMessengerNotices(): Promise<void> {
    const items = getDecisionInboxItems();
    const activeIds = new Set(items.map((item) => item.id));
    const now = nowMs();
    pruneDecisionCaches(now, activeIds);
    for (const item of items.slice().reverse()) {
      if (item.options.length <= 0) continue;
      const signature = buildDecisionNoticeSignature(item);
      const cached = sentDecisionNoticeSignatureById.get(item.id);
      if (cached?.signature === signature) continue;
      const route = resolveDecisionRoute(item);
      if (!route) continue;
      const reserved = reserveDecisionNoticeSend(item, route);
      if (reserved === "already_sent") {
        sentDecisionNoticeSignatureById.set(item.id, { signature, sentAt: nowMs() });
        continue;
      }
      if (!reserved) continue;
      const text = buildDecisionMessengerNotice(item);
      try {
        await sendMessengerMessage({
          channel: route.channel,
          targetId: route.targetId,
          text,
        });
        markDecisionNoticeSent(reserved);
        const t = nowMs();
        sentDecisionNoticeSignatureById.set(item.id, { signature: reserved.signature, sentAt: t });
        decisionRouteByDecisionId.set(item.id, { channel: route.channel, targetId: route.targetId, updatedAt: t });
        pruneDecisionCaches(t);
      } catch (err) {
        releaseDecisionNoticeReservation(reserved);
        console.warn(
          `[decision-messenger] failed to send decision notice (decision=${item.id}, channel=${route.channel}, target=${route.targetId}): ${String(err)}`,
        );
      }
    }
  }

  async function tryHandleInboxDecisionReply(input: DecisionReplyBridgeInput): Promise<DecisionReplyBridgeResult> {
    const text = String(input.text || "").trim();
    if (!text) return { handled: false, status: 200, payload: {} };

    const body = (input.body ?? {}) as Record<string, unknown>;
    const explicitRoute =
      isMessengerChannel(input.channel) && normalizeTextField(input.targetId)
        ? { channel: input.channel, targetId: normalizeTextField(input.targetId)! }
        : null;
    const fallbackRoute = resolveSourceChatRoute({
      source: normalizeTextField(input.source),
      chat: normalizeTextField(input.chat),
    });
    const route = explicitRoute ?? fallbackRoute;
    if (!route) return { handled: false, status: 200, payload: {} };

    const explicitDecisionId = text.match(DECISION_TOKEN_RE)?.[1] ?? null;
    const hasExplicitMarker = DECISION_REPLY_MARKER_RE.test(text) || Boolean(explicitDecisionId);
    const numbers = parseOptionNumbersFromText(text);
    const hasChoiceLikeText = isPlainDecisionChoiceText(text);
    const isApproveWord = DECISION_APPROVE_WORD_RE.test(text.replace(DECISION_REPLY_MARKER_RE, "").trim());
    const isSimpleChoice = hasChoiceLikeText || (numbers.length === 1 && !hasExplicitMarker) || isApproveWord;
    if (!hasExplicitMarker && !isSimpleChoice) {
      return { handled: false, status: 200, payload: {} };
    }

    const pendingDecision = findLatestDecisionForRoute(route, explicitDecisionId);
    if (!pendingDecision) {
      if (!hasExplicitMarker) return { handled: false, status: 200, payload: {} };
      const noDecisionMsg = pickDecisionL10n(
        "⚠️ 이 채널에는 대기 중인 의사결정 요청이 없습니다.",
        "⚠️ There is no pending decision request on this channel.",
        "⚠️ このチャンネルには保留中の意思決定リクエストがありません。",
        "⚠️ 此频道没有待处理的决策请求。",
      );
      await sendMessengerMessage({ channel: route.channel, targetId: route.targetId, text: noDecisionMsg }).catch(
        () => {
          // no-op
        },
      );
      return { handled: true, status: 404, payload: { error: "decision_not_found_for_route" } };
    }

    const validOptionNumbers = numbers.filter((num) => pendingDecision.options.some((option) => option.number === num));
    let selectedOptionNumber = validOptionNumbers[0];
    if (!selectedOptionNumber && isApproveWord && pendingDecision.options.length > 0) {
      selectedOptionNumber = pendingDecision.options[0]?.number;
    }
    if (!selectedOptionNumber) {
      const optionsHint = pendingDecision.options.map((option) => option.number).join(", ");
      const retryMsg = pickDecisionL10n(
        `⚠️ 선택 번호가 필요합니다. 가능한 번호: ${optionsHint}`,
        `⚠️ Option number required. Available options: ${optionsHint}`,
        `⚠️ 選択番号が必要です。選べる番号: ${optionsHint}`,
        `⚠️ 需要选项编号。可用编号：${optionsHint}`,
      );
      await sendMessengerMessage({ channel: route.channel, targetId: route.targetId, text: retryMsg }).catch(() => {
        // no-op
      });
      return { handled: true, status: 400, payload: { error: "option_number_required" } };
    }

    const note = extractDecisionNote(text, body);
    const replyBody: Record<string, unknown> = {
      ...body,
      option_number: selectedOptionNumber,
    };
    if (pendingDecision.kind === "review_round_pick" && validOptionNumbers.length > 1) {
      replyBody.selected_option_numbers = validOptionNumbers;
    }
    if (note) replyBody.note = note;

    const applied = applyDecisionReply(pendingDecision.id, replyBody);
    const ack = buildDecisionReplyAck(pendingDecision, selectedOptionNumber, applied.status, applied.payload);
    await sendMessengerMessage({ channel: route.channel, targetId: route.targetId, text: ack }).catch((err) => {
      console.warn(
        `[decision-messenger] failed to send decision reply ack (decision=${pendingDecision.id}, channel=${route.channel}, target=${route.targetId}): ${String(err)}`,
      );
    });

    return {
      handled: true,
      status: applied.status,
      payload: {
        ...applied.payload,
        decision_id: pendingDecision.id,
        option_number: selectedOptionNumber,
      },
    };
  }

  const decisionNoticeTimer = setInterval(() => {
    void flushDecisionInboxMessengerNotices().catch((err) => {
      console.warn(`[decision-messenger] background notice flush failed: ${String(err)}`);
    });
  }, 5000);
  (decisionNoticeTimer as NodeJS.Timeout).unref?.();
  setTimeout(() => {
    void flushDecisionInboxMessengerNotices().catch((err) => {
      console.warn(`[decision-messenger] initial notice flush failed: ${String(err)}`);
    });
  }, 1200);

  // ---------------------------------------------------------------------------
  // Messages / Chat
  // ---------------------------------------------------------------------------
  app.get("/api/decision-inbox", (_req, res) => {
    const items = getDecisionInboxItems();
    void flushDecisionInboxMessengerNotices().catch((err) => {
      console.warn(`[decision-messenger] on-demand notice flush failed: ${String(err)}`);
    });
    res.json({ items });
  });

  app.post("/api/decision-inbox/:id/reply", (req, res) => {
    const decisionId = String(req.params.id || "");
    const result = applyDecisionReply(decisionId, (req.body ?? {}) as Record<string, unknown>);
    return res.status(result.status).json(result.payload);
  });

  return {
    tryHandleInboxDecisionReply,
  };
}
