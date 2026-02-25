import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function writeGatewayConfig(port: number, token?: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-empire-gateway-test-"));
  const configPath = path.join(tmpDir, "openclaw-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        gateway: {
          port,
          auth: token ? { token } : undefined,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return configPath;
}

async function importGatewayModule(openclawConfigPath?: string) {
  vi.resetModules();
  if (openclawConfigPath) {
    process.env.OPENCLAW_CONFIG = openclawConfigPath;
  } else {
    delete process.env.OPENCLAW_CONFIG;
  }
  return import("./client.ts");
}

describe("gateway client", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gatewayHttpInvoke는 /tools/invoke로 요청을 보내고 result를 반환한다", async () => {
    const configPath = writeGatewayConfig(32123, "token-1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { sent: true, id: "invoke-1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const gateway = await importGatewayModule(configPath);
    const result = await gateway.gatewayHttpInvoke({
      tool: "message",
      action: "send",
      args: { text: "hello" },
    });

    expect(result).toEqual({ sent: true, id: "invoke-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:32123/tools/invoke");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer token-1");
  });

  it("gatewayHttpInvoke는 HTTP 실패 응답을 예외로 반환한다", async () => {
    const configPath = writeGatewayConfig(33111);
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const gateway = await importGatewayModule(configPath);
    await expect(
      gateway.gatewayHttpInvoke({
        tool: "message",
        args: { text: "x" },
      }),
    ).rejects.toThrow("gateway invoke failed: 500");
  });

  it("gatewayHttpInvoke는 ok=false payload를 예외로 반환한다", async () => {
    const configPath = writeGatewayConfig(33222);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { message: "tool invoke error" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const gateway = await importGatewayModule(configPath);
    await expect(
      gateway.gatewayHttpInvoke({
        tool: "message",
        args: { text: "x" },
      }),
    ).rejects.toThrow("tool invoke error");
  });

  it("OPENCLAW 설정이 없으면 notifyTaskStatus는 no-op으로 동작한다", async () => {
    const gateway = await importGatewayModule(undefined);
    expect(() => gateway.notifyTaskStatus("task-1", "title", "in_progress", "ko")).not.toThrow();
  });
});
