import { describe, expect, it } from "vitest";
import { resolveSessionAgentRouteFromSettings } from "./session-agent-routing.ts";

describe("session-agent-routing", () => {
  it("텔레그램 세션 targetId와 chat이 일치하면 agentId를 반환한다", () => {
    const route = resolveSessionAgentRouteFromSettings({
      settingsValue: {
        telegram: {
          sessions: [{ id: "tg-ops", name: "Ops", targetId: "7028830484", enabled: true, agentId: "a-1" }],
        },
      },
      source: "telegram",
      chat: "telegram:7028830484",
    });

    expect(route).toEqual({
      channel: "telegram",
      sessionId: "tg-ops",
      sessionName: "Ops",
      targetId: "7028830484",
      agentId: "a-1",
    });
  });

  it("agentId가 없으면 매핑하지 않는다", () => {
    const route = resolveSessionAgentRouteFromSettings({
      settingsValue: {
        telegram: {
          sessions: [{ id: "tg-ops", name: "Ops", targetId: "7028830484", enabled: true }],
        },
      },
      source: "telegram",
      chat: "7028830484",
    });

    expect(route).toBeNull();
  });

  it("비활성 세션은 매핑하지 않는다", () => {
    const route = resolveSessionAgentRouteFromSettings({
      settingsValue: {
        discord: {
          sessions: [
            { id: "dc-1", name: "Discord", targetId: "channel:1469158639695695904", enabled: false, agentId: "a-2" },
          ],
        },
      },
      source: "discord",
      chat: "channel:1469158639695695904",
    });

    expect(route).toBeNull();
  });
});

