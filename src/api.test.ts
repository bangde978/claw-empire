import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("401 응답 시 bootstrap 후 원요청을 재시도한다", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ departments: [{ id: "dep-1" }] }, 200));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    api.setApiAuthToken("token-1");
    const departments = await api.getDepartments();

    expect(departments).toEqual([{ id: "dep-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/departments");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/session");

    const firstHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer token-1");
  });

  it("createDepartment가 JSON body로 POST 요청을 보낸다", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          department: { id: "dep-1", name: "Department 1" },
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    const created = await api.createDepartment({
      id: "dep-1",
      name: "Department 1",
      name_ko: "부서1",
    });

    expect(created).toMatchObject({ id: "dep-1", name: "Department 1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/departments");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(String(init?.body))).toMatchObject({ id: "dep-1", name: "Department 1", name_ko: "부서1" });
  });

  it("비정상 응답은 ApiRequestError로 변환된다", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "project_path_required" }, 400));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    await expect(api.getProjects()).rejects.toSatisfy((error: unknown) => {
      if (!api.isApiRequestError(error)) return false;
      return error.status === 400 && error.code === "project_path_required" && error.url.endsWith("/api/projects");
    });
  });

  it("sendMessage는 헤더/바디 idempotency key를 함께 전송한다", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: { id: "msg-1" } }, 200));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    const id = await api.sendMessage({
      receiver_type: "all",
      content: "hello",
    });

    expect(id).toBe("msg-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/messages");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    const headerKey = headers.get("x-idempotency-key");
    const body = JSON.parse(String(init?.body)) as { idempotency_key?: string; content?: string };
    expect(body.content).toBe("hello");
    expect(typeof headerKey).toBe("string");
    expect(headerKey).toBe(body.idempotency_key);
    expect(String(headerKey)).toMatch(/^ceo-message-/);
  });

  it("bootstrapSession은 401에서 prompt 입력 토큰으로 재시도한다", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401)).mockResolvedValueOnce(
      jsonResponse(
        {
          ok: true,
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.spyOn(window, "prompt").mockReturnValue("  refreshed-token  ");

    const api = await import("./api");
    const ok = await api.bootstrapSession({ promptOnUnauthorized: true });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem("claw_api_auth_token")).toBe("refreshed-token");
  });

  it("세션 부트스트랩 csrf 토큰을 저장하고 mutation 요청에 헤더를 붙인다", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, csrf_token: "csrf-abc" }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    const ok = await api.bootstrapSession({ promptOnUnauthorized: false });
    expect(ok).toBe(true);

    await api.pauseTask("task-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-csrf-token")).toBe("csrf-abc");
  });
});
