import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  getSkills,
  getSkillDetail,
  getSkillLearningJob,
  startSkillLearning,
  type SkillEntry,
  type SkillDetail,
  type SkillLearnJob,
  type SkillLearnProvider,
} from "../api";
import type { Agent, AgentRole } from "../types";
import AgentAvatar from "./AgentAvatar";
import SkillHistoryPanel from "./SkillHistoryPanel";

/* ================================================================== */
/*  Skills data from skills.sh (loaded dynamically via /api/skills)    */
/* ================================================================== */

interface CategorizedSkill extends SkillEntry {
  category: string;
  installsDisplay: string;
}

type Locale = "ko" | "en" | "ja" | "zh";
type TFunction = (messages: Record<Locale, string>) => string;

const LANGUAGE_STORAGE_KEY = "climpire.language";
const LOCALE_TAGS: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

function normalizeLocale(value: string | null | undefined): Locale | null {
  const code = (value ?? "").toLowerCase();
  if (code.startsWith("ko")) return "ko";
  if (code.startsWith("en")) return "en";
  if (code.startsWith("ja")) return "ja";
  if (code.startsWith("zh")) return "zh";
  return null;
}

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return (
    normalizeLocale(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)) ??
    normalizeLocale(window.navigator.language) ??
    "en"
  );
}

function useI18n(preferredLocale?: string) {
  const [locale, setLocale] = useState<Locale>(
    () => normalizeLocale(preferredLocale) ?? detectLocale()
  );

  useEffect(() => {
    const preferred = normalizeLocale(preferredLocale);
    if (preferred) setLocale(preferred);
  }, [preferredLocale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      setLocale(normalizeLocale(preferredLocale) ?? detectLocale());
    };
    window.addEventListener("storage", sync);
    window.addEventListener("climpire-language-change", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(
        "climpire-language-change",
        sync as EventListener
      );
    };
  }, [preferredLocale]);

  const t = useCallback(
    (messages: Record<Locale, string>) => messages[locale] ?? messages.en,
    [locale]
  );

  return { locale, localeTag: LOCALE_TAGS[locale], t };
}

function categorize(name: string, repo: string): string {
  const n = name.toLowerCase();
  const r = repo.toLowerCase();
  if (
    n.includes("design") ||
    n.includes("ui") ||
    n.includes("ux") ||
    n.includes("brand") ||
    n.includes("canvas") ||
    n.includes("theme") ||
    n.includes("interface") ||
    n.includes("visual") ||
    n.includes("interaction")
  )
    return "Design";
  if (
    n.includes("marketing") ||
    n.includes("seo") ||
    n.includes("copywriting") ||
    n.includes("content") ||
    n.includes("social") ||
    n.includes("pricing") ||
    n.includes("launch") ||
    n.includes("analytics") ||
    n.includes("cro") ||
    n.includes("ads") ||
    n.includes("email-sequence") ||
    n.includes("referral") ||
    n.includes("competitor") ||
    n.includes("onboarding") ||
    n.includes("signup") ||
    n.includes("paywall") ||
    n.includes("popup") ||
    n.includes("ab-test") ||
    n.includes("free-tool") ||
    n.includes("backlink") ||
    r.includes("marketingskills")
  )
    return "Marketing";
  if (
    n.includes("test") ||
    n.includes("debug") ||
    n.includes("audit") ||
    n.includes("review") ||
    n.includes("verification") ||
    n.includes("e2e")
  )
    return "Testing & QA";
  if (
    n.includes("react") ||
    n.includes("vue") ||
    n.includes("next") ||
    n.includes("expo") ||
    n.includes("flutter") ||
    n.includes("swift") ||
    n.includes("angular") ||
    n.includes("tailwind") ||
    n.includes("shadcn") ||
    n.includes("nuxt") ||
    n.includes("vite") ||
    n.includes("native") ||
    n.includes("responsive") ||
    n.includes("component") ||
    n.includes("frontend") ||
    n.includes("remotion") ||
    n.includes("slidev") ||
    n.includes("stitch")
  )
    return "Frontend";
  if (
    n.includes("api") ||
    n.includes("backend") ||
    n.includes("node") ||
    n.includes("fastapi") ||
    n.includes("nest") ||
    n.includes("laravel") ||
    n.includes("python") ||
    n.includes("golang") ||
    n.includes("async") ||
    n.includes("sql") ||
    n.includes("postgres") ||
    n.includes("supabase") ||
    n.includes("convex") ||
    n.includes("stripe") ||
    n.includes("auth") ||
    n.includes("microservices") ||
    n.includes("error-handling")
  )
    return "Backend";
  if (
    n.includes("docker") ||
    n.includes("github-actions") ||
    n.includes("cicd") ||
    n.includes("deploy") ||
    n.includes("monorepo") ||
    n.includes("turborepo") ||
    n.includes("pnpm") ||
    n.includes("uv-package") ||
    n.includes("git") ||
    n.includes("release") ||
    n.includes("worktree")
  )
    return "DevOps";
  if (
    n.includes("agent") ||
    n.includes("mcp") ||
    n.includes("prompt") ||
    n.includes("langchain") ||
    n.includes("rag") ||
    n.includes("ai-sdk") ||
    n.includes("browser-use") ||
    n.includes("skill-creator") ||
    n.includes("find-skills") ||
    n.includes("remembering") ||
    n.includes("subagent") ||
    n.includes("dispatching") ||
    n.includes("planning") ||
    n.includes("executing") ||
    n.includes("writing-plans") ||
    n.includes("brainstorming") ||
    n.includes("using-superpowers") ||
    n.includes("finishing") ||
    n.includes("requesting") ||
    n.includes("receiving") ||
    n.includes("agentation") ||
    n.includes("clawdirect") ||
    n.includes("instaclaw") ||
    n.includes("nblm") ||
    n.includes("context7")
  )
    return "AI & Agent";
  if (
    n.includes("pdf") ||
    n.includes("pptx") ||
    n.includes("docx") ||
    n.includes("xlsx") ||
    n.includes("doc-coauthor") ||
    n.includes("internal-comms") ||
    n.includes("slack") ||
    n.includes("writing") ||
    n.includes("copy-editing") ||
    n.includes("humanizer") ||
    n.includes("obsidian") ||
    n.includes("baoyu") ||
    n.includes("firecrawl") ||
    n.includes("web-artifacts") ||
    n.includes("comic") ||
    n.includes("image") ||
    n.includes("infographic") ||
    n.includes("url-to-markdown")
  )
    return "Productivity";
  if (n.includes("security") || n.includes("accessibility"))
    return "Security";
  if (
    n.includes("typescript") ||
    n.includes("javascript") ||
    n.includes("architecture") ||
    n.includes("state-management") ||
    n.includes("modern-javascript")
  )
    return "Architecture";
  return "Other";
}

function formatInstalls(n: number, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, {
    notation: n >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
}

const CATEGORIES = [
  "All",
  "Frontend",
  "Backend",
  "Design",
  "AI & Agent",
  "Marketing",
  "Testing & QA",
  "DevOps",
  "Productivity",
  "Architecture",
  "Security",
  "Other",
];

const CATEGORY_ICONS: Record<string, string> = {
  All: "📚",
  Frontend: "🎨",
  Backend: "🔧",
  Design: "✨",
  "AI & Agent": "🤖",
  Marketing: "📈",
  "Testing & QA": "🧪",
  DevOps: "🚀",
  Productivity: "📝",
  Architecture: "🏗️",
  Security: "🔒",
  Other: "📦",
};

const CATEGORY_COLORS: Record<string, string> = {
  Frontend: "text-blue-400 bg-blue-500/15 border-blue-500/30",
  Backend: "text-green-400 bg-green-500/15 border-green-500/30",
  Design: "text-pink-400 bg-pink-500/15 border-pink-500/30",
  "AI & Agent": "text-purple-400 bg-purple-500/15 border-purple-500/30",
  Marketing: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  "Testing & QA": "text-cyan-400 bg-cyan-500/15 border-cyan-500/30",
  DevOps: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  Productivity: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  Architecture: "text-indigo-400 bg-indigo-500/15 border-indigo-500/30",
  Security: "text-red-400 bg-red-500/15 border-red-500/30",
  Other: "text-slate-400 bg-slate-500/15 border-slate-500/30",
};

function categoryLabel(category: string, t: TFunction) {
  switch (category) {
    case "All":
      return t({ ko: "전체", en: "All", ja: "すべて", zh: "全部" });
    case "Frontend":
      return t({ ko: "프론트엔드", en: "Frontend", ja: "フロントエンド", zh: "前端" });
    case "Backend":
      return t({ ko: "백엔드", en: "Backend", ja: "バックエンド", zh: "后端" });
    case "Design":
      return t({ ko: "디자인", en: "Design", ja: "デザイン", zh: "设计" });
    case "AI & Agent":
      return t({ ko: "AI & 에이전트", en: "AI & Agent", ja: "AI & エージェント", zh: "AI 与代理" });
    case "Marketing":
      return t({ ko: "마케팅", en: "Marketing", ja: "マーケティング", zh: "营销" });
    case "Testing & QA":
      return t({ ko: "테스트 & QA", en: "Testing & QA", ja: "テスト & QA", zh: "测试与 QA" });
    case "DevOps":
      return t({ ko: "데브옵스", en: "DevOps", ja: "DevOps", zh: "DevOps" });
    case "Productivity":
      return t({ ko: "생산성", en: "Productivity", ja: "生産性", zh: "效率" });
    case "Architecture":
      return t({ ko: "아키텍처", en: "Architecture", ja: "アーキテクチャ", zh: "架构" });
    case "Security":
      return t({ ko: "보안", en: "Security", ja: "セキュリティ", zh: "安全" });
    case "Other":
      return t({ ko: "기타", en: "Other", ja: "その他", zh: "其他" });
    default:
      return category;
  }
}

function getRankBadge(rank: number) {
  if (rank === 1) return { icon: "🥇", color: "text-yellow-400" };
  if (rank === 2) return { icon: "🥈", color: "text-slate-300" };
  if (rank === 3) return { icon: "🥉", color: "text-amber-600" };
  if (rank <= 10) return { icon: "🏆", color: "text-amber-400" };
  if (rank <= 50) return { icon: "⭐", color: "text-blue-400" };
  return { icon: "", color: "text-slate-500" };
}

function formatFirstSeen(value: string, localeTag: string): string {
  if (!value) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function localizeAuditStatus(status: string, t: TFunction): string {
  const normalized = status.toLowerCase();
  if (normalized === "pass") {
    return t({ ko: "통과", en: "Pass", ja: "合格", zh: "通过" });
  }
  if (normalized === "warn") {
    return t({ ko: "경고", en: "Warn", ja: "警告", zh: "警告" });
  }
  if (normalized === "pending") {
    return t({ ko: "대기", en: "Pending", ja: "保留", zh: "待处理" });
  }
  if (normalized === "fail") {
    return t({ ko: "실패", en: "Fail", ja: "失敗", zh: "失败" });
  }
  return status;
}

const LEARN_PROVIDER_ORDER: SkillLearnProvider[] = ["claude", "codex", "gemini", "opencode"];
const ROLE_ORDER: Record<AgentRole, number> = {
  team_leader: 0,
  senior: 1,
  junior: 2,
  intern: 3,
};

function roleLabel(role: AgentRole, t: TFunction): string {
  if (role === "team_leader") return t({ ko: "팀장", en: "Team Lead", ja: "チームリード", zh: "团队负责人" });
  if (role === "senior") return t({ ko: "시니어", en: "Senior", ja: "シニア", zh: "资深" });
  if (role === "junior") return t({ ko: "주니어", en: "Junior", ja: "ジュニア", zh: "初级" });
  return t({ ko: "인턴", en: "Intern", ja: "インターン", zh: "实习生" });
}

function providerLabel(provider: SkillLearnProvider): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex";
  if (provider === "gemini") return "Gemini";
  return "OpenCode";
}

function learningStatusLabel(status: SkillLearnJob["status"] | null, t: TFunction): string {
  if (status === "queued") return t({ ko: "대기중", en: "Queued", ja: "待機中", zh: "排队中" });
  if (status === "running") return t({ ko: "학습중", en: "Running", ja: "学習中", zh: "学习中" });
  if (status === "succeeded") return t({ ko: "완료", en: "Succeeded", ja: "完了", zh: "完成" });
  if (status === "failed") return t({ ko: "실패", en: "Failed", ja: "失敗", zh: "失败" });
  return "-";
}

function pickRepresentativeForProvider(agents: Agent[], provider: SkillLearnProvider): Agent | null {
  const candidates = agents.filter((agent) => agent.cli_provider === provider);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const roleGap = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (roleGap !== 0) return roleGap;
    if (b.stats_xp !== a.stats_xp) return b.stats_xp - a.stats_xp;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */

interface SkillsLibraryProps {
  agents: Agent[];
}

export default function SkillsLibrary({ agents }: SkillsLibraryProps) {
  const { t, localeTag } = useI18n();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortBy, setSortBy] = useState<"rank" | "name" | "installs">("rank");
  const [copiedSkill, setCopiedSkill] = useState<string | null>(null);
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, SkillDetail | "loading" | "error">>({});
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [learningSkill, setLearningSkill] = useState<CategorizedSkill | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<SkillLearnProvider[]>([]);
  const [learnJob, setLearnJob] = useState<SkillLearnJob | null>(null);
  const [learnSubmitting, setLearnSubmitting] = useState(false);
  const [learnError, setLearnError] = useState<string | null>(null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  const handleCardMouseEnter = useCallback((skill: CategorizedSkill) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const detailId = skill.skillId || skill.name;
      const key = `${skill.repo}/${detailId}`;
      setHoveredSkill(key);
      if (!detailCache[key]) {
        setDetailCache((prev) => ({ ...prev, [key]: "loading" }));
        getSkillDetail(skill.repo, detailId)
          .then((detail) => {
            setDetailCache((prev) => ({ ...prev, [key]: detail ?? "error" }));
          })
          .catch(() => {
            setDetailCache((prev) => ({ ...prev, [key]: "error" }));
          });
      }
    }, 300);
  }, [detailCache]);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredSkill(null);
  }, []);

  useEffect(() => {
    getSkills()
      .then(setSkills)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const categorizedSkills = useMemo<CategorizedSkill[]>(
    () =>
      skills.map((s) => ({
        ...s,
        category: categorize(s.name, s.repo),
        installsDisplay: formatInstalls(s.installs, localeTag),
      })),
    [skills, localeTag]
  );

  const filtered = useMemo(() => {
    let result = categorizedSkills;

    if (selectedCategory !== "All") {
      result = result.filter((s) => s.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.repo.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }

    if (sortBy === "name") {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name, localeTag));
    } else if (sortBy === "installs") {
      result = [...result].sort((a, b) => b.installs - a.installs);
    }
    // rank is default order

    return result;
  }, [categorizedSkills, search, selectedCategory, sortBy, localeTag]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: categorizedSkills.length };
    for (const s of categorizedSkills) {
      counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }, [categorizedSkills]);

  const representatives = useMemo(
    () =>
      LEARN_PROVIDER_ORDER.map((provider) => ({
        provider,
        agent: pickRepresentativeForProvider(agents, provider),
      })),
    [agents]
  );

  const defaultSelectedProviders = useMemo(
    () => representatives.filter((row) => row.agent).map((row) => row.provider),
    [representatives]
  );

  const learnInProgress =
    learnJob?.status === "queued" || learnJob?.status === "running";
  const preferKoreanName = localeTag.startsWith("ko");

  useEffect(() => {
    if (!learnJob || (learnJob.status !== "queued" && learnJob.status !== "running")) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      getSkillLearningJob(learnJob.id)
        .then((job) => {
          if (!cancelled) {
            setLearnJob(job);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setLearnError(e.message);
          }
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [learnJob]);

  useEffect(() => {
    if (!learnJob) return;
    if (learnJob.status === "succeeded" || learnJob.status === "failed") {
      setHistoryRefreshToken((prev) => prev + 1);
    }
  }, [learnJob?.id, learnJob?.status]);

  function openLearningModal(skill: CategorizedSkill) {
    setLearningSkill(skill);
    setSelectedProviders(defaultSelectedProviders);
    setLearnJob(null);
    setLearnError(null);
  }

  const closeLearningModal = useCallback(() => {
    if (learnInProgress) return;
    setLearningSkill(null);
    setSelectedProviders([]);
    setLearnJob(null);
    setLearnError(null);
  }, [learnInProgress]);

  useEffect(() => {
    if (!learningSkill) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeLearningModal();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [learningSkill, closeLearningModal]);

  function toggleProvider(provider: SkillLearnProvider) {
    if (learnInProgress) return;
    setSelectedProviders((prev) => (
      prev.includes(provider)
        ? prev.filter((item) => item !== provider)
        : [...prev, provider]
    ));
  }

  async function handleStartLearning() {
    if (!learningSkill || selectedProviders.length === 0 || learnSubmitting || learnInProgress) return;
    setLearnSubmitting(true);
    setLearnError(null);
    try {
      const job = await startSkillLearning({
        repo: learningSkill.repo,
        skillId: learningSkill.skillId || learningSkill.name,
        providers: selectedProviders,
      });
      setLearnJob(job);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLearnError(message);
    } finally {
      setLearnSubmitting(false);
    }
  }

  function handleCopy(skill: CategorizedSkill) {
    const cmd = `npx skills add ${skill.repo}`;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedSkill(skill.name);
      setTimeout(() => setCopiedSkill(null), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <div className="text-slate-400 text-sm">
            {t({
              ko: "skills.sh 데이터 로딩중...",
              en: "Loading skills.sh data...",
              ja: "skills.sh データを読み込み中...",
              zh: "正在加载 skills.sh 数据...",
            })}
          </div>
        </div>
      </div>
    );
  }

  if (error && skills.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-slate-400 text-sm">
            {t({
              ko: "스킬 데이터를 불러올 수 없습니다",
              en: "Unable to load skills data",
              ja: "スキルデータを読み込めません",
              zh: "无法加载技能数据",
            })}
          </div>
          <div className="text-slate-500 text-xs mt-1">{error}</div>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              getSkills()
                .then(setSkills)
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
            className="mt-4 px-4 py-2 text-sm bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-all"
          >
            {t({ ko: "다시 시도", en: "Retry", ja: "再試行", zh: "重试" })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">📚</span>
              {t({
                ko: "Agent Skills 문서고",
                en: "Agent Skills Library",
                ja: "Agent Skills ライブラリ",
                zh: "Agent Skills 资料库",
              })}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {t({
                ko: "AI 에이전트 스킬 디렉토리 · skills.sh 실시간 데이터",
                en: "AI agent skill directory · live skills.sh data",
                ja: "AI エージェントスキルディレクトリ · skills.sh リアルタイムデータ",
                zh: "AI 代理技能目录 · skills.sh 实时数据",
              })}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-empire-gold">{skills.length}</div>
            <div className="text-xs text-slate-500">
              {t({ ko: "등록된 스킬", en: "Registered skills", ja: "登録済みスキル", zh: "已收录技能" })}
            </div>
          </div>
        </div>

        {/* Search & Sort */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t({
                ko: "스킬 검색... (이름, 저장소, 카테고리)",
                en: "Search skills... (name, repo, category)",
                ja: "スキル検索...（名前・リポジトリ・カテゴリ）",
                zh: "搜索技能...（名称、仓库、分类）",
              })}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                &times;
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500/50"
          >
            <option value="rank">{t({ ko: "순위순", en: "By Rank", ja: "順位順", zh: "按排名" })}</option>
            <option value="installs">{t({ ko: "설치순", en: "By Installs", ja: "インストール順", zh: "按安装量" })}</option>
            <option value="name">{t({ ko: "이름순", en: "By Name", ja: "名前順", zh: "按名称" })}</option>
          </select>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              selectedCategory === cat
                ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                : "bg-slate-800/40 text-slate-400 border-slate-700/50 hover:bg-slate-700/40 hover:text-slate-300"
            }`}
          >
            {CATEGORY_ICONS[cat]} {categoryLabel(cat, t)}
            <span className="ml-1 text-slate-500">
              {categoryCounts[cat] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Results count */}
      <div className="text-xs text-slate-500 px-1">
        {filtered.length}
        {t({ ko: "개 스킬 표시중", en: " skills shown", ja: "件のスキルを表示中", zh: " 个技能已显示" })}
        {search &&
          ` · "${search}" ${t({
            ko: "검색 결과",
            en: "search results",
            ja: "検索結果",
            zh: "搜索结果",
          })}`}
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">
            {t({
              ko: "학습 메모리",
              en: "Learning Memory",
              ja: "学習メモリ",
              zh: "学习记忆",
            })}
          </div>
          <div className="text-[11px] text-slate-500">
            {t({
              ko: "CLI별 스킬 이력",
              en: "Per-CLI skill history",
              ja: "CLI別スキル履歴",
              zh: "按 CLI 的技能记录",
            })}
          </div>
        </div>
        <SkillHistoryPanel agents={agents} refreshToken={historyRefreshToken} className="h-[380px]" />
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((skill) => {
          const badge = getRankBadge(skill.rank);
          const catColor =
            CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.Other;
          const detailId = skill.skillId || skill.name;
          const detailKey = `${skill.repo}/${detailId}`;
          const isHovered = hoveredSkill === detailKey;
          const detail = detailCache[detailKey];
          return (
            <div
              key={`${skill.rank}-${detailId}`}
              className="relative bg-slate-800/50 border border-slate-700/40 rounded-xl p-4 hover:bg-slate-800/70 hover:border-slate-600/50 transition-all group"
              onMouseEnter={() => handleCardMouseEnter(skill)}
              onMouseLeave={handleCardMouseLeave}
            >
              {/* Top row: rank + name */}
              <div className="flex items-start gap-3 mb-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/60 text-sm font-bold shrink-0">
                  {badge.icon ? (
                    <span>{badge.icon}</span>
                  ) : (
                    <span className={badge.color}>#{skill.rank}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm truncate">
                    {skill.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    {skill.repo}
                  </div>
                </div>
              </div>

              {/* Bottom row: category + installs + learn/copy */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${catColor}`}
                >
                  {CATEGORY_ICONS[skill.category]} {categoryLabel(skill.category, t)}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">
                    <span className="text-empire-green font-medium">
                      {skill.installsDisplay}
                    </span>{" "}
                    {t({ ko: "설치", en: "installs", ja: "インストール", zh: "安装" })}
                  </span>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => openLearningModal(skill)}
                      className="px-2 py-1 text-[10px] bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 rounded-md hover:bg-emerald-600/30 transition-all"
                      title={t({
                        ko: "CLI 대표자에게 스킬 학습시키기",
                        en: "Teach this skill to selected CLI leaders",
                        ja: "選択したCLI代表にこのスキルを学習させる",
                        zh: "让所选 CLI 代表学习此技能",
                      })}
                    >
                      {t({ ko: "학습", en: "Learn", ja: "学習", zh: "学习" })}
                    </button>
                    <button
                      onClick={() => handleCopy(skill)}
                      className="px-2 py-1 text-[10px] bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-md hover:bg-blue-600/30 transition-all"
                      title={`npx skills add ${skill.repo}`}
                    >
                      {copiedSkill === skill.name
                        ? t({ ko: "복사됨", en: "Copied", ja: "コピー済み", zh: "已复制" })
                        : t({ ko: "복사", en: "Copy", ja: "コピー", zh: "复制" })}
                    </button>
                  </div>
                </div>
              </div>

              {/* Hover Detail Tooltip */}
              {isHovered && (
                <div
                  ref={tooltipRef}
                  className="absolute z-50 left-0 right-0 top-full mt-2 bg-slate-900/95 backdrop-blur-md border border-slate-600/60 rounded-xl p-4 shadow-2xl shadow-black/40 animate-in fade-in slide-in-from-top-1 duration-200"
                  onMouseEnter={() => {
                    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                    setHoveredSkill(detailKey);
                  }}
                  onMouseLeave={handleCardMouseLeave}
                >
                  {detail === "loading" && (
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                      <div className="animate-spin w-3 h-3 border border-blue-500 border-t-transparent rounded-full" />
                      {t({ ko: "상세정보 로딩중...", en: "Loading details...", ja: "詳細を読み込み中...", zh: "加载详情..." })}
                    </div>
                  )}
                  {detail === "error" && (
                    <div className="text-slate-500 text-xs">
                      {t({ ko: "상세정보를 불러올 수 없습니다", en: "Could not load details", ja: "詳細を読み込めません", zh: "无法加载详情" })}
                    </div>
                  )}
                  {detail && typeof detail === "object" && (
                    <div className="space-y-3">
                      {detail.title && (
                        <div className="text-sm font-semibold text-white">
                          {detail.title}
                        </div>
                      )}

                      {/* Description */}
                      {detail.description && (
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {detail.description}
                        </p>
                      )}

                      {/* When to use */}
                      {detail.whenToUse.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                            {t({ ko: "사용 시점", en: "When to Use", ja: "使うタイミング", zh: "适用场景" })}
                          </div>
                          <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-300">
                            {detail.whenToUse.slice(0, 6).map((item, idx) => (
                              <li key={`${detailKey}-when-${idx}`}>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Meta row */}
                      <div className="flex flex-wrap gap-3 text-[11px]">
                        {detail.weeklyInstalls && (
                          <span className="text-slate-400">
                            <span className="text-empire-green font-medium">{detail.weeklyInstalls}</span>
                            {" "}{t({ ko: "주간 설치", en: "weekly", ja: "週間", zh: "周安装" })}
                          </span>
                        )}
                        {detail.firstSeen && (
                          <span className="text-slate-500">
                            {t({ ko: "최초 등록", en: "First seen", ja: "初登録", zh: "首次发现" })}: {formatFirstSeen(detail.firstSeen, localeTag)}
                          </span>
                        )}
                      </div>

                      {/* Platform installs */}
                      {detail.platforms.length > 0 && (
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">
                            {t({ ko: "플랫폼별 설치", en: "Platform Installs", ja: "プラットフォーム別", zh: "平台安装量" })}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {detail.platforms.slice(0, 6).map((p) => (
                              <span
                                key={p.name}
                                className="text-[10px] px-2 py-0.5 bg-slate-800/80 border border-slate-700/50 rounded-md text-slate-400"
                              >
                                {p.name} <span className="text-empire-green">{p.installs}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Audits */}
                      {detail.audits.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {detail.audits.map((a) => (
                            <span
                              key={a.name}
                              className={`text-[10px] px-2 py-0.5 rounded-md border ${
                                a.status.toLowerCase() === "pass"
                                  ? "text-green-400 bg-green-500/10 border-green-500/30"
                                  : a.status.toLowerCase() === "warn" || a.status.toLowerCase() === "pending"
                                  ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
                                  : "text-red-400 bg-red-500/10 border-red-500/30"
                              }`}
                            >
                              {a.name}: {localizeAuditStatus(a.status, t)}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Install command */}
                      <div className="text-[10px] text-slate-500 font-mono bg-slate-800/60 rounded-md px-2 py-1.5 truncate">
                        $ {detail.installCommand}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-slate-400 text-sm">
            {t({ ko: "검색 결과가 없습니다", en: "No search results", ja: "検索結果はありません", zh: "没有搜索结果" })}
          </div>
          <div className="text-slate-500 text-xs mt-1">
            {t({
              ko: "다른 키워드로 검색해보세요",
              en: "Try a different keyword",
              ja: "別のキーワードで検索してください",
              zh: "请尝试其他关键词",
            })}
          </div>
        </div>
      )}

      {learningSkill && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-700/60 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-white">
                  {t({
                    ko: "스킬 학습 스쿼드",
                    en: "Skill Learning Squad",
                    ja: "スキル学習スクワッド",
                    zh: "技能学习小队",
                  })}
                </h3>
                <div className="mt-1 text-xs text-slate-400">
                  {learningSkill.name} · {learningSkill.repo}
                </div>
              </div>
              <button
                onClick={closeLearningModal}
                disabled={learnInProgress}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-all ${
                  learnInProgress
                    ? "cursor-not-allowed border-slate-700 text-slate-600"
                    : "border-slate-600 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {learnInProgress
                  ? t({ ko: "학습중", en: "Running", ja: "実行中", zh: "进行中" })
                  : t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-4 max-h-[calc(90vh-72px)]">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2">
                <div className="text-[11px] text-emerald-200">
                  {t({
                    ko: "실행 명령",
                    en: "Install command",
                    ja: "実行コマンド",
                    zh: "执行命令",
                  })}
                </div>
                <div className="mt-1 text-[11px] font-mono text-emerald-300 break-all">
                  npx skills add {learningSkill.repo}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  {t({
                    ko: "CLI 대표자를 선택하세요 (복수 선택 가능)",
                    en: "Select CLI representatives (multi-select)",
                    ja: "CLI代表を選択してください（複数選択可）",
                    zh: "选择 CLI 代表（可多选）",
                  })}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedProviders.length}
                  {t({
                    ko: "명 선택됨",
                    en: " selected",
                    ja: "名を選択",
                    zh: " 已选择",
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {representatives.map((row) => {
                  const isSelected = selectedProviders.includes(row.provider);
                  const hasAgent = !!row.agent;
                  const isAnimating = learnInProgress && isSelected && hasAgent;
                  const displayName = row.agent
                    ? (preferKoreanName ? row.agent.name_ko || row.agent.name : row.agent.name || row.agent.name_ko)
                    : t({
                        ko: "배치된 인원 없음",
                        en: "No assigned member",
                        ja: "担当メンバーなし",
                        zh: "暂无成员",
                      });
                  return (
                    <button
                      key={row.provider}
                      type="button"
                      onClick={() => toggleProvider(row.provider)}
                      disabled={!hasAgent || learnInProgress}
                      className={`relative overflow-hidden rounded-xl border p-3 text-left transition-all ${
                        !hasAgent
                          ? "cursor-not-allowed border-slate-700/80 bg-slate-800/40 opacity-60"
                          : isSelected
                            ? "border-emerald-500/50 bg-emerald-500/10"
                            : "border-slate-700/70 bg-slate-800/60 hover:border-slate-500/80 hover:bg-slate-800/80"
                      }`}
                    >
                      {isAnimating && (
                        <div className="pointer-events-none absolute inset-0 overflow-hidden">
                          {Array.from({ length: 6 }).map((_, idx) => (
                            <span
                              key={`${row.provider}-book-${idx}`}
                              className="learn-book-drop"
                              style={{
                                left: `${8 + idx * 15}%`,
                                animationDelay: `${idx * 0.15}s`,
                              }}
                            >
                              {idx % 2 === 0 ? "📘" : "📙"}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="relative z-10 flex items-center gap-3">
                        <div className={`relative ${isAnimating ? "learn-avatar-reading" : ""}`}>
                          <AgentAvatar
                            agent={row.agent ?? undefined}
                            agents={agents}
                            size={50}
                            rounded="xl"
                          />
                          {isAnimating && (
                            <span className="learn-reading-book">📖</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-400">{providerLabel(row.provider)}</div>
                          <div className="text-sm font-medium text-white truncate">{displayName}</div>
                          <div className="text-[11px] text-slate-500">
                            {row.agent
                              ? roleLabel(row.agent.role, t)
                              : t({
                                  ko: "사용 불가",
                                  en: "Unavailable",
                                  ja: "利用不可",
                                  zh: "不可用",
                                })}
                          </div>
                        </div>
                        <div
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            isSelected
                              ? "border-emerald-400/50 text-emerald-300 bg-emerald-500/15"
                              : "border-slate-600 text-slate-400 bg-slate-700/40"
                          }`}
                        >
                          {isSelected
                            ? t({ ko: "선택됨", en: "Selected", ja: "選択", zh: "已选" })
                            : t({ ko: "대기", en: "Idle", ja: "待機", zh: "待命" })}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-slate-800/55 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-slate-300">
                    {t({ ko: "작업 상태", en: "Job status", ja: "ジョブ状態", zh: "任务状态" })}:{" "}
                    <span
                      className={`font-medium ${
                        learnJob?.status === "succeeded"
                          ? "text-emerald-300"
                          : learnJob?.status === "failed"
                            ? "text-rose-300"
                            : learnJob?.status === "running" || learnJob?.status === "queued"
                              ? "text-amber-300"
                              : "text-slate-500"
                      }`}
                    >
                      {learningStatusLabel(learnJob?.status ?? null, t)}
                    </span>
                  </div>
                  {learnJob?.completedAt && (
                    <div className="text-[11px] text-slate-500">
                      {new Intl.DateTimeFormat(localeTag, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(learnJob.completedAt))}
                    </div>
                  )}
                </div>

                {learnError && (
                  <div className="mt-2 text-[11px] text-rose-300">{learnError}</div>
                )}
                {learnJob?.error && (
                  <div className="mt-2 text-[11px] text-rose-300">{learnJob.error}</div>
                )}

                {learnJob && (
                  <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/70 p-2 font-mono text-[10px] text-slate-300 max-h-32 overflow-y-auto space-y-1">
                    <div className="text-slate-500">$ {learnJob.command}</div>
                    {learnJob.logTail.length > 0 ? (
                      learnJob.logTail.slice(-10).map((line, idx) => (
                        <div key={`${learnJob.id}-log-${idx}`}>{line}</div>
                      ))
                    ) : (
                      <div className="text-slate-600">
                        {t({
                          ko: "로그가 아직 없습니다",
                          en: "No logs yet",
                          ja: "ログはまだありません",
                          zh: "暂无日志",
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={closeLearningModal}
                  disabled={learnInProgress}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    learnInProgress
                      ? "cursor-not-allowed border-slate-700 text-slate-600"
                      : "border-slate-600 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
                </button>
                <button
                  onClick={handleStartLearning}
                  disabled={
                    selectedProviders.length === 0 ||
                    learnSubmitting ||
                    learnInProgress ||
                    defaultSelectedProviders.length === 0
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    selectedProviders.length === 0 || learnInProgress || defaultSelectedProviders.length === 0
                      ? "cursor-not-allowed border-slate-700 text-slate-600"
                      : "border-emerald-500/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                  }`}
                >
                  {learnSubmitting || learnInProgress
                    ? t({ ko: "학습중...", en: "Learning...", ja: "学習中...", zh: "学习中..." })
                    : t({ ko: "학습 시작", en: "Start Learning", ja: "学習開始", zh: "开始学习" })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="text-center text-xs text-slate-600 py-4">
        {t({
          ko: "데이터 출처: skills.sh · 설치: npx skills add <owner/repo>",
          en: "Source: skills.sh · Install: npx skills add <owner/repo>",
          ja: "データソース: skills.sh · インストール: npx skills add <owner/repo>",
          zh: "数据来源: skills.sh · 安装: npx skills add <owner/repo>",
        })}
      </div>
    </div>
  );
}
