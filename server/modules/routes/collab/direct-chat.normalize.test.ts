import { describe, expect, it } from "vitest";
import {
  isAffirmativeReply,
  isNoPathReply,
  isTaskKickoffMessage,
  normalizeAgentReply,
  resolveContextualTaskMessage,
} from "./direct-chat.ts";

describe("normalizeAgentReply", () => {
  it("중복된 전체 응답 블록을 1회로 축약한다", () => {
    const input =
      "안녕하세요! 디자인팀 도로롱입니다, 대표님 ㅎㅎ 안녕하세요! 디자인팀 도로롱입니다, 대표님 ㅎㅎ";
    expect(normalizeAgentReply(input)).toBe("안녕하세요! 디자인팀 도로롱입니다, 대표님 ㅎㅎ");
  });

  it("연속 중복된 문장 블록(A+B+C, A+B+C)을 1회로 축약한다", () => {
    const input =
      "죄송합니다 대표님, 지금 시간 바로 확인해볼게요!앗 대표님, 지금 새벽 1시 30분이에요… 이 시간에 아직 안 주무시고 일하고 계신 건가요? 대표님도 좀 쉬셔야죠! 앗 대표님, 지금 새벽 1시 30분이에요… 이 시간에 아직 안 주무시고 일하고 계신 건가요? 대표님도 좀 쉬셔야죠!";
    expect(normalizeAgentReply(input)).toBe(
      "죄송합니다 대표님, 지금 시간 바로 확인해볼게요! 앗 대표님, 지금 새벽 1시 30분이에요… 이 시간에 아직 안 주무시고 일하고 계신 건가요? 대표님도 좀 쉬셔야죠!",
    );
  });

  it("중복이 없는 응답은 유지한다", () => {
    const input = "네 대표님, 점검 후 10분 내에 결과 공유드리겠습니다.";
    expect(normalizeAgentReply(input)).toBe(input);
  });
});

describe("task intent upgrade", () => {
  it("고고 같은 승인 메시지를 task kickoff로 인식한다", () => {
    expect(isTaskKickoffMessage("고고")).toBe(true);
    expect(isTaskKickoffMessage("go go!")).toBe(true);
    expect(isTaskKickoffMessage("좋은 아침")).toBe(false);
  });

  it("다국어 긍정 응답을 인식한다", () => {
    expect(isAffirmativeReply("네 진행해줘")).toBe(true);
    expect(isAffirmativeReply("yes, go ahead")).toBe(true);
    expect(isAffirmativeReply("はい、お願いします")).toBe(true);
    expect(isAffirmativeReply("好的，开始吧")).toBe(true);
    expect(isAffirmativeReply("아니 지금은 말고")).toBe(false);
  });

  it("경로 없음 응답을 다국어로 인식한다", () => {
    expect(isNoPathReply("경로 없어")).toBe(true);
    expect(isNoPathReply("I don't have project path")).toBe(true);
    expect(isNoPathReply("新建项目吧")).toBe(true);
    expect(isNoPathReply("path 있어")).toBe(false);
  });

  it("승인 메시지는 직전 업무요청 문맥으로 승격한다", () => {
    const contextual = resolveContextualTaskMessage("고고", [
      { content: "고고", messageType: "chat", createdAt: 3000 },
      { content: "현재 소스코드 디자인 평가를 받고싶어 업무 진행 가능해?", messageType: "chat", createdAt: 2000 },
      { content: "네 대표님, 가능합니다!", messageType: "chat", createdAt: 1000 },
    ]);
    expect(contextual).toBe("현재 소스코드 디자인 평가를 받고싶어 업무 진행 가능해?");
  });

  it("승격 여부 질문 뒤 긍정 응답이면 다국어로도 문맥 승격한다", () => {
    const contextual = resolveContextualTaskMessage(
      "yes, please proceed",
      [
        { content: "yes, please proceed", messageType: "chat", createdAt: 3000 },
        { content: "Can you evaluate the current source-code design and run the task?", messageType: "chat", createdAt: 2000 },
      ],
      [
        { content: "I can do that. Should I start right away?", createdAt: 2500 },
      ],
    );
    expect(contextual).toBe("Can you evaluate the current source-code design and run the task?");
  });

  it("긍정 응답이더라도 승격 질문 문맥이 없으면 승격하지 않는다", () => {
    const contextual = resolveContextualTaskMessage(
      "yes",
      [
        { content: "yes", messageType: "chat", createdAt: 3000 },
        { content: "점심 뭐 먹을까요?", messageType: "chat", createdAt: 2000 },
      ],
      [
        { content: "날씨 좋네요", createdAt: 2500 },
      ],
    );
    expect(contextual).toBeNull();
  });

  it("업무 문맥이 없으면 승인 메시지를 승격하지 않는다", () => {
    const contextual = resolveContextualTaskMessage("고고", [
      { content: "고고", messageType: "chat", createdAt: 3000 },
      { content: "날씨 좋네요", messageType: "chat", createdAt: 2000 },
      { content: "점심 뭐 먹을까요?", messageType: "chat", createdAt: 1000 },
    ]);
    expect(contextual).toBeNull();
  });
});
