import type { Agent, AgentRole, Department, RoomTheme, WorkflowPackKey } from "../types";

export type UiLanguageLike = "ko" | "en" | "ja" | "zh";

type Localized = { ko: string; en: string; ja: string; zh: string };
type DeptPreset = {
  name: Localized;
  icon: string;
  agentPrefix: Localized;
  avatarPool: string[];
};

type StaffPreset = {
  nonLeaderDeptCycle: string[];
  roleTitles?: Partial<Record<AgentRole, Localized>>;
};

type PackPreset = {
  key: WorkflowPackKey;
  label: Localized;
  summary: Localized;
  roomThemes: Record<string, RoomTheme>;
  departments: Partial<Record<string, DeptPreset>>;
  staff?: StaffPreset;
};

type OfficePackPresentation = {
  departments: Department[];
  agents: Agent[];
  roomThemes: Record<string, RoomTheme>;
};

const DEV_THEMES: Record<string, RoomTheme> = {
  ceoOffice: { floor1: 0xe5d9b9, floor2: 0xdfd0a8, wall: 0x998243, accent: 0xa77d0c },
  planning: { floor1: 0xf0e1c5, floor2: 0xeddaba, wall: 0xae9871, accent: 0xd4a85a },
  dev: { floor1: 0xd8e8f5, floor2: 0xcce1f2, wall: 0x6c96b7, accent: 0x5a9fd4 },
  design: { floor1: 0xe8def2, floor2: 0xe1d4ee, wall: 0x9378ad, accent: 0x9a6fc4 },
  qa: { floor1: 0xf0cbcb, floor2: 0xedc0c0, wall: 0xae7979, accent: 0xd46a6a },
  devsecops: { floor1: 0xf0d5c5, floor2: 0xedcdba, wall: 0xae8871, accent: 0xd4885a },
  operations: { floor1: 0xd0eede, floor2: 0xc4ead5, wall: 0x6eaa89, accent: 0x5ac48a },
  breakRoom: { floor1: 0xf7e2b7, floor2: 0xf6dead, wall: 0xa99c83, accent: 0xf0c878 },
};

const PACK_PRESETS: Record<WorkflowPackKey, PackPreset> = {
  development: {
    key: "development",
    label: {
      ko: "개발 오피스",
      en: "Development Office",
      ja: "開発オフィス",
      zh: "开发办公室",
    },
    summary: {
      ko: "기본 개발 조직 구조",
      en: "Default engineering organization",
      ja: "標準の開発組織",
      zh: "默认开发组织",
    },
    roomThemes: DEV_THEMES,
    departments: {},
  },
  report: {
    key: "report",
    label: {
      ko: "보고서 오피스",
      en: "Report Office",
      ja: "レポートオフィス",
      zh: "报告办公室",
    },
    summary: {
      ko: "리서치/문서화 중심 팀 구성",
      en: "Research and documentation focused crew",
      ja: "調査・文書化中心の構成",
      zh: "以调研与文档为核心的团队",
    },
    roomThemes: {
      ceoOffice: { floor1: 0xf0e8dc, floor2: 0xebdfce, wall: 0x8f7a63, accent: 0xbd8b57 },
      planning: { floor1: 0xe6ecf6, floor2: 0xdde5f1, wall: 0x5f7394, accent: 0x7090bd },
      dev: { floor1: 0xe7f0ed, floor2: 0xddeae5, wall: 0x5c7d73, accent: 0x6ea495 },
      design: { floor1: 0xf4ecf4, floor2: 0xece2ed, wall: 0x82658a, accent: 0xa076ab },
      qa: { floor1: 0xf8efe9, floor2: 0xf0e3d8, wall: 0x8c6c5f, accent: 0xb67b63 },
      devsecops: { floor1: 0xe8edf0, floor2: 0xdee5ea, wall: 0x596778, accent: 0x6f85a0 },
      operations: { floor1: 0xe9f1e7, floor2: 0xe0ebdc, wall: 0x5f7d5b, accent: 0x76a06b },
      breakRoom: { floor1: 0xf5efe4, floor2: 0xede4d3, wall: 0x8f866d, accent: 0xc2a26b },
    },
    departments: {
      planning: {
        name: { ko: "편집기획실", en: "Editorial Planning", ja: "編集企画室", zh: "编辑企划室" },
        icon: "📚",
        agentPrefix: { ko: "편집 PM", en: "Editorial PM", ja: "編集PM", zh: "编辑PM" },
        avatarPool: ["📚", "🗂️", "🧭"],
      },
      dev: {
        name: { ko: "리서치엔진팀", en: "Research Engine", ja: "リサーチエンジン", zh: "调研引擎组" },
        icon: "🧠",
        agentPrefix: { ko: "리서처", en: "Researcher", ja: "リサーチャー", zh: "研究员" },
        avatarPool: ["🧠", "📊", "📝"],
      },
      design: {
        name: { ko: "문서디자인팀", en: "Doc Design", ja: "ドキュメントデザイン", zh: "文档设计组" },
        icon: "🧾",
        agentPrefix: { ko: "문서 디자이너", en: "Doc Designer", ja: "資料デザイナー", zh: "文档设计师" },
        avatarPool: ["🧾", "🎨", "📐"],
      },
      qa: {
        name: { ko: "검수팀", en: "Review Desk", ja: "レビュー班", zh: "审校组" },
        icon: "🔎",
        agentPrefix: { ko: "검수관", en: "Reviewer", ja: "レビュア", zh: "审校员" },
        avatarPool: ["🔎", "✅", "🧪"],
      },
    },
    staff: {
      nonLeaderDeptCycle: ["planning", "planning", "dev", "qa", "design", "planning", "dev", "qa", "operations"],
    },
  },
  web_research_report: {
    key: "web_research_report",
    label: {
      ko: "웹 리서치 오피스",
      en: "Web Research Office",
      ja: "Web調査オフィス",
      zh: "网页调研办公室",
    },
    summary: {
      ko: "소스 수집과 근거 검증 중심",
      en: "Source collection and citation verification",
      ja: "情報源収集と根拠検証中心",
      zh: "以来源收集与证据校验为核心",
    },
    roomThemes: {
      ceoOffice: { floor1: 0xddebf1, floor2: 0xd2e3eb, wall: 0x4e6f7f, accent: 0x3d90b5 },
      planning: { floor1: 0xe2eef6, floor2: 0xd8e7f1, wall: 0x55728d, accent: 0x5f95c6 },
      dev: { floor1: 0xe2f1ef, floor2: 0xd8ebe8, wall: 0x4d7a72, accent: 0x4fa69a },
      design: { floor1: 0xeceff7, floor2: 0xe2e8f2, wall: 0x606c88, accent: 0x748ec5 },
      qa: { floor1: 0xf0f3f7, floor2: 0xe6ecf2, wall: 0x5d6f80, accent: 0x7a93b0 },
      devsecops: { floor1: 0xe4edf5, floor2: 0xd9e4ef, wall: 0x4e617a, accent: 0x5f7fa5 },
      operations: { floor1: 0xe5f3ec, floor2: 0xdbeadf, wall: 0x52755d, accent: 0x5fa777 },
      breakRoom: { floor1: 0xe8f0f4, floor2: 0xdce8ef, wall: 0x5f7380, accent: 0x7ca0b9 },
    },
    departments: {
      planning: {
        name: { ko: "조사전략실", en: "Research Strategy", ja: "調査戦略室", zh: "调研战略室" },
        icon: "🧭",
        agentPrefix: { ko: "전략 분석가", en: "Strategy Analyst", ja: "戦略アナリスト", zh: "策略分析师" },
        avatarPool: ["🧭", "🗺️", "📌"],
      },
      dev: {
        name: { ko: "크롤링팀", en: "Crawler Team", ja: "クロール班", zh: "爬取组" },
        icon: "🕸️",
        agentPrefix: { ko: "수집 엔지니어", en: "Collection Engineer", ja: "収集エンジニア", zh: "采集工程师" },
        avatarPool: ["🕸️", "🔗", "🧠"],
      },
      qa: {
        name: { ko: "팩트체크팀", en: "Fact Check", ja: "ファクトチェック", zh: "事实核验组" },
        icon: "✅",
        agentPrefix: { ko: "검증관", en: "Verifier", ja: "検証官", zh: "核验员" },
        avatarPool: ["✅", "🔍", "📎"],
      },
    },
    staff: {
      nonLeaderDeptCycle: ["planning", "dev", "qa", "dev", "planning", "qa", "operations", "devsecops"],
    },
  },
  novel: {
    key: "novel",
    label: {
      ko: "소설 스튜디오",
      en: "Novel Studio",
      ja: "小説スタジオ",
      zh: "小说工作室",
    },
    summary: {
      ko: "세계관/캐릭터/서사 중심 구성",
      en: "Worldbuilding, character and narrative setup",
      ja: "世界観・キャラ・物語中心",
      zh: "世界观/角色/叙事导向",
    },
    roomThemes: {
      ceoOffice: { floor1: 0xefe3d8, floor2: 0xe7d6c9, wall: 0x7c5d4b, accent: 0xb86b45 },
      planning: { floor1: 0xf2e7dc, floor2: 0xebddcf, wall: 0x7f624e, accent: 0xb97c4f },
      dev: { floor1: 0xe8e0f2, floor2: 0xdfd6eb, wall: 0x6e5a90, accent: 0x8d76bb },
      design: { floor1: 0xf6e3ea, floor2: 0xf0d8e1, wall: 0x885a6d, accent: 0xbc708f },
      qa: { floor1: 0xf3ece4, floor2: 0xece1d7, wall: 0x7f6b5a, accent: 0xa88468 },
      devsecops: { floor1: 0xe8e6ef, floor2: 0xddd9e8, wall: 0x5f5f7f, accent: 0x7b7ca8 },
      operations: { floor1: 0xe6efe8, floor2: 0xdce8e0, wall: 0x58735f, accent: 0x6b9a79 },
      breakRoom: { floor1: 0xf0e3cf, floor2: 0xe8d6bd, wall: 0x8a6f55, accent: 0xbc8b58 },
    },
    departments: {
      planning: {
        name: { ko: "세계관실", en: "Worldbuilding", ja: "世界観室", zh: "世界观组" },
        icon: "🌌",
        agentPrefix: { ko: "세계관 작가", en: "Lore Writer", ja: "設定作家", zh: "设定作者" },
        avatarPool: ["🌌", "📜", "🧭"],
      },
      dev: {
        name: { ko: "서사엔진팀", en: "Narrative Engine", ja: "物語エンジン", zh: "叙事引擎组" },
        icon: "✍️",
        agentPrefix: { ko: "서사 설계자", en: "Narrative Architect", ja: "物語設計者", zh: "叙事架构师" },
        avatarPool: ["✍️", "🖋️", "📘"],
      },
      design: {
        name: { ko: "캐릭터 아트팀", en: "Character Art", ja: "キャラアート", zh: "角色美术组" },
        icon: "🎭",
        agentPrefix: { ko: "캐릭터 디자이너", en: "Character Designer", ja: "キャラデザ", zh: "角色设计师" },
        avatarPool: ["🎭", "🧵", "🎨"],
      },
      qa: {
        name: { ko: "톤 검수팀", en: "Tone QA", ja: "トーン検証", zh: "语气审校组" },
        icon: "🪶",
        agentPrefix: { ko: "문체 검수관", en: "Style Reviewer", ja: "文体レビュア", zh: "文风审校员" },
        avatarPool: ["🪶", "📖", "✅"],
      },
    },
    staff: {
      nonLeaderDeptCycle: ["planning", "design", "dev", "design", "planning", "qa", "design", "operations"],
    },
  },
  video_preprod: {
    key: "video_preprod",
    label: {
      ko: "영상 프리프로덕션",
      en: "Video Pre-production",
      ja: "映像プリプロ",
      zh: "视频前期策划",
    },
    summary: {
      ko: "콘티/샷리스트/편집 노트 중심",
      en: "Storyboard and shot-list focused setup",
      ja: "コンテ・ショットリスト中心",
      zh: "分镜与镜头清单导向",
    },
    roomThemes: {
      ceoOffice: { floor1: 0x1f1f25, floor2: 0x17171c, wall: 0x343748, accent: 0xd18d35 },
      planning: { floor1: 0x25212b, floor2: 0x1c1923, wall: 0x44405b, accent: 0xbc7d47 },
      dev: { floor1: 0x1d2631, floor2: 0x17202a, wall: 0x334961, accent: 0x4c8fca },
      design: { floor1: 0x2a2230, floor2: 0x211a27, wall: 0x544063, accent: 0xc274b7 },
      qa: { floor1: 0x2a2425, floor2: 0x211d1f, wall: 0x5a494b, accent: 0xb98862 },
      devsecops: { floor1: 0x1f242c, floor2: 0x182028, wall: 0x3b4d62, accent: 0x6f8fb0 },
      operations: { floor1: 0x1f2a25, floor2: 0x18211d, wall: 0x3e5d50, accent: 0x62a789 },
      breakRoom: { floor1: 0x2a2622, floor2: 0x211d1a, wall: 0x564c43, accent: 0xbd8a49 },
    },
    departments: {
      planning: {
        name: { ko: "프리프로덕션팀", en: "Pre-production", ja: "プリプロ班", zh: "前期策划组" },
        icon: "🎬",
        agentPrefix: { ko: "프로듀서", en: "Producer", ja: "プロデューサ", zh: "制片" },
        avatarPool: ["🎬", "📽️", "🧭"],
      },
      dev: {
        name: { ko: "씬 엔진팀", en: "Scene Engine", ja: "シーン設計", zh: "场景引擎组" },
        icon: "🎞️",
        agentPrefix: { ko: "씬 디렉터", en: "Scene Director", ja: "シーン監督", zh: "场景导演" },
        avatarPool: ["🎞️", "🧱", "🔧"],
      },
      design: {
        name: { ko: "아트/촬영팀", en: "Art & Camera", ja: "アート撮影", zh: "美术摄影组" },
        icon: "📷",
        agentPrefix: { ko: "촬영 디자이너", en: "Camera Designer", ja: "撮影デザイナ", zh: "摄影设计师" },
        avatarPool: ["📷", "🎨", "💡"],
      },
      qa: {
        name: { ko: "컷 검수팀", en: "Cut QA", ja: "カット検証", zh: "镜头审校组" },
        icon: "🧪",
        agentPrefix: { ko: "컷 검수관", en: "Cut Reviewer", ja: "カットレビュア", zh: "镜头审校员" },
        avatarPool: ["🧪", "✅", "📌"],
      },
    },
    staff: {
      nonLeaderDeptCycle: ["planning", "design", "operations", "dev", "design", "planning", "qa", "operations"],
    },
  },
  roleplay: {
    key: "roleplay",
    label: {
      ko: "롤플레이 스튜디오",
      en: "Roleplay Studio",
      ja: "ロールプレイスタジオ",
      zh: "角色扮演工作室",
    },
    summary: {
      ko: "캐릭터 연기와 대사 몰입 중심",
      en: "Character role and dialogue immersion",
      ja: "キャラ演技と会話没入",
      zh: "角色演绎与对话沉浸",
    },
    roomThemes: {
      ceoOffice: { floor1: 0xf3e7dc, floor2: 0xebdbc9, wall: 0x7d5c4d, accent: 0xbe6f53 },
      planning: { floor1: 0xefe6f6, floor2: 0xe5dbef, wall: 0x6a5d91, accent: 0x8a74c0 },
      dev: { floor1: 0xe6edf8, floor2: 0xdce6f4, wall: 0x576d91, accent: 0x6f8fd1 },
      design: { floor1: 0xf6e3f2, floor2: 0xefd8e9, wall: 0x835b80, accent: 0xc36eb4 },
      qa: { floor1: 0xf5efe6, floor2: 0xeee3d8, wall: 0x7f6d5c, accent: 0xb7956d },
      devsecops: { floor1: 0xe8ecf5, floor2: 0xdde4ef, wall: 0x566479, accent: 0x6d86ab },
      operations: { floor1: 0xe9f2ea, floor2: 0xdfeadf, wall: 0x5b7660, accent: 0x6fae7e },
      breakRoom: { floor1: 0xf4e8d5, floor2: 0xecdcc3, wall: 0x8a7458, accent: 0xc59a5e },
    },
    departments: {
      planning: {
        name: { ko: "캐릭터기획실", en: "Character Planning", ja: "キャラ企画室", zh: "角色企划室" },
        icon: "🎭",
        agentPrefix: { ko: "캐릭터 플래너", en: "Character Planner", ja: "キャラ企画", zh: "角色策划" },
        avatarPool: ["🎭", "🧠", "📜"],
      },
      dev: {
        name: { ko: "대사엔진팀", en: "Dialogue Engine", ja: "会話エンジン", zh: "对话引擎组" },
        icon: "🗣️",
        agentPrefix: { ko: "대사 연출가", en: "Dialogue Director", ja: "台詞演出", zh: "台词导演" },
        avatarPool: ["🗣️", "💬", "🎙️"],
      },
      design: {
        name: { ko: "연출아트팀", en: "Stage Art", ja: "演出アート", zh: "演出美术组" },
        icon: "🎨",
        agentPrefix: { ko: "연출 디자이너", en: "Stage Designer", ja: "演出デザイナ", zh: "演出设计师" },
        avatarPool: ["🎨", "✨", "🎬"],
      },
      qa: {
        name: { ko: "캐릭터검수팀", en: "Character QA", ja: "キャラ検証", zh: "角色审校组" },
        icon: "🔐",
        agentPrefix: { ko: "설정 검수관", en: "Lore Reviewer", ja: "設定レビュア", zh: "设定审校员" },
        avatarPool: ["🔐", "✅", "🧪"],
      },
    },
    staff: {
      nonLeaderDeptCycle: ["planning", "design", "dev", "design", "qa", "planning", "operations", "design"],
    },
  },
};

export function normalizeOfficeWorkflowPack(value: unknown): WorkflowPackKey {
  if (typeof value !== "string") return "development";
  return value in PACK_PRESETS ? (value as WorkflowPackKey) : "development";
}

function pickText(locale: UiLanguageLike, text: Localized): string {
  switch (locale) {
    case "ko":
      return text.ko;
    case "ja":
      return text.ja || text.en;
    case "zh":
      return text.zh || text.en;
    case "en":
    default:
      return text.en;
  }
}

function localizedNumberedName(locale: UiLanguageLike, prefix: Localized, order: number): { name: string; name_ko: string; name_ja: string; name_zh: string } {
  return {
    name: `${prefix.en} ${order}`,
    name_ko: `${prefix.ko} ${order}`,
    name_ja: `${prefix.ja} ${order}`,
    name_zh: `${prefix.zh} ${order}`,
  };
}

export function getOfficePackMeta(packKey: WorkflowPackKey): { label: Localized; summary: Localized } {
  const preset = PACK_PRESETS[packKey] ?? PACK_PRESETS.development;
  return { label: preset.label, summary: preset.summary };
}

export function listOfficePackOptions(locale: UiLanguageLike): Array<{ key: WorkflowPackKey; label: string }> {
  return (Object.keys(PACK_PRESETS) as WorkflowPackKey[]).map((key) => ({
    key,
    label: pickText(locale, PACK_PRESETS[key].label),
  }));
}

export function buildOfficePackPresentation(params: {
  packKey: WorkflowPackKey;
  locale: UiLanguageLike;
  departments: Department[];
  agents: Agent[];
  customRoomThemes: Record<string, RoomTheme>;
}): OfficePackPresentation {
  const { packKey, departments, agents, customRoomThemes } = params;
  if (packKey === "development") {
    return {
      departments,
      agents,
      roomThemes: customRoomThemes,
    };
  }

  const preset = PACK_PRESETS[packKey] ?? PACK_PRESETS.development;
  const deptIdSet = new Set(departments.map((dept) => dept.id));
  const nonLeaderDeptCycle = (preset.staff?.nonLeaderDeptCycle ?? []).filter((deptId) => deptIdSet.has(deptId));
  const remappedDeptByAgentId = new Map<string, string>();

  if (nonLeaderDeptCycle.length > 0) {
    const roleRank: Record<AgentRole, number> = {
      team_leader: 0,
      senior: 1,
      junior: 2,
      intern: 3,
    };
    const sortedNonLeaderAgents = agents
      .filter((agent) => agent.role !== "team_leader" && typeof agent.department_id === "string" && !!agent.department_id)
      .slice()
      .sort((a, b) => {
        const roleDiff = (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9);
        if (roleDiff !== 0) return roleDiff;
        const xpDiff = (b.stats_xp ?? 0) - (a.stats_xp ?? 0);
        if (xpDiff !== 0) return xpDiff;
        return a.id.localeCompare(b.id);
      });

    let cycleCursor = 0;
    for (const agent of sortedNonLeaderAgents) {
      const nextDeptId = nonLeaderDeptCycle[cycleCursor % nonLeaderDeptCycle.length];
      cycleCursor += 1;
      if (nextDeptId) remappedDeptByAgentId.set(agent.id, nextDeptId);
    }
  }

  const transformedDepartments = departments.map((dept) => {
    const deptPreset = preset.departments[dept.id];
    if (!deptPreset) return dept;
    return {
      ...dept,
      icon: deptPreset.icon,
      name: deptPreset.name.en,
      name_ko: deptPreset.name.ko,
      name_ja: deptPreset.name.ja,
      name_zh: deptPreset.name.zh,
    };
  });

  const deptOrderCounter = new Map<string, number>();
  const transformedAgents = agents.map((agent) => {
    const deptId = remappedDeptByAgentId.get(agent.id) ?? agent.department_id;
    if (!deptId) return agent;
    const deptPreset = preset.departments[deptId];
    if (!deptPreset) {
      return deptId === agent.department_id ? agent : { ...agent, department_id: deptId };
    }

    const nextOrder = (deptOrderCounter.get(deptId) ?? 0) + 1;
    deptOrderCounter.set(deptId, nextOrder);
    const names = localizedNumberedName(params.locale, deptPreset.agentPrefix, nextOrder);
    const avatarPool = deptPreset.avatarPool;
    const nextAvatar = avatarPool[(nextOrder - 1) % avatarPool.length] ?? agent.avatar_emoji;

    return {
      ...agent,
      department_id: deptId,
      ...names,
      avatar_emoji: nextAvatar,
    };
  });

  return {
    departments: transformedDepartments,
    agents: transformedAgents,
    roomThemes: {
      ...customRoomThemes,
      ...preset.roomThemes,
    },
  };
}
