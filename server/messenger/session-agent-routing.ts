import type { DatabaseSync } from "node:sqlite";

const MESSENGER_SETTINGS_KEY = "messengerChannels";

type MessengerChannel = "telegram" | "discord" | "slack";

type PersistedSession = {
  id?: unknown;
  name?: unknown;
  targetId?: unknown;
  enabled?: unknown;
  agentId?: unknown;
};

type PersistedChannel = {
  sessions?: unknown;
};

type PersistedMessengerChannels = Partial<Record<MessengerChannel, PersistedChannel>>;

export type SessionAgentRoute = {
  channel: MessengerChannel;
  sessionId: string;
  sessionName: string;
  targetId: string;
  agentId: string;
};

export type AgentSessionRoute = {
  channel: MessengerChannel;
  sessionId: string;
  sessionName: string;
  targetId: string;
};

const MESSENGER_CHANNELS: MessengerChannel[] = ["telegram", "discord", "slack"];

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSource(value: unknown): MessengerChannel | null {
  const raw = normalizeText(value).toLowerCase();
  if (raw === "telegram" || raw === "discord" || raw === "slack") return raw;
  return null;
}

function stripKnownPrefix(channel: MessengerChannel, value: string): string {
  const lower = value.toLowerCase();
  const prefixes =
    channel === "telegram"
      ? ["telegram:"]
      : channel === "discord"
        ? ["discord:", "channel:"]
        : ["slack:", "channel:"];

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return value.slice(prefix.length).trim();
    }
  }
  return value;
}

function normalizeTargetId(channel: MessengerChannel, value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return stripKnownPrefix(channel, normalized);
}

function buildTargetCandidates(channel: MessengerChannel, chat: unknown): Set<string> {
  const raw = normalizeText(chat);
  const candidates = new Set<string>();
  if (!raw) return candidates;

  const stripped = stripKnownPrefix(channel, raw);
  if (stripped) candidates.add(stripped);
  candidates.add(raw);
  return candidates;
}

function isSessionEnabled(value: unknown): boolean {
  return value !== false;
}

export function resolveSessionAgentRouteFromSettings(params: {
  settingsValue: unknown;
  source: unknown;
  chat: unknown;
}): SessionAgentRoute | null {
  const { settingsValue, source, chat } = params;
  const channel = normalizeSource(source);
  if (!channel) return null;

  if (!settingsValue || typeof settingsValue !== "object" || Array.isArray(settingsValue)) {
    return null;
  }

  const channels = settingsValue as PersistedMessengerChannels;
  const channelConfig = channels[channel];
  if (!channelConfig || typeof channelConfig !== "object" || !Array.isArray(channelConfig.sessions)) {
    return null;
  }

  const candidates = buildTargetCandidates(channel, chat);
  if (candidates.size === 0) return null;

  for (const rawSession of channelConfig.sessions) {
    const session = (rawSession ?? {}) as PersistedSession;
    if (!isSessionEnabled(session.enabled)) continue;

    const targetId = normalizeTargetId(channel, session.targetId);
    if (!targetId) continue;

    const agentId = normalizeText(session.agentId);
    if (!agentId) continue;

    if (!candidates.has(targetId)) continue;

    const sessionId = normalizeText(session.id) || `${channel}-${targetId}`;
    const sessionName = normalizeText(session.name) || sessionId;
    return {
      channel,
      sessionId,
      sessionName,
      targetId,
      agentId,
    };
  }

  return null;
}

export function resolveAgentSessionRoutesFromSettings(params: {
  settingsValue: unknown;
  agentId: unknown;
}): AgentSessionRoute[] {
  const { settingsValue, agentId } = params;
  const targetAgentId = normalizeText(agentId);
  if (!targetAgentId) return [];
  if (!settingsValue || typeof settingsValue !== "object" || Array.isArray(settingsValue)) {
    return [];
  }

  const channels = settingsValue as PersistedMessengerChannels;
  const routes: AgentSessionRoute[] = [];
  const dedupe = new Set<string>();

  for (const channel of MESSENGER_CHANNELS) {
    const channelConfig = channels[channel];
    if (!channelConfig || typeof channelConfig !== "object" || !Array.isArray(channelConfig.sessions)) {
      continue;
    }
    for (const rawSession of channelConfig.sessions) {
      const session = (rawSession ?? {}) as PersistedSession;
      if (!isSessionEnabled(session.enabled)) continue;

      const sessionAgentId = normalizeText(session.agentId);
      if (sessionAgentId !== targetAgentId) continue;

      const targetId = normalizeTargetId(channel, session.targetId);
      if (!targetId) continue;

      const sessionId = normalizeText(session.id) || `${channel}-${targetId}`;
      const sessionName = normalizeText(session.name) || sessionId;
      const key = `${channel}:${targetId}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      routes.push({
        channel,
        sessionId,
        sessionName,
        targetId,
      });
    }
  }

  return routes;
}

export function resolveSessionAgentRouteFromDb(params: {
  db: DatabaseSync;
  source: unknown;
  chat: unknown;
}): SessionAgentRoute | null {
  const { db, source, chat } = params;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(MESSENGER_SETTINGS_KEY) as
      | { value?: unknown }
      | undefined;
    const raw = normalizeText(row?.value);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return resolveSessionAgentRouteFromSettings({
      settingsValue: parsed,
      source,
      chat,
    });
  } catch {
    return null;
  }
}

export function resolveAgentSessionRoutesFromDb(params: {
  db: DatabaseSync;
  agentId: unknown;
}): AgentSessionRoute[] {
  const { db, agentId } = params;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(MESSENGER_SETTINGS_KEY) as
      | { value?: unknown }
      | undefined;
    const raw = normalizeText(row?.value);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return resolveAgentSessionRoutesFromSettings({
      settingsValue: parsed,
      agentId,
    });
  } catch {
    return [];
  }
}
