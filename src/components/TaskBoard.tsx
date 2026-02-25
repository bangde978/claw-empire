import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Task, Agent, Department, TaskStatus, TaskType, SubTask, Project } from "../types";
import AgentAvatar from "./AgentAvatar";
import AgentSelect from "./AgentSelect";
import ProjectManagerModal from "./ProjectManagerModal";
import {
  getTaskDiff,
  mergeTask,
  discardTask,
  getProjects,
  createProject,
  checkProjectPath,
  getProjectPathSuggestions,
  browseProjectPath,
  pickProjectPathNative,
  isApiRequestError,
  bulkHideTasks,
  type TaskDiffResult,
} from "../api";

interface TaskBoardProps {
  tasks: Task[];
  agents: Agent[];
  departments: Department[];
  subtasks: SubTask[];
  onCreateTask: (input: {
    title: string;
    description?: string;
    department_id?: string;
    task_type?: string;
    priority?: number;
    project_id?: string;
    project_path?: string;
    assigned_agent_id?: string;
  }) => void;
  onUpdateTask: (id: string, data: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onAssignTask: (taskId: string, agentId: string) => void;
  onRunTask: (id: string) => void;
  onStopTask: (id: string) => void;
  onPauseTask?: (id: string) => void;
  onResumeTask?: (id: string) => void;
  onOpenTerminal?: (taskId: string) => void;
  onOpenMeetingMinutes?: (taskId: string) => void;
  onMergeTask?: (id: string) => void;
  onDiscardTask?: (id: string) => void;
}

type Locale = "ko" | "en" | "ja" | "zh";
type TFunction = (messages: Record<Locale, string>) => string;

const LANGUAGE_STORAGE_KEY = "climpire.language";
const TASK_CREATE_DRAFTS_STORAGE_KEY = "climpire.taskCreateDrafts";
const HIDEABLE_STATUSES = ["done", "pending", "cancelled"] as const;
type HideableStatus = (typeof HIDEABLE_STATUSES)[number];
type CreateTaskDraft = {
  id: string;
  title: string;
  description: string;
  departmentId: string;
  taskType: TaskType;
  priority: number;
  assignAgentId: string;
  projectId: string;
  projectQuery: string;
  createNewProjectMode: boolean;
  newProjectPath: string;
  updatedAt: number;
};
type MissingPathPrompt = {
  normalizedPath: string;
  canCreate: boolean;
  nearestExistingParent: string | null;
};
type FormFeedback = {
  tone: "error" | "info";
  message: string;
};
type ManualPathEntry = {
  name: string;
  path: string;
};
const LOCALE_TAGS: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

function isHideableStatus(status: TaskStatus): status is HideableStatus {
  return (HIDEABLE_STATUSES as readonly TaskStatus[]).includes(status);
}

function createDraftId(): string {
  if (typeof globalThis !== "undefined" && typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTaskType(value: unknown): TaskType {
  if (
    value === "general" ||
    value === "development" ||
    value === "design" ||
    value === "analysis" ||
    value === "presentation" ||
    value === "documentation"
  ) {
    return value;
  }
  return "general";
}

function loadCreateTaskDrafts(): CreateTaskDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TASK_CREATE_DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: typeof r.id === "string" && r.id ? r.id : createDraftId(),
          title: typeof r.title === "string" ? r.title : "",
          description: typeof r.description === "string" ? r.description : "",
          departmentId: typeof r.departmentId === "string" ? r.departmentId : "",
          taskType: normalizeTaskType(r.taskType),
          priority: typeof r.priority === "number" ? Math.min(Math.max(Math.trunc(r.priority), 1), 5) : 3,
          assignAgentId: typeof r.assignAgentId === "string" ? r.assignAgentId : "",
          projectId: typeof r.projectId === "string" ? r.projectId : "",
          projectQuery: typeof r.projectQuery === "string" ? r.projectQuery : "",
          createNewProjectMode: Boolean(r.createNewProjectMode),
          newProjectPath: typeof r.newProjectPath === "string" ? r.newProjectPath : "",
          updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
        } satisfies CreateTaskDraft;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function saveCreateTaskDrafts(drafts: CreateTaskDraft[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TASK_CREATE_DRAFTS_STORAGE_KEY, JSON.stringify(drafts.slice(0, 20)));
}

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
  const [locale, setLocale] = useState<Locale>(() => normalizeLocale(preferredLocale) ?? detectLocale());

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
      window.removeEventListener("climpire-language-change", sync as EventListener);
    };
  }, [preferredLocale]);

  const t = useCallback((messages: Record<Locale, string>) => messages[locale] ?? messages.en, [locale]);

  return { locale, localeTag: LOCALE_TAGS[locale], t };
}

// ── Column config ──────────────────────────────────────────────────────────────

const COLUMNS: {
  status: TaskStatus;
  icon: string;
  headerBg: string;
  borderColor: string;
  dotColor: string;
}[] = [
  {
    status: "inbox",
    icon: "📥",
    headerBg: "bg-slate-800",
    borderColor: "border-slate-600",
    dotColor: "bg-slate-400",
  },
  {
    status: "planned",
    icon: "📋",
    headerBg: "bg-blue-900",
    borderColor: "border-blue-700",
    dotColor: "bg-blue-400",
  },
  {
    status: "collaborating",
    icon: "🤝",
    headerBg: "bg-indigo-900",
    borderColor: "border-indigo-700",
    dotColor: "bg-indigo-400",
  },
  {
    status: "in_progress",
    icon: "⚡",
    headerBg: "bg-amber-900",
    borderColor: "border-amber-700",
    dotColor: "bg-amber-400",
  },
  {
    status: "review",
    icon: "🔍",
    headerBg: "bg-purple-900",
    borderColor: "border-purple-700",
    dotColor: "bg-purple-400",
  },
  {
    status: "done",
    icon: "✅",
    headerBg: "bg-green-900",
    borderColor: "border-green-700",
    dotColor: "bg-green-400",
  },
  {
    status: "pending",
    icon: "⏸️",
    headerBg: "bg-orange-900",
    borderColor: "border-orange-700",
    dotColor: "bg-orange-400",
  },
  {
    status: "cancelled",
    icon: "🚫",
    headerBg: "bg-red-900",
    borderColor: "border-red-700",
    dotColor: "bg-red-400",
  },
];

const STATUS_OPTIONS: TaskStatus[] = [
  "inbox",
  "planned",
  "collaborating",
  "in_progress",
  "review",
  "done",
  "pending",
  "cancelled",
];

const TASK_TYPE_OPTIONS: { value: TaskType; color: string }[] = [
  { value: "general", color: "bg-slate-700 text-slate-300" },
  { value: "development", color: "bg-cyan-900 text-cyan-300" },
  { value: "design", color: "bg-pink-900 text-pink-300" },
  { value: "analysis", color: "bg-indigo-900 text-indigo-300" },
  { value: "presentation", color: "bg-orange-900 text-orange-300" },
  { value: "documentation", color: "bg-teal-900 text-teal-300" },
];

function taskStatusLabel(status: TaskStatus, t: TFunction) {
  switch (status) {
    case "inbox":
      return t({ ko: "수신함", en: "Inbox", ja: "受信箱", zh: "收件箱" });
    case "planned":
      return t({ ko: "계획됨", en: "Planned", ja: "計画済み", zh: "已计划" });
    case "in_progress":
      return t({ ko: "진행 중", en: "In Progress", ja: "進行中", zh: "进行中" });
    case "review":
      return t({ ko: "검토", en: "Review", ja: "レビュー", zh: "审核" });
    case "done":
      return t({ ko: "완료", en: "Done", ja: "完了", zh: "完成" });
    case "pending":
      return t({ ko: "보류", en: "Pending", ja: "保留", zh: "待处理" });
    case "cancelled":
      return t({ ko: "취소", en: "Cancelled", ja: "キャンセル", zh: "已取消" });
    default:
      return status;
  }
}

function taskTypeLabel(type: TaskType, t: TFunction) {
  switch (type) {
    case "general":
      return t({ ko: "일반", en: "General", ja: "一般", zh: "通用" });
    case "development":
      return t({ ko: "개발", en: "Development", ja: "開発", zh: "开发" });
    case "design":
      return t({ ko: "디자인", en: "Design", ja: "デザイン", zh: "设计" });
    case "analysis":
      return t({ ko: "분석", en: "Analysis", ja: "分析", zh: "分析" });
    case "presentation":
      return t({ ko: "발표", en: "Presentation", ja: "プレゼン", zh: "演示" });
    case "documentation":
      return t({ ko: "문서화", en: "Documentation", ja: "ドキュメント", zh: "文档" });
    default:
      return type;
  }
}

function getTaskTypeBadge(type: TaskType, t: TFunction) {
  const option = TASK_TYPE_OPTIONS.find((entry) => entry.value === type) ?? TASK_TYPE_OPTIONS[0];
  return { ...option, label: taskTypeLabel(option.value, t) };
}

function priorityIcon(p: number) {
  if (p >= 4) return "🔴";
  if (p >= 2) return "🟡";
  return "🟢";
}

function priorityLabel(p: number, t: TFunction) {
  if (p >= 4) return t({ ko: "높음", en: "High", ja: "高", zh: "高" });
  if (p >= 2) return t({ ko: "중간", en: "Medium", ja: "中", zh: "中" });
  return t({ ko: "낮음", en: "Low", ja: "低", zh: "低" });
}

function timeAgo(ts: number, localeTag: string): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" });
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return rtf.format(-diffH, "hour");
  return rtf.format(-Math.floor(diffH / 24), "day");
}

// ── Create Modal ──────────────────────────────────────────────────────────────

interface CreateModalProps {
  agents: Agent[];
  departments: Department[];
  onClose: () => void;
  onCreate: TaskBoardProps["onCreateTask"];
  onAssign: TaskBoardProps["onAssignTask"];
}

function CreateModal({ agents, departments, onClose, onCreate, onAssign }: CreateModalProps) {
  const { t, locale, localeTag } = useI18n();
  const initialDrafts = useMemo(() => loadCreateTaskDrafts(), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("general");
  const [priority, setPriority] = useState(3);
  const [assignAgentId, setAssignAgentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectActiveIndex, setProjectActiveIndex] = useState(-1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [createNewProjectMode, setCreateNewProjectMode] = useState(false);
  const [newProjectPath, setNewProjectPath] = useState("");
  const [pathSuggestionsOpen, setPathSuggestionsOpen] = useState(false);
  const [pathSuggestionsLoading, setPathSuggestionsLoading] = useState(false);
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [missingPathPrompt, setMissingPathPrompt] = useState<MissingPathPrompt | null>(null);
  const [manualPathPickerOpen, setManualPathPickerOpen] = useState(false);
  const [nativePathPicking, setNativePathPicking] = useState(false);
  const [manualPathLoading, setManualPathLoading] = useState(false);
  const [manualPathCurrent, setManualPathCurrent] = useState("");
  const [manualPathParent, setManualPathParent] = useState<string | null>(null);
  const [manualPathEntries, setManualPathEntries] = useState<ManualPathEntry[]>([]);
  const [manualPathTruncated, setManualPathTruncated] = useState(false);
  const [manualPathError, setManualPathError] = useState<string | null>(null);
  const [pathApiUnsupported, setPathApiUnsupported] = useState(false);
  const [nativePickerUnsupported, setNativePickerUnsupported] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitWithoutProjectPromptOpen, setSubmitWithoutProjectPromptOpen] = useState(false);
  const [formFeedback, setFormFeedback] = useState<FormFeedback | null>(null);
  const [drafts, setDrafts] = useState<CreateTaskDraft[]>(initialDrafts);
  const [restorePromptOpen, setRestorePromptOpen] = useState<boolean>(initialDrafts.length > 0);
  const [selectedRestoreDraftId, setSelectedRestoreDraftId] = useState<string | null>(initialDrafts[0]?.id ?? null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const projectPickerRef = useRef<HTMLDivElement | null>(null);

  const filteredAgents = useMemo(
    () => (departmentId ? agents.filter((a) => a.department_id === departmentId) : agents),
    [agents, departmentId],
  );

  const unsupportedPathApiMessage = useMemo(
    () =>
      t({
        ko: "현재 서버 버전은 경로 탐색 보조 기능을 지원하지 않습니다. 경로를 직접 입력해주세요.",
        en: "This server does not support path helper APIs. Enter the path manually.",
        ja: "現在のサーバーではパス補助 API をサポートしていません。手入力してください。",
        zh: "当前服务器不支持路径辅助 API，请手动输入路径。",
      }),
    [t],
  );

  const nativePickerUnavailableMessage = useMemo(
    () =>
      t({
        ko: "운영체제 폴더 선택기를 사용할 수 없는 환경입니다. 앱 내 폴더 탐색 또는 직접 입력을 사용해주세요.",
        en: "OS folder picker is unavailable in this environment. Use in-app browser or manual input.",
        ja: "この環境では OS フォルダ選択が利用できません。アプリ内閲覧または手入力を使ってください。",
        zh: "当前环境无法使用系统文件夹选择器，请使用应用内浏览或手动输入。",
      }),
    [t],
  );

  const formatAllowedRootsMessage = useCallback(
    (allowedRoots: string[]) => {
      if (allowedRoots.length === 0) {
        return t({
          ko: "허용된 프로젝트 경로 범위를 벗어났습니다.",
          en: "Path is outside allowed project roots.",
          ja: "許可されたプロジェクトパス範囲外です。",
          zh: "路径超出允许的项目根目录范围。",
        });
      }
      return t({
        ko: `허용된 프로젝트 경로 범위를 벗어났습니다. 허용 경로: ${allowedRoots.join(", ")}`,
        en: `Path is outside allowed project roots. Allowed roots: ${allowedRoots.join(", ")}`,
        ja: `許可されたプロジェクトパス範囲外です。許可パス: ${allowedRoots.join(", ")}`,
        zh: `路径超出允许的项目根目录范围。允许路径：${allowedRoots.join(", ")}`,
      });
    },
    [t],
  );

  const resolvePathHelperErrorMessage = useCallback(
    (err: unknown, fallback: Record<Locale, string>) => {
      if (!isApiRequestError(err)) return t(fallback);

      if (err.status === 404) {
        return unsupportedPathApiMessage;
      }
      if (err.code === "project_path_outside_allowed_roots") {
        const allowedRoots = Array.isArray((err.details as { allowed_roots?: unknown })?.allowed_roots)
          ? (err.details as { allowed_roots: unknown[] }).allowed_roots.filter(
              (item): item is string => typeof item === "string" && item.trim().length > 0,
            )
          : [];
        return formatAllowedRootsMessage(allowedRoots);
      }
      if (err.code === "native_picker_unavailable") {
        return nativePickerUnavailableMessage;
      }
      if (err.code === "project_path_not_directory") {
        return t({
          ko: "해당 경로는 폴더가 아닙니다. 디렉터리 경로를 입력해주세요.",
          en: "This path is not a directory. Please enter a directory path.",
          ja: "このパスはフォルダではありません。ディレクトリパスを入力してください。",
          zh: "该路径不是文件夹，请输入目录路径。",
        });
      }
      if (err.code === "project_path_not_found") {
        return t({
          ko: "해당 경로를 찾을 수 없습니다.",
          en: "Path not found.",
          ja: "パスが見つかりません。",
          zh: "找不到该路径。",
        });
      }
      return t(fallback);
    },
    [t, unsupportedPathApiMessage, formatAllowedRootsMessage, nativePickerUnavailableMessage],
  );

  const persistDrafts = useCallback((updater: (prev: CreateTaskDraft[]) => CreateTaskDraft[]) => {
    setDrafts((prev) => {
      const next = updater(prev)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
      saveCreateTaskDrafts(next);
      return next;
    });
  }, []);

  const applyDraft = useCallback((draft: CreateTaskDraft) => {
    setTitle(draft.title);
    setDescription(draft.description);
    setDepartmentId(draft.departmentId);
    setTaskType(draft.taskType);
    setPriority(draft.priority);
    setAssignAgentId(draft.assignAgentId);
    setProjectId(draft.projectId);
    setProjectQuery(draft.projectQuery);
    setCreateNewProjectMode(draft.createNewProjectMode);
    setNewProjectPath(draft.newProjectPath);
    setProjectDropdownOpen(false);
    setProjectActiveIndex(-1);
    setActiveDraftId(draft.id);
  }, []);

  const hasWorkingDraftData = useMemo(
    () =>
      Boolean(title.trim()) ||
      Boolean(description.trim()) ||
      Boolean(departmentId) ||
      taskType !== "general" ||
      priority !== 3 ||
      Boolean(assignAgentId) ||
      Boolean(projectId) ||
      Boolean(projectQuery.trim()) ||
      createNewProjectMode ||
      Boolean(newProjectPath.trim()),
    [
      title,
      description,
      departmentId,
      taskType,
      priority,
      assignAgentId,
      projectId,
      projectQuery,
      createNewProjectMode,
      newProjectPath,
    ],
  );

  const saveCurrentAsDraft = useCallback(() => {
    if (!hasWorkingDraftData) return;
    const draft: CreateTaskDraft = {
      id: activeDraftId ?? createDraftId(),
      title: title.trim(),
      description,
      departmentId,
      taskType,
      priority,
      assignAgentId,
      projectId,
      projectQuery,
      createNewProjectMode,
      newProjectPath,
      updatedAt: Date.now(),
    };
    persistDrafts((prev) => {
      const idx = prev.findIndex((item) => item.id === draft.id);
      if (idx < 0) return [draft, ...prev];
      const next = [...prev];
      next[idx] = draft;
      return next;
    });
    setActiveDraftId(draft.id);
  }, [
    hasWorkingDraftData,
    activeDraftId,
    title,
    description,
    departmentId,
    taskType,
    priority,
    assignAgentId,
    projectId,
    projectQuery,
    createNewProjectMode,
    newProjectPath,
    persistDrafts,
  ]);

  const deleteDraft = useCallback(
    (draftId: string) => {
      persistDrafts((prev) => prev.filter((item) => item.id !== draftId));
      setActiveDraftId((prev) => (prev === draftId ? null : prev));
    },
    [persistDrafts],
  );

  const clearDrafts = useCallback(() => {
    persistDrafts(() => []);
    setActiveDraftId(null);
  }, [persistDrafts]);

  const handleRequestClose = useCallback(() => {
    if (!submitBusy) saveCurrentAsDraft();
    onClose();
  }, [submitBusy, saveCurrentAsDraft, onClose]);

  useEffect(() => {
    if (drafts.length === 0 && restorePromptOpen) {
      setRestorePromptOpen(false);
    }
  }, [drafts.length, restorePromptOpen]);

  const restoreCandidates = useMemo(() => drafts.slice(0, 3), [drafts]);
  const selectedRestoreDraft = useMemo(
    () => restoreCandidates.find((item) => item.id === selectedRestoreDraftId) ?? restoreCandidates[0] ?? null,
    [restoreCandidates, selectedRestoreDraftId],
  );

  useEffect(() => {
    if (restoreCandidates.length === 0) {
      if (selectedRestoreDraftId !== null) setSelectedRestoreDraftId(null);
      return;
    }
    if (!restoreCandidates.some((item) => item.id === selectedRestoreDraftId)) {
      setSelectedRestoreDraftId(restoreCandidates[0].id);
    }
  }, [restoreCandidates, selectedRestoreDraftId]);

  const formatDraftTimestamp = useCallback(
    (ts: number) =>
      new Intl.DateTimeFormat(localeTag, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ts)),
    [localeTag],
  );

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    getProjects({ page: 1, page_size: 50 })
      .then((res) => {
        if (cancelled) return;
        setProjects(res.projects);
      })
      .catch((err) => {
        console.error("Failed to load projects for task creation:", err);
        if (cancelled) return;
        setProjects([]);
      })
      .finally(() => {
        if (cancelled) return;
        setProjectsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selected = projectId ? projects.find((p) => p.id === projectId) : undefined;
    if (!selected) return;
    setProjectQuery(selected.name);
  }, [projectId, projects]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!projectPickerRef.current) return;
      if (!projectPickerRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
        setProjectActiveIndex(-1);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedProject = useMemo(
    () => (projectId ? (projects.find((p) => p.id === projectId) ?? null) : null),
    [projectId, projects],
  );

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects.slice(0, 30);
    return projects
      .filter((project) => {
        const name = project.name.toLowerCase();
        const path = project.project_path.toLowerCase();
        const goal = project.core_goal.toLowerCase();
        return name.includes(q) || path.includes(q) || goal.includes(q);
      })
      .slice(0, 30);
  }, [projects, projectQuery]);

  useEffect(() => {
    if (!projectDropdownOpen) {
      setProjectActiveIndex(-1);
      return;
    }
    if (filteredProjects.length === 0) {
      setProjectActiveIndex(-1);
      return;
    }
    const selectedIdx = selectedProject ? filteredProjects.findIndex((p) => p.id === selectedProject.id) : -1;
    setProjectActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [projectDropdownOpen, filteredProjects, selectedProject]);

  useEffect(() => {
    if (!createNewProjectMode) {
      setPathSuggestionsOpen(false);
      setPathSuggestions([]);
      setMissingPathPrompt(null);
      setManualPathPickerOpen(false);
      setSubmitWithoutProjectPromptOpen(false);
    }
  }, [createNewProjectMode]);

  useEffect(() => {
    if (!createNewProjectMode || !pathSuggestionsOpen || pathApiUnsupported) return;
    let cancelled = false;
    setPathSuggestionsLoading(true);
    getProjectPathSuggestions(newProjectPath.trim(), 30)
      .then((paths) => {
        if (cancelled) return;
        setPathSuggestions(paths);
      })
      .catch((err) => {
        console.error("Failed to load project path suggestions:", err);
        if (cancelled) return;
        if (isApiRequestError(err) && err.status === 404) {
          setPathApiUnsupported(true);
          setPathSuggestionsOpen(false);
          setFormFeedback({ tone: "info", message: unsupportedPathApiMessage });
          return;
        }
        setPathSuggestions([]);
        setFormFeedback({
          tone: "error",
          message: resolvePathHelperErrorMessage(err, {
            ko: "경로 후보를 불러오지 못했습니다.",
            en: "Failed to load path suggestions.",
            ja: "パス候補を読み込めませんでした。",
            zh: "无法加载路径候选。",
          }),
        });
      })
      .finally(() => {
        if (cancelled) return;
        setPathSuggestionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    createNewProjectMode,
    pathSuggestionsOpen,
    newProjectPath,
    pathApiUnsupported,
    unsupportedPathApiMessage,
    resolvePathHelperErrorMessage,
  ]);

  const loadManualPathEntries = useCallback(
    async (targetPath?: string) => {
      if (pathApiUnsupported) {
        setManualPathError(unsupportedPathApiMessage);
        return;
      }
      setManualPathLoading(true);
      setManualPathError(null);
      try {
        const result = await browseProjectPath(targetPath);
        setManualPathCurrent(result.current_path);
        setManualPathParent(result.parent_path);
        setManualPathEntries(result.entries);
        setManualPathTruncated(result.truncated);
      } catch (err) {
        console.error("Failed to browse project path:", err);
        if (isApiRequestError(err) && err.status === 404) {
          setPathApiUnsupported(true);
          setManualPathPickerOpen(false);
          setManualPathError(unsupportedPathApiMessage);
          setFormFeedback({ tone: "info", message: unsupportedPathApiMessage });
        } else {
          setManualPathError(
            resolvePathHelperErrorMessage(err, {
              ko: "경로 목록을 불러오지 못했습니다.",
              en: "Failed to load directories.",
              ja: "ディレクトリ一覧を読み込めませんでした。",
              zh: "无法加载目录列表。",
            }),
          );
        }
        setManualPathEntries([]);
        setManualPathTruncated(false);
      } finally {
        setManualPathLoading(false);
      }
    },
    [pathApiUnsupported, unsupportedPathApiMessage, resolvePathHelperErrorMessage],
  );

  const selectProject = useCallback((project: Project | null) => {
    setFormFeedback(null);
    setSubmitWithoutProjectPromptOpen(false);
    if (!project) {
      setProjectId("");
      setProjectQuery("");
      setProjectDropdownOpen(false);
      setProjectActiveIndex(-1);
      setCreateNewProjectMode(false);
      setNewProjectPath("");
      return;
    }
    setProjectId(project.id);
    setProjectQuery(project.name);
    setProjectDropdownOpen(false);
    setProjectActiveIndex(-1);
    setCreateNewProjectMode(false);
    setNewProjectPath("");
  }, []);

  const handleProjectInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setProjectDropdownOpen(false);
        setProjectActiveIndex(-1);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setProjectDropdownOpen(true);
        setProjectActiveIndex((prev) => {
          if (filteredProjects.length === 0) return -1;
          if (prev < 0) return 0;
          return Math.min(prev + 1, filteredProjects.length - 1);
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setProjectDropdownOpen(true);
        setProjectActiveIndex((prev) => {
          if (filteredProjects.length === 0) return -1;
          if (prev < 0) return filteredProjects.length - 1;
          return Math.max(prev - 1, 0);
        });
        return;
      }

      if (e.key === "Enter" && projectDropdownOpen) {
        e.preventDefault();
        if (projectActiveIndex >= 0 && projectActiveIndex < filteredProjects.length) {
          selectProject(filteredProjects[projectActiveIndex]);
        }
      }
    },
    [filteredProjects, projectActiveIndex, projectDropdownOpen, selectProject],
  );

  async function submitTask(options?: { allowCreateMissingPath?: boolean; allowWithoutProject?: boolean }) {
    const allowCreateMissingPath = options?.allowCreateMissingPath ?? false;
    const allowWithoutProject = options?.allowWithoutProject ?? false;
    if (!title.trim()) return;
    if (submitBusy) return;
    setFormFeedback(null);
    setSubmitWithoutProjectPromptOpen(false);

    let resolvedProject = selectedProject;

    if (!resolvedProject && projectQuery.trim()) {
      const q = projectQuery.trim().toLowerCase();
      const exact = projects.find((p) => p.name.toLowerCase() === q || p.project_path.toLowerCase() === q);
      if (exact) {
        resolvedProject = exact;
      } else {
        const prefixMatches = projects.filter(
          (p) => p.name.toLowerCase().startsWith(q) || p.project_path.toLowerCase().startsWith(q),
        );
        if (prefixMatches.length === 1) {
          resolvedProject = prefixMatches[0];
        }
      }
    }

    if (projectId && !resolvedProject) {
      setFormFeedback({
        tone: "error",
        message: t({
          ko: "선택한 프로젝트를 찾을 수 없습니다. 다시 선택해주세요.",
          en: "The selected project was not found. Please select again.",
          ja: "選択したプロジェクトが見つかりません。再度選択してください。",
          zh: "找不到所选项目，请重新选择。",
        }),
      });
      return;
    }

    if (!resolvedProject && projectQuery.trim() && !createNewProjectMode) {
      setFormFeedback({
        tone: "error",
        message: t({
          ko: "입력한 프로젝트를 확정할 수 없습니다. 목록에서 선택하거나 비워두고 진행해주세요.",
          en: "Could not resolve the typed project. Pick from the list or clear it to continue.",
          ja: "入力したプロジェクトを特定できません。リストから選択するか、空欄で続行してください。",
          zh: "无法确定输入的项目。请从列表选择，或清空后继续。",
        }),
      });
      setProjectDropdownOpen(true);
      return;
    }

    if (!resolvedProject && createNewProjectMode) {
      const projectName = projectQuery.trim();
      const coreGoal = description.trim();
      if (!projectName) {
        setFormFeedback({
          tone: "error",
          message: t({
            ko: "신규 프로젝트명을 입력해주세요.",
            en: "Please enter a new project name.",
            ja: "新規プロジェクト名を入力してください。",
            zh: "请输入新项目名称。",
          }),
        });
        return;
      }
      if (!newProjectPath.trim()) {
        setFormFeedback({
          tone: "error",
          message: t({
            ko: "신규 프로젝트 경로를 입력해주세요.",
            en: "Please enter a new project path.",
            ja: "新規プロジェクトのパスを入力してください。",
            zh: "请输入新项目路径。",
          }),
        });
        return;
      }
      if (!coreGoal) {
        setFormFeedback({
          tone: "error",
          message: t({
            ko: "신규 프로젝트 생성 시 설명은 필수이며, 프로젝트 핵심 목표로 저장됩니다.",
            en: "Description is required for new project creation and will be saved as the project core goal.",
            ja: "新規プロジェクト作成時は説明が必須で、プロジェクトのコア目標として保存されます。",
            zh: "创建新项目时说明为必填，并会保存为项目核心目标。",
          }),
        });
        return;
      }

      setSubmitBusy(true);
      try {
        const rawNewProjectPath = newProjectPath.trim();
        let normalizedPath = rawNewProjectPath;
        let createPathIfMissing = true;

        try {
          const pathCheck = await checkProjectPath(rawNewProjectPath);
          normalizedPath = pathCheck.normalized_path || rawNewProjectPath;
          if (normalizedPath !== rawNewProjectPath) {
            setNewProjectPath(normalizedPath);
          }

          if (pathCheck.exists && !pathCheck.is_directory) {
            setFormFeedback({
              tone: "error",
              message: t({
                ko: "입력한 경로가 폴더가 아닙니다. 디렉터리 경로를 입력해주세요.",
                en: "The path is not a directory. Please enter a directory path.",
                ja: "入力したパスはフォルダではありません。ディレクトリパスを指定してください。",
                zh: "该路径不是文件夹，请输入目录路径。",
              }),
            });
            return;
          }

          if (!pathCheck.exists && !allowCreateMissingPath) {
            setMissingPathPrompt({
              normalizedPath,
              canCreate: pathCheck.can_create,
              nearestExistingParent: pathCheck.nearest_existing_parent,
            });
            return;
          }
          createPathIfMissing = !pathCheck.exists && allowCreateMissingPath;
        } catch (pathCheckErr) {
          if (isApiRequestError(pathCheckErr) && pathCheckErr.status === 404) {
            setPathApiUnsupported(true);
            setFormFeedback({ tone: "info", message: unsupportedPathApiMessage });
            createPathIfMissing = true;
          } else {
            setFormFeedback({
              tone: "error",
              message: resolvePathHelperErrorMessage(pathCheckErr, {
                ko: "프로젝트 경로 확인에 실패했습니다.",
                en: "Failed to verify project path.",
                ja: "プロジェクトパスの確認に失敗しました。",
                zh: "项目路径校验失败。",
              }),
            });
            return;
          }
        }

        const createdProject = await createProject({
          name: projectName,
          project_path: normalizedPath,
          core_goal: coreGoal,
          create_path_if_missing: createPathIfMissing,
        });
        setMissingPathPrompt(null);
        resolvedProject = createdProject;
        setProjectId(createdProject.id);
        setProjectQuery(createdProject.name);
        setCreateNewProjectMode(false);
        setProjects((prev) => {
          if (prev.some((p) => p.id === createdProject.id)) return prev;
          return [createdProject, ...prev];
        });
      } catch (err) {
        console.error("Failed to create project during task creation:", err);
        if (isApiRequestError(err) && err.code === "project_path_conflict") {
          const details =
            (err.details as {
              existing_project_id?: unknown;
              existing_project_name?: unknown;
              existing_project_path?: unknown;
            } | null) ?? null;
          const existingProjectId = typeof details?.existing_project_id === "string" ? details.existing_project_id : "";
          const existingProjectName =
            typeof details?.existing_project_name === "string" ? details.existing_project_name : "";
          const existingProjectPath =
            typeof details?.existing_project_path === "string" ? details.existing_project_path : "";
          const existingProject = projects.find(
            (project) =>
              (existingProjectId && project.id === existingProjectId) ||
              (existingProjectPath && project.project_path === existingProjectPath),
          );
          if (existingProject) {
            selectProject(existingProject);
          } else {
            setCreateNewProjectMode(false);
            setProjectDropdownOpen(true);
            void getProjects({ page: 1, page_size: 50 })
              .then((res) => setProjects(res.projects))
              .catch((loadErr) => {
                console.error("Failed to refresh projects after path conflict:", loadErr);
              });
          }
          setFormFeedback({
            tone: "info",
            message: t({
              ko: existingProjectName
                ? `이미 '${existingProjectName}' 프로젝트에서 사용 중인 경로입니다. 기존 프로젝트를 선택해주세요.`
                : "이미 등록된 프로젝트 경로입니다. 기존 프로젝트를 선택해주세요.",
              en: existingProjectName
                ? `This path is already used by '${existingProjectName}'. Please use the existing project.`
                : "This path is already used by another project. Please use the existing project.",
              ja: existingProjectName
                ? `このパスは既に '${existingProjectName}' で使用中です。既存プロジェクトを選択してください。`
                : "このパスは既存プロジェクトで使用中です。既存プロジェクトを選択してください。",
              zh: existingProjectName
                ? `该路径已被‘${existingProjectName}’使用，请选择已有项目。`
                : "该路径已被现有项目使用，请选择已有项目。",
            }),
          });
          return;
        }
        if (isApiRequestError(err) && err.code === "project_path_not_found") {
          const details =
            (err.details as {
              normalized_path?: unknown;
              can_create?: unknown;
              nearest_existing_parent?: unknown;
            } | null) ?? null;
          setMissingPathPrompt({
            normalizedPath:
              typeof details?.normalized_path === "string" ? details.normalized_path : newProjectPath.trim(),
            canCreate: Boolean(details?.can_create),
            nearestExistingParent:
              typeof details?.nearest_existing_parent === "string" ? details.nearest_existing_parent : null,
          });
          return;
        }
        setFormFeedback({
          tone: "error",
          message: resolvePathHelperErrorMessage(err, {
            ko: "신규 프로젝트 생성에 실패했습니다. 프로젝트명/경로를 확인해주세요.",
            en: "Failed to create a new project. Please check name/path.",
            ja: "新規プロジェクトの作成に失敗しました。名前/パスを確認してください。",
            zh: "新项目创建失败，请检查名称/路径。",
          }),
        });
        return;
      } finally {
        setSubmitBusy(false);
      }
    }

    if (!resolvedProject && !allowWithoutProject) {
      setSubmitWithoutProjectPromptOpen(true);
      return;
    }

    setSubmitBusy(true);
    try {
      await Promise.resolve(
        onCreate({
          title: title.trim(),
          description: description.trim() || undefined,
          department_id: departmentId || undefined,
          task_type: taskType,
          priority,
          project_id: resolvedProject?.id,
          project_path: resolvedProject?.project_path,
          assigned_agent_id: assignAgentId || undefined,
        }),
      );
      onClose();
    } catch (err) {
      console.error("Failed to create task:", err);
      setFormFeedback({
        tone: "error",
        message: t({
          ko: "업무 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
          en: "Failed to create task. Please try again shortly.",
          ja: "タスク作成中にエラーが発生しました。しばらくしてから再試行してください。",
          zh: "创建任务时发生错误，请稍后重试。",
        }),
      });
    } finally {
      setSubmitBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitTask();
  }

  const prioritySection = (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-300">
        {t({ ko: "우선순위", en: "Priority", ja: "優先度", zh: "优先级" })}: {priorityIcon(priority)}{" "}
        {priorityLabel(priority, t)} ({priority}/5)
      </label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => {
              setPriority(star);
              setFormFeedback(null);
            }}
            className={`flex-1 rounded-lg py-2 text-lg transition ${
              star <= priority ? "bg-amber-600 text-white shadow-md" : "bg-slate-800 text-slate-500 hover:bg-slate-700"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );

  const assigneeSection = (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-300">
        {t({ ko: "담당 에이전트", en: "Assignee", ja: "担当エージェント", zh: "负责人" })}
      </label>
      <AgentSelect
        agents={filteredAgents}
        departments={departments}
        value={assignAgentId}
        onChange={(value) => {
          setAssignAgentId(value);
          setFormFeedback(null);
        }}
        placeholder={t({
          ko: "-- 미배정 --",
          en: "-- Unassigned --",
          ja: "-- 未割り当て --",
          zh: "-- 未分配 --",
        })}
        size="md"
      />
      {departmentId && filteredAgents.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {t({
            ko: "해당 부서에 에이전트가 없습니다.",
            en: "No agents are available in this department.",
            ja: "この部署にはエージェントがいません。",
            zh: "该部门暂无可用代理。",
          })}
        </p>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div
        className={`my-3 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl transition-[max-width] duration-300 ease-out sm:my-0 sm:max-h-[90dvh] lg:max-h-none lg:max-w-2xl ${
          createNewProjectMode ? "lg:max-w-5xl" : ""
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-5">
          <h2 className="text-lg font-bold text-white">
            {t({ ko: "새 업무 만들기", en: "Create New Task", ja: "新しいタスクを作成", zh: "创建新任务" })}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setRestorePromptOpen(false);
                setDraftModalOpen(true);
              }}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
              title={t({
                ko: "임시 저장 항목 열기",
                en: "Open temporary drafts",
                ja: "一時保存を開く",
                zh: "打开临时草稿",
              })}
            >
              {`[${t({ ko: "임시", en: "Temp", ja: "一時", zh: "临时" })}(${drafts.length})]`}
            </button>
            <button
              onClick={handleRequestClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              title={t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
            >
              ✕
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div
            className={`min-h-0 flex-1 overflow-y-auto px-6 py-4 lg:overflow-visible ${createNewProjectMode ? "lg:grid lg:grid-cols-2 lg:gap-5" : ""}`}
          >
            <div className="min-w-0 space-y-4">
              {/* Title */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  {t({ ko: "제목", en: "Title", ja: "タイトル", zh: "标题" })} <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setFormFeedback(null);
                  }}
                  placeholder={t({
                    ko: "업무 제목을 입력하세요",
                    en: "Enter a task title",
                    ja: "タスクのタイトルを入力してください",
                    zh: "请输入任务标题",
                  })}
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  {t({ ko: "설명", en: "Description", ja: "説明", zh: "说明" })}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setFormFeedback(null);
                  }}
                  placeholder={t({
                    ko: "업무에 대한 상세 설명을 입력하세요",
                    en: "Enter a detailed description",
                    ja: "タスクの詳細説明を入力してください",
                    zh: "请输入任务详细说明",
                  })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Department + Task Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">
                    {t({ ko: "부서", en: "Department", ja: "部署", zh: "部门" })}
                  </label>
                  <select
                    value={departmentId}
                    onChange={(e) => {
                      setFormFeedback(null);
                      setDepartmentId(e.target.value);
                      setAssignAgentId("");
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">
                      {t({ ko: "-- 전체 --", en: "-- All --", ja: "-- 全体 --", zh: "-- 全部 --" })}
                    </option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.icon} {locale === "ko" ? d.name_ko : d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">
                    {t({ ko: "업무 유형", en: "Task Type", ja: "タスク種別", zh: "任务类型" })}
                  </label>
                  <select
                    value={taskType}
                    onChange={(e) => {
                      setTaskType(e.target.value as TaskType);
                      setFormFeedback(null);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {TASK_TYPE_OPTIONS.map((typeOption) => (
                      <option key={typeOption.value} value={typeOption.value}>
                        {taskTypeLabel(typeOption.value, t)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Project */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  {t({ ko: "프로젝트명", en: "Project Name", ja: "プロジェクト名", zh: "项目名" })}
                </label>
                <div className="relative" ref={projectPickerRef}>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={projectQuery}
                      onChange={(e) => {
                        setFormFeedback(null);
                        setSubmitWithoutProjectPromptOpen(false);
                        setProjectQuery(e.target.value);
                        setProjectId("");
                        setProjectDropdownOpen(true);
                        setCreateNewProjectMode(false);
                        setNewProjectPath("");
                      }}
                      onFocus={() => setProjectDropdownOpen(true)}
                      onKeyDown={handleProjectInputKeyDown}
                      placeholder={t({
                        ko: "프로젝트 이름 또는 경로 입력",
                        en: "Type project name or path",
                        ja: "プロジェクト名またはパスを入力",
                        zh: "输入项目名称或路径",
                      })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setProjectDropdownOpen((prev) => !prev);
                        if (!projectDropdownOpen && filteredProjects.length > 0) {
                          setProjectActiveIndex(0);
                        }
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs text-slate-300 transition hover:bg-slate-700 hover:text-white"
                      title={t({
                        ko: "프로젝트 목록 토글",
                        en: "Toggle project list",
                        ja: "プロジェクト一覧の切替",
                        zh: "切换项目列表",
                      })}
                    >
                      {projectDropdownOpen ? "▲" : "▼"}
                    </button>
                  </div>

                  {projectDropdownOpen && (
                    <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectProject(null);
                        }}
                        className="w-full border-b border-slate-800 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800"
                      >
                        {t({
                          ko: "-- 프로젝트 미지정 --",
                          en: "-- No project --",
                          ja: "-- プロジェクトなし --",
                          zh: "-- 无项目 --",
                        })}
                      </button>
                      {projectsLoading ? (
                        <div className="px-3 py-2 text-sm text-slate-400">
                          {t({
                            ko: "프로젝트 불러오는 중...",
                            en: "Loading projects...",
                            ja: "プロジェクトを読み込み中...",
                            zh: "正在加载项目...",
                          })}
                        </div>
                      ) : filteredProjects.length === 0 ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-300">
                          <p className="pr-2">
                            {t({
                              ko: "신규 프로젝트로 생성할까요?",
                              en: "Create as a new project?",
                              ja: "新規プロジェクトとして作成しますか？",
                              zh: "要创建为新项目吗？",
                            })}
                          </p>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setFormFeedback(null);
                              setCreateNewProjectMode(true);
                              setProjectDropdownOpen(false);
                            }}
                            className="ml-auto shrink-0 rounded-md border border-emerald-500 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                          >
                            {t({ ko: "예", en: "Yes", ja: "はい", zh: "是" })}
                          </button>
                        </div>
                      ) : (
                        filteredProjects.map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectProject(project);
                            }}
                            onMouseEnter={() => {
                              const idx = filteredProjects.findIndex((p) => p.id === project.id);
                              setProjectActiveIndex(idx);
                            }}
                            className={`w-full px-3 py-2 text-left transition hover:bg-slate-800 ${
                              projectActiveIndex >= 0 && filteredProjects[projectActiveIndex]?.id === project.id
                                ? "bg-slate-700/90"
                                : selectedProject?.id === project.id
                                  ? "bg-slate-800/80"
                                  : ""
                            }`}
                          >
                            <div className="truncate text-sm text-slate-100">{project.name}</div>
                            <div className="truncate text-[11px] text-slate-400">{project.project_path}</div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {selectedProject && (
                  <p className="mt-1 break-all text-xs text-slate-400">{selectedProject.project_path}</p>
                )}
                {createNewProjectMode && !selectedProject && (
                  <div className="mt-2 space-y-2">
                    <label className="block text-xs text-slate-400">
                      {t({
                        ko: "신규 프로젝트 경로",
                        en: "New project path",
                        ja: "新規プロジェクトパス",
                        zh: "新项目路径",
                      })}
                    </label>
                    <input
                      type="text"
                      value={newProjectPath}
                      onChange={(e) => {
                        setNewProjectPath(e.target.value);
                        setMissingPathPrompt(null);
                        setFormFeedback(null);
                      }}
                      placeholder="/absolute/path/to/project"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={pathApiUnsupported}
                        onClick={() => {
                          setFormFeedback(null);
                          setManualPathPickerOpen(true);
                          void loadManualPathEntries(newProjectPath.trim() || undefined);
                        }}
                        className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t({
                          ko: "앱 내 폴더 탐색",
                          en: "In-App Folder Browser",
                          ja: "アプリ内フォルダ閲覧",
                          zh: "应用内文件夹浏览",
                        })}
                      </button>
                      <button
                        type="button"
                        disabled={pathApiUnsupported}
                        onClick={() => {
                          setFormFeedback(null);
                          setPathSuggestionsOpen((prev) => !prev);
                        }}
                        className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {pathSuggestionsOpen
                          ? t({
                              ko: "자동 경로찾기 닫기",
                              en: "Close Auto Finder",
                              ja: "自動候補を閉じる",
                              zh: "关闭自动查找",
                            })
                          : t({ ko: "자동 경로찾기", en: "Auto Path Finder", ja: "自動パス検索", zh: "自动路径查找" })}
                      </button>
                      <button
                        type="button"
                        disabled={nativePathPicking || nativePickerUnsupported}
                        onClick={async () => {
                          setNativePathPicking(true);
                          try {
                            const picked = await pickProjectPathNative();
                            if (picked.cancelled || !picked.path) return;
                            setNewProjectPath(picked.path);
                            setMissingPathPrompt(null);
                            setPathSuggestionsOpen(false);
                            setFormFeedback(null);
                          } catch (err) {
                            console.error("Failed to open native path picker:", err);
                            if (isApiRequestError(err) && err.status === 404) {
                              setPathApiUnsupported(true);
                              setFormFeedback({ tone: "info", message: unsupportedPathApiMessage });
                            } else {
                              const message = resolvePathHelperErrorMessage(err, {
                                ko: "운영체제 폴더 선택기를 열지 못했습니다.",
                                en: "Failed to open OS folder picker.",
                                ja: "OSフォルダ選択を開けませんでした。",
                                zh: "无法打开系统文件夹选择器。",
                              });
                              if (
                                isApiRequestError(err) &&
                                (err.code === "native_picker_unavailable" || err.code === "native_picker_failed")
                              ) {
                                setNativePickerUnsupported(true);
                                setFormFeedback({ tone: "info", message });
                              } else {
                                setFormFeedback({ tone: "error", message });
                              }
                            }
                          } finally {
                            setNativePathPicking(false);
                          }
                        }}
                        className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {nativePathPicking
                          ? t({
                              ko: "수동 경로찾기 여는 중...",
                              en: "Opening Manual Picker...",
                              ja: "手動パス選択を開いています...",
                              zh: "正在打开手动路径选择...",
                            })
                          : nativePickerUnsupported
                            ? t({
                                ko: "수동 경로찾기(사용불가)",
                                en: "Manual Path Finder (Unavailable)",
                                ja: "手動パス選択（利用不可）",
                                zh: "手动路径选择（不可用）",
                              })
                            : t({
                                ko: "수동 경로찾기",
                                en: "Manual Path Finder",
                                ja: "手動パス選択",
                                zh: "手动路径选择",
                              })}
                      </button>
                    </div>
                    {pathSuggestionsOpen && (
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/70">
                        {pathSuggestionsLoading ? (
                          <p className="px-3 py-2 text-xs text-slate-400">
                            {t({
                              ko: "경로 후보를 불러오는 중...",
                              en: "Loading path suggestions...",
                              ja: "パス候補を読み込み中...",
                              zh: "正在加载路径候选...",
                            })}
                          </p>
                        ) : pathSuggestions.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-slate-400">
                            {t({
                              ko: "추천 경로가 없습니다. 직접 입력해주세요.",
                              en: "No suggested path. Enter one manually.",
                              ja: "候補パスがありません。手入力してください。",
                              zh: "没有推荐路径，请手动输入。",
                            })}
                          </p>
                        ) : (
                          pathSuggestions.map((candidate) => (
                            <button
                              key={candidate}
                              type="button"
                              onClick={() => {
                                setNewProjectPath(candidate);
                                setMissingPathPrompt(null);
                                setPathSuggestionsOpen(false);
                              }}
                              className="w-full px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-slate-700/70"
                            >
                              {candidate}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    {missingPathPrompt && (
                      <p className="text-xs text-amber-300">
                        {t({
                          ko: "해당 경로가 아직 존재하지 않습니다. 생성 확인 후 진행됩니다.",
                          en: "This path does not exist yet. Creation confirmation will be requested.",
                          ja: "このパスはまだ存在しません。作成確認後に続行されます。",
                          zh: "该路径当前不存在，提交时会先请求创建确认。",
                        })}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      {t({
                        ko: "설명 항목 내용이 신규 프로젝트의 핵심 목표(core_goal)로 저장됩니다.",
                        en: "Description will be saved as the new project core goal.",
                        ja: "説明欄の内容が新規プロジェクトのコア目標として保存されます。",
                        zh: "说明内容会保存为新项目的核心目标。",
                      })}
                    </p>
                  </div>
                )}
                {!projectsLoading && projects.length === 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {t({
                      ko: "등록된 프로젝트가 없습니다. 프로젝트 관리에서 먼저 생성해주세요.",
                      en: "No registered project. Create one first in Project Manager.",
                      ja: "登録済みプロジェクトがありません。先にプロジェクト管理で作成してください。",
                      zh: "暂无已注册项目。请先在项目管理中创建。",
                    })}
                  </p>
                )}
              </div>

              <div className={createNewProjectMode ? "lg:hidden" : ""}>{prioritySection}</div>
              <div className={createNewProjectMode ? "lg:hidden" : ""}>{assigneeSection}</div>
            </div>
            {createNewProjectMode && (
              <aside className="hidden min-w-0 lg:block lg:transition-all lg:duration-300 lg:ease-out">
                <div className="space-y-4 rounded-xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                  {prioritySection}
                  {assigneeSection}
                </div>
              </aside>
            )}
          </div>

          {formFeedback && (
            <div className="px-6 pb-3">
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  formFeedback.tone === "error"
                    ? "border-rose-500/60 bg-rose-500/10 text-rose-200"
                    : "border-cyan-500/50 bg-cyan-500/10 text-cyan-100"
                }`}
              >
                {formFeedback.message}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-slate-700 px-6 py-4">
            <button
              type="button"
              onClick={handleRequestClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitBusy}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitBusy
                ? t({ ko: "생성 중...", en: "Creating...", ja: "作成中...", zh: "创建中..." })
                : t({ ko: "업무 만들기", en: "Create Task", ja: "タスク作成", zh: "创建任务" })}
            </button>
          </div>
        </form>
      </div>

      {restorePromptOpen && selectedRestoreDraft && (
        <div
          className="fixed inset-0 z-[58] flex items-center justify-center bg-black/65 p-4"
          onClick={() => setRestorePromptOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {t({
                  ko: "임시 데이터 복구",
                  en: "Restore Draft",
                  ja: "下書き復元",
                  zh: "恢复草稿",
                })}
              </h3>
            </div>
            <div className="space-y-2 px-4 py-4">
              <p className="text-sm text-slate-200">
                {t({
                  ko: "기존에 입력하던 데이터가 있습니다. 불러오시겠습니까?",
                  en: "There is previously entered data. Would you like to load it?",
                  ja: "以前入力していたデータがあります。読み込みますか？",
                  zh: "检测到之前输入的数据，是否加载？",
                })}
              </p>
              <p className="text-xs text-slate-400">
                {t({
                  ko: "최근 임시 항목 (최대 3개)",
                  en: "Recent drafts (up to 3)",
                  ja: "最近の下書き（最大3件）",
                  zh: "最近草稿（最多3个）",
                })}
              </p>
              <div className="space-y-2">
                {restoreCandidates.map((draft) => {
                  const isSelected = selectedRestoreDraft.id === draft.id;
                  return (
                    <button
                      key={draft.id}
                      type="button"
                      onClick={() => setSelectedRestoreDraftId(draft.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        isSelected
                          ? "border-blue-500 bg-blue-500/15"
                          : "border-slate-700 bg-slate-800/70 hover:bg-slate-800"
                      }`}
                    >
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {draft.title ||
                          t({
                            ko: "(제목 없음)",
                            en: "(Untitled)",
                            ja: "(無題)",
                            zh: "（无标题）",
                          })}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatDraftTimestamp(draft.updatedAt)} · {timeAgo(draft.updatedAt, localeTag)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => setRestorePromptOpen(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {t({ ko: "새로 작성", en: "Start Fresh", ja: "新規作成", zh: "重新填写" })}
              </button>
              <button
                type="button"
                onClick={() => {
                  applyDraft(selectedRestoreDraft);
                  setRestorePromptOpen(false);
                }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
              >
                {t({ ko: "불러오기", en: "Load", ja: "読み込み", zh: "加载" })}
              </button>
            </div>
          </div>
        </div>
      )}

      {submitWithoutProjectPromptOpen && (
        <div
          className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSubmitWithoutProjectPromptOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {t({
                  ko: "프로젝트 연결 없이 생성",
                  en: "Create Without Project",
                  ja: "プロジェクト未連携で作成",
                  zh: "不关联项目创建",
                })}
              </h3>
            </div>
            <div className="space-y-2 px-4 py-4">
              <p className="text-sm text-slate-200">
                {t({
                  ko: "프로젝트 연결 없이 업무를 생성하시겠습니까?",
                  en: "Create this task without a project link?",
                  ja: "プロジェクト未連携でタスクを作成しますか？",
                  zh: "要在不关联项目的情况下创建任务吗？",
                })}
              </p>
              <p className="text-xs text-slate-400">
                {t({
                  ko: "이 경우 프로젝트 이력에는 집계되지 않습니다.",
                  en: "It will not appear in project history.",
                  ja: "この場合、プロジェクト履歴には集計されません。",
                  zh: "该任务不会出现在项目历史中。",
                })}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => setSubmitWithoutProjectPromptOpen(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubmitWithoutProjectPromptOpen(false);
                  void submitTask({ allowWithoutProject: true });
                }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
              >
                {t({ ko: "계속", en: "Continue", ja: "続行", zh: "继续" })}
              </button>
            </div>
          </div>
        </div>
      )}

      {missingPathPrompt && (
        <div
          className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setMissingPathPrompt(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {t({
                  ko: "프로젝트 경로 확인",
                  en: "Confirm Project Path",
                  ja: "プロジェクトパス確認",
                  zh: "确认项目路径",
                })}
              </h3>
            </div>
            <div className="space-y-2 px-4 py-4">
              <p className="text-sm text-slate-200">
                {t({
                  ko: "해당 경로가 없습니다. 추가하시겠습니까?",
                  en: "This path does not exist. Create it now?",
                  ja: "このパスは存在しません。作成しますか？",
                  zh: "该路径不存在。现在创建吗？",
                })}
              </p>
              <p className="break-all rounded-md border border-slate-700 bg-slate-800/70 px-2.5 py-2 text-xs text-slate-200">
                {missingPathPrompt.normalizedPath}
              </p>
              {missingPathPrompt.nearestExistingParent && (
                <p className="text-xs text-slate-400">
                  {t({
                    ko: `기준 폴더: ${missingPathPrompt.nearestExistingParent}`,
                    en: `Base folder: ${missingPathPrompt.nearestExistingParent}`,
                    ja: `基準フォルダ: ${missingPathPrompt.nearestExistingParent}`,
                    zh: `基准目录：${missingPathPrompt.nearestExistingParent}`,
                  })}
                </p>
              )}
              {!missingPathPrompt.canCreate && (
                <p className="text-xs text-amber-300">
                  {t({
                    ko: "현재 권한으로 해당 경로를 생성할 수 없습니다. 다른 경로를 선택해주세요.",
                    en: "This path is not creatable with current permissions. Choose another path.",
                    ja: "現在の権限ではこのパスを作成できません。別のパスを指定してください。",
                    zh: "当前权限无法创建此路径，请选择其他路径。",
                  })}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => setMissingPathPrompt(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                type="button"
                disabled={!missingPathPrompt.canCreate || submitBusy}
                onClick={() => {
                  setMissingPathPrompt(null);
                  void submitTask({ allowCreateMissingPath: true });
                }}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t({ ko: "예", en: "Yes", ja: "はい", zh: "是" })}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualPathPickerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setManualPathPickerOpen(false)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {t({
                  ko: "앱 내 폴더 탐색",
                  en: "In-App Folder Browser",
                  ja: "アプリ内フォルダ閲覧",
                  zh: "应用内文件夹浏览",
                })}
              </h3>
              <button
                type="button"
                onClick={() => setManualPathPickerOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2">
                <p className="text-[11px] text-slate-400">
                  {t({ ko: "현재 위치", en: "Current Location", ja: "現在位置", zh: "当前位置" })}
                </p>
                <p className="break-all text-xs text-slate-200">{manualPathCurrent || "-"}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!manualPathParent || manualPathLoading}
                  onClick={() => {
                    if (!manualPathParent) return;
                    void loadManualPathEntries(manualPathParent);
                  }}
                  className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t({ ko: "상위 폴더", en: "Up", ja: "上位フォルダ", zh: "上级目录" })}
                </button>
                <button
                  type="button"
                  disabled={manualPathLoading}
                  onClick={() => void loadManualPathEntries(manualPathCurrent || undefined)}
                  className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t({ ko: "새로고침", en: "Refresh", ja: "更新", zh: "刷新" })}
                </button>
              </div>
              <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50">
                {manualPathLoading ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {t({
                      ko: "폴더 목록을 불러오는 중...",
                      en: "Loading directories...",
                      ja: "フォルダ一覧を読み込み中...",
                      zh: "正在加载目录...",
                    })}
                  </p>
                ) : manualPathError ? (
                  <p className="px-3 py-2 text-xs text-rose-300">{manualPathError}</p>
                ) : manualPathEntries.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {t({
                      ko: "선택 가능한 하위 폴더가 없습니다.",
                      en: "No selectable subdirectories.",
                      ja: "選択可能なサブディレクトリがありません。",
                      zh: "没有可选的子目录。",
                    })}
                  </p>
                ) : (
                  manualPathEntries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => void loadManualPathEntries(entry.path)}
                      className="w-full border-b border-slate-700/70 px-3 py-2 text-left transition hover:bg-slate-700/60"
                    >
                      <p className="text-xs font-semibold text-slate-100">{entry.name}</p>
                      <p className="truncate text-[11px] text-slate-400">{entry.path}</p>
                    </button>
                  ))
                )}
              </div>
              {manualPathTruncated && (
                <p className="text-[11px] text-slate-400">
                  {t({
                    ko: "항목이 많아 상위 300개 폴더만 표시했습니다.",
                    en: "Only the first 300 directories are shown.",
                    ja: "項目数が多いため先頭300件のみ表示しています。",
                    zh: "目录过多，仅显示前300个。",
                  })}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => setManualPathPickerOpen(false)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                type="button"
                disabled={!manualPathCurrent}
                onClick={() => {
                  if (!manualPathCurrent) return;
                  setNewProjectPath(manualPathCurrent);
                  setMissingPathPrompt(null);
                  setManualPathPickerOpen(false);
                }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t({
                  ko: "현재 폴더 선택",
                  en: "Select Current Folder",
                  ja: "現在フォルダを選択",
                  zh: "选择当前文件夹",
                })}
              </button>
            </div>
          </div>
        </div>
      )}

      {draftModalOpen && (
        <div
          className="fixed inset-0 z-[61] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDraftModalOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {t({ ko: "임시 저장 목록", en: "Temporary Drafts", ja: "一時保存一覧", zh: "临时草稿列表" })}
              </h3>
              <button
                type="button"
                onClick={() => setDraftModalOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
                title={t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
              >
                ✕
              </button>
            </div>

            <div className="max-h-[55dvh] space-y-2 overflow-y-auto px-4 py-3">
              {drafts.length === 0 ? (
                <div className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-4 text-center text-sm text-slate-400">
                  {t({
                    ko: "저장된 임시 항목이 없습니다.",
                    en: "No temporary drafts saved.",
                    ja: "保存された一時項目はありません。",
                    zh: "没有已保存的临时草稿。",
                  })}
                </div>
              ) : (
                drafts.map((draft) => (
                  <div key={draft.id} className="rounded-lg border border-slate-700 bg-slate-800/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100">
                          {draft.title ||
                            t({
                              ko: "(제목 없음)",
                              en: "(Untitled)",
                              ja: "(無題)",
                              zh: "（无标题）",
                            })}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDraftTimestamp(draft.updatedAt)} · {timeAgo(draft.updatedAt, localeTag)}
                        </p>
                        {draft.description.trim() && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-300">{draft.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            applyDraft(draft);
                            setDraftModalOpen(false);
                          }}
                          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-blue-500"
                        >
                          {t({ ko: "불러오기", en: "Load", ja: "読み込み", zh: "加载" })}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDraft(draft.id)}
                          className="rounded-md border border-red-500/70 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/10"
                        >
                          {t({ ko: "삭제", en: "Delete", ja: "削除", zh: "删除" })}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={clearDrafts}
                disabled={drafts.length === 0}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t({ ko: "전체 삭제", en: "Delete All", ja: "すべて削除", zh: "全部删除" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

// ── Diff Modal ────────────────────────────────────────────────────────────────

function DiffModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [diffData, setDiffData] = useState<TaskDiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    getTaskDiff(taskId)
      .then((d) => {
        if (!d.ok)
          setError(d.error || t({ ko: "알 수 없는 오류", en: "Unknown error", ja: "不明なエラー", zh: "未知错误" }));
        else setDiffData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [taskId, t]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleMerge = useCallback(async () => {
    if (
      !confirm(
        t({
          ko: "이 브랜치를 메인에 병합하시겠습니까?",
          en: "Merge this branch into main?",
          ja: "このブランチを main にマージしますか？",
          zh: "要将此分支合并到 main 吗？",
        }),
      )
    )
      return;
    setMerging(true);
    try {
      const result = await mergeTask(taskId);
      setActionResult(
        result.ok
          ? `${t({ ko: "병합 완료", en: "Merge completed", ja: "マージ完了", zh: "合并完成" })}: ${result.message}`
          : `${t({ ko: "병합 실패", en: "Merge failed", ja: "マージ失敗", zh: "合并失败" })}: ${result.message}`,
      );
      if (result.ok) setTimeout(onClose, 1500);
    } catch (e: unknown) {
      setActionResult(
        `${t({ ko: "오류", en: "Error", ja: "エラー", zh: "错误" })}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setMerging(false);
    }
  }, [taskId, onClose, t]);

  const handleDiscard = useCallback(async () => {
    if (
      !confirm(
        t({
          ko: "이 브랜치의 변경사항을 모두 폐기하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
          en: "Discard all changes in this branch? This action cannot be undone.",
          ja: "このブランチの変更をすべて破棄しますか？この操作は元に戻せません。",
          zh: "要丢弃此分支的所有更改吗？此操作无法撤销。",
        }),
      )
    )
      return;
    setDiscarding(true);
    try {
      const result = await discardTask(taskId);
      setActionResult(
        result.ok
          ? t({
              ko: "브랜치가 폐기되었습니다.",
              en: "Branch was discarded.",
              ja: "ブランチを破棄しました。",
              zh: "分支已丢弃。",
            })
          : `${t({ ko: "폐기 실패", en: "Discard failed", ja: "破棄失敗", zh: "丢弃失败" })}: ${result.message}`,
      );
      if (result.ok) setTimeout(onClose, 1500);
    } catch (e: unknown) {
      setActionResult(
        `${t({ ko: "오류", en: "Error", ja: "エラー", zh: "错误" })}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setDiscarding(false);
    }
  }, [taskId, onClose, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">
              {t({ ko: "Git 변경사항", en: "Git Diff", ja: "Git 差分", zh: "Git 差异" })}
            </span>
            {diffData?.branchName && (
              <span className="rounded-full bg-purple-900 px-2.5 py-0.5 text-xs text-purple-300">
                {diffData.branchName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMerge}
              disabled={merging || discarding || !diffData?.hasWorktree}
              className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-600 disabled:opacity-40"
            >
              {merging ? "..." : t({ ko: "병합", en: "Merge", ja: "マージ", zh: "合并" })}
            </button>
            <button
              onClick={handleDiscard}
              disabled={merging || discarding || !diffData?.hasWorktree}
              className="rounded-lg bg-red-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
            >
              {discarding ? "..." : t({ ko: "폐기", en: "Discard", ja: "破棄", zh: "丢弃" })}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              title={t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
            >
              X
            </button>
          </div>
        </div>

        {/* Action result */}
        {actionResult && (
          <div className="border-b border-slate-700 bg-slate-800 px-5 py-2 text-sm text-amber-300">{actionResult}</div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              {t({
                ko: "변경사항 불러오는 중...",
                en: "Loading diff...",
                ja: "差分を読み込み中...",
                zh: "正在加载差异...",
              })}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-400">
              {t({ ko: "오류", en: "Error", ja: "エラー", zh: "错误" })}: {error}
            </div>
          ) : !diffData?.hasWorktree ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              {t({
                ko: "이 작업의 워크트리를 찾을 수 없습니다. (Git 프로젝트 아님 또는 이미 병합됨)",
                en: "No worktree found for this task (non-git project or already merged)",
                ja: "このタスクのワークツリーが見つかりません（Git プロジェクトではない、または既にマージ済み）",
                zh: "找不到该任务的 worktree（非 Git 项目或已合并）",
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stat summary */}
              {diffData.stat && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-300">
                    {t({ ko: "요약", en: "Summary", ja: "概要", zh: "摘要" })}
                  </h3>
                  <pre className="rounded-lg bg-slate-800 p-3 text-xs text-slate-300 overflow-x-auto">
                    {diffData.stat}
                  </pre>
                </div>
              )}
              {/* Full diff */}
              {diffData.diff && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-300">
                    {t({ ko: "Diff", en: "Diff", ja: "差分", zh: "差异" })}
                  </h3>
                  <pre className="max-h-[50vh] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed">
                    {diffData.diff.split("\n").map((line, i) => {
                      let cls = "text-slate-400";
                      if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-green-400";
                      else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400";
                      else if (line.startsWith("@@")) cls = "text-cyan-400";
                      else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-slate-500 font-bold";
                      return (
                        <span key={i} className={cls}>
                          {line}
                          {"\n"}
                        </span>
                      );
                    })}
                  </pre>
                </div>
              )}
              {!diffData.stat && !diffData.diff && (
                <div className="text-center text-slate-500 py-8">
                  {t({
                    ko: "변경사항이 없습니다",
                    en: "No changes detected",
                    ja: "変更はありません",
                    zh: "未检测到更改",
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  agents: Agent[];
  departments: Department[];
  taskSubtasks: SubTask[];
  isHiddenTask?: boolean;
  onUpdateTask: TaskBoardProps["onUpdateTask"];
  onDeleteTask: TaskBoardProps["onDeleteTask"];
  onAssignTask: TaskBoardProps["onAssignTask"];
  onRunTask: TaskBoardProps["onRunTask"];
  onStopTask: TaskBoardProps["onStopTask"];
  onPauseTask?: (id: string) => void;
  onResumeTask?: (id: string) => void;
  onOpenTerminal?: (taskId: string) => void;
  onOpenMeetingMinutes?: (taskId: string) => void;
  onMergeTask?: (id: string) => void;
  onDiscardTask?: (id: string) => void;
  onHideTask?: (id: string) => void;
  onUnhideTask?: (id: string) => void;
}

const SUBTASK_STATUS_ICON: Record<string, string> = {
  pending: "\u23F3",
  in_progress: "\uD83D\uDD28",
  done: "\u2705",
  blocked: "\uD83D\uDEAB",
};

function TaskCard({
  task,
  agents,
  departments,
  taskSubtasks,
  isHiddenTask,
  onUpdateTask,
  onDeleteTask,
  onAssignTask,
  onRunTask,
  onStopTask,
  onPauseTask,
  onResumeTask,
  onOpenTerminal,
  onOpenMeetingMinutes,
  onHideTask,
  onUnhideTask,
}: TaskCardProps) {
  const { t, localeTag, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [agentWarning, setAgentWarning] = useState(false);

  const assignedAgent = task.assigned_agent ?? agents.find((a) => a.id === task.assigned_agent_id);
  const department = departments.find((d) => d.id === task.department_id);
  const typeBadge = getTaskTypeBadge(task.task_type, t);

  const canRun = task.status === "planned" || task.status === "inbox";
  const canStop = task.status === "in_progress";
  const canPause = task.status === "in_progress" && !!onPauseTask;
  const canResume = (task.status === "pending" || task.status === "cancelled") && !!onResumeTask;
  const canDelete = task.status !== "in_progress";
  const canHideTask = isHideableStatus(task.status);

  return (
    <div
      className={`group rounded-xl border p-3.5 shadow-sm transition hover:shadow-md ${
        isHiddenTask
          ? "border-cyan-700/80 bg-slate-800/80 hover:border-cyan-600"
          : "border-slate-700 bg-slate-800 hover:border-slate-600"
      }`}
    >
      {/* Header row */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-sm font-semibold leading-snug text-white"
        >
          {task.title}
        </button>
        <span
          className="flex-shrink-0 text-base"
          title={`${t({ ko: "우선순위", en: "Priority", ja: "優先度", zh: "优先级" })}: ${priorityLabel(task.priority, t)}`}
        >
          {priorityIcon(task.priority)}
        </span>
      </div>

      {/* Description */}
      {task.description && (
        <p className={`mb-2 text-xs leading-relaxed text-slate-400 ${expanded ? "" : "line-clamp-2"}`}>
          {task.description}
        </p>
      )}

      {/* Badges row */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge.color}`}>{typeBadge.label}</span>
        {isHiddenTask && (
          <span className="rounded-full bg-cyan-900/60 px-2 py-0.5 text-xs text-cyan-200">
            🙈 {t({ ko: "숨김", en: "Hidden", ja: "非表示", zh: "隐藏" })}
          </span>
        )}
        {department && (
          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
            {department.icon} {locale === "ko" ? department.name_ko : department.name}
          </span>
        )}
      </div>

      {/* Status select */}
      <div className="mb-3">
        <select
          value={task.status}
          onChange={(e) => onUpdateTask(task.id, { status: e.target.value as TaskStatus })}
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-white outline-none transition focus:border-blue-500"
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {taskStatusLabel(status, t)}
            </option>
          ))}
        </select>
      </div>

      {/* Agent + time */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {assignedAgent ? (
            <>
              <AgentAvatar agent={assignedAgent} agents={agents} size={20} />
              <span className="text-xs text-slate-300">
                {locale === "ko" ? assignedAgent.name_ko : assignedAgent.name}
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-500">
              {t({ ko: "미배정", en: "Unassigned", ja: "未割り当て", zh: "未分配" })}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-500">{timeAgo(task.created_at, localeTag)}</span>
      </div>

      {/* Assign agent dropdown */}
      <div
        className={`mb-3 rounded-lg transition-all ${agentWarning ? "ring-2 ring-red-500 animate-[shake_0.4s_ease-in-out]" : ""}`}
      >
        <AgentSelect
          agents={agents}
          departments={departments}
          value={task.assigned_agent_id ?? ""}
          onChange={(agentId) => {
            setAgentWarning(false);
            if (agentId) {
              onAssignTask(task.id, agentId);
            } else {
              onUpdateTask(task.id, { assigned_agent_id: null });
            }
          }}
        />
        {agentWarning && (
          <p className="mt-1 text-xs font-medium text-red-400 animate-[shake_0.4s_ease-in-out]">
            {t({
              ko: "담당자를 배정해주세요!",
              en: "Please assign an agent!",
              ja: "担当者を割り当ててください！",
              zh: "请分配负责人！",
            })}
          </p>
        )}
      </div>

      {/* SubTask progress bar */}
      {(task.subtask_total ?? 0) > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowSubtasks((v) => !v)}
            className="mb-1.5 flex w-full items-center gap-2 text-left"
          >
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all"
                style={{ width: `${Math.round(((task.subtask_done ?? 0) / (task.subtask_total ?? 1)) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {task.subtask_done ?? 0}/{task.subtask_total ?? 0}
            </span>
            <span className="text-xs text-slate-500">{showSubtasks ? "▲" : "▼"}</span>
          </button>
          {showSubtasks && taskSubtasks.length > 0 && (
            <div className="space-y-1 pl-1">
              {taskSubtasks.map((st) => {
                const targetDept = st.target_department_id
                  ? departments.find((d) => d.id === st.target_department_id)
                  : null;
                return (
                  <div key={st.id} className="flex items-center gap-1.5 text-xs">
                    <span>{SUBTASK_STATUS_ICON[st.status] || "\u23F3"}</span>
                    <span
                      className={`flex-1 truncate ${st.status === "done" ? "line-through text-slate-500" : "text-slate-300"}`}
                    >
                      {st.title}
                    </span>
                    {targetDept && (
                      <span
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: targetDept.color + "30", color: targetDept.color }}
                      >
                        {targetDept.icon} {targetDept.name_ko}
                      </span>
                    )}
                    {st.delegated_task_id && st.status !== "done" && (
                      <span
                        className="text-blue-400 shrink-0"
                        title={t({ ko: "위임됨", en: "Delegated", ja: "委任済み", zh: "已委派" })}
                      >
                        🔗
                      </span>
                    )}
                    {st.status === "blocked" && st.blocked_reason && (
                      <span className="text-red-400 text-[10px] truncate max-w-[80px]" title={st.blocked_reason}>
                        {st.blocked_reason}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {canRun && (
          <button
            onClick={() => {
              if (!task.assigned_agent_id) {
                setAgentWarning(true);
                setTimeout(() => setAgentWarning(false), 3000);
                return;
              }
              onRunTask(task.id);
            }}
            title={t({ ko: "작업 실행", en: "Run task", ja: "タスク実行", zh: "运行任务" })}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-green-700 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-green-600"
          >
            ▶ {t({ ko: "실행", en: "Run", ja: "実行", zh: "运行" })}
          </button>
        )}
        {canPause && (
          <button
            onClick={() => onPauseTask!(task.id)}
            title={t({ ko: "작업 일시중지", en: "Pause task", ja: "タスク一時停止", zh: "暂停任务" })}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-orange-700 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-orange-600"
          >
            ⏸ {t({ ko: "일시중지", en: "Pause", ja: "一時停止", zh: "暂停" })}
          </button>
        )}
        {canStop && (
          <button
            onClick={() => {
              if (
                confirm(
                  t({
                    ko: `"${task.title}" 작업을 중지할까요?\n\n경고: Stop 처리 시 해당 프로젝트 변경분은 롤백됩니다.`,
                    en: `Stop "${task.title}"?\n\nWarning: stopping will roll back project changes.`,
                    ja: `「${task.title}」を停止しますか？\n\n警告: 停止するとプロジェクトの変更はロールバックされます。`,
                    zh: `要停止“${task.title}”吗？\n\n警告：停止后将回滚该项目的更改。`,
                  }),
                )
              ) {
                onStopTask(task.id);
              }
            }}
            title={t({ ko: "작업 중지", en: "Cancel task", ja: "タスク停止", zh: "取消任务" })}
            className="flex items-center justify-center gap-1 rounded-lg bg-red-800 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
          >
            ⏹ {t({ ko: "중지", en: "Cancel", ja: "キャンセル", zh: "取消" })}
          </button>
        )}
        {canResume && (
          <button
            onClick={() => onResumeTask!(task.id)}
            title={t({ ko: "작업 재개", en: "Resume task", ja: "タスク再開", zh: "恢复任务" })}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-700 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600"
          >
            ↩ {t({ ko: "재개", en: "Resume", ja: "再開", zh: "恢复" })}
          </button>
        )}
        {(task.status === "in_progress" ||
          task.status === "review" ||
          task.status === "done" ||
          task.status === "pending") &&
          onOpenTerminal && (
            <button
              onClick={() => onOpenTerminal(task.id)}
              title={t({
                ko: "터미널 출력 보기",
                en: "View terminal output",
                ja: "ターミナル出力を見る",
                zh: "查看终端输出",
              })}
              className="flex items-center justify-center rounded-lg bg-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600 hover:text-white"
            >
              &#128421;
            </button>
          )}
        {(task.status === "planned" ||
          task.status === "collaborating" ||
          task.status === "in_progress" ||
          task.status === "review" ||
          task.status === "done" ||
          task.status === "pending") &&
          onOpenMeetingMinutes && (
            <button
              onClick={() => onOpenMeetingMinutes(task.id)}
              title={t({
                ko: "회의록 보기",
                en: "View meeting minutes",
                ja: "会議録を見る",
                zh: "查看会议纪要",
              })}
              className="flex items-center justify-center rounded-lg bg-cyan-800/70 px-2 py-1.5 text-xs text-cyan-200 transition hover:bg-cyan-700 hover:text-white"
            >
              📝
            </button>
          )}
        {task.status === "review" && (
          <button
            onClick={() => setShowDiff(true)}
            title={t({
              ko: "변경사항 보기 (Git diff)",
              en: "View changes (Git diff)",
              ja: "変更を見る (Git diff)",
              zh: "查看更改 (Git diff)",
            })}
            className="flex items-center justify-center gap-1 rounded-lg bg-purple-800 px-2 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-700"
          >
            {t({ ko: "Diff", en: "Diff", ja: "差分", zh: "差异" })}
          </button>
        )}
        {canHideTask && !isHiddenTask && onHideTask && (
          <button
            onClick={() => onHideTask(task.id)}
            title={t({
              ko: "완료/보류/취소 작업 숨기기",
              en: "Hide done/pending/cancelled task",
              ja: "完了/保留/キャンセルのタスクを非表示",
              zh: "隐藏已完成/待处理/已取消任务",
            })}
            className="flex items-center justify-center gap-1 rounded-lg bg-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600 hover:text-white"
          >
            🙈 {t({ ko: "숨김", en: "Hide", ja: "非表示", zh: "隐藏" })}
          </button>
        )}
        {canHideTask && !!isHiddenTask && onUnhideTask && (
          <button
            onClick={() => onUnhideTask(task.id)}
            title={t({ ko: "숨긴 작업 복원", en: "Restore hidden task", ja: "非表示タスクを復元", zh: "恢复隐藏任务" })}
            className="flex items-center justify-center gap-1 rounded-lg bg-blue-800 px-2 py-1.5 text-xs text-blue-200 transition hover:bg-blue-700 hover:text-white"
          >
            👁 {t({ ko: "복원", en: "Restore", ja: "復元", zh: "恢复" })}
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => {
              if (
                confirm(
                  t({
                    ko: `"${task.title}" 업무를 삭제할까요?`,
                    en: `Delete "${task.title}"?`,
                    ja: `「${task.title}」を削除しますか？`,
                    zh: `要删除“${task.title}”吗？`,
                  }),
                )
              )
                onDeleteTask(task.id);
            }}
            title={t({ ko: "작업 삭제", en: "Delete task", ja: "タスク削除", zh: "删除任务" })}
            className="flex items-center justify-center rounded-lg bg-red-900/60 px-2 py-1.5 text-xs text-red-400 transition hover:bg-red-800 hover:text-red-300"
          >
            🗑
          </button>
        )}
      </div>

      {/* Diff modal */}
      {showDiff && <DiffModal taskId={task.id} onClose={() => setShowDiff(false)} />}
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  agents: Agent[];
  departments: Department[];
  filterDept: string;
  filterAgent: string;
  filterType: string;
  search: string;
  onFilterDept: (v: string) => void;
  onFilterAgent: (v: string) => void;
  onFilterType: (v: string) => void;
  onSearch: (v: string) => void;
}

function FilterBar({
  agents,
  departments,
  filterDept,
  filterAgent,
  filterType,
  search,
  onFilterDept,
  onFilterAgent,
  onFilterType,
  onSearch,
}: FilterBarProps) {
  const { t, locale } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative min-w-[140px] flex-1 sm:min-w-[180px]">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔎</span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t({ ko: "업무 검색...", en: "Search tasks...", ja: "タスク検索...", zh: "搜索任务..." })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Department */}
      <select
        value={filterDept}
        onChange={(e) => onFilterDept(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 outline-none transition focus:border-blue-500"
      >
        <option value="">{t({ ko: "전체 부서", en: "All Departments", ja: "全部署", zh: "全部门" })}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.icon} {locale === "ko" ? d.name_ko : d.name}
          </option>
        ))}
      </select>

      {/* Agent */}
      <AgentSelect
        agents={agents}
        departments={departments}
        value={filterAgent}
        onChange={onFilterAgent}
        placeholder={t({ ko: "전체 에이전트", en: "All Agents", ja: "全エージェント", zh: "全部代理" })}
        size="md"
      />

      {/* Task type */}
      <select
        value={filterType}
        onChange={(e) => onFilterType(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 outline-none transition focus:border-blue-500"
      >
        <option value="">{t({ ko: "전체 유형", en: "All Types", ja: "全タイプ", zh: "全部类型" })}</option>
        {TASK_TYPE_OPTIONS.map((typeOption) => (
          <option key={typeOption.value} value={typeOption.value}>
            {taskTypeLabel(typeOption.value, t)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface BulkHideModalProps {
  tasks: Task[];
  hiddenTaskIds: Set<string>;
  onClose: () => void;
  onApply: (statuses: HideableStatus[]) => void;
}

function BulkHideModal({ tasks, hiddenTaskIds, onClose, onApply }: BulkHideModalProps) {
  const { t } = useI18n();

  const availableCounts = useMemo(() => {
    const counts: Record<HideableStatus, number> = {
      done: 0,
      pending: 0,
      cancelled: 0,
    };
    for (const task of tasks) {
      if (!isHideableStatus(task.status) || hiddenTaskIds.has(task.id)) continue;
      counts[task.status] += 1;
    }
    return counts;
  }, [tasks, hiddenTaskIds]);

  const [selected, setSelected] = useState<Record<HideableStatus, boolean>>({
    done: availableCounts.done > 0,
    pending: availableCounts.pending > 0,
    cancelled: availableCounts.cancelled > 0,
  });

  const selectedStatuses = useMemo(
    () => HIDEABLE_STATUSES.filter((status) => selected[status] && availableCounts[status] > 0),
    [selected, availableCounts],
  );

  const hideTargetCount = useMemo(
    () => selectedStatuses.reduce((count, status) => count + availableCounts[status], 0),
    [selectedStatuses, availableCounts],
  );

  const statusRows = useMemo(
    () =>
      HIDEABLE_STATUSES.map((status) => ({
        status,
        label: taskStatusLabel(status, t),
        count: availableCounts[status],
      })),
    [availableCounts, t],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            {t({
              ko: "숨길 상태 선택",
              en: "Select statuses to hide",
              ja: "非表示にする状態を選択",
              zh: "选择要隐藏的状态",
            })}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            title={t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
          >
            ✕
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-slate-400">
          {t({
            ko: "완료/보류/취소 중 선택한 상태의 업무를 한 번에 숨깁니다.",
            en: "Hide all tasks in the selected done/pending/cancelled statuses at once.",
            ja: "選択した完了/保留/キャンセル状態のタスクを一括で非表示にします。",
            zh: "一次性隐藏所选完成/待处理/已取消状态的任务。",
          })}
        </p>

        <div className="space-y-2">
          {statusRows.map(({ status, label, count }) => (
            <label
              key={status}
              className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 ${
                count > 0
                  ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600"
                  : "cursor-not-allowed border-slate-800 bg-slate-900/70 text-slate-500"
              }`}
            >
              <span className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected[status]}
                  disabled={count <= 0}
                  onChange={() => {
                    setSelected((prev) => ({ ...prev, [status]: !prev[status] }));
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                {label}
              </span>
              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300">{count}</span>
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
          </button>
          <button
            onClick={() => onApply(selectedStatuses)}
            disabled={hideTargetCount <= 0}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {t({ ko: "숨김 적용", en: "Apply hide", ja: "非表示適用", zh: "应用隐藏" })} ({hideTargetCount})
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TaskBoard (main export) ───────────────────────────────────────────────────

export function TaskBoard({
  tasks,
  agents,
  departments,
  subtasks,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onAssignTask,
  onRunTask,
  onStopTask,
  onPauseTask,
  onResumeTask,
  onOpenTerminal,
  onOpenMeetingMinutes,
  onMergeTask,
  onDiscardTask,
}: TaskBoardProps) {
  const { t } = useI18n();
  const [showCreate, setShowCreate] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showBulkHideModal, setShowBulkHideModal] = useState(false);
  const [filterDept, setFilterDept] = useState("");
  const [filterAgent, setFilterAgent] = useState("");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const hiddenTaskIds = useMemo(() => new Set(tasks.filter((t) => t.hidden === 1).map((t) => t.id)), [tasks]);

  const hideTask = useCallback(
    (taskId: string) => {
      onUpdateTask(taskId, { hidden: 1 });
    },
    [onUpdateTask],
  );

  const unhideTask = useCallback(
    (taskId: string) => {
      onUpdateTask(taskId, { hidden: 0 });
    },
    [onUpdateTask],
  );

  const hideByStatuses = useCallback((statuses: HideableStatus[]) => {
    if (statuses.length === 0) return;
    bulkHideTasks(statuses, 1);
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterDept && t.department_id !== filterDept) return false;
      if (filterAgent && t.assigned_agent_id !== filterAgent) return false;
      if (filterType && t.task_type !== filterType) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      const isHidden = hiddenTaskIds.has(t.id);
      if (!showAllTasks && isHidden) return false;
      return true;
    });
  }, [tasks, filterDept, filterAgent, filterType, search, hiddenTaskIds, showAllTasks]);

  const tasksByStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of COLUMNS) {
      map[col.status] = filteredTasks
        .filter((t) => t.status === col.status)
        .sort((a, b) => b.priority - a.priority || b.created_at - a.created_at);
    }
    return map;
  }, [filteredTasks]);

  const subtasksByTask = useMemo(() => {
    const map: Record<string, SubTask[]> = {};
    for (const st of subtasks) {
      if (!map[st.task_id]) map[st.task_id] = [];
      map[st.task_id].push(st);
    }
    return map;
  }, [subtasks]);

  const activeFilterCount = [filterDept, filterAgent, filterType, search].filter(Boolean).length;
  const hiddenTaskCount = useMemo(() => {
    let count = 0;
    for (const task of tasks) {
      if (isHideableStatus(task.status) && hiddenTaskIds.has(task.id)) count++;
    }
    return count;
  }, [tasks, hiddenTaskIds]);

  return (
    <div className="taskboard-shell flex h-full flex-col gap-4 bg-slate-950 p-3 sm:p-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white">
          {t({ ko: "업무 보드", en: "Task Board", ja: "タスクボード", zh: "任务看板" })}
        </h1>
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">
          {t({ ko: "총", en: "Total", ja: "合計", zh: "总计" })} {filteredTasks.length}
          {t({ ko: "개", en: "", ja: "件", zh: "项" })}
          {activeFilterCount > 0 &&
            ` (${t({ ko: "필터", en: "filters", ja: "フィルター", zh: "筛选器" })} ${activeFilterCount}${t({
              ko: "개 적용",
              en: " applied",
              ja: "件適用",
              zh: "个已应用",
            })})`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFilterDept("");
                setFilterAgent("");
                setFilterType("");
                setSearch("");
              }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              {t({ ko: "필터 초기화", en: "Reset Filters", ja: "フィルターをリセット", zh: "重置筛选" })}
            </button>
          )}
          <button
            onClick={() => setShowAllTasks((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              showAllTasks
                ? "border-cyan-600 bg-cyan-900/40 text-cyan-100 hover:bg-cyan-900/60"
                : "border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
            title={
              showAllTasks
                ? t({
                    ko: "진행중 보기로 전환 (숨김 제외)",
                    en: "Switch to active view (exclude hidden)",
                    ja: "進行中表示へ切替（非表示を除外）",
                    zh: "切换到进行中视图（排除隐藏）",
                  })
                : t({
                    ko: "모두보기로 전환 (숨김 포함)",
                    en: "Switch to all view (include hidden)",
                    ja: "全体表示へ切替（非表示を含む）",
                    zh: "切换到全部视图（包含隐藏）",
                  })
            }
          >
            <span className={showAllTasks ? "text-slate-400" : "text-emerald-200"}>
              {t({ ko: "진행중", en: "Active", ja: "進行中", zh: "进行中" })}
            </span>
            <span className="mx-1 text-slate-500">/</span>
            <span className={showAllTasks ? "text-cyan-100" : "text-slate-500"}>
              {t({ ko: "모두보기", en: "All", ja: "すべて", zh: "全部" })}
            </span>
            <span className="ml-1 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
              {hiddenTaskCount}
            </span>
          </button>
          <button
            onClick={() => setShowBulkHideModal(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
            title={t({
              ko: "완료/보류/취소 상태 업무 숨기기",
              en: "Hide done/pending/cancelled tasks",
              ja: "完了/保留/キャンセル状態を非表示",
              zh: "隐藏完成/待处理/已取消任务",
            })}
          >
            🙈 {t({ ko: "숨김", en: "Hide", ja: "非表示", zh: "隐藏" })}
          </button>
          <button
            onClick={() => setShowProjectManager(true)}
            className="taskboard-project-manage-btn rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
          >
            🗂 {t({ ko: "프로젝트 관리", en: "Project Manager", ja: "プロジェクト管理", zh: "项目管理" })}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow transition hover:bg-blue-500 active:scale-95"
          >
            + {t({ ko: "새 업무", en: "New Task", ja: "新規タスク", zh: "新建任务" })}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        agents={agents}
        departments={departments}
        filterDept={filterDept}
        filterAgent={filterAgent}
        filterType={filterType}
        search={search}
        onFilterDept={setFilterDept}
        onFilterAgent={setFilterAgent}
        onFilterType={setFilterType}
        onSearch={setSearch}
      />

      {/* Kanban board */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
        {COLUMNS.map((col) => {
          const colTasks = tasksByStatus[col.status] ?? [];
          return (
            <div
              key={col.status}
              className={`taskboard-column flex w-full flex-col rounded-xl border sm:w-72 sm:flex-shrink-0 ${col.borderColor} bg-slate-900`}
            >
              {/* Column header */}
              <div className={`flex items-center justify-between rounded-t-xl ${col.headerBg} px-3.5 py-2.5`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${col.dotColor}`} />
                  <span className="text-sm font-semibold text-white">
                    {col.icon} {taskStatusLabel(col.status, t)}
                  </span>
                </div>
                <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-bold text-white/80">
                  {colTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2.5 p-2.5 sm:flex-1 sm:overflow-y-auto">
                {colTasks.length === 0 ? (
                  <div className="flex min-h-24 items-center justify-center py-8 text-xs text-slate-600 sm:flex-1">
                    {t({ ko: "업무 없음", en: "No tasks", ja: "タスクなし", zh: "暂无任务" })}
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agents={agents}
                      departments={departments}
                      taskSubtasks={subtasksByTask[task.id] ?? []}
                      isHiddenTask={hiddenTaskIds.has(task.id)}
                      onUpdateTask={onUpdateTask}
                      onDeleteTask={onDeleteTask}
                      onAssignTask={onAssignTask}
                      onRunTask={onRunTask}
                      onStopTask={onStopTask}
                      onPauseTask={onPauseTask}
                      onResumeTask={onResumeTask}
                      onOpenTerminal={onOpenTerminal}
                      onOpenMeetingMinutes={onOpenMeetingMinutes}
                      onMergeTask={onMergeTask}
                      onDiscardTask={onDiscardTask}
                      onHideTask={hideTask}
                      onUnhideTask={unhideTask}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          agents={agents}
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreate={onCreateTask}
          onAssign={onAssignTask}
        />
      )}

      {/* Project manager modal */}
      {showProjectManager && (
        <ProjectManagerModal agents={agents} departments={departments} onClose={() => setShowProjectManager(false)} />
      )}

      {/* Bulk hide modal */}
      {showBulkHideModal && (
        <BulkHideModal
          tasks={tasks}
          hiddenTaskIds={hiddenTaskIds}
          onClose={() => setShowBulkHideModal(false)}
          onApply={(statuses) => {
            hideByStatuses(statuses);
            setShowBulkHideModal(false);
          }}
        />
      )}
    </div>
  );
}

export default TaskBoard;
