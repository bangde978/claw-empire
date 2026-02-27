import type { DatabaseSync } from "node:sqlite";
import { INBOX_WEBHOOK_SECRET, OAUTH_BASE_HOST, PORT } from "../config/runtime.ts";

const MESSENGER_SETTINGS_KEY = "messengerChannels";
const TELEGRAM_RECEIVER_OFFSET_KEY = "telegramReceiverOffset";
const TELEGRAM_ACTIVE_DELAY_MS = 1_500;
const TELEGRAM_IDLE_DELAY_MS = 5_000;
const TELEGRAM_POLL_TIMEOUT_SECONDS = 20;

type PersistedSession = {
  targetId?: unknown;
  enabled?: unknown;
};

type PersistedTelegramChannel = {
  token?: unknown;
  sessions?: unknown;
  receiveEnabled?: unknown;
};

type PersistedMessengerChannels = {
  telegram?: PersistedTelegramChannel;
};

type TelegramUpdateMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: {
    id?: number | string;
    title?: string;
  };
  from?: {
    id?: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramUpdateMessage;
  channel_post?: TelegramUpdateMessage;
};

type TelegramGetUpdatesResponse = {
  ok?: boolean;
  description?: string;
  result?: TelegramUpdate[];
};

type TelegramReceiverConfig = {
  token: string;
  receiveEnabled: boolean;
  allowedChatIds: Set<string>;
};

export type TelegramReceiverStatus = {
  running: boolean;
  configured: boolean;
  receiveEnabled: boolean;
  enabled: boolean;
  allowedChatCount: number;
  nextOffset: number;
  lastPollAt: number | null;
  lastForwardAt: number | null;
  lastUpdateId: number | null;
  lastError: string | null;
};

export type StartTelegramReceiverOptions = {
  db: DatabaseSync;
  fetchImpl?: typeof fetch;
};

type ReceiverHandle = {
  stop: () => void;
  getStatus: () => TelegramReceiverStatus;
};

const initialStatus = (): TelegramReceiverStatus => ({
  running: false,
  configured: false,
  receiveEnabled: true,
  enabled: false,
  allowedChatCount: 0,
  nextOffset: 0,
  lastPollAt: null,
  lastForwardAt: null,
  lastUpdateId: null,
  lastError: null,
});

let receiverHandle: ReceiverHandle | null = null;

function cloneStatus(status: TelegramReceiverStatus): TelegramReceiverStatus {
  return { ...status };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChatId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return normalizeText(value);
}

function readMessengerChannels(db: DatabaseSync): PersistedMessengerChannels | null {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(MESSENGER_SETTINGS_KEY) as
      | { value?: unknown }
      | undefined;
    const raw = normalizeText(row?.value);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as PersistedMessengerChannels;
  } catch {
    return null;
  }
}

function resolveTelegramConfig(db: DatabaseSync): TelegramReceiverConfig {
  let token = "";
  let receiveEnabled = true;
  let allowedChatIds = new Set<string>();

  const messengerChannels = readMessengerChannels(db);
  const telegram = messengerChannels?.telegram;
  if (!telegram || typeof telegram !== "object") {
    return { token, receiveEnabled, allowedChatIds };
  }

  if (Object.prototype.hasOwnProperty.call(telegram, "token")) {
    token = normalizeText(telegram.token);
  }

  if (typeof telegram.receiveEnabled === "boolean") {
    receiveEnabled = telegram.receiveEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(telegram, "sessions") && Array.isArray(telegram.sessions)) {
    allowedChatIds = new Set<string>();
    for (const rawSession of telegram.sessions) {
      const session = (rawSession ?? {}) as PersistedSession;
      if (session.enabled === false) continue;
      const chatId = normalizeChatId(session.targetId);
      if (!chatId) continue;
      allowedChatIds.add(chatId);
    }
  }

  return { token, receiveEnabled, allowedChatIds };
}

function readReceiverOffset(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(TELEGRAM_RECEIVER_OFFSET_KEY) as
      | { value?: unknown }
      | undefined;
    const raw = normalizeText(row?.value);
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) {
        return Math.trunc(parsed);
      }
    } catch {
      // fallback to Number(raw)
    }
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.trunc(numeric);
    }
  } catch {
    // ignore
  }
  return 0;
}

function writeReceiverOffset(db: DatabaseSync, offset: number): void {
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.trunc(offset) : 0;
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(TELEGRAM_RECEIVER_OFFSET_KEY, JSON.stringify(safeOffset));
}

function extractMessage(update: TelegramUpdate): TelegramUpdateMessage | null {
  if (update.message && typeof update.message === "object") return update.message;
  if (update.channel_post && typeof update.channel_post === "object") return update.channel_post;
  return null;
}

function buildAuthor(message: TelegramUpdateMessage): string {
  const from = message.from;
  if (!from || typeof from !== "object") {
    return "telegram";
  }
  const username = normalizeText(from.username);
  const firstName = normalizeText(from.first_name);
  const lastName = normalizeText(from.last_name);
  const display = [firstName, lastName].filter(Boolean).join(" ").trim() || username || String(from.id ?? "telegram");
  return username ? `${display}(@${username})` : display;
}

async function forwardTelegramUpdate(params: {
  update: TelegramUpdate;
  allowedChatIds: Set<string>;
  fetchImpl: typeof fetch;
}): Promise<"forwarded" | "skipped"> {
  const { update, allowedChatIds, fetchImpl } = params;
  const message = extractMessage(update);
  if (!message) return "skipped";

  if (message.from?.is_bot) {
    return "skipped";
  }

  const chatId = normalizeChatId(message.chat?.id);
  if (!chatId || !allowedChatIds.has(chatId)) {
    return "skipped";
  }

  const text = normalizeText(message.text) || normalizeText(message.caption);
  if (!text) {
    return "skipped";
  }

  const messageId =
    typeof message.message_id === "number" && Number.isFinite(message.message_id)
      ? String(Math.trunc(message.message_id))
      : String(update.update_id ?? `${Date.now()}`);
  const author = buildAuthor(message);
  const inboxRes = await fetchImpl(`http://${OAUTH_BASE_HOST}:${PORT}/api/inbox`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-inbox-secret": INBOX_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      source: "telegram",
      message_id: messageId,
      author,
      chat: `telegram:${chatId}`,
      text,
    }),
  });

  if (!inboxRes.ok) {
    const detail = await inboxRes.text().catch(() => "");
    throw new Error(`inbox forward failed (${inboxRes.status})${detail ? `: ${detail}` : ""}`);
  }

  return "forwarded";
}

export async function pollTelegramReceiverOnce(options: {
  db: DatabaseSync;
  status: TelegramReceiverStatus;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { db, status } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollStartedAt = Date.now();
  status.lastPollAt = pollStartedAt;

  const config = resolveTelegramConfig(db);
  status.receiveEnabled = config.receiveEnabled;
  status.allowedChatCount = config.allowedChatIds.size;
  status.configured = Boolean(config.token) && config.allowedChatIds.size > 0;
  status.enabled = false;

  if (!config.receiveEnabled) {
    status.lastError = null;
    return;
  }
  if (!config.token) {
    status.lastError = "telegram token missing";
    return;
  }
  if (config.allowedChatIds.size === 0) {
    status.lastError = "telegram sessions missing";
    return;
  }
  if (!INBOX_WEBHOOK_SECRET) {
    status.lastError = "INBOX_WEBHOOK_SECRET missing";
    return;
  }

  status.enabled = true;
  const persistedOffset = readReceiverOffset(db);
  const nextOffset = Math.max(status.nextOffset, persistedOffset);
  status.nextOffset = nextOffset;

  const telegramRes = await fetchImpl(`https://api.telegram.org/bot${config.token}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      offset: nextOffset,
      timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message", "channel_post"],
    }),
  });

  const payload = (await telegramRes.json().catch(() => null)) as TelegramGetUpdatesResponse | null;
  if (!telegramRes.ok || payload?.ok === false) {
    throw new Error(payload?.description || `telegram getUpdates failed (${telegramRes.status})`);
  }

  const updates = Array.isArray(payload?.result) ? payload.result : [];
  let maxUpdateId = nextOffset - 1;
  let forwarded = false;

  for (const update of updates) {
    const updateId =
      typeof update.update_id === "number" && Number.isFinite(update.update_id) ? update.update_id : null;
    if (updateId === null) continue;
    if (updateId < nextOffset) continue;

    const result = await forwardTelegramUpdate({
      update,
      allowedChatIds: config.allowedChatIds,
      fetchImpl,
    });
    if (result === "forwarded") {
      forwarded = true;
    }
    if (updateId > maxUpdateId) {
      maxUpdateId = updateId;
      status.lastUpdateId = updateId;
    }
  }

  if (maxUpdateId >= nextOffset) {
    const newOffset = maxUpdateId + 1;
    writeReceiverOffset(db, newOffset);
    status.nextOffset = newOffset;
  }

  if (forwarded) {
    status.lastForwardAt = Date.now();
  }
  status.lastError = null;
}

export function startTelegramReceiver(options: StartTelegramReceiverOptions): ReceiverHandle {
  if (receiverHandle) {
    return receiverHandle;
  }

  const { db } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const status = initialStatus();
  status.running = true;

  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => {
        void tick();
      },
      Math.max(250, delayMs),
    );
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await pollTelegramReceiverOnce({ db, status, fetchImpl });
    } catch (err) {
      status.lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[Claw-Empire] telegram receiver error: ${status.lastError}`);
    } finally {
      busy = false;
      schedule(status.enabled ? TELEGRAM_ACTIVE_DELAY_MS : TELEGRAM_IDLE_DELAY_MS);
    }
  };

  schedule(1_200);

  receiverHandle = {
    stop() {
      stopped = true;
      status.running = false;
      status.enabled = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      receiverHandle = null;
    },
    getStatus() {
      return cloneStatus(status);
    },
  };

  return receiverHandle;
}

export function getTelegramReceiverStatus(): TelegramReceiverStatus {
  if (!receiverHandle) {
    return initialStatus();
  }
  return receiverHandle.getStatus();
}
