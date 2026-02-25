import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { WebSocket } from "ws";

import { OPENCLAW_CONFIG_PATH, PKG_VERSION } from "../config/runtime.ts";

// ---------------------------------------------------------------------------
// OpenClaw Gateway wake (ported from claw-kanban)
// ---------------------------------------------------------------------------
const GATEWAY_PROTOCOL_VERSION = 3;
const GATEWAY_WS_PATH = "/ws";
const WAKE_DEBOUNCE_DEFAULT_MS = 12_000;
const wakeDebounce = new Map<string, number>();
let cachedGateway: { url: string; token?: string; loadedAt: number } | null = null;

function loadGatewayConfig(): { url: string; token?: string } | null {
  if (!OPENCLAW_CONFIG_PATH) return null;

  const now = Date.now();
  if (cachedGateway && now - cachedGateway.loadedAt < 30_000) {
    return { url: cachedGateway.url, token: cachedGateway.token };
  }
  try {
    const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      gateway?: {
        port?: number;
        auth?: { token?: string };
      };
    };
    const port = Number(parsed?.gateway?.port);
    if (!Number.isFinite(port) || port <= 0) {
      console.warn(`[Claw-Empire] invalid gateway.port in ${OPENCLAW_CONFIG_PATH}`);
      return null;
    }
    const token = typeof parsed?.gateway?.auth?.token === "string" ? parsed.gateway.auth.token : undefined;
    const url = `ws://127.0.0.1:${port}${GATEWAY_WS_PATH}`;
    cachedGateway = { url, token, loadedAt: now };
    return { url, token };
  } catch (err) {
    console.warn(`[Claw-Empire] failed to read gateway config: ${String(err)}`);
    return null;
  }
}

function shouldSendWake(key: string, debounceMs: number): boolean {
  const now = Date.now();
  const last = wakeDebounce.get(key);
  if (last && now - last < debounceMs) {
    return false;
  }
  wakeDebounce.set(key, now);
  if (wakeDebounce.size > 2000) {
    for (const [k, ts] of wakeDebounce) {
      if (now - ts > debounceMs * 4) {
        wakeDebounce.delete(k);
      }
    }
  }
  return true;
}

async function sendGatewayWake(text: string): Promise<void> {
  const config = loadGatewayConfig();
  if (!config) {
    throw new Error("gateway config unavailable");
  }

  const connectId = randomUUID();
  const wakeId = randomUUID();
  const instanceId = randomUUID();

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const ws = new WebSocket(config.url);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    const send = (payload: unknown) => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const connectParams = {
      minProtocol: GATEWAY_PROTOCOL_VERSION,
      maxProtocol: GATEWAY_PROTOCOL_VERSION,
      client: {
        id: "cli",
        displayName: "Claw-Empire",
        version: PKG_VERSION,
        platform: process.platform,
        mode: "backend",
        instanceId,
      },
      ...(config.token ? { auth: { token: config.token } } : {}),
      role: "operator",
      scopes: ["operator.admin"],
      caps: [],
    };

    ws.on("open", () => {
      send({ type: "req", id: connectId, method: "connect", params: connectParams });
    });

    ws.on("message", (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      if (!raw) return;
      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || msg.type !== "res") return;
      if (msg.id === connectId) {
        if (!msg.ok) {
          finish(new Error(msg.error?.message ?? "gateway connect failed"));
          return;
        }
        send({ type: "req", id: wakeId, method: "wake", params: { mode: "now", text } });
        return;
      }
      if (msg.id === wakeId) {
        if (!msg.ok) {
          finish(new Error(msg.error?.message ?? "gateway wake failed"));
          return;
        }
        finish();
      }
    });

    ws.on("error", () => {
      finish(new Error("gateway socket error"));
    });

    ws.on("close", () => {
      finish(new Error("gateway socket closed"));
    });

    timer = setTimeout(() => {
      finish(new Error("gateway wake timeout"));
    }, 8000);
    (timer as NodeJS.Timeout).unref?.();
  });
}

function queueWake(params: { key: string; text: string; debounceMs?: number }) {
  if (!OPENCLAW_CONFIG_PATH) return;
  const debounceMs = params.debounceMs ?? WAKE_DEBOUNCE_DEFAULT_MS;
  if (!shouldSendWake(params.key, debounceMs)) return;
  void sendGatewayWake(params.text).catch((err) => {
    console.warn(`[Claw-Empire] wake failed (${params.key}): ${String(err)}`);
  });
}

type GatewayLang = "ko" | "en" | "ja" | "zh";

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
  if (!OPENCLAW_CONFIG_PATH) return;
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

// ---------------------------------------------------------------------------
// Gateway HTTP REST invoke (for /tools/invoke endpoint)
// ---------------------------------------------------------------------------
export async function gatewayHttpInvoke(req: {
  tool: string;
  action?: string;
  args?: Record<string, any>;
}): Promise<any> {
  const config = loadGatewayConfig();
  if (!config) throw new Error("gateway config unavailable");
  const portMatch = config.url.match(/:(\d+)/);
  if (!portMatch) throw new Error("cannot extract port from gateway URL");
  const baseUrl = `http://127.0.0.1:${portMatch[1]}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const r = await fetch(`${baseUrl}/tools/invoke`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`gateway invoke failed: ${r.status}${body ? `: ${body}` : ""}`);
  }
  const data = (await r.json()) as { ok: boolean; result?: any; error?: { message?: string } };
  if (!data.ok) throw new Error(data.error?.message || "tool invoke error");
  return data.result;
}
