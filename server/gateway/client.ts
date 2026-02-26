import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_DB_PATH,
  DISCORD_BOT_TOKEN,
  DISCORD_CHANNEL_IDS,
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL_IDS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS,
} from "../config/runtime.ts";

const WAKE_DEBOUNCE_DEFAULT_MS = 12_000;
const SETTINGS_CACHE_TTL_MS = 3_000;
const MESSENGER_SETTINGS_KEY = "messengerChannels";

const wakeDebounce = new Map<string, number>();
let cachedMessengerConfig: { loadedAt: number; value: MessengerRuntimeConfig } | null = null;

type GatewayLang = "ko" | "en" | "ja" | "zh";
export type MessengerChannel = "telegram" | "discord" | "slack";

type PersistedSession = {
  id?: string;
  name?: string;
  targetId?: string;
  enabled?: boolean;
};

type PersistedChannelConfig = {
  token?: string;
  sessions?: PersistedSession[];
};

type PersistedMessengerChannels = Partial<Record<MessengerChannel, PersistedChannelConfig>>;

type MessengerSession = {
  id: string;
  name: string;
  targetId: string;
  enabled: boolean;
};

type MessengerChannelConfig = {
  token: string;
  sessions: MessengerSession[];
};

type MessengerRuntimeConfig = Record<MessengerChannel, MessengerChannelConfig>;

export type MessengerRuntimeSession = {
  sessionKey: string;
  channel: MessengerChannel;
  targetId: string;
  enabled: boolean;
  displayName: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSession(session: PersistedSession, channel: MessengerChannel, index: number): MessengerSession | null {
  const targetId = normalizeText(session.targetId);
  if (!targetId) {
    return null;
  }
  const rawId = normalizeText(session.id);
  const id = rawId || `${channel}-${index + 1}`;
  const name = normalizeText(session.name) || `${channel.toUpperCase()} ${index + 1}`;
  return {
    id,
    name,
    targetId,
    enabled: session.enabled !== false,
  };
}

function makeEnvSessions(channel: MessengerChannel, targetIds: string[]): MessengerSession[] {
  return targetIds.reduce<MessengerSession[]>((acc, targetId, index) => {
    const normalized = normalizeText(targetId);
    if (!normalized) {
      return acc;
    }
    acc.push({
      id: `${channel}-env-${index + 1}`,
      name: `${channel.toUpperCase()} ENV ${index + 1}`,
      targetId: normalized,
      enabled: true,
    });
    return acc;
  }, []);
}

function buildEnvConfig(): MessengerRuntimeConfig {
  return {
    telegram: {
      token: normalizeText(TELEGRAM_BOT_TOKEN),
      sessions: makeEnvSessions("telegram", TELEGRAM_CHAT_IDS),
    },
    discord: {
      token: normalizeText(DISCORD_BOT_TOKEN),
      sessions: makeEnvSessions("discord", DISCORD_CHANNEL_IDS),
    },
    slack: {
      token: normalizeText(SLACK_BOT_TOKEN),
      sessions: makeEnvSessions("slack", SLACK_CHANNEL_IDS),
    },
  };
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readPersistedMessengerChannels(): PersistedMessengerChannels | null {
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(MESSENGER_SETTINGS_KEY) as
      | { value?: unknown }
      | undefined;
    const raw = typeof row?.value === "string" ? row.value.trim() : "";
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PersistedMessengerChannels;
  } catch (err) {
    console.warn(`[Claw-Empire] failed to load messenger channels settings: ${String(err)}`);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function mergeChannelConfig(
  channel: MessengerChannel,
  base: MessengerChannelConfig,
  persistedChannels: PersistedMessengerChannels | null,
): MessengerChannelConfig {
  const persisted = persistedChannels?.[channel];
  if (!persisted || typeof persisted !== "object") {
    return base;
  }

  const nextToken = hasOwn(persisted, "token") ? normalizeText(persisted.token) : base.token;

  let nextSessions = base.sessions;
  if (hasOwn(persisted, "sessions") && Array.isArray(persisted.sessions)) {
    nextSessions = persisted.sessions
      .map((session, index) => normalizeSession(session ?? {}, channel, index))
      .filter((session): session is MessengerSession => Boolean(session));
  }

  return {
    token: nextToken,
    sessions: nextSessions,
  };
}

function loadMessengerConfig(): MessengerRuntimeConfig {
  const now = Date.now();
  if (cachedMessengerConfig && now - cachedMessengerConfig.loadedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedMessengerConfig.value;
  }

  const envConfig = buildEnvConfig();
  const persistedChannels = readPersistedMessengerChannels();
  const merged: MessengerRuntimeConfig = {
    telegram: mergeChannelConfig("telegram", envConfig.telegram, persistedChannels),
    discord: mergeChannelConfig("discord", envConfig.discord, persistedChannels),
    slack: mergeChannelConfig("slack", envConfig.slack, persistedChannels),
  };

  cachedMessengerConfig = { loadedAt: now, value: merged };
  return merged;
}

function shouldSendWake(key: string, debounceMs: number): boolean {
  const now = Date.now();
  const last = wakeDebounce.get(key);
  if (last && now - last < debounceMs) {
    return false;
  }

  wakeDebounce.set(key, now);
  if (wakeDebounce.size > 2000) {
    for (const [candidateKey, ts] of wakeDebounce) {
      if (now - ts > debounceMs * 4) {
        wakeDebounce.delete(candidateKey);
      }
    }
  }

  return true;
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const payload = (await r.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!r.ok || payload?.ok === false) {
    throw new Error(payload?.description || `telegram send failed (${r.status})`);
  }
}

async function sendDiscordMessage(token: string, channelId: string, text: string): Promise<void> {
  const r = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bot ${token}`,
    },
    body: JSON.stringify({ content: text }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`discord send failed (${r.status})${detail ? `: ${detail}` : ""}`);
  }
}

async function sendSlackMessage(token: string, channelId: string, text: string): Promise<void> {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel: channelId, text }),
  });

  const payload = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!r.ok || payload?.ok === false) {
    throw new Error(payload?.error || `slack send failed (${r.status})`);
  }
}

async function sendByChannel(channel: MessengerChannel, token: string, targetId: string, text: string): Promise<void> {
  if (!token) {
    throw new Error(`${channel} token missing`);
  }
  const normalizedTarget = normalizeText(targetId);
  if (!normalizedTarget) {
    throw new Error(`${channel} target missing`);
  }

  if (channel === "telegram") {
    await sendTelegramMessage(token, normalizedTarget, text);
    return;
  }
  if (channel === "discord") {
    await sendDiscordMessage(token, normalizedTarget, text);
    return;
  }
  await sendSlackMessage(token, normalizedTarget, text);
}

export function listMessengerSessions(): MessengerRuntimeSession[] {
  const config = loadMessengerConfig();
  const sessions: MessengerRuntimeSession[] = [];

  for (const channel of ["telegram", "discord", "slack"] as MessengerChannel[]) {
    const channelConfig = config[channel];
    for (const session of channelConfig.sessions) {
      const sessionKey = `${channel}:${session.id}`;
      sessions.push({
        sessionKey,
        channel,
        targetId: session.targetId,
        enabled: session.enabled,
        displayName: session.name,
      });
    }
  }

  return sessions;
}

export async function sendMessengerMessage(params: {
  channel: MessengerChannel;
  targetId: string;
  text: string;
}): Promise<void> {
  const text = normalizeText(params.text);
  if (!text) {
    throw new Error("message text required");
  }

  const config = loadMessengerConfig();
  const channelConfig = config[params.channel];
  if (!channelConfig) {
    throw new Error(`unsupported channel: ${params.channel}`);
  }

  await sendByChannel(params.channel, channelConfig.token, params.targetId, text);
}

export async function sendMessengerSessionMessage(sessionKey: string, text: string): Promise<void> {
  const normalizedKey = normalizeText(sessionKey);
  if (!normalizedKey) {
    throw new Error("sessionKey required");
  }
  const payload = normalizeText(text);
  if (!payload) {
    throw new Error("message text required");
  }

  const config = loadMessengerConfig();
  const sessions = listMessengerSessions();
  const session = sessions.find((item) => item.sessionKey === normalizedKey);
  if (!session) {
    throw new Error("session not found");
  }

  const token = config[session.channel].token;
  await sendByChannel(session.channel, token, session.targetId, payload);
}

async function sendMessengerWake(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const config = loadMessengerConfig();
  const targets = listMessengerSessions().filter((session) => {
    if (!session.enabled) {
      return false;
    }
    const token = config[session.channel]?.token;
    return Boolean(token);
  });

  if (targets.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const token = config[target.channel].token;
      await sendByChannel(target.channel, token, target.targetId, trimmed);
    }),
  );

  const failures: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (result?.status === "fulfilled") {
      continue;
    }
    const target = targets[i];
    failures.push(`${target.channel}:${target.targetId} => ${String(result?.reason ?? "unknown error")}`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join(" | "));
  }
}

function queueWake(params: { key: string; text: string; debounceMs?: number }) {
  const debounceMs = params.debounceMs ?? WAKE_DEBOUNCE_DEFAULT_MS;
  if (!shouldSendWake(params.key, debounceMs)) {
    return;
  }

  void sendMessengerWake(params.text).catch((err) => {
    console.warn(`[Claw-Empire] messenger notification failed (${params.key}): ${String(err)}`);
  });
}

function detectGatewayLang(text: string): GatewayLang {
  const ko = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g)?.length ?? 0;
  const ja = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g)?.length ?? 0;
  const zh = text.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
  const total = text.replace(/\s/g, "").length || 1;
  if (ko / total > 0.15) return "ko";
  if (ja / total > 0.15) return "ja";
  if (zh / total > 0.3) return "zh";
  return "en";
}

function normalizeGatewayLang(lang: string | null | undefined, title: string): GatewayLang {
  if (lang === "ko" || lang === "en" || lang === "ja" || lang === "zh") return lang;
  if (title.trim()) return detectGatewayLang(title);
  return "en";
}

function resolveStatusLabel(status: string, lang: GatewayLang): string {
  if (status === "in_progress") {
    if (lang === "en") return "Started";
    if (lang === "ja") return "開始";
    if (lang === "zh") return "开始";
    return "진행 시작";
  }
  if (status === "review") {
    if (lang === "en") return "In Review";
    if (lang === "ja") return "レビュー中";
    if (lang === "zh") return "审核中";
    return "검토 중";
  }
  if (status === "done") {
    if (lang === "en") return "Completed";
    if (lang === "ja") return "完了";
    if (lang === "zh") return "完成";
    return "완료";
  }
  return status;
}

export function notifyTaskStatus(taskId: string, title: string, status: string, lang?: string): void {
  const resolvedLang = normalizeGatewayLang(lang, title);
  const emoji =
    status === "in_progress"
      ? "\u{1F680}"
      : status === "review"
        ? "\u{1F50D}"
        : status === "done"
          ? "\u2705"
          : "\u{1F4CB}";
  const label = resolveStatusLabel(status, resolvedLang);
  queueWake({
    key: `task:${taskId}:${status}`,
    text: `${emoji} [${label}] ${title}`,
    debounceMs: 5_000,
  });
}

export async function gatewayHttpInvoke(_req: {
  tool: string;
  action?: string;
  args?: Record<string, any>;
}): Promise<any> {
  throw new Error("openclaw gateway integration has been removed; use direct messenger transports");
}
