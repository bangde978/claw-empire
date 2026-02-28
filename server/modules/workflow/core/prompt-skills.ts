import type { DatabaseSync } from "node:sqlite";

type PromptSkillProvider = "claude" | "codex" | "gemini" | "opencode" | "copilot" | "antigravity" | "api";
type PromptSkillRow = {
  repo: string;
  skill_id: string;
  skill_label: string;
  learned_at: number;
};

const SKILL_PROMPT_FETCH_LIMIT = 8;
const SKILL_PROMPT_INLINE_LIMIT = 4;
const DEFAULT_LOCAL_TASTE_SKILL_PATH = "tools/taste-skill/skill.md";
const DEFAULT_PROMPT_SKILLS: PromptSkillRow[] = [
  {
    repo: DEFAULT_LOCAL_TASTE_SKILL_PATH,
    skill_id: "",
    skill_label: `${DEFAULT_LOCAL_TASTE_SKILL_PATH} (default local baseline)`,
    learned_at: Number.MAX_SAFE_INTEGER,
  },
];

function isPromptSkillProvider(provider: string): provider is PromptSkillProvider {
  return (
    provider === "claude" ||
    provider === "codex" ||
    provider === "gemini" ||
    provider === "opencode" ||
    provider === "copilot" ||
    provider === "antigravity" ||
    provider === "api"
  );
}

function getPromptSkillProviderDisplayName(provider: string): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex";
  if (provider === "gemini") return "Gemini";
  if (provider === "opencode") return "OpenCode";
  if (provider === "copilot") return "GitHub Copilot";
  if (provider === "antigravity") return "Antigravity";
  if (provider === "api") return "API Provider";
  return provider || "unknown";
}

function clipPromptSkillLabel(label: string, maxLength = 48): string {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatPromptSkillTag(repo: string, skillId: string, skillLabel: string): string {
  const fallback = skillId ? `${repo}#${skillId}` : repo;
  const source = skillLabel || fallback;
  const clipped = clipPromptSkillLabel(source);
  return clipped ? `[${clipped}]` : "";
}

function normalizePromptSkillRepo(repo: string): string {
  return String(repo || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\/+$/, "");
}

function withDefaultPromptSkills(rows: PromptSkillRow[]): PromptSkillRow[] {
  const merged: PromptSkillRow[] = [];
  const seen = new Set<string>();

  const pushUnique = (row: PromptSkillRow) => {
    const repoKey = normalizePromptSkillRepo(row.repo);
    if (!repoKey) return;
    if (seen.has(repoKey)) return;
    seen.add(repoKey);
    merged.push(row);
  };

  for (const row of DEFAULT_PROMPT_SKILLS) pushUnique(row);
  for (const row of rows) pushUnique(row);

  return merged;
}

function queryPromptSkillsByProvider(
  db: DatabaseSync,
  provider: PromptSkillProvider,
  limit: number,
): Array<{
  repo: string;
  skill_id: string;
  skill_label: string;
  learned_at: number;
}> {
  return db
    .prepare(
      `
    SELECT
      repo,
      skill_id,
      skill_label,
      MAX(COALESCE(run_completed_at, updated_at, created_at)) AS learned_at
    FROM skill_learning_history
    WHERE status = 'succeeded' AND provider = ?
    GROUP BY repo, skill_id, skill_label
    ORDER BY learned_at DESC
    LIMIT ?
  `,
    )
    .all(provider, limit) as Array<{
    repo: string;
    skill_id: string;
    skill_label: string;
    learned_at: number;
  }>;
}

function queryPromptSkillsGlobal(
  db: DatabaseSync,
  limit: number,
): Array<{
  repo: string;
  skill_id: string;
  skill_label: string;
  learned_at: number;
}> {
  return db
    .prepare(
      `
    SELECT
      repo,
      skill_id,
      skill_label,
      MAX(COALESCE(run_completed_at, updated_at, created_at)) AS learned_at
    FROM skill_learning_history
    WHERE status = 'succeeded'
    GROUP BY repo, skill_id, skill_label
    ORDER BY learned_at DESC
    LIMIT ?
  `,
    )
    .all(limit) as Array<{
    repo: string;
    skill_id: string;
    skill_label: string;
    learned_at: number;
  }>;
}

function formatPromptSkillTagLine(rows: Array<{ repo: string; skill_id: string; skill_label: string }>): string {
  const tags = rows.map((row) => formatPromptSkillTag(row.repo, row.skill_id, row.skill_label)).filter(Boolean);
  if (tags.length === 0) return "[none]";
  const inlineCount = Math.min(tags.length, SKILL_PROMPT_INLINE_LIMIT);
  const inline = tags.slice(0, inlineCount).join("");
  const overflow = tags.length - inlineCount;
  return overflow > 0 ? `${inline}[+${overflow} more]` : inline;
}

export function createPromptSkillsHelper(db: DatabaseSync): {
  buildAvailableSkillsPromptBlock: (provider: string) => string;
} {
  function buildAvailableSkillsPromptBlock(provider: string): string {
    const providerDisplay = getPromptSkillProviderDisplayName(provider);
    const localDefaultSkillRule = `[Skills Rule] Default local skill: \`${DEFAULT_LOCAL_TASTE_SKILL_PATH}\`. Read and apply it before execution when available.`;
    try {
      const providerKey = isPromptSkillProvider(provider) ? provider : null;
      const providerLearnedSkills = providerKey
        ? queryPromptSkillsByProvider(db, providerKey, SKILL_PROMPT_FETCH_LIMIT)
        : [];
      if (providerLearnedSkills.length > 0) {
        const providerSkills = withDefaultPromptSkills(providerLearnedSkills);
        return [
          `[Available Skills][provider=${providerDisplay}][default=taste-skill]${formatPromptSkillTagLine(providerSkills)}`,
          "[Skills Rule] Use provider-matched skills first when relevant.",
          localDefaultSkillRule,
        ].join("\n");
      }

      const fallbackLearnedSkills = queryPromptSkillsGlobal(db, SKILL_PROMPT_FETCH_LIMIT);
      if (fallbackLearnedSkills.length > 0) {
        const fallbackSkills = withDefaultPromptSkills(fallbackLearnedSkills);
        return [
          `[Available Skills][provider=${providerDisplay}][default=taste-skill][fallback=global]${formatPromptSkillTagLine(fallbackSkills)}`,
          "[Skills Rule] No provider-specific history yet. Use global learned skills when relevant.",
          localDefaultSkillRule,
        ].join("\n");
      }

      const defaultSkills = withDefaultPromptSkills([]);
      return [
        `[Available Skills][provider=${providerDisplay}][default=taste-skill]${formatPromptSkillTagLine(defaultSkills)}`,
        "[Skills Rule] No learned skills recorded yet.",
        localDefaultSkillRule,
      ].join("\n");
    } catch {
      const defaultSkills = withDefaultPromptSkills([]);
      return [
        `[Available Skills][provider=${providerDisplay}][default=taste-skill][fallback=unavailable]${formatPromptSkillTagLine(defaultSkills)}`,
        "[Skills Rule] Skills history lookup failed.",
        localDefaultSkillRule,
      ].join("\n");
    }
  }

  return { buildAvailableSkillsPromptBlock };
}
