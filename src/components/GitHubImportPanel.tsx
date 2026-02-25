import { useCallback, useEffect, useRef, useState } from "react";
import {
  cloneGitHubRepo,
  createProject,
  disconnectOAuth,
  getCloneStatus,
  getGitHubBranches,
  getGitHubRepos,
  getGitHubStatus,
  pollGitHubDevice,
  startGitHubDeviceFlow,
  type GitHubBranch,
  type GitHubRepo,
  type GitHubStatus,
} from "../api";
import { useI18n } from "../i18n";

interface GitHubImportPanelProps {
  onComplete: (result: { projectId: string; projectPath: string; branch: string }) => void;
  onCancel: () => void;
}

type WizardStep = "repo" | "branch" | "clone";

// --- Inline Device Code Flow sub-component ---
function GitHubDeviceConnect({
  reason,
  onConnected,
  onCancel,
}: {
  reason: "not_connected" | "missing_repo_scope";
  onConnected: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [deviceUserCode, setDeviceUserCode] = useState<string | null>(null);
  const [deviceVerifyUrl, setDeviceVerifyUrl] = useState<string | null>(null);
  const [deviceStateId, setDeviceStateId] = useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<"idle" | "waiting" | "complete" | "error">("idle");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const startFlow = useCallback(async () => {
    setDeviceError(null);
    setDeviceStatus("idle");

    // If reconnecting, disconnect first
    if (reason === "missing_repo_scope") {
      setDisconnecting(true);
      try {
        await disconnectOAuth("github-copilot");
      } catch {
        /* ok */
      }
      setDisconnecting(false);
    }

    try {
      const dc = await startGitHubDeviceFlow();
      setDeviceUserCode(dc.userCode);
      setDeviceVerifyUrl(dc.verificationUri);
      setDeviceStateId(dc.stateId);
      setDeviceStatus("waiting");

      // Open GitHub verification page
      window.open(dc.verificationUri, "_blank");

      // Recursive polling with dynamic interval (handles slow_down)
      let intervalMs = (dc.interval || 5) * 1000;
      let stopped = false;
      const poll = () => {
        if (stopped) return;
        pollTimer.current = setTimeout(async () => {
          if (stopped) return;
          try {
            const result = await pollGitHubDevice(dc.stateId);
            if (result.status === "complete") {
              stopped = true;
              setDeviceStatus("complete");
              setTimeout(onConnected, 500);
              return;
            } else if (result.status === "expired" || result.status === "denied") {
              stopped = true;
              setDeviceStatus("error");
              setDeviceError(result.status === "expired" ? "Code expired" : "Access denied");
              return;
            } else if (result.status === "slow_down") {
              // GitHub requires us to increase interval by 5 seconds
              intervalMs += 5000;
            }
          } catch (pollErr) {
            console.error("[GitHubImport] poll error:", pollErr);
          }
          poll(); // schedule next
        }, intervalMs);
      };
      poll();
    } catch (err) {
      setDeviceStatus("error");
      setDeviceError(err instanceof Error ? err.message : String(err));
    }
  }, [reason, onConnected]);

  const description =
    reason === "not_connected"
      ? t({
          ko: "GitHub 계정을 연결하면 리포지토리를 가져올 수 있습니다.",
          en: "Connect your GitHub account to import repositories.",
          ja: "GitHub アカウントを接続するとリポジトリをインポートできます。",
          zh: "连接 GitHub 账号即可导入仓库。",
        })
      : t({
          ko: "현재 GitHub 토큰에 repo 권한이 없습니다. 재연결하면 private 리포를 포함한 전체 저장소에 접근할 수 있습니다.",
          en: "Current GitHub token lacks repo scope. Reconnect to access all repositories including private ones.",
          ja: "現在の GitHub トークンに repo 権限がありません。再接続するとプライベートリポを含む全リポにアクセスできます。",
          zh: "当前 GitHub 令牌缺少 repo 权限。重新连接即可访问包括私有仓库在内的所有仓库。",
        });

  return (
    <div className="space-y-4 p-6">
      <p className="text-sm text-slate-300">{description}</p>

      {deviceStatus === "idle" && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disconnecting}
            onClick={() => void startFlow()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {disconnecting
              ? t({ ko: "연결 해제 중...", en: "Disconnecting...", ja: "切断中...", zh: "断开中..." })
              : reason === "not_connected"
                ? t({ ko: "GitHub 연결", en: "Connect GitHub", ja: "GitHub 接続", zh: "连接 GitHub" })
                : t({
                    ko: "GitHub 재연결 (repo 권한)",
                    en: "Reconnect GitHub (repo scope)",
                    ja: "GitHub 再接続 (repo 権限)",
                    zh: "重新连接 GitHub（repo 权限）",
                  })}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"
          >
            {t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
          </button>
        </div>
      )}

      {deviceStatus === "waiting" && deviceUserCode && (
        <div className="space-y-3 rounded-xl border border-blue-500/30 bg-blue-900/20 p-4">
          <p className="text-xs text-slate-300">
            {t({
              ko: "아래 코드를 GitHub 인증 페이지에 입력하세요:",
              en: "Enter this code on the GitHub verification page:",
              ja: "下記のコードを GitHub 認証ページに入力してください:",
              zh: "请在 GitHub 验证页面输入以下代码：",
            })}
          </p>
          <div className="flex items-center gap-3">
            <code className="rounded-lg bg-slate-800 px-4 py-2 text-lg font-bold tracking-widest text-white">
              {deviceUserCode}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(deviceUserCode);
              }}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              {t({ ko: "복사", en: "Copy", ja: "コピー", zh: "复制" })}
            </button>
          </div>
          {deviceVerifyUrl && (
            <a
              href={deviceVerifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-blue-400 underline hover:text-blue-300"
            >
              {t({
                ko: "GitHub 인증 페이지 열기",
                en: "Open GitHub verification page",
                ja: "GitHub 認証ページを開く",
                zh: "打开 GitHub 验证页面",
              })}
            </a>
          )}
          <p className="animate-pulse text-xs text-slate-400">
            {t({ ko: "인증 대기 중...", en: "Waiting for authorization...", ja: "認証待ち...", zh: "等待授权..." })}
          </p>
        </div>
      )}

      {deviceStatus === "complete" && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">
          {t({
            ko: "GitHub 연결 완료! 리포 목록을 불러옵니다...",
            en: "GitHub connected! Loading repositories...",
            ja: "GitHub 接続完了！リポジトリを読み込みます...",
            zh: "GitHub 已连接！正在加载仓库...",
          })}
        </div>
      )}

      {deviceStatus === "error" && (
        <div className="space-y-2">
          <div className="rounded-lg border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {deviceError}
          </div>
          <button
            type="button"
            onClick={() => {
              setDeviceStatus("idle");
              setDeviceError(null);
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
          >
            {t({ ko: "다시 시도", en: "Try again", ja: "再試行", zh: "重试" })}
          </button>
        </div>
      )}
    </div>
  );
}

export default function GitHubImportPanel({ onComplete, onCancel }: GitHubImportPanelProps) {
  const { t } = useI18n();

  // GitHub status
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Step tracking
  const [step, setStep] = useState<WizardStep>("repo");

  // Step 1: Repo selection
  const [repoSearch, setRepoSearch] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [directInput, setDirectInput] = useState("");
  const [directInputError, setDirectInputError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [patToken, setPatToken] = useState("");
  const [patLoading, setPatLoading] = useState(false);

  // Step 2: Branch selection
  const [branches, setBranches] = useState<GitHubBranch[]>([]);

  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // Step 3: Clone & create
  const [targetPath, setTargetPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [coreGoal, setCoreGoal] = useState("");
  const [cloneProgress, setCloneProgress] = useState(0);
  const [cloneStatus, setCloneStatus] = useState<string>("idle"); // idle, cloning, done, error
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load GitHub status
  useEffect(() => {
    setStatusLoading(true);
    getGitHubStatus()
      .then(setGhStatus)
      .catch(() => setGhStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  // Load repos
  const loadRepos = useCallback(async (query: string) => {
    setReposLoading(true);
    try {
      const res = await getGitHubRepos({ q: query || undefined, per_page: 30 });
      setRepos(res.repos);
    } catch {
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (!ghStatus?.connected) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void loadRepos(repoSearch);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [repoSearch, ghStatus, loadRepos]);

  // Initial load
  useEffect(() => {
    if (ghStatus?.connected) {
      void loadRepos("");
    }
  }, [ghStatus, loadRepos]);

  // Load branches when repo selected
  const handleRepoSelect = useCallback(
    async (repo: GitHubRepo, pat?: string) => {
      setSelectedRepo(repo);
      setStep("branch");
      setBranchesLoading(true);
      setBranchError(null);
      setSelectedBranch(null);
      try {
        const res = await getGitHubBranches(repo.owner, repo.name, pat);
        setBranches(res.remote_branches);
      } catch (err: any) {
        setBranches([]);
        const msg = err?.message || String(err);
        if (msg.includes("404") || msg.includes("not_found") || msg.includes("repo_not_found")) {
          setBranchError(
            t({
              ko: `리포지토리 ${repo.full_name}에 접근할 수 없습니다. 설정 → OAuth 탭에서 자체 GitHub OAuth App을 등록하면 Private 리포에 접근할 수 있습니다. 또는 아래에 PAT를 직접 입력하세요.`,
              en: `Cannot access repository ${repo.full_name}. Register your own GitHub OAuth App in Settings → OAuth tab for private repo access, or enter a PAT below.`,
              ja: `リポジトリ ${repo.full_name} にアクセスできません。設定 → OAuth タブで自前の GitHub OAuth App を登録するとプライベートリポにアクセスできます。または下に PAT を入力してください。`,
              zh: `无法访问仓库 ${repo.full_name}。在设置 → OAuth 标签中注册自己的 GitHub OAuth App 即可访问私有仓库，或在下方输入 PAT。`,
            }),
          );
        } else if (msg.includes("token_invalid")) {
          setBranchError(
            t({
              ko: "PAT가 유효하지 않거나 만료되었습니다. 다시 확인해주세요.",
              en: "PAT is invalid or expired. Please check and try again.",
              ja: "PAT が無効か期限切れです。確認して再試行してください。",
              zh: "PAT 无效或已过期，请检查后重试。",
            }),
          );
        } else {
          setBranchError(msg);
        }
      } finally {
        setBranchesLoading(false);
      }
    },
    [t],
  );

  // Direct repo input: parse "owner/repo" or GitHub URL
  const handleDirectInput = useCallback(async () => {
    setDirectInputError(null);
    const input = directInput.trim();
    // Parse: "owner/repo", "https://github.com/owner/repo", "github.com/owner/repo"
    const match = input.match(/(?:(?:https?:\/\/)?github\.com\/)?([^/\s]+)\/([^/\s#?]+)/);
    if (!match) {
      setDirectInputError(
        t({
          ko: "형식: owner/repo 또는 GitHub URL",
          en: "Format: owner/repo or GitHub URL",
          ja: "形式: owner/repo または GitHub URL",
          zh: "格式：owner/repo 或 GitHub URL",
        }),
      );
      return;
    }
    const [, owner, rawRepo] = match;
    const repoName = rawRepo.replace(/\.git$/, "");
    // Create a minimal GitHubRepo object and proceed to branch selection
    const fakeRepo: GitHubRepo = {
      id: 0,
      name: repoName,
      full_name: `${owner}/${repoName}`,
      owner,
      private: true,
      description: null,
      default_branch: "main",
      updated_at: new Date().toISOString(),
      html_url: `https://github.com/${owner}/${repoName}`,
      clone_url: `https://github.com/${owner}/${repoName}.git`,
    };
    try {
      await handleRepoSelect(fakeRepo);
    } catch (err: any) {
      // Error is already set in branchError by handleRepoSelect, but also show in directInput
      setDirectInputError(err?.message || String(err));
    }
  }, [directInput, t, handleRepoSelect]);

  // Retry branch fetch with PAT
  const handlePatRetry = useCallback(async () => {
    if (!selectedRepo || !patToken.trim()) return;
    setPatLoading(true);
    setBranchError(null);
    await handleRepoSelect(selectedRepo, patToken.trim());
    setPatLoading(false);
  }, [selectedRepo, patToken, handleRepoSelect]);

  // Select branch and go to clone step
  const handleBranchSelect = useCallback(
    (branchName: string) => {
      setSelectedBranch(branchName);
      setStep("clone");
      if (selectedRepo) {
        setProjectName(selectedRepo.name);
        setTargetPath(`~/Projects/${selectedRepo.name}`);
        setCoreGoal("");
      }
    },
    [selectedRepo],
  );

  // Clone & create project
  const handleImport = useCallback(async () => {
    if (!selectedRepo || !selectedBranch) return;
    setCreating(true);
    setCloneError(null);
    setCloneStatus("cloning");
    setCloneProgress(0);

    try {
      // Resolve ~ to home
      const resolvedPath = targetPath.startsWith("~/")
        ? targetPath // server resolves ~ to home directory
        : targetPath;
      const res = await cloneGitHubRepo({
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch: selectedBranch,
        target_path: resolvedPath,
        pat: patToken.trim() || undefined,
      });

      if (res.already_exists) {
        // Skip clone, just create project
        setCloneStatus("done");
        setCloneProgress(100);
      } else if (res.clone_id) {
        // Poll for progress
        const cloneId = res.clone_id;
        pollRef.current = setInterval(async () => {
          try {
            const status = await getCloneStatus(cloneId);
            setCloneProgress(status.progress);
            if (status.status === "done") {
              setCloneStatus("done");
              if (pollRef.current) clearInterval(pollRef.current);
            } else if (status.status === "error") {
              setCloneStatus("error");
              setCloneError(status.error || "Clone failed");
              if (pollRef.current) clearInterval(pollRef.current);
              setCreating(false);
            }
          } catch {
            // continue polling
          }
        }, 1000);
        // Wait for completion
        return;
      }

      // Create project
      const project = await createProject({
        name: projectName.trim() || selectedRepo.name,
        project_path: res.target_path || resolvedPath,
        core_goal: coreGoal.trim() || `GitHub: ${selectedRepo.full_name} (${selectedBranch})`,
        github_repo: selectedRepo.full_name,
      });
      onComplete({ projectId: project.id, projectPath: res.target_path || resolvedPath, branch: selectedBranch });
    } catch (err) {
      setCloneStatus("error");
      setCloneError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }, [selectedRepo, selectedBranch, targetPath, projectName, coreGoal, patToken, onComplete]);

  // When clone status changes to done, create project
  useEffect(() => {
    if (cloneStatus !== "done" || !creating || !selectedRepo || !selectedBranch) return;
    const resolvedPath = targetPath.startsWith("~/")
      ? targetPath // server resolves ~ to home directory
      : targetPath;
    createProject({
      name: projectName.trim() || selectedRepo.name,
      project_path: resolvedPath,
      core_goal: coreGoal.trim() || `GitHub: ${selectedRepo.full_name} (${selectedBranch})`,
      github_repo: selectedRepo.full_name,
    })
      .then((project) => {
        onComplete({ projectId: project.id, projectPath: resolvedPath, branch: selectedBranch });
      })
      .catch((err) => {
        setCloneError(err instanceof Error ? err.message : String(err));
        setCloneStatus("error");
      })
      .finally(() => setCreating(false));
  }, [cloneStatus, creating, selectedRepo, selectedBranch, targetPath, projectName, coreGoal, onComplete]);

  // Cleanup polls
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // --- Not connected / no repo scope ---
  if (statusLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-slate-400">
          {t({ ko: "확인 중...", en: "Checking...", ja: "確認中...", zh: "检查中..." })}
        </p>
      </div>
    );
  }

  // Not connected — show Device Code Flow
  if (!ghStatus?.connected) {
    return (
      <GitHubDeviceConnect
        reason="not_connected"
        onConnected={() => {
          setStatusLoading(true);
          getGitHubStatus()
            .then(setGhStatus)
            .catch(() => setGhStatus(null))
            .finally(() => setStatusLoading(false));
        }}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Step indicator */}
      <div className="flex items-center gap-2 border-b border-slate-700 px-5 py-3">
        <button
          type="button"
          onClick={() => {
            setStep("repo");
            setSelectedRepo(null);
            setSelectedBranch(null);
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium ${step === "repo" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}
        >
          1. {t({ ko: "리포 선택", en: "Select Repo", ja: "リポ選択", zh: "选择仓库" })}
        </button>
        <span className="text-slate-600">/</span>
        <button
          type="button"
          disabled={!selectedRepo}
          onClick={() => {
            if (selectedRepo) setStep("branch");
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium ${step === "branch" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"} disabled:opacity-40`}
        >
          2. {t({ ko: "브랜치", en: "Branch", ja: "ブランチ", zh: "分支" })}
        </button>
        <span className="text-slate-600">/</span>
        <button
          type="button"
          disabled={!selectedBranch}
          onClick={() => {
            if (selectedBranch) setStep("clone");
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium ${step === "clone" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"} disabled:opacity-40`}
        >
          3. {t({ ko: "가져오기", en: "Import", ja: "インポート", zh: "导入" })}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-white"
        >
          {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* Step 1: Repo selection */}
        {step === "repo" && (
          <div className="space-y-3">
            {/* Direct repo input */}
            <div className="rounded-xl border border-slate-600/50 bg-slate-800/40 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-300">
                {t({
                  ko: "직접 입력 (Private 리포 포함)",
                  en: "Direct Input (incl. private repos)",
                  ja: "直接入力（プライベートリポ含む）",
                  zh: "直接输入（含私有仓库）",
                })}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t({
                    ko: "owner/repo 또는 GitHub URL",
                    en: "owner/repo or GitHub URL",
                    ja: "owner/repo または GitHub URL",
                    zh: "owner/repo 或 GitHub URL",
                  })}
                  value={directInput}
                  onChange={(e) => {
                    setDirectInput(e.target.value);
                    setDirectInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleDirectInput();
                  }}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => void handleDirectInput()}
                  disabled={!directInput.trim()}
                  className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  {t({ ko: "이동", en: "Go", ja: "移動", zh: "前往" })}
                </button>
              </div>
              {directInputError && <p className="text-[11px] text-rose-300">{directInputError}</p>}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-slate-700" />
              <span className="text-[11px] text-slate-500">
                {t({
                  ko: "또는 목록에서 선택",
                  en: "or select from list",
                  ja: "またはリストから選択",
                  zh: "或从列表选择",
                })}
              </span>
              <div className="flex-1 border-t border-slate-700" />
            </div>

            <input
              type="text"
              placeholder={t({
                ko: "리포지토리 검색...",
                en: "Search repositories...",
                ja: "リポジトリを検索...",
                zh: "搜索仓库...",
              })}
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
            {reposLoading ? (
              <p className="text-xs text-slate-400">
                {t({ ko: "불러오는 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
              </p>
            ) : repos.length === 0 ? (
              <p className="text-xs text-slate-500">
                {t({ ko: "검색 결과 없음", en: "No results", ja: "結果なし", zh: "无结果" })}
              </p>
            ) : (
              <div className="space-y-1">
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => void handleRepoSelect(repo)}
                    className="w-full rounded-lg border border-slate-700/70 bg-slate-800/60 px-4 py-3 text-left transition hover:border-blue-500/70 hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{repo.full_name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${repo.private ? "bg-amber-600/20 text-amber-300" : "bg-emerald-600/20 text-emerald-300"}`}
                      >
                        {repo.private ? "Private" : "Public"}
                      </span>
                    </div>
                    {repo.description && <p className="mt-1 truncate text-xs text-slate-400">{repo.description}</p>}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {t({ ko: "기본 브랜치", en: "Default", ja: "デフォルト", zh: "默认分支" })}: {repo.default_branch}{" "}
                      · {new Date(repo.updated_at).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Branch selection */}
        {step === "branch" && selectedRepo && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-2">
              <p className="text-sm font-medium text-white">{selectedRepo.full_name}</p>
              {selectedRepo.description && <p className="text-xs text-slate-400">{selectedRepo.description}</p>}
            </div>
            <h4 className="text-xs font-semibold text-slate-300">
              {t({ ko: "브랜치 선택", en: "Select Branch", ja: "ブランチを選択", zh: "选择分支" })}
            </h4>
            {branchError && (
              <div className="space-y-3">
                <div className="rounded-lg border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {branchError}
                </div>
                {/* PAT input for private repos */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-900/10 p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-300">
                    {t({
                      ko: "Personal Access Token (PAT)으로 인증",
                      en: "Authenticate with Personal Access Token (PAT)",
                      ja: "Personal Access Token (PAT) で認証",
                      zh: "使用 Personal Access Token (PAT) 认证",
                    })}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t({
                      ko: "GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens에서 해당 리포 접근 권한이 있는 토큰을 생성하세요.",
                      en: "Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens and create a token with access to this repo.",
                      ja: "GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens で、このリポにアクセスできるトークンを作成してください。",
                      zh: "前往 GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens，创建具有此仓库访问权限的令牌。",
                    })}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="ghp_xxxx... or github_pat_xxxx..."
                      value={patToken}
                      onChange={(e) => setPatToken(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && patToken.trim()) void handlePatRetry();
                      }}
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handlePatRetry()}
                      disabled={!patToken.trim() || patLoading}
                      className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
                    >
                      {patLoading
                        ? t({ ko: "확인 중...", en: "Verifying...", ja: "確認中...", zh: "验证中..." })
                        : t({ ko: "인증", en: "Authenticate", ja: "認証", zh: "认证" })}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {branchesLoading ? (
              <p className="text-xs text-slate-400">
                {t({ ko: "불러오는 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
              </p>
            ) : branches.length === 0 && !branchError ? (
              <p className="text-xs text-slate-500">
                {t({ ko: "브랜치 없음", en: "No branches", ja: "ブランチなし", zh: "无分支" })}
              </p>
            ) : (
              <div className="space-y-1">
                {branches.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => handleBranchSelect(b.name)}
                    className={`w-full rounded-lg border px-4 py-2.5 text-left transition ${
                      b.is_default
                        ? "border-blue-500/50 bg-blue-900/20 hover:bg-blue-900/30"
                        : "border-slate-700/70 bg-slate-800/60 hover:border-blue-500/70 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{b.name}</span>
                      {b.is_default && (
                        <span className="rounded bg-blue-600/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                          default
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{b.sha?.slice(0, 8)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Clone & Create */}
        {step === "clone" && selectedRepo && selectedBranch && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-4 py-2">
              <p className="text-sm text-white">
                {selectedRepo.full_name} <span className="text-blue-400">({selectedBranch})</span>
              </p>
            </div>

            <label className="block text-xs text-slate-400">
              {t({ ko: "프로젝트 이름", en: "Project Name", ja: "プロジェクト名", zh: "项目名称" })}
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={creating}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </label>

            <label className="block text-xs text-slate-400">
              {t({ ko: "대상 경로", en: "Target Path", ja: "対象パス", zh: "目标路径" })}
              <input
                type="text"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                disabled={creating}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </label>

            <label className="block text-xs text-slate-400">
              {t({
                ko: "핵심 목표 (선택)",
                en: "Core Goal (optional)",
                ja: "コア目標（任意）",
                zh: "核心目标（可选）",
              })}
              <textarea
                rows={3}
                value={coreGoal}
                onChange={(e) => setCoreGoal(e.target.value)}
                disabled={creating}
                className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </label>

            {/* Progress bar */}
            {(cloneStatus === "cloning" || cloneStatus === "done") && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {cloneStatus === "done"
                      ? t({ ko: "완료", en: "Complete", ja: "完了", zh: "完成" })
                      : t({ ko: "클론 중...", en: "Cloning...", ja: "クローン中...", zh: "正在克隆..." })}
                  </span>
                  <span className="text-slate-400">{cloneProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${cloneProgress}%` }}
                  />
                </div>
              </div>
            )}

            {cloneError && (
              <div className="rounded-lg border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {cloneError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={creating || !projectName.trim() || !targetPath.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                {creating
                  ? t({ ko: "가져오는 중...", en: "Importing...", ja: "インポート中...", zh: "正在导入..." })
                  : t({
                      ko: "GitHub에서 가져오기",
                      en: "Import from GitHub",
                      ja: "GitHub からインポート",
                      zh: "从 GitHub 导入",
                    })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("branch");
                  setCloneStatus("idle");
                  setCloneError(null);
                  setCreating(false);
                }}
                disabled={creating}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
              >
                {t({ ko: "이전", en: "Back", ja: "戻る", zh: "返回" })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
