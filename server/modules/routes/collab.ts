import type { RuntimeContext, RouteCollabExports } from "../../types/runtime-context.ts";
import { isLang, type Lang } from "../../types/lang.ts";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createAnnouncementReplyScheduler } from "./collab/announcement-response.ts";
import { createChatReplyGenerator } from "./collab/chat-response.ts";
import { initializeCollabCoordination } from "./collab/coordination.ts";
import { createDirectChatHandlers, type AgentRow } from "./collab/direct-chat.ts";
import { initializeProjectResolution, type DelegationOptions } from "./collab/project-resolution.ts";
import { initializeSubtaskSummary, type SubtaskRow } from "./collab/subtask-summary.ts";

export function registerRoutesPartB(ctx: RuntimeContext): RouteCollabExports {
  const __ctx: RuntimeContext = ctx;
  const CLI_STATUS_TTL = __ctx.CLI_STATUS_TTL;
  const CLI_TOOLS = __ctx.CLI_TOOLS;
  const MODELS_CACHE_TTL = __ctx.MODELS_CACHE_TTL;
  const IdempotencyConflictError = __ctx.IdempotencyConflictError;
  const StorageBusyError = __ctx.StorageBusyError;
  const activeProcesses = __ctx.activeProcesses;
  const analyzeSubtaskDepartment = __ctx.analyzeSubtaskDepartment;
  const app = __ctx.app;
  const appendTaskLog = __ctx.appendTaskLog;
  const broadcast = __ctx.broadcast;
  const buildCliFailureMessage = __ctx.buildCliFailureMessage;
  const buildDirectReplyPrompt = __ctx.buildDirectReplyPrompt;
  const executeApiProviderAgent = __ctx.executeApiProviderAgent;
  const executeCopilotAgent = __ctx.executeCopilotAgent;
  const executeAntigravityAgent = __ctx.executeAntigravityAgent;
  const buildTaskExecutionPrompt = __ctx.buildTaskExecutionPrompt;
  const cachedCliStatus = __ctx.cachedCliStatus;
  const cachedModels = __ctx.cachedModels;
  const chooseSafeReply = __ctx.chooseSafeReply;
  const cleanupWorktree = __ctx.cleanupWorktree;
  const clearTaskWorkflowState = __ctx.clearTaskWorkflowState;
  const createWorktree = __ctx.createWorktree;
  const crossDeptNextCallbacks = __ctx.crossDeptNextCallbacks;
  const db = __ctx.db;
  const dbPath = __ctx.dbPath;
  const delegatedTaskToSubtask = __ctx.delegatedTaskToSubtask;
  const deptCount = __ctx.deptCount;
  const detectAllCli = __ctx.detectAllCli;
  const endTaskExecutionSession = __ctx.endTaskExecutionSession;
  const ensureClaudeMd = __ctx.ensureClaudeMd;
  const ensureOAuthActiveAccount = __ctx.ensureOAuthActiveAccount;
  const ensureTaskExecutionSession = __ctx.ensureTaskExecutionSession;
  const execWithTimeout = __ctx.execWithTimeout;
  const fetchClaudeUsage = __ctx.fetchClaudeUsage;
  const fetchCodexUsage = __ctx.fetchCodexUsage;
  const fetchGeminiUsage = __ctx.fetchGeminiUsage;
  const finishReview = __ctx.finishReview;
  const generateProjectContext = __ctx.generateProjectContext;
  const getActiveOAuthAccountIds = __ctx.getActiveOAuthAccountIds;
  const getAgentDisplayName = __ctx.getAgentDisplayName;
  const getNextOAuthLabel = __ctx.getNextOAuthLabel;
  const getOAuthAccounts = __ctx.getOAuthAccounts;
  const getPreferredOAuthAccounts = __ctx.getPreferredOAuthAccounts;
  const getProviderModelConfig = __ctx.getProviderModelConfig;
  const getRecentChanges = __ctx.getRecentChanges;
  const getRecentConversationContext = __ctx.getRecentConversationContext;
  const getTaskContinuationContext = __ctx.getTaskContinuationContext;
  const handleTaskRunComplete = __ctx.handleTaskRunComplete;
  const hasExplicitWarningFixRequest = __ctx.hasExplicitWarningFixRequest;
  const hasStructuredJsonLines = __ctx.hasStructuredJsonLines;
  const getNextHttpAgentPid = __ctx.getNextHttpAgentPid;
  const insertMessageWithIdempotency = __ctx.insertMessageWithIdempotency;
  const interruptPidTree = __ctx.interruptPidTree;
  const isTaskWorkflowInterrupted = __ctx.isTaskWorkflowInterrupted;
  const killPidTree = __ctx.killPidTree;
  const launchApiProviderAgent = __ctx.launchApiProviderAgent;
  const launchHttpAgent = __ctx.launchHttpAgent;
  const logsDir = __ctx.logsDir;
  const meetingPhaseByAgent = __ctx.meetingPhaseByAgent;
  const meetingPresenceUntil = __ctx.meetingPresenceUntil;
  const meetingReviewDecisionByAgent = __ctx.meetingReviewDecisionByAgent;
  const meetingSeatIndexByAgent = __ctx.meetingSeatIndexByAgent;
  const meetingTaskIdByAgent = __ctx.meetingTaskIdByAgent;
  const mergeWorktree = __ctx.mergeWorktree;
  const normalizeOAuthProvider = __ctx.normalizeOAuthProvider;
  const notifyCeo = __ctx.notifyCeo;
  const nowMs = __ctx.nowMs;
  const randomDelay = __ctx.randomDelay;
  const recordAcceptedIngressAuditOrRollback = __ctx.recordAcceptedIngressAuditOrRollback;
  const recordMessageIngressAuditOr503 = __ctx.recordMessageIngressAuditOr503;
  const recordTaskCreationAudit = __ctx.recordTaskCreationAudit;
  const refreshGoogleToken = __ctx.refreshGoogleToken;
  const removeActiveOAuthAccount = __ctx.removeActiveOAuthAccount;
  const resolveMessageIdempotencyKey = __ctx.resolveMessageIdempotencyKey;
  const rollbackTaskWorktree = __ctx.rollbackTaskWorktree;
  const runAgentOneShot = __ctx.runAgentOneShot;
  const seedApprovedPlanSubtasks = __ctx.seedApprovedPlanSubtasks;
  const setActiveOAuthAccount = __ctx.setActiveOAuthAccount;
  const setOAuthActiveAccounts = __ctx.setOAuthActiveAccounts;
  const spawnCliAgent = __ctx.spawnCliAgent;
  const startPlannedApprovalMeeting = __ctx.startPlannedApprovalMeeting;
  const startProgressTimer = __ctx.startProgressTimer;
  const startTaskExecutionForAgent = __ctx.startTaskExecutionForAgent;
  const stopProgressTimer = __ctx.stopProgressTimer;
  const stopRequestModeByTask = __ctx.stopRequestModeByTask;
  const stopRequestedTasks = __ctx.stopRequestedTasks;
  const subtaskDelegationCallbacks = __ctx.subtaskDelegationCallbacks;
  const subtaskDelegationCompletionNoticeSent = __ctx.subtaskDelegationCompletionNoticeSent;
  const subtaskDelegationDispatchInFlight = __ctx.subtaskDelegationDispatchInFlight;
  const taskExecutionSessions = __ctx.taskExecutionSessions;
  const taskWorktrees = __ctx.taskWorktrees;
  const withSqliteBusyRetry = __ctx.withSqliteBusyRetry;
  const prettyStreamJson = __ctx.prettyStreamJson;
  const refreshCliUsageData = __ctx.refreshCliUsageData;
  const buildHealthPayload = __ctx.buildHealthPayload;
  const consumeOAuthState = __ctx.consumeOAuthState;
  const upsertOAuthCredential = __ctx.upsertOAuthCredential;
  const startGitHubOAuth = __ctx.startGitHubOAuth;
  const startGoogleAntigravityOAuth = __ctx.startGoogleAntigravityOAuth;
  const handleGitHubCallback = __ctx.handleGitHubCallback;
  const handleGoogleAntigravityCallback = __ctx.handleGoogleAntigravityCallback;
  const buildOAuthStatus = __ctx.buildOAuthStatus;
  const fetchOpenCodeModels = __ctx.fetchOpenCodeModels;
  const cachedCliModels = __ctx.cachedCliModels;
  const readCodexModelsCache = __ctx.readCodexModelsCache;
  const fetchGeminiModels = __ctx.fetchGeminiModels;
  const toModelInfo = __ctx.toModelInfo;
  const cachedSkills = __ctx.cachedSkills;
  const SKILLS_CACHE_TTL = __ctx.SKILLS_CACHE_TTL;
  const fetchSkillsFromSite = __ctx.fetchSkillsFromSite;
  const readCliUsageFromDb = __ctx.readCliUsageFromDb;

  // ---------------------------------------------------------------------------
  // Agent auto-reply & task delegation logic
  // ---------------------------------------------------------------------------
  const ROLE_PRIORITY: Record<string, number> = {
    team_leader: 0,
    senior: 1,
    junior: 2,
    intern: 3,
  };

  const ROLE_LABEL: Record<string, string> = {
    team_leader: "팀장",
    senior: "시니어",
    junior: "주니어",
    intern: "인턴",
  };

  const DEPT_KEYWORDS: Record<string, string[]> = {
    dev: ["개발", "코딩", "프론트", "백엔드", "API", "서버", "코드", "버그", "프로그램", "앱", "웹"],
    design: ["디자인", "UI", "UX", "목업", "피그마", "아이콘", "로고", "배너", "레이아웃", "시안"],
    planning: ["기획", "전략", "분석", "리서치", "보고서", "PPT", "발표", "시장", "조사", "제안"],
    operations: ["운영", "배포", "인프라", "모니터링", "서버관리", "CI", "CD", "DevOps", "장애"],
    qa: ["QA", "QC", "품질", "테스트", "검수", "버그리포트", "회귀", "자동화테스트", "성능테스트", "리뷰"],
    devsecops: [
      "보안",
      "취약점",
      "인증",
      "SSL",
      "방화벽",
      "해킹",
      "침투",
      "파이프라인",
      "컨테이너",
      "도커",
      "쿠버네티스",
      "암호화",
    ],
  };

  function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function sendAgentMessage(
    agent: AgentRow,
    content: string,
    messageType: string = "chat",
    receiverType: string = "agent",
    receiverId: string | null = null,
    taskId: string | null = null,
  ): void {
    const id = randomUUID();
    const t = nowMs();
    db.prepare(
      `
    INSERT INTO messages (id, sender_type, sender_id, receiver_type, receiver_id, content, message_type, task_id, created_at)
    VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?)
  `,
    ).run(id, agent.id, receiverType, receiverId, content, messageType, taskId, t);

    broadcast("new_message", {
      id,
      sender_type: "agent",
      sender_id: agent.id,
      receiver_type: receiverType,
      receiver_id: receiverId,
      content,
      message_type: messageType,
      task_id: taskId,
      created_at: t,
      sender_name: agent.name,
      sender_avatar: agent.avatar_emoji ?? "🤖",
    });
  }

  // ---- Language detection & multilingual response system ----

  function readSettingString(key: string): string | undefined {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      const parsed = JSON.parse(row.value);
      return typeof parsed === "string" ? parsed : row.value;
    } catch {
      return row.value;
    }
  }

  function getPreferredLanguage(): Lang {
    const settingLang = readSettingString("language");
    return isLang(settingLang) ? settingLang : "en";
  }

  function resolveLang(text?: string, fallback?: Lang): Lang {
    const settingLang = readSettingString("language");
    if (isLang(settingLang)) return settingLang;
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (trimmed) return detectLang(trimmed);
    return fallback ?? getPreferredLanguage();
  }

  function detectLang(text: string): Lang {
    const ko = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g)?.length ?? 0;
    const ja = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g)?.length ?? 0;
    const zh = text.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
    const total = text.replace(/\s/g, "").length || 1;
    if (ko / total > 0.15) return "ko";
    if (ja / total > 0.15) return "ja";
    if (zh / total > 0.3) return "zh";
    return "en";
  }

  // Bilingual response templates: { ko, en, ja, zh }
  type L10n = Record<Lang, string[]>;

  function l(ko: string[], en: string[], ja?: string[], zh?: string[]): L10n {
    return {
      ko,
      en,
      ja: ja ?? en.map((s) => s), // fallback to English
      zh: zh ?? en.map((s) => s),
    };
  }

  function pickL(pool: L10n, lang: Lang): string {
    const arr = pool[lang];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Agent personality flair by agent name + language
  function getFlairs(agentName: string, lang: Lang): string[] {
    const flairs: Record<string, Record<Lang, string[]>> = {
      Aria: {
        ko: ["코드 리뷰 중에", "리팩토링 구상하면서", "PR 체크하면서"],
        en: ["reviewing code", "planning a refactor", "checking PRs"],
        ja: ["コードレビュー中に", "リファクタリングを考えながら", "PR確認しながら"],
        zh: ["审查代码中", "规划重构时", "检查PR时"],
      },
      Bolt: {
        ko: ["빠르게 코딩하면서", "API 설계하면서", "성능 튜닝하면서"],
        en: ["coding fast", "designing APIs", "tuning performance"],
        ja: ["高速コーディング中", "API設計しながら", "パフォーマンスチューニング中"],
        zh: ["快速编码中", "设计API时", "调优性能时"],
      },
      Nova: {
        ko: ["새로운 기술 공부하면서", "프로토타입 만들면서", "실험적인 코드 짜면서"],
        en: ["studying new tech", "building a prototype", "writing experimental code"],
        ja: ["新技術を勉強しながら", "プロトタイプ作成中", "実験的なコード書き中"],
        zh: ["学习新技术中", "制作原型时", "编写实验代码时"],
      },
      Pixel: {
        ko: ["디자인 시안 작업하면서", "컴포넌트 정리하면서", "UI 가이드 업데이트하면서"],
        en: ["working on mockups", "organizing components", "updating the UI guide"],
        ja: ["デザインモックアップ作業中", "コンポーネント整理しながら", "UIガイド更新中"],
        zh: ["制作设计稿中", "整理组件时", "更新UI指南时"],
      },
      Luna: {
        ko: ["애니메이션 작업하면서", "컬러 팔레트 고민하면서", "사용자 경험 분석하면서"],
        en: ["working on animations", "refining the color palette", "analyzing UX"],
        ja: ["アニメーション作業中", "カラーパレット検討中", "UX分析しながら"],
        zh: ["制作动画中", "调整调色板时", "分析用户体验时"],
      },
      Sage: {
        ko: ["시장 분석 보고서 보면서", "전략 문서 정리하면서", "경쟁사 리서치하면서"],
        en: ["reviewing market analysis", "organizing strategy docs", "researching competitors"],
        ja: ["市場分析レポート確認中", "戦略文書整理中", "競合リサーチしながら"],
        zh: ["查看市场分析报告", "整理战略文件时", "调研竞品时"],
      },
      Clio: {
        ko: ["데이터 분석하면서", "기획서 작성하면서", "사용자 인터뷰 정리하면서"],
        en: ["analyzing data", "drafting a proposal", "organizing user interviews"],
        ja: ["データ分析中", "企画書作成中", "ユーザーインタビュー整理中"],
        zh: ["分析数据中", "撰写企划书时", "整理用户访谈时"],
      },
      Atlas: {
        ko: ["서버 모니터링하면서", "배포 파이프라인 점검하면서", "운영 지표 확인하면서"],
        en: ["monitoring servers", "checking deploy pipelines", "reviewing ops metrics"],
        ja: ["サーバー監視中", "デプロイパイプライン点検中", "運用指標確認中"],
        zh: ["监控服务器中", "检查部署流水线时", "查看运营指标时"],
      },
      Turbo: {
        ko: ["자동화 스크립트 돌리면서", "CI/CD 최적화하면서", "인프라 정리하면서"],
        en: ["running automation scripts", "optimizing CI/CD", "cleaning up infra"],
        ja: ["自動化スクリプト実行中", "CI/CD最適化中", "インフラ整理中"],
        zh: ["运行自动化脚本中", "优化CI/CD时", "整理基础设施时"],
      },
      Hawk: {
        ko: ["테스트 케이스 리뷰하면서", "버그 리포트 분석하면서", "품질 지표 확인하면서"],
        en: ["reviewing test cases", "analyzing bug reports", "checking quality metrics"],
        ja: ["テストケースレビュー中", "バグレポート分析中", "品質指標確認中"],
        zh: ["审查测试用例中", "分析缺陷报告时", "查看质量指标时"],
      },
      Lint: {
        ko: ["자동화 테스트 작성하면서", "코드 검수하면서", "회귀 테스트 돌리면서"],
        en: ["writing automated tests", "inspecting code", "running regression tests"],
        ja: ["自動テスト作成中", "コード検査中", "回帰テスト実行中"],
        zh: ["编写自动化测试中", "检查代码时", "运行回归测试时"],
      },
      Vault: {
        ko: ["보안 감사 진행하면서", "취약점 스캔 결과 보면서", "인증 로직 점검하면서"],
        en: ["running a security audit", "reviewing vuln scan results", "checking auth logic"],
        ja: ["セキュリティ監査中", "脆弱性スキャン結果確認中", "認証ロジック点検中"],
        zh: ["进行安全审计中", "查看漏洞扫描结果时", "检查认证逻辑时"],
      },
      Pipe: {
        ko: ["파이프라인 구축하면서", "컨테이너 설정 정리하면서", "배포 자동화 하면서"],
        en: ["building pipelines", "configuring containers", "automating deployments"],
        ja: ["パイプライン構築中", "コンテナ設定整理中", "デプロイ自動化中"],
        zh: ["构建流水线中", "配置容器时", "自动化部署时"],
      },
    };
    const agentFlairs = flairs[agentName];
    if (agentFlairs) return agentFlairs[lang] ?? agentFlairs.en;
    const defaults: Record<Lang, string[]> = {
      ko: ["업무 처리하면서", "작업 진행하면서", "일하면서"],
      en: ["working on tasks", "making progress", "getting things done"],
      ja: ["業務処理中", "作業進行中", "仕事しながら"],
      zh: ["处理业务中", "推进工作时", "忙着干活时"],
    };
    return defaults[lang];
  }

  // Role labels per language
  const ROLE_LABEL_L10N: Record<string, Record<Lang, string>> = {
    team_leader: { ko: "팀장", en: "Team Lead", ja: "チームリーダー", zh: "组长" },
    senior: { ko: "시니어", en: "Senior", ja: "シニア", zh: "高级" },
    junior: { ko: "주니어", en: "Junior", ja: "ジュニア", zh: "初级" },
    intern: { ko: "인턴", en: "Intern", ja: "インターン", zh: "实习生" },
  };

  function getRoleLabel(role: string, lang: Lang): string {
    return ROLE_LABEL_L10N[role]?.[lang] ?? ROLE_LABEL[role] ?? role;
  }

  // Intent classifiers per language
  function classifyIntent(msg: string, lang: Lang) {
    const checks: Record<string, RegExp[]> = {
      greeting: [
        /안녕|하이|반가|좋은\s*(아침|오후|저녁)/i,
        /hello|hi\b|hey|good\s*(morning|afternoon|evening)|howdy|what'?s\s*up/i,
        /こんにちは|おはよう|こんばんは|やあ|どうも/i,
        /你好|嗨|早上好|下午好|晚上好/i,
      ],
      presence: [
        /자리|있어|계세요|계신가|거기|응답|들려|보여|어디야|어딨/i,
        /are you (there|here|around|available|at your desk)|you there|anybody|present/i,
        /いますか|席に|いる？|応答/i,
        /在吗|在不在|有人吗/i,
      ],
      whatDoing: [
        /뭐\s*해|뭐하|뭘\s*해|뭐\s*하고|뭐\s*하는|하는\s*중|진행\s*중|바쁘|바빠|한가/i,
        /what are you (doing|up to|working on)|busy|free|what'?s going on|occupied/i,
        /何してる|忙しい|暇|何やってる/i,
        /在做什么|忙吗|有空吗|在干嘛/i,
      ],
      report: [
        /보고|현황|상태|진행|어디까지|결과|리포트|성과/i,
        /report|status|progress|update|how('?s| is) (it|the|your)|results/i,
        /報告|進捗|状況|ステータス/i,
        /报告|进度|状态|进展/i,
      ],
      praise: [
        /잘했|수고|고마|감사|훌륭|대단|멋져|최고|짱/i,
        /good (job|work)|well done|thank|great|awesome|amazing|excellent|nice|kudos|bravo/i,
        /よくやった|お疲れ|ありがとう|素晴らしい|すごい/i,
        /做得好|辛苦|谢谢|太棒了|厉害/i,
      ],
      encourage: [
        /힘내|화이팅|파이팅|응원|열심히|잘\s*부탁|잘\s*해|잘해봐/i,
        /keep (it )?up|go for it|fighting|you (got|can do) (this|it)|cheer|hang in there/i,
        /頑張|ファイト|応援/i,
        /加油|努力|拜托/i,
      ],
      joke: [
        /ㅋ|ㅎ|웃|재밌|장난|농담|심심|놀자/i,
        /lol|lmao|haha|joke|funny|bored|play/i,
        /笑|面白い|冗談|暇/i,
        /哈哈|笑|开玩笑|无聊/i,
      ],
      complaint: [
        /느려|답답|왜\s*이래|언제\s*돼|빨리|지연|늦/i,
        /slow|frustrat|why (is|so)|when (will|is)|hurry|delay|late|taking (too )?long/i,
        /遅い|イライラ|なぜ|いつ|急いで/i,
        /慢|着急|为什么|快点|延迟/i,
      ],
      opinion: [
        /어때|생각|의견|아이디어|제안|건의|어떨까|괜찮/i,
        /what do you think|opinion|idea|suggest|how about|thoughts|recommend/i,
        /どう思う|意見|アイデア|提案/i,
        /怎么看|意见|想法|建议/i,
      ],
      canDo: [
        /가능|할\s*수|되나|될까|할까|해줘|해\s*줄|맡아|부탁/i,
        /can you|could you|possible|able to|handle|take care|would you|please/i,
        /できる|可能|お願い|頼む|やって/i,
        /能不能|可以|拜托|帮忙|处理/i,
      ],
      question: [
        /\?|뭐|어디|언제|왜|어떻게|무엇|몇/i,
        /\?|what|where|when|why|how|which|who/i,
        /\?|何|どこ|いつ|なぜ|どう/i,
        /\?|什么|哪里|什么时候|为什么|怎么/i,
      ],
    };

    const langIdx = { ko: 0, en: 1, ja: 2, zh: 3 }[lang];
    const result: Record<string, boolean> = {};
    for (const [key, patterns] of Object.entries(checks)) {
      // Check ALL language patterns (user may mix languages)
      result[key] = patterns.some((p) => p.test(msg));
    }
    return result;
  }

  const { generateChatReply } = createChatReplyGenerator({
    db,
    resolveLang,
    getDeptName,
    getRoleLabel,
    pickRandom,
    getFlairs,
    classifyIntent,
    l,
    pickL,
  });

  const { generateAnnouncementReply, scheduleAnnouncementReplies } = createAnnouncementReplyScheduler({
    db,
    resolveLang,
    getDeptName,
    getRoleLabel,
    l,
    pickL,
    sendAgentMessage,
  });

  Object.assign(__ctx, { generateChatReply, generateAnnouncementReply });

  type DirectivePolicy = {
    skipDelegation: boolean;
    skipDelegationReason: "no_task" | "lightweight" | null;
    skipPlannedMeeting: boolean;
    skipPlanSubtasks: boolean;
  };

  const { normalizeTextField, resolveProjectFromOptions, buildRoundGoal } = initializeProjectResolution({ db });

  function analyzeDirectivePolicy(content: string): DirectivePolicy {
    const text = content.trim();
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    const compact = normalized.replace(/\s+/g, "");

    const includesTerm = (term: string): boolean => {
      const termNorm = term.toLowerCase();
      return normalized.includes(termNorm) || compact.includes(termNorm.replace(/\s+/g, ""));
    };
    const includesAny = (terms: string[]): boolean => terms.some(includesTerm);

    // Meeting skip is now controlled exclusively via API parameter (skipPlannedMeeting: true).
    // Text-based keyword matching for "회의 없이" etc. has been removed for safety.
    const isNoMeeting = false;

    const isNoTask = includesAny([
      "업무 생성 없이",
      "태스크 생성 없이",
      "작업 생성 없이",
      "sub task 없이",
      "delegation 없이",
      "하달 없이",
      "no task",
      "no delegation",
      "without delegation",
      "do not delegate",
      "don't delegate",
      "タスク作成なし",
      "タスク作成不要",
      "委任なし",
      "割り当てなし",
      "下達なし",
      "不创建任务",
      "无需创建任务",
      "不下达",
      "不委派",
      "不分配",
    ]);

    const hasLightweightSignal = includesAny([
      "응답 테스트",
      "응답테스트",
      "테스트 중",
      "테스트만",
      "ping",
      "헬스 체크",
      "health check",
      "status check",
      "상태 확인",
      "확인만",
      "ack test",
      "smoke test",
      "応答テスト",
      "応答確認",
      "テストのみ",
      "pingテスト",
      "状態確認",
      "動作確認",
      "响应测试",
      "响应确认",
      "仅测试",
      "测试一下",
      "状态检查",
      "健康检查",
      "ping测试",
    ]);

    const hasWorkSignal = includesAny([
      "업무",
      "작업",
      "하달",
      "착수",
      "실행",
      "진행",
      "작성",
      "수정",
      "구현",
      "배포",
      "리뷰",
      "검토",
      "정리",
      "조치",
      "할당",
      "태스크",
      "delegate",
      "assign",
      "implement",
      "deploy",
      "fix",
      "review",
      "plan",
      "subtask",
      "task",
      "handoff",
      "業務",
      "作業",
      "指示",
      "実行",
      "進行",
      "作成",
      "修正",
      "実装",
      "配布",
      "レビュー",
      "検討",
      "整理",
      "対応",
      "割当",
      "委任",
      "計画",
      "タスク",
      "任务",
      "工作",
      "下达",
      "执行",
      "进行",
      "编写",
      "修改",
      "实现",
      "部署",
      "评审",
      "审核",
      "处理",
      "分配",
      "委派",
      "计划",
      "子任务",
    ]);

    const isLightweight = hasLightweightSignal && !hasWorkSignal;
    const skipDelegation = isNoTask || isLightweight;
    const skipDelegationReason: DirectivePolicy["skipDelegationReason"] = isNoTask
      ? "no_task"
      : isLightweight
        ? "lightweight"
        : null;
    const skipPlannedMeeting = !skipDelegation && isNoMeeting;
    const skipPlanSubtasks = skipPlannedMeeting;

    return {
      skipDelegation,
      skipDelegationReason,
      skipPlannedMeeting,
      skipPlanSubtasks,
    };
  }

  function shouldExecuteDirectiveDelegation(policy: DirectivePolicy, explicitSkipPlannedMeeting: boolean): boolean {
    if (!policy.skipDelegation) return true;
    // If the user explicitly selected "skip meeting", still execute delegation for
    // lightweight/ping-like directives so the task is not silently dropped.
    if (explicitSkipPlannedMeeting && policy.skipDelegationReason === "lightweight") return true;
    return false;
  }

  // ---- Task delegation logic for team leaders ----

  function detectTargetDepartments(message: string): string[] {
    const found: string[] = [];
    for (const [deptId, keywords] of Object.entries(DEPT_KEYWORDS)) {
      for (const kw of keywords) {
        if (message.includes(kw)) {
          found.push(deptId);
          break;
        }
      }
    }
    return found;
  }

  /** Detect @mentions in messages — returns department IDs and agent IDs */
  function detectMentions(message: string): { deptIds: string[]; agentIds: string[] } {
    const deptIds: string[] = [];
    const agentIds: string[] = [];

    // Match @부서이름 patterns (both with and without 팀 suffix)
    const depts = db.prepare("SELECT id, name, name_ko FROM departments").all() as {
      id: string;
      name: string;
      name_ko: string;
    }[];
    for (const dept of depts) {
      const nameKo = dept.name_ko.replace("팀", "");
      if (
        message.includes(`@${dept.name_ko}`) ||
        message.includes(`@${nameKo}`) ||
        message.includes(`@${dept.name}`) ||
        message.includes(`@${dept.id}`)
      ) {
        deptIds.push(dept.id);
      }
    }

    // Match @에이전트이름 patterns
    const agents = db.prepare("SELECT id, name, name_ko FROM agents").all() as {
      id: string;
      name: string;
      name_ko: string | null;
    }[];
    for (const agent of agents) {
      if ((agent.name_ko && message.includes(`@${agent.name_ko}`)) || message.includes(`@${agent.name}`)) {
        agentIds.push(agent.id);
      }
    }

    return { deptIds, agentIds };
  }

  /** Handle mention-based delegation: create task in mentioned department */
  function handleMentionDelegation(originLeader: AgentRow, targetDeptId: string, ceoMessage: string, lang: Lang): void {
    const crossLeader = findTeamLeader(targetDeptId);
    if (!crossLeader) return;
    const crossDeptName = getDeptName(targetDeptId);
    const crossLeaderName = lang === "ko" ? crossLeader.name_ko || crossLeader.name : crossLeader.name;
    const originLeaderName = lang === "ko" ? originLeader.name_ko || originLeader.name : originLeader.name;
    const taskTitle = ceoMessage.length > 60 ? ceoMessage.slice(0, 57) + "..." : ceoMessage;

    // Origin team leader sends mention request to target team leader
    const mentionReq = pickL(
      l(
        [
          `${crossLeaderName}님! 대표님 지시입니다: "${taskTitle}" — ${crossDeptName}에서 처리 부탁드립니다! 🏷️`,
          `${crossLeaderName}님, 대표님이 직접 요청하셨습니다. "${taskTitle}" 건, ${crossDeptName} 담당으로 진행해주세요!`,
        ],
        [
          `${crossLeaderName}! CEO directive for ${crossDeptName}: "${taskTitle}" — please handle this! 🏷️`,
          `${crossLeaderName}, CEO requested this for your team: "${taskTitle}"`,
        ],
        [`${crossLeaderName}さん！CEO指示です："${taskTitle}" — ${crossDeptName}で対応お願いします！🏷️`],
        [`${crossLeaderName}，CEO指示："${taskTitle}" — 请${crossDeptName}处理！🏷️`],
      ),
      lang,
    );
    sendAgentMessage(originLeader, mentionReq, "task_assign", "agent", crossLeader.id, null);

    // Broadcast delivery animation event for UI
    broadcast("cross_dept_delivery", {
      from_agent_id: originLeader.id,
      to_agent_id: crossLeader.id,
      task_title: taskTitle,
    });

    // Target team leader acknowledges and delegates
    const ackDelay = 1500 + Math.random() * 1000;
    setTimeout(() => {
      // Use the full delegation flow for the target department
      handleTaskDelegation(crossLeader, ceoMessage, "");
    }, ackDelay);
  }

  function findBestSubordinate(
    deptId: string,
    excludeId: string,
    candidateAgentIds?: string[] | null,
  ): AgentRow | null {
    // candidateAgentIds가 지정되면 해당 목록에서만 선택 (manual 모드, 부서 고정)
    if (Array.isArray(candidateAgentIds)) {
      if (candidateAgentIds.length === 0) {
        return null;
      }
      const placeholders = candidateAgentIds.map(() => "?").join(",");
      const agents = db
        .prepare(
          `SELECT * FROM agents WHERE id IN (${placeholders}) AND department_id = ? AND id != ? AND role != 'team_leader' ORDER BY
         CASE status WHEN 'idle' THEN 0 WHEN 'break' THEN 1 WHEN 'working' THEN 2 ELSE 3 END,
         CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 WHEN 'intern' THEN 2 ELSE 3 END`,
        )
        .all(...candidateAgentIds, deptId, excludeId) as unknown as AgentRow[];
      return agents[0] ?? null;
    }
    // 기존 로직: 부서 전체에서 선택
    const agents = db
      .prepare(
        `SELECT * FROM agents WHERE department_id = ? AND id != ? AND role != 'team_leader' ORDER BY
       CASE status WHEN 'idle' THEN 0 WHEN 'break' THEN 1 WHEN 'working' THEN 2 ELSE 3 END,
       CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 WHEN 'intern' THEN 2 ELSE 3 END`,
      )
      .all(deptId, excludeId) as unknown as AgentRow[];
    return agents[0] ?? null;
  }

  function findTeamLeader(deptId: string | null): AgentRow | null {
    if (!deptId) return null;
    return (
      (db.prepare("SELECT * FROM agents WHERE department_id = ? AND role = 'team_leader' LIMIT 1").get(deptId) as
        | AgentRow
        | undefined) ?? null
    );
  }

  function getDeptName(deptId: string): string {
    const lang = getPreferredLanguage();
    const d = db.prepare("SELECT name, name_ko FROM departments WHERE id = ?").get(deptId) as
      | {
          name: string;
          name_ko: string;
        }
      | undefined;
    if (!d) return deptId;
    return lang === "ko" ? d.name_ko || d.name : d.name || d.name_ko || deptId;
  }

  // Role enforcement: restrict agents to their department's domain
  function getDeptRoleConstraint(deptId: string, deptName: string): string {
    const constraints: Record<string, string> = {
      planning: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Planning). Focus ONLY on planning, strategy, market analysis, requirements, and documentation. Do NOT write production code, create design assets, or run tests. If coding/design is needed, describe requirements and specifications instead.`,
      dev: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Development). Focus ONLY on coding, debugging, code review, and technical implementation. Do NOT create design mockups, write business strategy documents, or perform QA testing.`,
      design: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Design). Focus ONLY on UI/UX design, visual assets, design specs, and prototyping. Do NOT write production backend code, run tests, or make infrastructure changes.`,
      qa: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (QA/QC). Focus ONLY on testing, quality assurance, test automation, and bug reporting. Do NOT write production code or create design assets.`,
      devsecops: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (DevSecOps). Focus ONLY on infrastructure, security audits, CI/CD pipelines, container orchestration, and deployment. Do NOT write business logic or create design assets.`,
      operations: `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName} (Operations). Focus ONLY on operations, automation, monitoring, maintenance, and process optimization. Do NOT write production code or create design assets.`,
    };
    return (
      constraints[deptId] ||
      `IMPORTANT ROLE CONSTRAINT: You belong to ${deptName}. Focus on tasks within your department's expertise.`
    );
  }

  // ---------------------------------------------------------------------------
  // Subtask cross-department delegation: sequential by department,
  // one batched request per department.
  // ---------------------------------------------------------------------------
  const { formatTaskSubtaskProgressSummary, groupSubtasksByTargetDepartment, orderSubtaskQueuesByDepartment } =
    initializeSubtaskSummary({ db, l, pickL });

  function buildSubtaskDelegationPrompt(
    parentTask: {
      id: string;
      title: string;
      description: string | null;
      project_id: string | null;
      project_path: string | null;
    },
    assignedSubtasks: SubtaskRow[],
    execAgent: AgentRow,
    targetDeptId: string,
    targetDeptName: string,
  ): string {
    const lang = resolveLang(parentTask.description ?? parentTask.title);
    const assignedIds = new Set(assignedSubtasks.map((st) => st.id));
    const orderedChecklist = assignedSubtasks
      .map((st, idx) => {
        const detail = st.description ? ` - ${st.description}` : "";
        return `${idx + 1}. ${st.title}${detail}`;
      })
      .join("\n");

    // Gather all sibling subtasks for context
    const allSubtasks = db
      .prepare("SELECT id, title, status, target_department_id FROM subtasks WHERE task_id = ? ORDER BY created_at")
      .all(parentTask.id) as Array<{ id: string; title: string; status: string; target_department_id: string | null }>;

    const statusIcon: Record<string, string> = {
      done: "✅",
      in_progress: "🔨",
      pending: "⏳",
      blocked: "🔒",
    };

    const subtaskLines = allSubtasks
      .map((st) => {
        const icon = statusIcon[st.status] || "⏳";
        const parentDept = db.prepare("SELECT department_id FROM tasks WHERE id = ?").get(parentTask.id) as
          | { department_id: string | null }
          | undefined;
        const dept = st.target_department_id
          ? getDeptName(st.target_department_id)
          : getDeptName(parentDept?.department_id ?? "");
        const marker = assignedIds.has(st.id)
          ? pickL(l([" ← 당신의 담당"], [" <- assigned to you"], [" ← あなたの担当"], [" <- 你的负责项"]), lang)
          : "";
        return `${icon} ${st.title} (${dept} - ${st.status})${marker}`;
      })
      .join("\n");

    const roleLabel =
      { team_leader: "Team Leader", senior: "Senior", junior: "Junior", intern: "Intern" }[execAgent.role] ||
      execAgent.role;
    const deptConstraint = getDeptRoleConstraint(targetDeptId, targetDeptName);
    const deptPromptRaw = (
      db.prepare("SELECT prompt FROM departments WHERE id = ?").get(targetDeptId) as
        | { prompt?: string | null }
        | undefined
    )?.prompt;
    const deptPrompt = typeof deptPromptRaw === "string" ? deptPromptRaw.trim() : "";
    const deptPromptBlock = deptPrompt ? `[Department Shared Prompt]\n${deptPrompt}` : "";
    const conversationCtx = getRecentConversationContext(execAgent.id);
    const agentDisplayName = getAgentDisplayName(execAgent, lang);
    const header = pickL(
      l(
        [`[프로젝트 협업 업무 - ${targetDeptName}]`],
        [`[Project collaboration task - ${targetDeptName}]`],
        [`[プロジェクト協業タスク - ${targetDeptName}]`],
        [`[项目协作任务 - ${targetDeptName}]`],
      ),
      lang,
    );
    const originalTaskLabel = pickL(l(["원본 업무"], ["Original task"], ["元タスク"], ["原始任务"]), lang);
    const ceoRequestLabel = pickL(l(["CEO 요청"], ["CEO request"], ["CEO依頼"], ["CEO指示"]), lang);
    const allSubtasksLabel = pickL(
      l(["전체 서브태스크 현황"], ["All subtask status"], ["全サブタスク状況"], ["全部 SubTask 状态"]),
      lang,
    );
    const deptOwnedLabel = pickL(
      l(
        [`[${targetDeptName} 담당 업무 묶음]`],
        [`[${targetDeptName} owned batch]`],
        [`[${targetDeptName}担当タスク一式]`],
        [`[${targetDeptName}负责项集合]`],
      ),
      lang,
    );
    const checklistLabel = pickL(
      l(["순차 실행 체크리스트"], ["Sequential execution checklist"], ["順次実行チェックリスト"], ["顺序执行清单"]),
      lang,
    );
    const finalInstruction = pickL(
      l(
        [
          "위 순차 체크리스트를 1번부터 끝까지 순서대로 처리하고, 중간에 분할하지 말고 한 번의 작업 흐름으로 완료하세요.",
        ],
        [
          "Execute the checklist in order from 1 to end, and finish it in one continuous run without splitting into separate requests.",
        ],
        ["上記チェックリストを1番から順番に実行し、分割せず1回の作業フローで完了してください。"],
        ["请按 1 到末尾顺序执行清单，不要拆分为多次请求，在一次连续流程中完成。"],
      ),
      lang,
    );

    return buildTaskExecutionPrompt(
      [
        header,
        ``,
        `${originalTaskLabel}: ${parentTask.title}`,
        parentTask.description ? `${ceoRequestLabel}: ${parentTask.description}` : "",
        ``,
        `[${allSubtasksLabel}]`,
        subtaskLines,
        ``,
        deptOwnedLabel,
        `${checklistLabel}:`,
        orderedChecklist,
        conversationCtx ? `\n${conversationCtx}` : "",
        ``,
        `---`,
        `Agent: ${agentDisplayName} (${roleLabel}, ${targetDeptName})`,
        execAgent.personality ? `Personality: ${execAgent.personality}` : "",
        deptConstraint,
        deptPromptBlock,
        ``,
        finalInstruction,
      ],
      {
        allowWarningFix: hasExplicitWarningFixRequest(
          parentTask.title,
          parentTask.description,
          assignedSubtasks.map((st) => st.title).join(" / "),
          assignedSubtasks
            .map((st) => st.description)
            .filter((v): v is string => !!v)
            .join(" / "),
        ),
      },
    );
  }

  function hasOpenForeignSubtasks(taskId: string, targetDeptIds: string[] = []): boolean {
    const uniqueDeptIds = [...new Set(targetDeptIds.filter(Boolean))];
    if (uniqueDeptIds.length > 0) {
      const placeholders = uniqueDeptIds.map(() => "?").join(", ");
      const row = db
        .prepare(
          `
      SELECT 1
      FROM subtasks
      WHERE task_id = ?
        AND target_department_id IN (${placeholders})
        AND target_department_id IS NOT NULL
        AND status != 'done'
        AND (delegated_task_id IS NULL OR delegated_task_id = '')
      LIMIT 1
    `,
        )
        .get(taskId, ...uniqueDeptIds);
      return !!row;
    }

    const row = db
      .prepare(
        `
    SELECT 1
    FROM subtasks
    WHERE task_id = ?
      AND target_department_id IS NOT NULL
      AND status != 'done'
      AND (delegated_task_id IS NULL OR delegated_task_id = '')
    LIMIT 1
  `,
      )
      .get(taskId);
    return !!row;
  }

  function processSubtaskDelegations(taskId: string): void {
    if (subtaskDelegationDispatchInFlight.has(taskId)) return;

    const foreignSubtasks = db
      .prepare(
        "SELECT * FROM subtasks WHERE task_id = ? AND target_department_id IS NOT NULL AND (delegated_task_id IS NULL OR delegated_task_id = '') ORDER BY created_at",
      )
      .all(taskId) as unknown as SubtaskRow[];

    if (foreignSubtasks.length === 0) return;

    const parentTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | {
          id: string;
          title: string;
          description: string | null;
          project_id: string | null;
          project_path: string | null;
          department_id: string | null;
        }
      | undefined;
    if (!parentTask) return;
    const lang = resolveLang(parentTask.description ?? parentTask.title);
    const queues = orderSubtaskQueuesByDepartment(groupSubtasksByTargetDepartment(foreignSubtasks));
    const deptCount = queues.length;
    subtaskDelegationDispatchInFlight.add(taskId);
    subtaskDelegationCompletionNoticeSent.delete(parentTask.id);

    notifyCeo(
      pickL(
        l(
          [
            `'${parentTask.title}' 의 외부 부서 서브태스크 ${foreignSubtasks.length}건을 부서별 배치로 순차 위임합니다.`,
          ],
          [
            `Delegating ${foreignSubtasks.length} external-department subtasks for '${parentTask.title}' sequentially by department, one batched request at a time.`,
          ],
          [
            `'${parentTask.title}' の他部門サブタスク${foreignSubtasks.length}件を、部門ごとにバッチ化して順次委任します。`,
          ],
          [`将把'${parentTask.title}'的${foreignSubtasks.length}个外部门 SubTask 按部门批量后顺序委派。`],
        ),
        lang,
      ),
      taskId,
    );
    appendTaskLog(
      taskId,
      "system",
      `Subtask delegation mode: sequential_by_department_batched (queues=${deptCount}, items=${foreignSubtasks.length})`,
    );
    const runQueue = (index: number) => {
      if (index >= queues.length) {
        subtaskDelegationDispatchInFlight.delete(taskId);
        maybeNotifyAllSubtasksComplete(parentTask.id);
        return;
      }
      delegateSubtaskBatch(queues[index], index, queues.length, parentTask, () => {
        const nextDelay = 900 + Math.random() * 700;
        setTimeout(() => runQueue(index + 1), nextDelay);
      });
    };
    runQueue(0);
  }

  function maybeNotifyAllSubtasksComplete(parentTaskId: string): void {
    const remaining = db
      .prepare("SELECT COUNT(*) as cnt FROM subtasks WHERE task_id = ? AND status != 'done'")
      .get(parentTaskId) as { cnt: number };
    if (remaining.cnt !== 0 || subtaskDelegationCompletionNoticeSent.has(parentTaskId)) return;

    const parentTask = db.prepare("SELECT title, description, status FROM tasks WHERE id = ?").get(parentTaskId) as
      | {
          title: string;
          description: string | null;
          status: string;
        }
      | undefined;
    if (!parentTask) return;

    const lang = resolveLang(parentTask.description ?? parentTask.title);
    subtaskDelegationCompletionNoticeSent.add(parentTaskId);
    const subtaskProgressSummary = formatTaskSubtaskProgressSummary(parentTaskId, lang);
    const progressSuffix = subtaskProgressSummary
      ? `\n${pickL(l(["보완/협업 완료 현황"], ["Remediation/Collaboration completion"], ["補完/協業 完了状況"], ["整改/协作完成情况"]), lang)}\n${subtaskProgressSummary}`
      : "";
    notifyCeo(
      pickL(
        l(
          [`'${parentTask.title}' 의 모든 서브태스크(부서간 협업 포함)가 완료되었습니다. ✅${progressSuffix}`],
          [
            `All subtasks for '${parentTask.title}' (including cross-department collaboration) are complete. ✅${progressSuffix}`,
          ],
          [`'${parentTask.title}' の全サブタスク（部門間協業含む）が完了しました。✅${progressSuffix}`],
          [`'${parentTask.title}'的全部 SubTask（含跨部门协作）已完成。✅${progressSuffix}`],
        ),
        lang,
      ),
      parentTaskId,
    );
    if (parentTask.status === "review") {
      setTimeout(() => finishReview(parentTaskId, parentTask.title), 1200);
    }
  }

  function delegateSubtaskBatch(
    subtasks: SubtaskRow[],
    queueIndex: number,
    queueTotal: number,
    parentTask: {
      id: string;
      title: string;
      description: string | null;
      project_id: string | null;
      project_path: string | null;
      department_id: string | null;
    },
    onBatchDone?: () => void,
  ): void {
    const lang = resolveLang(parentTask.description ?? parentTask.title);
    if (subtasks.length === 0) {
      onBatchDone?.();
      return;
    }

    const targetDeptId = subtasks[0].target_department_id!;
    const targetDeptName = getDeptName(targetDeptId);
    const subtaskIds = subtasks.map((st) => st.id);
    const firstTitle = subtasks[0].title;
    const batchTitle = subtasks.length > 1 ? `${firstTitle} +${subtasks.length - 1}` : firstTitle;

    const crossLeader = findTeamLeader(targetDeptId);
    if (!crossLeader) {
      const doneAt = nowMs();
      for (const sid of subtaskIds) {
        db.prepare("UPDATE subtasks SET status = 'done', completed_at = ?, blocked_reason = NULL WHERE id = ?").run(
          doneAt,
          sid,
        );
        broadcast("subtask_update", db.prepare("SELECT * FROM subtasks WHERE id = ?").get(sid));
      }
      maybeNotifyAllSubtasksComplete(parentTask.id);
      onBatchDone?.();
      return;
    }

    const originLeader = findTeamLeader(parentTask.department_id);
    const originLeaderName = originLeader
      ? getAgentDisplayName(originLeader, lang)
      : pickL(l(["팀장"], ["Team Lead"], ["チームリーダー"], ["组长"]), lang);
    const crossLeaderName = getAgentDisplayName(crossLeader, lang);

    if (queueTotal > 1) {
      notifyCeo(
        pickL(
          l(
            [`서브태스크 배치 위임 진행: ${targetDeptName} (${queueIndex + 1}/${queueTotal}, ${subtasks.length}건)`],
            [
              `Batched subtask delegation in progress: ${targetDeptName} (${queueIndex + 1}/${queueTotal}, ${subtasks.length} item(s))`,
            ],
            [`サブタスク一括委任進行中: ${targetDeptName} (${queueIndex + 1}/${queueTotal}, ${subtasks.length}件)`],
            [`批量 SubTask 委派进行中：${targetDeptName}（${queueIndex + 1}/${queueTotal}，${subtasks.length}项）`],
          ),
          lang,
        ),
        parentTask.id,
      );
    }

    if (originLeader) {
      sendAgentMessage(
        originLeader,
        pickL(
          l(
            [
              `${crossLeaderName}님, '${parentTask.title}' 프로젝트의 서브태스크 ${subtasks.length}건(${batchTitle})을 순차 체크리스트로 일괄 처리 부탁드립니다! 🤝`,
            ],
            [
              `${crossLeaderName}, please process ${subtasks.length} subtasks (${batchTitle}) for '${parentTask.title}' as one sequential checklist in a single run. 🤝`,
            ],
            [
              `${crossLeaderName}さん、'${parentTask.title}' のサブタスク${subtasks.length}件（${batchTitle}）を順次チェックリストで一括対応お願いします！🤝`,
            ],
            [
              `${crossLeaderName}，请将'${parentTask.title}'的 ${subtasks.length} 个 SubTask（${batchTitle}）按顺序清单一次性处理！🤝`,
            ],
          ),
          lang,
        ),
        "chat",
        "agent",
        crossLeader.id,
        parentTask.id,
      );
    }

    broadcast("cross_dept_delivery", {
      from_agent_id: originLeader?.id || null,
      to_agent_id: crossLeader.id,
      task_title: batchTitle,
    });

    const ackDelay = 1500 + Math.random() * 1000;
    setTimeout(() => {
      const crossSub = findBestSubordinate(targetDeptId, crossLeader.id);
      const execAgent = crossSub || crossLeader;
      const execName = getAgentDisplayName(execAgent, lang);

      sendAgentMessage(
        crossLeader,
        crossSub
          ? pickL(
              l(
                [
                  `네, ${originLeaderName}님! ${subtasks.length}건(${batchTitle})을 ${execName}에게 일괄 배정해 순차 처리하겠습니다 👍`,
                ],
                [
                  `Got it, ${originLeaderName}! I'll assign ${subtasks.length} items (${batchTitle}) to ${execName} as one ordered batch. 👍`,
                ],
                [
                  `了解です、${originLeaderName}さん！${subtasks.length}件（${batchTitle}）を${execName}に一括割り当てて順次対応します 👍`,
                ],
                [
                  `收到，${originLeaderName}！将把 ${subtasks.length} 项（${batchTitle}）批量分配给 ${execName} 按顺序处理 👍`,
                ],
              ),
              lang,
            )
          : pickL(
              l(
                [`네, ${originLeaderName}님! ${subtasks.length}건(${batchTitle})을 제가 직접 순차 처리하겠습니다 👍`],
                [
                  `Understood, ${originLeaderName}! I'll handle ${subtasks.length} items (${batchTitle}) myself in order. 👍`,
                ],
                [`承知しました、${originLeaderName}さん！${subtasks.length}件（${batchTitle}）を私が順次対応します 👍`],
                [`明白，${originLeaderName}！这 ${subtasks.length} 项（${batchTitle}）由我按顺序亲自处理 👍`],
              ),
              lang,
            ),
        "chat",
        "agent",
        null,
        parentTask.id,
      );

      const delegatedTaskId = randomUUID();
      const ct = nowMs();
      const delegatedTitle = pickL(
        l(
          [`[서브태스크 일괄협업 x${subtasks.length}] ${batchTitle}`],
          [`[Batched Subtask Collaboration x${subtasks.length}] ${batchTitle}`],
          [`[サブタスク一括協業 x${subtasks.length}] ${batchTitle}`],
          [`[批量 SubTask 协作 x${subtasks.length}] ${batchTitle}`],
        ),
        lang,
      );
      const delegatedChecklist = subtasks.map((st, idx) => `${idx + 1}. ${st.title}`).join("\n");
      const delegatedDescription = pickL(
        l(
          [
            `[서브태스크 위임 from ${getDeptName(parentTask.department_id ?? "")}] ${parentTask.description || parentTask.title}\n\n[순차 체크리스트]\n${delegatedChecklist}`,
          ],
          [
            `[Subtasks delegated from ${getDeptName(parentTask.department_id ?? "")}] ${parentTask.description || parentTask.title}\n\n[Sequential checklist]\n${delegatedChecklist}`,
          ],
          [
            `[サブタスク委任元 ${getDeptName(parentTask.department_id ?? "")}] ${parentTask.description || parentTask.title}\n\n[順次チェックリスト]\n${delegatedChecklist}`,
          ],
          [
            `[SubTask 委派来源 ${getDeptName(parentTask.department_id ?? "")}] ${parentTask.description || parentTask.title}\n\n[顺序清单]\n${delegatedChecklist}`,
          ],
        ),
        lang,
      );
      db.prepare(
        `
      INSERT INTO tasks (id, title, description, department_id, project_id, status, priority, task_type, project_path, source_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planned', 1, 'general', ?, ?, ?, ?)
    `,
      ).run(
        delegatedTaskId,
        delegatedTitle,
        delegatedDescription,
        targetDeptId,
        parentTask.project_id ?? null,
        parentTask.project_path,
        parentTask.id,
        ct,
        ct,
      );
      recordTaskCreationAudit({
        taskId: delegatedTaskId,
        taskTitle: delegatedTitle,
        taskStatus: "planned",
        departmentId: targetDeptId,
        sourceTaskId: parentTask.id,
        taskType: "general",
        projectPath: parentTask.project_path ?? null,
        trigger: "workflow.subtask_batch_delegation",
        triggerDetail: `parent_task=${parentTask.id}; subtasks=${subtasks.length}; target_dept=${targetDeptId}`,
        actorType: "agent",
        actorId: crossLeader.id,
        actorName: crossLeader.name,
        body: {
          parent_task_id: parentTask.id,
          subtask_ids: subtaskIds,
          target_department_id: targetDeptId,
        },
      });
      if (parentTask.project_id) {
        db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(
          ct,
          ct,
          parentTask.project_id,
        );
      }
      appendTaskLog(delegatedTaskId, "system", `Subtask delegation from '${parentTask.title}' → ${targetDeptName}`);
      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(delegatedTaskId));

      const ct2 = nowMs();
      db.prepare(
        "UPDATE tasks SET assigned_agent_id = ?, status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?",
      ).run(execAgent.id, ct2, ct2, delegatedTaskId);
      db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(
        delegatedTaskId,
        execAgent.id,
      );
      appendTaskLog(delegatedTaskId, "system", `${crossLeaderName} → ${execName}`);

      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(delegatedTaskId));
      broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(execAgent.id));

      for (const sid of subtaskIds) {
        db.prepare(
          "UPDATE subtasks SET delegated_task_id = ?, status = 'in_progress', blocked_reason = NULL WHERE id = ?",
        ).run(delegatedTaskId, sid);
        broadcast("subtask_update", db.prepare("SELECT * FROM subtasks WHERE id = ?").get(sid));
      }
      delegatedTaskToSubtask.set(delegatedTaskId, subtaskIds[0]);
      if (onBatchDone) {
        subtaskDelegationCallbacks.set(delegatedTaskId, onBatchDone);
      }

      const execProvider = execAgent.cli_provider || "claude";
      if (["claude", "codex", "gemini", "opencode", "copilot", "antigravity", "api"].includes(execProvider)) {
        const projPath = resolveProjectPath({
          project_id: parentTask.project_id,
          project_path: parentTask.project_path,
          description: parentTask.description,
          title: parentTask.title,
        });
        const worktreePath = createWorktree(projPath, delegatedTaskId, execAgent.name);
        const agentCwd = worktreePath || projPath;
        if (worktreePath) {
          appendTaskLog(
            delegatedTaskId,
            "system",
            `Git worktree created: ${worktreePath} (branch: climpire/${delegatedTaskId.slice(0, 8)})`,
          );
        }
        const logFilePath = path.join(logsDir, `${delegatedTaskId}.log`);
        const spawnPrompt = buildSubtaskDelegationPrompt(parentTask, subtasks, execAgent, targetDeptId, targetDeptName);
        const executionSession = ensureTaskExecutionSession(delegatedTaskId, execAgent.id, execProvider);
        const worktreeNote = worktreePath
          ? `\nNOTE: You are working in an isolated Git worktree branch (climpire/${delegatedTaskId.slice(0, 8)}). Commit your changes normally.`
          : "";
        const sessionPrompt = [
          `[Task Session] id=${executionSession.sessionId} owner=${executionSession.agentId} provider=${executionSession.provider}`,
          "Task-scoped session: keep continuity only within this delegated task.",
          spawnPrompt,
          worktreeNote,
        ].join("\n");

        if (worktreePath && execProvider === "claude") {
          ensureClaudeMd(projPath, worktreePath);
        }

        appendTaskLog(delegatedTaskId, "system", `RUN start (agent=${execAgent.name}, provider=${execProvider})`);

        // For http/api providers, completion is handled internally via handleTaskRunComplete
        // which fires subtaskDelegationCallbacks. We wrap the existing callback to also
        // finalize subtask statuses (done/blocked) before advancing the queue.
        // For CLI providers (spawnCliAgent), child.on("close") → handleSubtaskDelegationBatchComplete
        // handles both subtask finalization and handleTaskRunComplete in one path.
        const wrapCallbackForHttpProvider = () => {
          const originalCallback = subtaskDelegationCallbacks.get(delegatedTaskId);
          subtaskDelegationCallbacks.set(delegatedTaskId, () => {
            // Finalize subtask statuses based on delegated task exit result
            const finishedTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(delegatedTaskId) as
              | { status: string }
              | undefined;
            if (!finishedTask || finishedTask.status === "cancelled" || finishedTask.status === "pending") {
              delegatedTaskToSubtask.delete(delegatedTaskId);
              appendTaskLog(
                delegatedTaskId,
                "system",
                `Delegated batch callback skipped (status=${finishedTask?.status ?? "missing"})`,
              );
              // Even on cancel/missing, advance the queue so remaining batches are not stalled.
              // Matches the defensive pattern in orchestration.ts handleTaskRunComplete failure path.
              if (originalCallback) originalCallback();
              return;
            }
            const succeeded = finishedTask?.status === "done" || finishedTask?.status === "review";
            const doneAt = nowMs();
            for (const sid of subtaskIds) {
              if (succeeded) {
                db.prepare(
                  "UPDATE subtasks SET status = 'done', completed_at = ?, blocked_reason = NULL WHERE id = ?",
                ).run(doneAt, sid);
              } else {
                db.prepare("UPDATE subtasks SET status = 'blocked', blocked_reason = ? WHERE id = ?").run(
                  "Delegated task failed",
                  sid,
                );
              }
              broadcast("subtask_update", db.prepare("SELECT * FROM subtasks WHERE id = ?").get(sid));
            }
            delegatedTaskToSubtask.delete(delegatedTaskId);
            if (succeeded) {
              const touchedParents = new Set<string>();
              for (const sid of subtaskIds) {
                const sub = db.prepare("SELECT task_id FROM subtasks WHERE id = ?").get(sid) as
                  | { task_id: string }
                  | undefined;
                if (sub?.task_id) touchedParents.add(sub.task_id);
              }
              for (const pid of touchedParents) maybeNotifyAllSubtasksComplete(pid);
            }
            // originalCallback is the onBatchDone registered at line 1611 — call it to advance the queue
            if (originalCallback) originalCallback();
          });
        };

        if (execProvider === "api") {
          wrapCallbackForHttpProvider();
          const controller = new AbortController();
          const fakePid = getNextHttpAgentPid();
          launchApiProviderAgent(
            delegatedTaskId,
            execAgent.api_provider_id ?? null,
            execAgent.api_model ?? null,
            sessionPrompt,
            agentCwd,
            logFilePath,
            controller,
            fakePid,
          );
        } else if (execProvider === "copilot" || execProvider === "antigravity") {
          wrapCallbackForHttpProvider();
          const controller = new AbortController();
          const fakePid = getNextHttpAgentPid();
          launchHttpAgent(
            delegatedTaskId,
            execProvider,
            sessionPrompt,
            agentCwd,
            logFilePath,
            controller,
            fakePid,
            execAgent.oauth_account_id ?? null,
          );
        } else {
          const delegateModelConfig = getProviderModelConfig();
          const delegateModel = delegateModelConfig[execProvider]?.model || undefined;
          const delegateReasoningLevel = delegateModelConfig[execProvider]?.reasoningLevel || undefined;
          const child = spawnCliAgent(
            delegatedTaskId,
            execProvider,
            sessionPrompt,
            agentCwd,
            logFilePath,
            delegateModel,
            delegateReasoningLevel,
          );
          child.on("close", (code: number | null) => {
            handleSubtaskDelegationBatchComplete(delegatedTaskId, subtaskIds, code ?? 1);
          });
        }

        const worktreeCeoNote = worktreePath
          ? pickL(
              l(
                [` (격리 브랜치: climpire/${delegatedTaskId.slice(0, 8)})`],
                [` (isolated branch: climpire/${delegatedTaskId.slice(0, 8)})`],
                [` (分離ブランチ: climpire/${delegatedTaskId.slice(0, 8)})`],
                [`（隔离分支: climpire/${delegatedTaskId.slice(0, 8)}）`],
              ),
              lang,
            )
          : "";
        notifyCeo(
          pickL(
            l(
              [
                `${targetDeptName} ${execName}가 서브태스크 ${subtasks.length}건 일괄 작업을 시작했습니다.${worktreeCeoNote}`,
              ],
              [
                `${targetDeptName} ${execName} started one batched run for ${subtasks.length} subtasks.${worktreeCeoNote}`,
              ],
              [
                `${targetDeptName}の${execName}がサブタスク${subtasks.length}件の一括作業を開始しました。${worktreeCeoNote}`,
              ],
              [`${targetDeptName} 的 ${execName} 已开始 ${subtasks.length} 个 SubTask 的批量处理。${worktreeCeoNote}`],
            ),
            lang,
          ),
          delegatedTaskId,
        );
        startProgressTimer(delegatedTaskId, delegatedTitle, targetDeptId);
      } else {
        onBatchDone?.();
      }
    }, ackDelay);
  }

  function finalizeDelegatedSubtasks(delegatedTaskId: string, subtaskIds: string[], exitCode: number): void {
    if (subtaskIds.length === 0) return;

    const pausedRun =
      exitCode !== 0 &&
      stopRequestedTasks.has(delegatedTaskId) &&
      stopRequestModeByTask.get(delegatedTaskId) === "pause";
    if (pausedRun) {
      appendTaskLog(
        delegatedTaskId,
        "system",
        "Delegated subtask finalization deferred (pause requested, waiting for resume)",
      );
      handleTaskRunComplete(delegatedTaskId, exitCode);
      return;
    }

    delegatedTaskToSubtask.delete(delegatedTaskId);
    handleTaskRunComplete(delegatedTaskId, exitCode);

    const lang = getPreferredLanguage();
    const blockedReason = pickL(
      l(["위임 작업 실패"], ["Delegated task failed"], ["委任タスク失敗"], ["委派任务失败"]),
      lang,
    );
    const doneAt = nowMs();
    const touchedParentTaskIds = new Set<string>();

    for (const subtaskId of subtaskIds) {
      const sub = db.prepare("SELECT task_id FROM subtasks WHERE id = ?").get(subtaskId) as
        | { task_id: string }
        | undefined;
      if (sub?.task_id) touchedParentTaskIds.add(sub.task_id);
      if (exitCode === 0) {
        db.prepare("UPDATE subtasks SET status = 'done', completed_at = ?, blocked_reason = NULL WHERE id = ?").run(
          doneAt,
          subtaskId,
        );
      } else {
        db.prepare("UPDATE subtasks SET status = 'blocked', blocked_reason = ? WHERE id = ?").run(
          blockedReason,
          subtaskId,
        );
      }
      broadcast("subtask_update", db.prepare("SELECT * FROM subtasks WHERE id = ?").get(subtaskId));
    }

    if (exitCode === 0) {
      for (const parentTaskId of touchedParentTaskIds) {
        maybeNotifyAllSubtasksComplete(parentTaskId);
      }
    }
  }

  function handleSubtaskDelegationComplete(delegatedTaskId: string, subtaskId: string, exitCode: number): void {
    finalizeDelegatedSubtasks(delegatedTaskId, [subtaskId], exitCode);
  }

  function handleSubtaskDelegationBatchComplete(delegatedTaskId: string, subtaskIds: string[], exitCode: number): void {
    finalizeDelegatedSubtasks(delegatedTaskId, subtaskIds, exitCode);
  }

  const collabCoordination = initializeCollabCoordination({
    ...__ctx,
    resolveLang,
    l,
    pickL,
    sendAgentMessage,
    findBestSubordinate,
    findTeamLeader,
    getDeptName,
    getDeptRoleConstraint,
    maybeNotifyAllSubtasksComplete,
  });
  const {
    reconcileCrossDeptSubtasks,
    recoverCrossDeptQueueAfterMissingCallback,
    startCrossDeptCooperation,
    detectProjectPath,
    resolveProjectPath,
    getLatestKnownProjectPath,
    getDefaultProjectRoot,
    resolveDirectiveProjectPath,
    stripReportRequestPrefix,
    detectReportOutputFormat,
    pickPlanningReportAssignee,
    handleReportRequest,
  } = collabCoordination;

  function handleTaskDelegation(
    teamLeader: AgentRow,
    ceoMessage: string,
    ceoMsgId: string,
    options: DelegationOptions = {},
  ): void {
    const lang = resolveLang(ceoMessage);
    const leaderName = lang === "ko" ? teamLeader.name_ko || teamLeader.name : teamLeader.name;
    const leaderDeptId = teamLeader.department_id!;
    const leaderDeptName = getDeptName(leaderDeptId);
    const skipPlannedMeeting = !!options.skipPlannedMeeting;
    const skipPlanSubtasks = !!options.skipPlanSubtasks;

    // --- Step 1: Team leader acknowledges (1~2 sec) ---
    const ackDelay = 1000 + Math.random() * 1000;
    setTimeout(() => {
      // 프로젝트 manual 모드 시 지정된 직원만 후보로 사용
      let projectCandidateAgentIds: string[] | null = null;
      if (options.projectId) {
        const proj = db.prepare("SELECT assignment_mode FROM projects WHERE id = ?").get(options.projectId) as
          | { assignment_mode?: string }
          | undefined;
        if (proj?.assignment_mode === "manual") {
          projectCandidateAgentIds = (
            db.prepare("SELECT agent_id FROM project_agents WHERE project_id = ?").all(options.projectId) as Array<{
              agent_id: string;
            }>
          ).map((r) => r.agent_id);
        }
      }
      const subordinate = findBestSubordinate(leaderDeptId, teamLeader.id, projectCandidateAgentIds);
      const manualFallbackToLeader = Array.isArray(projectCandidateAgentIds) && subordinate === null;

      const taskId = randomUUID();
      const t = nowMs();
      const taskTitle = ceoMessage.length > 60 ? ceoMessage.slice(0, 57) + "..." : ceoMessage;
      const selectedProject = resolveProjectFromOptions(options);
      const projectContextHint = normalizeTextField(options.projectContext) || selectedProject.coreGoal;
      const roundGoal = buildRoundGoal(selectedProject.coreGoal, ceoMessage);
      const { projectPath: detectedPathRaw, source: projectPathSource } = resolveDirectiveProjectPath(ceoMessage, {
        ...options,
        projectPath: options.projectPath ?? selectedProject.projectPath,
        projectContext: projectContextHint,
      });
      const detectedPath = detectedPathRaw || selectedProject.projectPath || null;
      const taskDescriptionLines = [`[CEO] ${ceoMessage}`];
      if (selectedProject.name) taskDescriptionLines.push(`[PROJECT] ${selectedProject.name}`);
      if (selectedProject.coreGoal) taskDescriptionLines.push(`[PROJECT CORE GOAL] ${selectedProject.coreGoal}`);
      taskDescriptionLines.push(`[ROUND GOAL] ${roundGoal}`);
      if (projectContextHint && projectContextHint !== selectedProject.coreGoal) {
        taskDescriptionLines.push(`[PROJECT CONTEXT] ${projectContextHint}`);
      }
      db.prepare(
        `
      INSERT INTO tasks (id, title, description, department_id, project_id, status, priority, task_type, project_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planned', 1, 'general', ?, ?, ?)
    `,
      ).run(taskId, taskTitle, taskDescriptionLines.join("\n"), leaderDeptId, selectedProject.id, detectedPath, t, t);
      recordTaskCreationAudit({
        taskId,
        taskTitle,
        taskStatus: "planned",
        departmentId: leaderDeptId,
        taskType: "general",
        projectPath: detectedPath ?? null,
        trigger: "workflow.delegation.ceo_message",
        triggerDetail: `skip_planned_meeting=${skipPlannedMeeting}; skip_plan_subtasks=${skipPlanSubtasks}`,
        actorType: "agent",
        actorId: teamLeader.id,
        actorName: teamLeader.name,
        body: {
          ceo_message: ceoMessage,
          options: {
            skip_planned_meeting: skipPlannedMeeting,
            skip_plan_subtasks: skipPlanSubtasks,
            project_id: selectedProject.id,
            project_context: projectContextHint,
            round_goal: roundGoal,
          },
        },
      });
      if (selectedProject.id) {
        db.prepare("UPDATE projects SET last_used_at = ?, updated_at = ? WHERE id = ?").run(t, t, selectedProject.id);
      }
      appendTaskLog(taskId, "system", `CEO → ${leaderName}: ${ceoMessage}`);
      if (selectedProject.id) {
        appendTaskLog(taskId, "system", `Project linked: ${selectedProject.name || selectedProject.id}`);
      }
      appendTaskLog(taskId, "system", `Round goal: ${roundGoal}`);
      if (detectedPath) {
        appendTaskLog(taskId, "system", `Project path resolved (${projectPathSource}): ${detectedPath}`);
      }
      if (projectContextHint) {
        appendTaskLog(taskId, "system", `Project context hint: ${projectContextHint}`);
      }
      if (manualFallbackToLeader) {
        appendTaskLog(
          taskId,
          "system",
          `Manual assignment fallback: no eligible subordinate found among ${(projectCandidateAgentIds ?? []).length} assigned agent(s). Team leader will execute.`,
        );
      }

      broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));

      const mentionedDepts = [...new Set(detectTargetDepartments(ceoMessage).filter((d) => d !== leaderDeptId))];
      const isPlanningLead = leaderDeptId === "planning";

      if (isPlanningLead) {
        const relatedLabel =
          mentionedDepts.length > 0
            ? mentionedDepts.map(getDeptName).join(", ")
            : pickL(l(["없음"], ["None"], ["なし"], ["无"]), lang);
        appendTaskLog(taskId, "system", `Planning pre-check related departments: ${relatedLabel}`);
        notifyCeo(
          pickL(
            l(
              [`[기획팀] '${taskTitle}' 유관부서 사전 파악 완료: ${relatedLabel}`],
              [`[Planning] Related departments identified for '${taskTitle}': ${relatedLabel}`],
              [`[企画] '${taskTitle}' の関連部門の事前把握が完了: ${relatedLabel}`],
              [`[企划] 已完成'${taskTitle}'相关部门预识别：${relatedLabel}`],
            ),
            lang,
          ),
          taskId,
        );
      }

      const runCrossDeptBeforeDelegationIfNeeded = (next: () => void) => {
        if (isTaskWorkflowInterrupted(taskId)) return;
        if (!(isPlanningLead && mentionedDepts.length > 0)) {
          next();
          return;
        }

        const crossDeptNames = mentionedDepts.map(getDeptName).join(", ");
        if (hasOpenForeignSubtasks(taskId, mentionedDepts)) {
          notifyCeo(
            pickL(
              l(
                [`[CEO OFFICE] 기획팀 선행 협업을 서브태스크 통합 디스패처로 실행합니다: ${crossDeptNames}`],
                [`[CEO OFFICE] Running planning pre-collaboration via unified subtask dispatcher: ${crossDeptNames}`],
                [`[CEO OFFICE] 企画先行協業を統合サブタスクディスパッチャで実行します: ${crossDeptNames}`],
                [`[CEO OFFICE] 企划前置协作改为统一 SubTask 调度执行：${crossDeptNames}`],
              ),
              lang,
            ),
            taskId,
          );
          appendTaskLog(
            taskId,
            "system",
            `Planning pre-collaboration unified to batched subtask dispatch (${crossDeptNames})`,
          );
          processSubtaskDelegations(taskId);
          next();
          return;
        }

        notifyCeo(
          pickL(
            l(
              [`[CEO OFFICE] 기획팀 선행 협업 처리 시작: ${crossDeptNames}`],
              [`[CEO OFFICE] Planning pre-collaboration started with: ${crossDeptNames}`],
              [`[CEO OFFICE] 企画チームの先行協業を開始: ${crossDeptNames}`],
              [`[CEO OFFICE] 企划团队前置协作已启动：${crossDeptNames}`],
            ),
            lang,
          ),
          taskId,
        );
        // Mark original task as 'collaborating' while cross-dept work proceeds
        db.prepare("UPDATE tasks SET status = 'collaborating', updated_at = ? WHERE id = ?").run(nowMs(), taskId);
        broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));

        startCrossDeptCooperation(
          mentionedDepts,
          0,
          { teamLeader, taskTitle, ceoMessage, leaderDeptId, leaderDeptName, leaderName, lang, taskId },
          () => {
            if (isTaskWorkflowInterrupted(taskId)) return;
            notifyCeo(
              pickL(
                l(
                  ["[CEO OFFICE] 유관부서 선행 처리 완료. 이제 내부 업무 하달을 시작합니다."],
                  ["[CEO OFFICE] Related-department pre-processing complete. Starting internal delegation now."],
                  ["[CEO OFFICE] 関連部門の先行処理が完了。これより内部委任を開始します。"],
                  ["[CEO OFFICE] 相关部门前置处理完成，现开始内部下达。"],
                ),
                lang,
              ),
              taskId,
            );
            next();
          },
        );
      };

      const runCrossDeptAfterMainIfNeeded = () => {
        if (isPlanningLead || mentionedDepts.length === 0) return;
        const crossDelay = 3000 + Math.random() * 1000;
        setTimeout(() => {
          if (isTaskWorkflowInterrupted(taskId)) return;
          if (hasOpenForeignSubtasks(taskId, mentionedDepts)) {
            appendTaskLog(
              taskId,
              "system",
              `Cross-dept collaboration unified to batched subtask dispatch (${mentionedDepts.map(getDeptName).join(", ")})`,
            );
            processSubtaskDelegations(taskId);
            return;
          }
          // Only set 'collaborating' if the task hasn't already moved to 'in_progress' (avoid status regression)
          const currentTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as
            | { status: string }
            | undefined;
          if (currentTask && currentTask.status !== "in_progress") {
            db.prepare("UPDATE tasks SET status = 'collaborating', updated_at = ? WHERE id = ?").run(nowMs(), taskId);
            broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
          }
          startCrossDeptCooperation(mentionedDepts, 0, {
            teamLeader,
            taskTitle,
            ceoMessage,
            leaderDeptId,
            leaderDeptName,
            leaderName,
            lang,
            taskId,
          });
        }, crossDelay);
      };

      const runPlanningPhase = (afterPlan: () => void) => {
        if (isTaskWorkflowInterrupted(taskId)) return;
        if (skipPlannedMeeting) {
          appendTaskLog(taskId, "system", "Planned meeting skipped by CEO directive");
          if (!skipPlanSubtasks) {
            seedApprovedPlanSubtasks(taskId, leaderDeptId, []);
          }
          runCrossDeptBeforeDelegationIfNeeded(afterPlan);
          return;
        }
        startPlannedApprovalMeeting(taskId, taskTitle, leaderDeptId, (planningNotes: string[]) => {
          if (isTaskWorkflowInterrupted(taskId)) return;
          if (!skipPlanSubtasks) {
            seedApprovedPlanSubtasks(taskId, leaderDeptId, planningNotes ?? []);
          }
          runCrossDeptBeforeDelegationIfNeeded(afterPlan);
        });
      };

      if (subordinate) {
        const subName = lang === "ko" ? subordinate.name_ko || subordinate.name : subordinate.name;
        const subRole = getRoleLabel(subordinate.role, lang);

        let ackMsg: string;
        if (skipPlannedMeeting && isPlanningLead && mentionedDepts.length > 0) {
          const crossDeptNames = mentionedDepts.map(getDeptName).join(", ");
          ackMsg = pickL(
            l(
              [
                `네, 대표님! 팀장 계획 회의는 생략하고 ${crossDeptNames} 유관부서 사전 조율 후 ${subRole} ${subName}에게 즉시 하달하겠습니다. 📋`,
              ],
              [
                `Understood. We'll skip the leaders' planning meeting, coordinate quickly with ${crossDeptNames}, then delegate immediately to ${subRole} ${subName}. 📋`,
              ],
              [
                `了解しました。リーダー計画会議は省略し、${crossDeptNames} と事前調整後に ${subRole} ${subName} へ即時委任します。📋`,
              ],
              [`收到。将跳过负责人规划会议，先与${crossDeptNames}快速协同后立即下达给${subRole} ${subName}。📋`],
            ),
            lang,
          );
        } else if (skipPlannedMeeting && mentionedDepts.length > 0) {
          const crossDeptNames = mentionedDepts.map(getDeptName).join(", ");
          ackMsg = pickL(
            l(
              [
                `네, 대표님! 팀장 계획 회의 없이 바로 ${subRole} ${subName}에게 하달하고 ${crossDeptNames} 협업을 병행하겠습니다. 📋`,
              ],
              [
                `Understood. We'll skip the planning meeting, delegate directly to ${subRole} ${subName}, and coordinate with ${crossDeptNames} in parallel. 📋`,
              ],
              [
                `了解しました。計画会議なしで ${subRole} ${subName} へ直ちに委任し、${crossDeptNames} との協業を並行します。📋`,
              ],
              [`收到。跳过规划会议，直接下达给${subRole} ${subName}，并并行推进${crossDeptNames}协作。📋`],
            ),
            lang,
          );
        } else if (skipPlannedMeeting) {
          ackMsg = pickL(
            l(
              [`네, 대표님! 팀장 계획 회의는 생략하고 ${subRole} ${subName}에게 즉시 하달하겠습니다. 📋`],
              [
                `Understood. We'll skip the leaders' planning meeting and delegate immediately to ${subRole} ${subName}. 📋`,
              ],
              [`了解しました。リーダー計画会議は省略し、${subRole} ${subName} へ即時委任します。📋`],
              [`收到。将跳过负责人规划会议，立即下达给${subRole} ${subName}。📋`],
            ),
            lang,
          );
        } else if (isPlanningLead && mentionedDepts.length > 0) {
          const crossDeptNames = mentionedDepts.map(getDeptName).join(", ");
          ackMsg = pickL(
            l(
              [
                `네, 대표님! 먼저 ${crossDeptNames} 유관부서 목록을 확정하고 회의/선행 협업을 완료한 뒤 ${subRole} ${subName}에게 하달하겠습니다. 📋`,
                `알겠습니다! 기획팀에서 유관부서 선처리까지 마친 뒤 ${subName}에게 최종 하달하겠습니다.`,
              ],
              [
                `Understood. I'll first confirm related departments (${crossDeptNames}), finish cross-team pre-processing, then delegate to ${subRole} ${subName}. 📋`,
              ],
              [
                `了解しました。まず関連部門（${crossDeptNames}）を確定し、先行協業完了後に${subRole} ${subName}へ委任します。📋`,
              ],
              [`收到。先确认相关部门（${crossDeptNames}）并完成前置协作后，再下达给${subRole} ${subName}。📋`],
            ),
            lang,
          );
        } else if (mentionedDepts.length > 0) {
          const crossDeptNames = mentionedDepts.map(getDeptName).join(", ");
          ackMsg = pickL(
            l(
              [
                `네, 대표님! 먼저 팀장 계획 회의를 진행한 뒤 ${subRole} ${subName}에게 하달하고, ${crossDeptNames} 협업도 연계하겠습니다. 📋`,
                `알겠습니다! 팀장 계획 회의에서 착수안 정리 완료 후 ${subName} 배정과 ${crossDeptNames} 협업 조율을 진행하겠습니다 🤝`,
              ],
              [
                `Understood. We'll run the team-lead planning meeting first, then delegate to ${subRole} ${subName} and coordinate with ${crossDeptNames}. 📋`,
                `Got it. After the leaders' planning meeting, I'll assign ${subName} and sync with ${crossDeptNames}. 🤝`,
              ],
              [
                `了解しました。まずチームリーダー計画会議を行い、その後 ${subRole} ${subName} へ委任し、${crossDeptNames} との協業も調整します。📋`,
              ],
              [`收到。先进行团队负责人规划会议，再下达给${subRole} ${subName}，并协调${crossDeptNames}协作。📋`],
            ),
            lang,
          );
        } else {
          ackMsg = pickL(
            l(
              [
                `네, 대표님! 먼저 팀장 계획 회의를 소집하고, 회의 결과 정리 후 ${subRole} ${subName}에게 하달하겠습니다. 📋`,
                `알겠습니다! 우리 팀 ${subName}가 적임자이며, 팀장 계획 회의 종료 후 순차적으로 지시하겠습니다.`,
                `확인했습니다, 대표님! 팀장 계획 회의 후 ${subName}에게 전달하고 진행 관리하겠습니다.`,
              ],
              [
                `Understood. I'll convene the team-lead planning meeting first, then assign to ${subRole} ${subName} after the planning output is finalized. 📋`,
                `Got it. ${subName} is the best fit, and I'll delegate in sequence after the leaders' planning meeting concludes.`,
                `Confirmed. After the leaders' planning meeting, I'll hand this off to ${subName} and manage execution.`,
              ],
              [
                `了解しました。まずチームリーダー計画会議を招集し、会議結果整理後に ${subRole} ${subName} へ委任します。📋`,
                `承知しました。${subName} が最適任なので、会議終了後に順次指示します。`,
              ],
              [
                `收到。先召集团队负责人规划会议，整理结论后再分配给${subRole} ${subName}。📋`,
                `明白。${subName}最合适，会在会议结束后按顺序下达。`,
              ],
            ),
            lang,
          );
        }
        sendAgentMessage(teamLeader, ackMsg, "chat", "agent", null, taskId);

        const delegateToSubordinate = () => {
          // --- Step 2: Delegate to subordinate (2~3 sec) ---
          const delegateDelay = 2000 + Math.random() * 1000;
          setTimeout(() => {
            if (isTaskWorkflowInterrupted(taskId)) return;
            const t2 = nowMs();
            db.prepare("UPDATE tasks SET assigned_agent_id = ?, status = 'planned', updated_at = ? WHERE id = ?").run(
              subordinate.id,
              t2,
              taskId,
            );
            db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(taskId, subordinate.id);
            appendTaskLog(taskId, "system", `${leaderName} → ${subName}`);

            broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
            broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(subordinate.id));

            const delegateMsg = pickL(
              l(
                [
                  `${subName}, 대표님 지시사항이야. "${ceoMessage}" — 확인하고 진행해줘!`,
                  `${subName}! 긴급 업무야. "${ceoMessage}" — 우선순위 높게 처리 부탁해.`,
                  `${subName}, 새 업무 할당이야: "${ceoMessage}" — 진행 상황 수시로 공유해줘 👍`,
                ],
                [
                  `${subName}, directive from the CEO: "${ceoMessage}" — please handle this!`,
                  `${subName}! Priority task: "${ceoMessage}" — needs immediate attention.`,
                  `${subName}, new assignment: "${ceoMessage}" — keep me posted on progress 👍`,
                ],
                [
                  `${subName}、CEOからの指示だよ。"${ceoMessage}" — 確認して進めて！`,
                  `${subName}！優先タスク: "${ceoMessage}" — よろしく頼む 👍`,
                ],
                [
                  `${subName}，CEO的指示："${ceoMessage}" — 请跟进处理！`,
                  `${subName}！优先任务："${ceoMessage}" — 随时更新进度 👍`,
                ],
              ),
              lang,
            );
            sendAgentMessage(teamLeader, delegateMsg, "task_assign", "agent", subordinate.id, taskId);

            // --- Step 3: Subordinate acknowledges (1~2 sec) ---
            const subAckDelay = 1000 + Math.random() * 1000;
            setTimeout(() => {
              if (isTaskWorkflowInterrupted(taskId)) return;
              const leaderRole = getRoleLabel(teamLeader.role, lang);
              const subAckMsg = pickL(
                l(
                  [
                    `네, ${leaderRole} ${leaderName}님! 확인했습니다. 바로 착수하겠습니다! 💪`,
                    `알겠습니다! 바로 시작하겠습니다. 진행 상황 공유 드리겠습니다.`,
                    `확인했습니다, ${leaderName}님! 최선을 다해 처리하겠습니다 🔥`,
                  ],
                  [
                    `Yes, ${leaderName}! Confirmed. Starting right away! 💪`,
                    `Got it! On it now. I'll keep you updated on progress.`,
                    `Confirmed, ${leaderName}! I'll give it my best 🔥`,
                  ],
                  [`はい、${leaderName}さん！了解しました。すぐ取りかかります！💪`, `承知しました！進捗共有します 🔥`],
                  [`好的，${leaderName}！收到，马上开始！💪`, `明白了！会及时汇报进度 🔥`],
                ),
                lang,
              );
              sendAgentMessage(subordinate, subAckMsg, "chat", "agent", null, taskId);
              startTaskExecutionForAgent(taskId, subordinate, leaderDeptId, leaderDeptName);
              runCrossDeptAfterMainIfNeeded();
            }, subAckDelay);
          }, delegateDelay);
        };

        runPlanningPhase(delegateToSubordinate);
      } else {
        // No subordinate — team leader handles it themselves
        if (manualFallbackToLeader) {
          notifyCeo(
            pickL(
              l(
                [
                  `[CEO OFFICE] 수동 배정 안전장치 적용: 지정 직원 중 실행 가능한 하위 직원이 없어 팀장(${leaderName})이 직접 수행합니다.`,
                ],
                [
                  `[CEO OFFICE] Manual assignment safeguard applied: no eligible subordinate in assigned agents, so team leader (${leaderName}) will execute directly.`,
                ],
                [
                  `[CEO OFFICE] 手動割り当ての安全装置を適用: 指定エージェントに実行可能なサブ担当がいないため、チームリーダー (${leaderName}) が直接実行します。`,
                ],
                [
                  `[CEO OFFICE] 已应用手动分配安全机制：指定员工中无可执行的下属成员，由组长（${leaderName}）直接执行。`,
                ],
              ),
              lang,
            ),
            taskId,
          );
        }
        const selfMsg = skipPlannedMeeting
          ? pickL(
              l(
                [`네, 대표님! 팀장 계획 회의는 생략하고 팀 내 가용 인력이 없어 제가 즉시 직접 처리하겠습니다. 💪`],
                [
                  `Understood. We'll skip the leaders' planning meeting and I'll execute this directly right away since no assignee is available. 💪`,
                ],
                [`了解しました。リーダー計画会議は省略し、空き要員がいないため私が即時対応します。💪`],
                [`收到。将跳过负责人规划会议，因无可用成员由我立即亲自处理。💪`],
              ),
              lang,
            )
          : pickL(
              l(
                [
                  `네, 대표님! 먼저 팀장 계획 회의를 진행하고, 팀 내 가용 인력이 없어 회의 정리 후 제가 직접 처리하겠습니다. 💪`,
                  `알겠습니다! 팀장 계획 회의 완료 후 제가 직접 진행하겠습니다.`,
                ],
                [
                  `Understood. We'll complete the team-lead planning meeting first, and since no one is available I'll execute it myself after the plan is organized. 💪`,
                  `Got it. I'll proceed personally after the leaders' planning meeting.`,
                ],
                [
                  `了解しました。まずチームリーダー計画会議を行い、空き要員がいないため会議整理後は私が直接対応します。💪`,
                ],
                [`收到。先进行团队负责人规划会议，因无可用成员，会议整理后由我亲自执行。💪`],
              ),
              lang,
            );
        sendAgentMessage(teamLeader, selfMsg, "chat", "agent", null, taskId);

        const t2 = nowMs();
        db.prepare("UPDATE tasks SET assigned_agent_id = ?, status = 'planned', updated_at = ? WHERE id = ?").run(
          teamLeader.id,
          t2,
          taskId,
        );
        db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(taskId, teamLeader.id);
        appendTaskLog(taskId, "system", `${leaderName} self-assigned (planned)`);

        broadcast("task_update", db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
        broadcast("agent_status", db.prepare("SELECT * FROM agents WHERE id = ?").get(teamLeader.id));

        runPlanningPhase(() => {
          if (isTaskWorkflowInterrupted(taskId)) return;
          startTaskExecutionForAgent(taskId, teamLeader, leaderDeptId, leaderDeptName);
          runCrossDeptAfterMainIfNeeded();
        });
      }
    }, ackDelay);
  }

  const { scheduleAgentReply } = createDirectChatHandlers({
    db,
    logsDir,
    nowMs,
    randomDelay,
    broadcast,
    appendTaskLog,
    recordTaskCreationAudit,
    resolveLang,
    resolveProjectPath,
    detectProjectPath,
    normalizeTextField,
    resolveProjectFromOptions,
    buildRoundGoal,
    getDeptName,
    l,
    pickL,
    sendAgentMessage,
    chooseSafeReply,
    buildCliFailureMessage,
    buildDirectReplyPrompt,
    runAgentOneShot,
    executeApiProviderAgent,
    executeCopilotAgent,
    executeAntigravityAgent,
    isTaskWorkflowInterrupted,
    startTaskExecutionForAgent,
    handleTaskDelegation,
  });

  return {
    DEPT_KEYWORDS,
    sendAgentMessage,
    getPreferredLanguage,
    resolveLang,
    detectLang,
    l,
    pickL,
    getRoleLabel,
    scheduleAnnouncementReplies,
    normalizeTextField,
    analyzeDirectivePolicy,
    shouldExecuteDirectiveDelegation,
    detectTargetDepartments,
    detectMentions,
    handleMentionDelegation,
    findTeamLeader,
    getDeptName,
    getDeptRoleConstraint,
    formatTaskSubtaskProgressSummary,
    processSubtaskDelegations,
    reconcileCrossDeptSubtasks,
    recoverCrossDeptQueueAfterMissingCallback,
    resolveProjectPath,
    handleReportRequest,
    handleTaskDelegation,
    scheduleAgentReply,
  };
}
