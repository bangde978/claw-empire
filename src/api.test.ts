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

  it("getProjectDetail는 intelligence payload를 포함한 프로젝트 상세를 읽는다", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          project: { id: "proj-1", name: "Project 1", project_path: "/tmp/project-1", core_goal: "Goal" },
          assigned_agents: [],
          tasks: [],
          reports: [],
          decision_events: [],
          intelligence: {
            summary: { open_incidents: 2, high_risk_incidents: 1, timeline_events: 5, health_score: 82, stale_tasks: 1, review_backlog: 1, ownerless_tasks: 0 },
            timeline: [{ id: "evt-1", type: "task_created", task_id: "task-1", title: "Task", summary: "Opened", actor_name: null, created_at: 1, tone: "info" }],
            postmortems: [],
            recommended_actions: [{ id: "stale_tasks", title: "Escalate", detail: "detail", priority: "high" }],
          },
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    const detail = await api.getProjectDetail("proj-1");

    expect(detail.intelligence?.summary.timeline_events).toBe(5);
    expect(detail.intelligence?.summary.health_score).toBe(82);
    expect(detail.intelligence?.timeline[0]?.id).toBe("evt-1");
    expect(detail.intelligence?.recommended_actions[0]?.id).toBe("stale_tasks");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/projects/proj-1");
  });

  it("getDashboardInsights는 risk radar와 agent performance를 반환한다", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          risk_radar: [{ id: "risk-1", severity: "warning", title: "Risk", summary: "Needs review", count: 2, sample_labels: ["A"] }],
          agent_performance: [
            {
              agent_id: "agent-1",
              agent_name: "Alex",
              agent_name_ko: "알렉스",
              department_name: "Planning",
              department_name_ko: "기획",
              tasks_owned: 4,
              tasks_done: 3,
              active_tasks: 1,
              completion_rate: 75,
              avg_cycle_hours: 4.5,
              review_rate: 25,
              stall_rate: 0,
              dominant_task_type: "analysis",
              score: 88,
            },
          ],
          project_hotspots: [
            {
              project_id: "proj-1",
              project_name: "Project 1",
              project_path: "/tmp/project-1",
              risk_score: 44,
              open_incidents: 3,
              stale_tasks: 1,
              review_backlog: 1,
              ownerless_tasks: 0,
            },
          ],
          recommended_actions: [
            {
              id: "action-1",
              title: "Do this",
              detail: "Soon",
              priority: "medium",
              project_id: "proj-1",
              project_path: "/tmp/project-1",
            },
          ],
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    const insights = await api.getDashboardInsights();

    expect(insights.risk_radar[0]).toMatchObject({ id: "risk-1", count: 2 });
    expect(insights.agent_performance[0]).toMatchObject({ agent_id: "agent-1", score: 88 });
    expect(insights.project_hotspots[0]).toMatchObject({ project_id: "proj-1", risk_score: 44 });
    expect(insights.recommended_actions[0]).toMatchObject({
      id: "action-1",
      priority: "medium",
      project_id: "proj-1",
      project_path: "/tmp/project-1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/dashboard/insights");
  });

  it("dashboard handled history APIs는 목록 조회/업서트/삭제를 처리한다", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            items: [
              {
                kind: "action",
                item_id: "action-1",
                title: "Do this",
                project_id: "proj-1",
                project_path: "/tmp/project-1",
                fingerprint: "fp-1",
                handled_by: "Claw Empire",
                note: "done",
                handled_at: 100,
                updated_at: 101,
              },
            ],
          },
          200,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const api = await import("./api");
    const items = await api.getDashboardHandledHistory();
    expect(items[0]).toMatchObject({ item_id: "action-1", fingerprint: "fp-1" });

    await api.upsertDashboardHandledHistoryItem({
      kind: "risk",
      item_id: "risk-1",
      title: "Risk",
      fingerprint: "risk-fp",
      handled_by: "Operator",
    });

    await api.deleteDashboardHandledHistoryItem({ kind: "risk", item_id: "risk-1" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/dashboard/handled-history");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/dashboard/handled-history");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/dashboard/handled-history?kind=risk&item_id=risk-1");
  });
});
