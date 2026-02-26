import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function createTestDb(options?: { messengerChannels?: unknown }): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-empire-messenger-test-"));
  const dbPath = path.join(tmpDir, "test.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    if (options && Object.prototype.hasOwnProperty.call(options, "messengerChannels")) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        "messengerChannels",
        JSON.stringify(options.messengerChannels ?? {}),
      );
    }
  } finally {
    db.close();
  }
  return dbPath;
}

async function importGatewayModule(env: Record<string, string | undefined>) {
  vi.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    DB_PATH: env.DB_PATH,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_IDS: env.TELEGRAM_CHAT_IDS,
    DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
    DISCORD_CHANNEL_IDS: env.DISCORD_CHANNEL_IDS,
    SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
    SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS,
    OPENCLAW_CONFIG: env.OPENCLAW_CONFIG,
  };

  return import("./client.ts");
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("gateway client", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("notifyTaskStatus는 설정된 Telegram/Discord/Slack 채널로 직접 전송한다", async () => {
    const dbPath = createTestDb();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const gateway = await importGatewayModule({
      DB_PATH: dbPath,
      TELEGRAM_BOT_TOKEN: "tg-token",
      TELEGRAM_CHAT_IDS: "-100123",
      DISCORD_BOT_TOKEN: "discord-token",
      DISCORD_CHANNEL_IDS: "987654",
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_CHANNEL_IDS: "C123",
      OPENCLAW_CONFIG: undefined,
    });

    gateway.notifyTaskStatus("task-1", "테스트 작업", "in_progress", "ko");
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const calls = fetchMock.mock.calls as Array<[string, RequestInit | undefined]>;

    const telegramCall = calls.find(([url]) => url.includes("api.telegram.org"));
    expect(telegramCall?.[0]).toBe("https://api.telegram.org/bottg-token/sendMessage");
    expect(telegramCall?.[1]?.method).toBe("POST");

    const discordCall = calls.find(([url]) => url.includes("discord.com/api/v10/channels"));
    expect(discordCall?.[0]).toBe("https://discord.com/api/v10/channels/987654/messages");
    expect((discordCall?.[1]?.headers as Record<string, string>)?.authorization).toBe("Bot discord-token");

    const slackCall = calls.find(([url]) => url.includes("slack.com/api/chat.postMessage"));
    expect(slackCall?.[0]).toBe("https://slack.com/api/chat.postMessage");
    expect((slackCall?.[1]?.headers as Record<string, string>)?.authorization).toBe("Bearer xoxb-test");
  });

  it("settings.messengerChannels 값이 있으면 세션/토큰으로 런타임 세션을 구성한다", async () => {
    const dbPath = createTestDb({
      messengerChannels: {
        telegram: {
          token: "tg-db-token",
          sessions: [
            { id: "ops", name: "Ops Alert", targetId: "-100999", enabled: true },
            { id: "silent", name: "Silent", targetId: "-100000", enabled: false },
          ],
        },
      },
    });

    const gateway = await importGatewayModule({
      DB_PATH: dbPath,
      TELEGRAM_BOT_TOKEN: "tg-env-token",
      TELEGRAM_CHAT_IDS: "-100111",
      DISCORD_BOT_TOKEN: undefined,
      DISCORD_CHANNEL_IDS: undefined,
      SLACK_BOT_TOKEN: undefined,
      SLACK_CHANNEL_IDS: undefined,
      OPENCLAW_CONFIG: undefined,
    });

    const sessions = gateway.listMessengerSessions();
    expect(sessions).toEqual([
      {
        sessionKey: "telegram:ops",
        channel: "telegram",
        targetId: "-100999",
        enabled: true,
        displayName: "Ops Alert",
      },
      {
        sessionKey: "telegram:silent",
        channel: "telegram",
        targetId: "-100000",
        enabled: false,
        displayName: "Silent",
      },
    ]);
  });

  it("sendMessengerMessage는 지정 채널/대상으로 직접 전송한다", async () => {
    const dbPath = createTestDb({
      messengerChannels: {
        discord: {
          token: "discord-db-token",
          sessions: [],
        },
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const gateway = await importGatewayModule({
      DB_PATH: dbPath,
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_CHAT_IDS: undefined,
      DISCORD_BOT_TOKEN: undefined,
      DISCORD_CHANNEL_IDS: undefined,
      SLACK_BOT_TOKEN: undefined,
      SLACK_CHANNEL_IDS: undefined,
      OPENCLAW_CONFIG: undefined,
    });

    await gateway.sendMessengerMessage({
      channel: "discord",
      targetId: "123456",
      text: "hello",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://discord.com/api/v10/channels/123456/messages");
  });

  it("gatewayHttpInvoke는 제거되었음을 명시적으로 반환한다", async () => {
    const dbPath = createTestDb();
    const gateway = await importGatewayModule({
      DB_PATH: dbPath,
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_CHAT_IDS: undefined,
      DISCORD_BOT_TOKEN: undefined,
      DISCORD_CHANNEL_IDS: undefined,
      SLACK_BOT_TOKEN: undefined,
      SLACK_CHANNEL_IDS: undefined,
      OPENCLAW_CONFIG: undefined,
    });

    await expect(gateway.gatewayHttpInvoke({ tool: "message" })).rejects.toThrow(
      "openclaw gateway integration has been removed",
    );
  });
});
