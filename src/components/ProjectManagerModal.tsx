import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Project } from '../types';
import {
  browseProjectPath,
  checkProjectPath,
  createProject,
  deleteProject,
  getProjectDetail,
  getProjectPathSuggestions,
  getProjects,
  getTaskReportDetail,
  isApiRequestError,
  pickProjectPathNative,
  updateProject,
  type ProjectDetailResponse,
  type ProjectTaskHistoryItem,
  type TaskReportDetail,
} from '../api';
import { useI18n } from '../i18n';
import TaskReportPopup from './TaskReportPopup';

interface ProjectManagerModalProps {
  agents: Agent[];
  onClose: () => void;
}

const PAGE_SIZE = 5;
type MissingPathPrompt = {
  normalizedPath: string;
  canCreate: boolean;
  nearestExistingParent: string | null;
};
type FormFeedback = {
  tone: 'error' | 'info';
  message: string;
};
type ManualPathEntry = {
  name: string;
  path: string;
};

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ProjectManagerModal({ agents, onClose }: ProjectManagerModalProps) {
  const { t, language } = useI18n();

  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [isCreating, setIsCreating] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [coreGoal, setCoreGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [pathSuggestionsOpen, setPathSuggestionsOpen] = useState(false);
  const [pathSuggestionsLoading, setPathSuggestionsLoading] = useState(false);
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [missingPathPrompt, setMissingPathPrompt] = useState<MissingPathPrompt | null>(null);
  const [manualPathPickerOpen, setManualPathPickerOpen] = useState(false);
  const [nativePathPicking, setNativePathPicking] = useState(false);
  const [manualPathLoading, setManualPathLoading] = useState(false);
  const [manualPathCurrent, setManualPathCurrent] = useState('');
  const [manualPathParent, setManualPathParent] = useState<string | null>(null);
  const [manualPathEntries, setManualPathEntries] = useState<ManualPathEntry[]>([]);
  const [manualPathTruncated, setManualPathTruncated] = useState(false);
  const [manualPathError, setManualPathError] = useState<string | null>(null);
  const [pathApiUnsupported, setPathApiUnsupported] = useState(false);
  const [nativePickerUnsupported, setNativePickerUnsupported] = useState(false);
  const [formFeedback, setFormFeedback] = useState<FormFeedback | null>(null);

  const [reportDetail, setReportDetail] = useState<TaskReportDetail | null>(null);

  const loadProjects = useCallback(async (targetPage: number, keyword: string) => {
    setLoadingList(true);
    try {
      const res = await getProjects({
        page: targetPage,
        page_size: PAGE_SIZE,
        search: keyword.trim() || undefined,
      });
      setProjects(res.projects);
      setPage(res.page);
      setTotalPages(Math.max(1, res.total_pages || 1));
      if (res.projects.length === 0) {
        setIsCreating(true);
      }
      if (!selectedProjectId && res.projects[0]) {
        setSelectedProjectId(res.projects[0].id);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoadingList(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadProjects(1, search);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    getProjectDetail(selectedProjectId)
      .then((res) => {
        setDetail(res);
        if (!editingProjectId && !isCreating) {
          setName(res.project.name);
          setProjectPath(res.project.project_path);
          setCoreGoal(res.project.core_goal);
        }
      })
      .catch((err) => {
        console.error('Failed to load project detail:', err);
      })
      .finally(() => setLoadingDetail(false));
  }, [selectedProjectId, editingProjectId, isCreating]);

  const viewedProject = detail?.project ?? null;
  const selectedProject = isCreating ? null : viewedProject;

  const headerTitle = t({
    ko: '프로젝트 관리',
    en: 'Project Management',
    ja: 'プロジェクト管理',
    zh: '项目管理',
  });

  const formTitle = editingProjectId
    ? t({ ko: '프로젝트 수정', en: 'Edit Project', ja: 'プロジェクト編集', zh: '编辑项目' })
    : isCreating
      ? t({ ko: '신규 프로젝트 등록', en: 'Register New Project', ja: '新規プロジェクト登録', zh: '新建项目' })
      : t({ ko: '프로젝트 정보', en: 'Project Info', ja: 'プロジェクト情報', zh: '项目信息' });

  const canSave = !!name.trim() && !!projectPath.trim() && !!coreGoal.trim();
  const pathToolsVisible = isCreating || !!editingProjectId;

  const unsupportedPathApiMessage = useMemo(
    () => t({
      ko: '현재 서버 버전은 경로 탐색 보조 기능을 지원하지 않습니다. 경로를 직접 입력해주세요.',
      en: 'This server does not support path helper APIs. Enter the path manually.',
      ja: '現在のサーバーではパス補助 API をサポートしていません。手入力してください。',
      zh: '当前服务器不支持路径辅助 API，请手动输入路径。',
    }),
    [t],
  );

  const nativePickerUnavailableMessage = useMemo(
    () => t({
      ko: '운영체제 폴더 선택기를 사용할 수 없는 환경입니다. 앱 내 폴더 탐색 또는 직접 입력을 사용해주세요.',
      en: 'OS folder picker is unavailable in this environment. Use in-app browser or manual input.',
      ja: 'この環境では OS フォルダ選択が利用できません。アプリ内閲覧または手入力を使ってください。',
      zh: '当前环境无法使用系统文件夹选择器，请使用应用内浏览或手动输入。',
    }),
    [t],
  );

  const formatAllowedRootsMessage = useCallback((allowedRoots: string[]) => {
    if (allowedRoots.length === 0) {
      return t({
        ko: '허용된 프로젝트 경로 범위를 벗어났습니다.',
        en: 'Path is outside allowed project roots.',
        ja: '許可されたプロジェクトパス範囲外です。',
        zh: '路径超出允许的项目根目录范围。',
      });
    }
    return t({
      ko: `허용된 프로젝트 경로 범위를 벗어났습니다. 허용 경로: ${allowedRoots.join(', ')}`,
      en: `Path is outside allowed project roots. Allowed roots: ${allowedRoots.join(', ')}`,
      ja: `許可されたプロジェクトパス範囲外です。許可パス: ${allowedRoots.join(', ')}`,
      zh: `路径超出允许的项目根目录范围。允许路径：${allowedRoots.join(', ')}`,
    });
  }, [t]);

  const resolvePathHelperErrorMessage = useCallback((err: unknown, fallback: {
    ko: string;
    en: string;
    ja: string;
    zh: string;
  }) => {
    if (!isApiRequestError(err)) return t(fallback);
    if (err.status === 404) {
      return unsupportedPathApiMessage;
    }
    if (err.code === 'project_path_outside_allowed_roots') {
      const allowedRoots = Array.isArray((err.details as { allowed_roots?: unknown })?.allowed_roots)
        ? ((err.details as { allowed_roots: unknown[] }).allowed_roots
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0))
        : [];
      return formatAllowedRootsMessage(allowedRoots);
    }
    if (err.code === 'native_picker_unavailable') {
      return nativePickerUnavailableMessage;
    }
    if (err.code === 'project_path_not_directory') {
      return t({
        ko: '해당 경로는 폴더가 아닙니다. 디렉터리 경로를 입력해주세요.',
        en: 'This path is not a directory. Please enter a directory path.',
        ja: 'このパスはフォルダではありません。ディレクトリパスを入力してください。',
        zh: '该路径不是文件夹，请输入目录路径。',
      });
    }
    if (err.code === 'project_path_not_found') {
      return t({
        ko: '해당 경로를 찾을 수 없습니다.',
        en: 'Path not found.',
        ja: 'パスが見つかりません。',
        zh: '找不到该路径。',
      });
    }
    return t(fallback);
  }, [t, unsupportedPathApiMessage, formatAllowedRootsMessage, nativePickerUnavailableMessage]);

  const resetPathHelperState = useCallback(() => {
    setPathSuggestionsOpen(false);
    setPathSuggestionsLoading(false);
    setPathSuggestions([]);
    setMissingPathPrompt(null);
    setManualPathPickerOpen(false);
    setNativePathPicking(false);
    setManualPathLoading(false);
    setManualPathCurrent('');
    setManualPathParent(null);
    setManualPathEntries([]);
    setManualPathTruncated(false);
    setManualPathError(null);
    setFormFeedback(null);
  }, []);

  useEffect(() => {
    if (pathToolsVisible) return;
    resetPathHelperState();
  }, [pathToolsVisible, resetPathHelperState]);

  useEffect(() => {
    if (!pathToolsVisible || !pathSuggestionsOpen || pathApiUnsupported) return;
    let cancelled = false;
    setPathSuggestionsLoading(true);
    getProjectPathSuggestions(projectPath.trim(), 30)
      .then((paths) => {
        if (cancelled) return;
        setPathSuggestions(paths);
      })
      .catch((err) => {
        console.error('Failed to load project path suggestions:', err);
        if (cancelled) return;
        if (isApiRequestError(err) && err.status === 404) {
          setPathApiUnsupported(true);
          setPathSuggestionsOpen(false);
          setFormFeedback({ tone: 'info', message: unsupportedPathApiMessage });
          return;
        }
        setPathSuggestions([]);
        setFormFeedback({
          tone: 'error',
          message: resolvePathHelperErrorMessage(err, {
            ko: '경로 후보를 불러오지 못했습니다.',
            en: 'Failed to load path suggestions.',
            ja: 'パス候補を読み込めませんでした。',
            zh: '无法加载路径候选。',
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
    pathSuggestionsOpen,
    pathToolsVisible,
    projectPath,
    pathApiUnsupported,
    unsupportedPathApiMessage,
    resolvePathHelperErrorMessage,
  ]);

  const loadManualPathEntries = useCallback(async (targetPath?: string) => {
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
      console.error('Failed to browse project path:', err);
      if (isApiRequestError(err) && err.status === 404) {
        setPathApiUnsupported(true);
        setManualPathPickerOpen(false);
        setManualPathError(unsupportedPathApiMessage);
        setFormFeedback({ tone: 'info', message: unsupportedPathApiMessage });
      } else {
        setManualPathError(
          resolvePathHelperErrorMessage(err, {
            ko: '경로 목록을 불러오지 못했습니다.',
            en: 'Failed to load directories.',
            ja: 'ディレクトリ一覧を読み込めませんでした。',
            zh: '无法加载目录列表。',
          }),
        );
      }
      setManualPathEntries([]);
      setManualPathTruncated(false);
    } finally {
      setManualPathLoading(false);
    }
  }, [pathApiUnsupported, unsupportedPathApiMessage, resolvePathHelperErrorMessage]);

  const groupedTaskCards = useMemo(() => {
    if (!detail) return [];
    const rows = [...detail.tasks].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const byId = new Map<string, ProjectTaskHistoryItem>(rows.map((row) => [row.id, row]));
    const groups = new Map<
      string,
      { root: ProjectTaskHistoryItem; children: ProjectTaskHistoryItem[]; latestAt: number }
    >();

    for (const row of rows) {
      const parentId = typeof row.source_task_id === 'string' && row.source_task_id.trim()
        ? row.source_task_id.trim()
        : null;
      const root = parentId ? (byId.get(parentId) ?? row) : row;
      const rootId = root.id;
      const existing = groups.get(rootId);
      const group = existing ?? {
        root,
        children: [],
        latestAt: root.created_at || 0,
      };

      if (row.id === rootId) {
        group.root = row;
      } else {
        group.children.push(row);
      }
      group.latestAt = Math.max(group.latestAt, row.created_at || 0);
      groups.set(rootId, group);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        children: [...group.children].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [detail]);

  const sortedReports = useMemo(() => {
    if (!detail) return [];
    return [...detail.reports].sort((a, b) => (b.completed_at || b.created_at || 0) - (a.completed_at || a.created_at || 0));
  }, [detail]);

  const startCreate = () => {
    setIsCreating(true);
    setEditingProjectId(null);
    setName('');
    setProjectPath('');
    setCoreGoal('');
    resetPathHelperState();
  };

  const startEditSelected = () => {
    if (!viewedProject) return;
    setIsCreating(false);
    setEditingProjectId(viewedProject.id);
    setName(viewedProject.name);
    setProjectPath(viewedProject.project_path);
    setCoreGoal(viewedProject.core_goal);
    resetPathHelperState();
  };

  const handleSave = async (allowCreateMissingPath = false) => {
    if (!canSave || saving) return;
    setFormFeedback(null);
    let savePath = projectPath.trim();
    let createPathIfMissing = allowCreateMissingPath;

    if (!allowCreateMissingPath) {
      try {
        const pathCheck = await checkProjectPath(savePath);
        savePath = pathCheck.normalized_path || savePath;
        if (savePath !== projectPath.trim()) {
          setProjectPath(savePath);
        }
        if (pathCheck.exists && !pathCheck.is_directory) {
          setFormFeedback({
            tone: 'error',
            message: t({
              ko: '해당 경로는 폴더가 아닙니다. 디렉터리 경로를 입력해주세요.',
              en: 'This path is not a directory. Please enter a directory path.',
              ja: 'このパスはフォルダではありません。ディレクトリパスを入力してください。',
              zh: '该路径不是文件夹，请输入目录路径。',
            }),
          });
          return;
        }
        if (!pathCheck.exists) {
          setMissingPathPrompt({
            normalizedPath: pathCheck.normalized_path || savePath,
            canCreate: pathCheck.can_create,
            nearestExistingParent: pathCheck.nearest_existing_parent,
          });
          return;
        }
        createPathIfMissing = false;
      } catch (err) {
        console.error('Failed to check project path:', err);
        if (isApiRequestError(err) && err.status === 404) {
          setPathApiUnsupported(true);
          createPathIfMissing = true;
          setFormFeedback({ tone: 'info', message: unsupportedPathApiMessage });
        } else {
          setFormFeedback({
            tone: 'error',
            message: resolvePathHelperErrorMessage(err, {
              ko: '프로젝트 경로 확인에 실패했습니다.',
              en: 'Failed to verify project path.',
              ja: 'プロジェクトパスの確認に失敗しました。',
              zh: '项目路径校验失败。',
            }),
          });
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (editingProjectId) {
        const updated = await updateProject(editingProjectId, {
          name: name.trim(),
          project_path: savePath,
          core_goal: coreGoal.trim(),
          create_path_if_missing: createPathIfMissing,
        });
        setSelectedProjectId(updated.id);
      } else {
        const created = await createProject({
          name: name.trim(),
          project_path: savePath,
          core_goal: coreGoal.trim(),
          create_path_if_missing: createPathIfMissing,
        });
        setSelectedProjectId(created.id);
      }
      await loadProjects(1, search);
      setEditingProjectId(null);
      setIsCreating(false);
      resetPathHelperState();
    } catch (err) {
      console.error('Failed to save project:', err);
      if (isApiRequestError(err) && err.code === 'project_path_conflict') {
        const details = (err.details as {
          existing_project_name?: unknown;
          existing_project_path?: unknown;
        } | null) ?? null;
        const existingProjectName = typeof details?.existing_project_name === 'string' ? details.existing_project_name : '';
        const existingProjectPath = typeof details?.existing_project_path === 'string' ? details.existing_project_path : '';
        setFormFeedback({
          tone: 'info',
          message: t({
            ko: existingProjectName
              ? `동일 경로가 이미 '${existingProjectName}' 프로젝트에 등록되어 있습니다. (${existingProjectPath || 'path'})`
              : '동일 경로가 이미 다른 프로젝트에 등록되어 있습니다.',
            en: existingProjectName
              ? `This path is already registered by '${existingProjectName}'. (${existingProjectPath || 'path'})`
              : 'This path is already registered by another project.',
            ja: existingProjectName
              ? `このパスは既に '${existingProjectName}' に登録されています。(${existingProjectPath || 'path'})`
              : 'このパスは既に別のプロジェクトに登録されています。',
            zh: existingProjectName
              ? `该路径已被‘${existingProjectName}’注册。(${existingProjectPath || 'path'})`
              : '该路径已被其他项目注册。',
          }),
        });
        return;
      }
      if (isApiRequestError(err) && err.code === 'project_path_not_found') {
        const details = (err.details as {
          normalized_path?: unknown;
          can_create?: unknown;
          nearest_existing_parent?: unknown;
        } | null) ?? null;
        setMissingPathPrompt({
          normalizedPath:
            typeof details?.normalized_path === 'string'
              ? details.normalized_path
              : savePath,
          canCreate: Boolean(details?.can_create),
          nearestExistingParent:
            typeof details?.nearest_existing_parent === 'string'
              ? details.nearest_existing_parent
              : null,
        });
        return;
      }
      setFormFeedback({
        tone: 'error',
        message: resolvePathHelperErrorMessage(err, {
          ko: '프로젝트 저장에 실패했습니다. 입력값을 확인해주세요.',
          en: 'Failed to save project. Please check your inputs.',
          ja: 'プロジェクト保存に失敗しました。入力値を確認してください。',
          zh: '项目保存失败，请检查输入值。',
        }),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProject) return;
    const confirmed = window.confirm(
      t({
        ko: `프로젝트 '${selectedProject.name}' 을(를) 삭제할까요?`,
        en: `Delete project '${selectedProject.name}'?`,
        ja: `プロジェクト '${selectedProject.name}' を削除しますか？`,
        zh: `要删除项目 '${selectedProject.name}' 吗？`,
      }),
    );
    if (!confirmed) return;

    try {
      await deleteProject(selectedProject.id);
      setSelectedProjectId(null);
      setDetail(null);
      await loadProjects(1, search);
      startCreate();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleOpenTaskDetail = async (taskId: string) => {
    try {
      const d = await getTaskReportDetail(taskId);
      setReportDetail(d);
    } catch (err) {
      console.error('Failed to open task detail:', err);
    }
  };

  if (reportDetail) {
    return (
      <TaskReportPopup
        report={reportDetail}
        agents={agents}
        uiLanguage={language}
        onClose={() => setReportDetail(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[86vh] w-[min(1180px,95vw)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <aside className="flex w-[330px] flex-col border-r border-slate-700 bg-slate-900/70">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">{headerTitle}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="border-b border-slate-700 px-4 py-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void loadProjects(1, search);
                }
              }}
              placeholder={t({
                ko: '프로젝트 검색',
                en: 'Search projects',
                ja: 'プロジェクト検索',
                zh: '搜索项目',
              })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void loadProjects(1, search);
                }}
                className="rounded-md bg-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-600"
              >
                {t({ ko: '조회', en: 'Search', ja: '検索', zh: '查询' })}
              </button>
              <button
                type="button"
                onClick={startCreate}
                className="rounded-md bg-blue-700 px-2.5 py-1 text-xs text-white hover:bg-blue-600"
              >
                {t({ ko: '신규', en: 'New', ja: '新規', zh: '新建' })}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="px-4 py-6 text-xs text-slate-400">{t({ ko: '불러오는 중...', en: 'Loading...', ja: '読み込み中...', zh: '加载中...' })}</div>
            ) : projects.length === 0 ? (
              <div className="px-4 py-6 text-xs text-slate-500">{t({ ko: '등록된 프로젝트가 없습니다', en: 'No projects', ja: 'プロジェクトなし', zh: '暂无项目' })}</div>
            ) : (
              <div className="divide-y divide-slate-800">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(p.id);
                      setIsCreating(false);
                      setEditingProjectId(null);
                    }}
                    className={`w-full px-4 py-3 text-left transition ${
                      selectedProjectId === p.id ? 'bg-blue-900/30' : 'hover:bg-slate-800/70'
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-white">{p.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{p.project_path}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-500">{p.core_goal}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-700 px-4 py-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => void loadProjects(page - 1, search)}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 disabled:opacity-40"
            >
              {t({ ko: '이전', en: 'Prev', ja: '前へ', zh: '上一页' })}
            </button>
            <span className="text-xs text-slate-500">{page} / {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => void loadProjects(page + 1, search)}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 disabled:opacity-40"
            >
              {t({ ko: '다음', en: 'Next', ja: '次へ', zh: '下一页' })}
            </button>
          </div>
        </aside>

        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-slate-700 px-5 py-3">
            <h3 className="text-sm font-semibold text-white">{formTitle}</h3>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[360px_1fr]">
            <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <label className="block text-xs text-slate-400">
                {t({ ko: '프로젝트 이름', en: 'Project Name', ja: 'プロジェクト名', zh: '项目名称' })}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFormFeedback(null);
                  }}
                  disabled={!isCreating && !editingProjectId}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                {t({ ko: '프로젝트 경로', en: 'Project Path', ja: 'プロジェクトパス', zh: '项目路径' })}
                <input
                  type="text"
                  value={projectPath}
                  onChange={(e) => {
                    setProjectPath(e.target.value);
                    setMissingPathPrompt(null);
                    setFormFeedback(null);
                  }}
                  disabled={!isCreating && !editingProjectId}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>
              {pathToolsVisible && (
                <div className="space-y-2">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={pathApiUnsupported}
                      onClick={() => {
                        setFormFeedback(null);
                        setManualPathPickerOpen(true);
                        void loadManualPathEntries(projectPath.trim() || undefined);
                      }}
                      className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t({ ko: '앱 내 폴더 탐색', en: 'In-App Folder Browser', ja: 'アプリ内フォルダ閲覧', zh: '应用内文件夹浏览' })}
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
                        ? t({ ko: '자동 경로찾기 닫기', en: 'Close Auto Finder', ja: '自動候補を閉じる', zh: '关闭自动查找' })
                        : t({ ko: '자동 경로찾기', en: 'Auto Path Finder', ja: '自動パス検索', zh: '自动路径查找' })}
                    </button>
                    <button
                      type="button"
                      disabled={nativePathPicking || nativePickerUnsupported}
                      onClick={async () => {
                        setNativePathPicking(true);
                        try {
                          const picked = await pickProjectPathNative();
                          if (picked.cancelled || !picked.path) return;
                          setProjectPath(picked.path);
                          setMissingPathPrompt(null);
                          setPathSuggestionsOpen(false);
                          setFormFeedback(null);
                        } catch (err) {
                          console.error('Failed to open native path picker:', err);
                          if (isApiRequestError(err) && err.status === 404) {
                            setPathApiUnsupported(true);
                            setFormFeedback({ tone: 'info', message: unsupportedPathApiMessage });
                          } else {
                            const message = resolvePathHelperErrorMessage(err, {
                              ko: '운영체제 폴더 선택기를 열지 못했습니다.',
                              en: 'Failed to open OS folder picker.',
                              ja: 'OSフォルダ選択を開けませんでした。',
                              zh: '无法打开系统文件夹选择器。',
                            });
                            if (isApiRequestError(err) && (err.code === 'native_picker_unavailable' || err.code === 'native_picker_failed')) {
                              setNativePickerUnsupported(true);
                              setFormFeedback({ tone: 'info', message });
                            } else {
                              setFormFeedback({ tone: 'error', message });
                            }
                          }
                        } finally {
                          setNativePathPicking(false);
                        }
                      }}
                      className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {nativePathPicking
                        ? t({ ko: '수동 경로찾기 여는 중...', en: 'Opening Manual Picker...', ja: '手動パス選択を開いています...', zh: '正在打开手动路径选择...' })
                        : nativePickerUnsupported
                          ? t({ ko: '수동 경로찾기(사용불가)', en: 'Manual Path Finder (Unavailable)', ja: '手動パス選択（利用不可）', zh: '手动路径选择（不可用）' })
                          : t({ ko: '수동 경로찾기', en: 'Manual Path Finder', ja: '手動パス選択', zh: '手动路径选择' })}
                    </button>
                  </div>
                  {pathSuggestionsOpen && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/70">
                      {pathSuggestionsLoading ? (
                        <p className="px-3 py-2 text-xs text-slate-400">
                          {t({
                            ko: '경로 후보를 불러오는 중...',
                            en: 'Loading path suggestions...',
                            ja: 'パス候補を読み込み中...',
                            zh: '正在加载路径候选...',
                          })}
                        </p>
                      ) : pathSuggestions.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-400">
                          {t({
                            ko: '추천 경로가 없습니다. 직접 입력해주세요.',
                            en: 'No suggested path. Enter one manually.',
                            ja: '候補パスがありません。手入力してください。',
                            zh: '没有推荐路径，请手动输入。',
                          })}
                        </p>
                      ) : (
                        pathSuggestions.map((candidate) => (
                          <button
                            key={candidate}
                            type="button"
                            onClick={() => {
                              setProjectPath(candidate);
                              setMissingPathPrompt(null);
                              setPathSuggestionsOpen(false);
                              setFormFeedback(null);
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
                        ko: '해당 경로가 아직 존재하지 않습니다. 저장 시 생성 여부를 확인합니다.',
                        en: 'This path does not exist yet. Save will ask whether to create it.',
                        ja: 'このパスはまだ存在しません。保存時に作成確認を行います。',
                        zh: '该路径尚不存在，保存时会先确认是否创建。',
                      })}
                    </p>
                  )}
                </div>
              )}
              {formFeedback && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    formFeedback.tone === 'error'
                      ? 'border-rose-500/60 bg-rose-500/10 text-rose-200'
                      : 'border-cyan-500/50 bg-cyan-500/10 text-cyan-100'
                  }`}
                >
                  {formFeedback.message}
                </div>
              )}
              <label className="block text-xs text-slate-400">
                {t({ ko: '핵심 목표', en: 'Core Goal', ja: 'コア目標', zh: '核心目标' })}
                <textarea
                  rows={5}
                  value={coreGoal}
                  onChange={(e) => {
                    setCoreGoal(e.target.value);
                    setFormFeedback(null);
                  }}
                  disabled={!isCreating && !editingProjectId}
                  className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                {(isCreating || !!editingProjectId) && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleSave();
                    }}
                    disabled={!canSave || saving}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                  >
                    {editingProjectId
                      ? t({ ko: '수정 저장', en: 'Save', ja: '保存', zh: '保存' })
                      : t({ ko: '프로젝트 등록', en: 'Create', ja: '作成', zh: '创建' })}
                  </button>
                )}
                {(isCreating || !!editingProjectId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setEditingProjectId(null);
                      resetPathHelperState();
                      if (viewedProject) {
                        setName(viewedProject.name);
                        setProjectPath(viewedProject.project_path);
                        setCoreGoal(viewedProject.core_goal);
                      }
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
                  >
                    {t({ ko: '취소', en: 'Cancel', ja: 'キャンセル', zh: '取消' })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={startEditSelected}
                  disabled={!selectedProject || isCreating || !!editingProjectId}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
                >
                  {t({ ko: '선택 프로젝트 편집', en: 'Edit Selected', ja: '選択編集', zh: '编辑选中项' })}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!selectedProject}
                  className="rounded-lg border border-red-700/70 px-3 py-1.5 text-xs text-red-300 disabled:opacity-40"
                >
                  {t({ ko: '삭제', en: 'Delete', ja: '削除', zh: '删除' })}
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <h4 className="text-sm font-semibold text-white">
                  {t({ ko: '프로젝트 정보', en: 'Project Info', ja: 'プロジェクト情報', zh: '项目信息' })}
                </h4>
                {loadingDetail ? (
                  <p className="mt-2 text-xs text-slate-400">{t({ ko: '불러오는 중...', en: 'Loading...', ja: '読み込み中...', zh: '加载中...' })}</p>
                ) : isCreating ? (
                  <p className="mt-2 text-xs text-slate-500">{t({ ko: '신규 프로젝트를 입력 중입니다', en: 'Creating a new project', ja: '新規プロジェクトを入力中です', zh: '正在输入新项目' })}</p>
                ) : !selectedProject ? (
                  <p className="mt-2 text-xs text-slate-500">{t({ ko: '프로젝트를 선택하세요', en: 'Select a project', ja: 'プロジェクトを選択', zh: '请选择项目' })}</p>
                ) : (
                  <div className="mt-2 space-y-2 text-xs">
                    <p className="text-slate-200"><span className="text-slate-500">ID:</span> {selectedProject.id}</p>
                    <p className="break-all text-slate-200"><span className="text-slate-500">Path:</span> {selectedProject.project_path}</p>
                    <p className="break-all text-slate-200"><span className="text-slate-500">Goal:</span> {selectedProject.core_goal}</p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <h4 className="text-sm font-semibold text-white">
                  {t({ ko: '작업 이력', en: 'Task History', ja: '作業履歴', zh: '任务历史' })}
                </h4>
                {!selectedProject ? (
                  <p className="mt-2 text-xs text-slate-500">-</p>
                ) : groupedTaskCards.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">{t({ ko: '연결된 작업이 없습니다', en: 'No mapped tasks', ja: '紐づくタスクなし', zh: '没有映射任务' })}</p>
                ) : (
                  <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
                    {groupedTaskCards.map((group) => (
                      <button
                        key={group.root.id}
                        type="button"
                        onClick={() => void handleOpenTaskDetail(group.root.id)}
                        className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-left transition hover:border-blue-500/70 hover:bg-slate-900"
                      >
                        <p className="whitespace-pre-wrap break-all text-xs font-semibold text-slate-100">{group.root.title}</p>
                        <p className="mt-1 break-all text-[11px] text-slate-400">
                          {group.root.status} · {group.root.task_type} · {fmtTime(group.root.created_at)}
                        </p>
                        <p className="mt-1 break-all text-[11px] text-slate-500">
                          {t({ ko: '담당', en: 'Owner', ja: '担当', zh: '负责人' })}: {group.root.assigned_agent_name_ko || group.root.assigned_agent_name || '-'}
                        </p>
                        <p className="mt-1 text-[11px] text-blue-300">
                          {t({ ko: '하위 작업', en: 'Sub tasks', ja: 'サブタスク', zh: '子任务' })}: {group.children.length}
                        </p>
                        {group.children.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {group.children.slice(0, 3).map((child) => (
                              <p key={child.id} className="whitespace-pre-wrap break-all text-[11px] text-slate-500">
                                - {child.title}
                              </p>
                            ))}
                            {group.children.length > 3 && (
                              <p className="text-[11px] text-slate-500">
                                +{group.children.length - 3}
                              </p>
                            )}
                          </div>
                        )}
                        <p className="mt-2 text-right text-[11px] text-emerald-300">
                          {t({ ko: '카드 클릭으로 상세 보기', en: 'Click card for details', ja: 'クリックで詳細表示', zh: '点击卡片查看详情' })}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <h4 className="text-sm font-semibold text-white">
                  {t({ ko: '보고서 이력(프로젝트 매핑)', en: 'Mapped Reports', ja: '紐づくレポート', zh: '映射报告' })}
                </h4>
                {!selectedProject ? (
                  <p className="mt-2 text-xs text-slate-500">-</p>
                ) : sortedReports.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">{t({ ko: '연결된 보고서가 없습니다', en: 'No mapped reports', ja: '紐づくレポートなし', zh: '没有映射报告' })}</p>
                ) : (
                  <div className="mt-2 max-h-56 overflow-y-auto space-y-2">
                    {sortedReports.map((row) => (
                      <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-100">{row.title}</p>
                          <p className="text-[11px] text-slate-400">{fmtTime(row.completed_at || row.created_at)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleOpenTaskDetail(row.id)}
                          className="rounded-md bg-emerald-700 px-2 py-1 text-[11px] text-white hover:bg-emerald-600"
                        >
                          {t({ ko: '열람', en: 'Open', ja: '表示', zh: '查看' })}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {missingPathPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setMissingPathPrompt(null)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {t({ ko: '프로젝트 경로 확인', en: 'Confirm Project Path', ja: 'プロジェクトパス確認', zh: '确认项目路径' })}
              </h3>
            </div>
            <div className="space-y-2 px-4 py-4">
              <p className="text-sm text-slate-200">
                {t({
                  ko: '해당 경로가 없습니다. 추가하시겠습니까?',
                  en: 'This path does not exist. Create it now?',
                  ja: 'このパスは存在しません。作成しますか？',
                  zh: '该路径不存在。现在创建吗？',
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
                    ko: '현재 권한으로 해당 경로를 생성할 수 없습니다. 다른 경로를 선택해주세요.',
                    en: 'This path is not creatable with current permissions. Choose another path.',
                    ja: '現在の権限ではこのパスを作成できません。別のパスを指定してください。',
                    zh: '当前权限无法创建此路径，请选择其他路径。',
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
                {t({ ko: '취소', en: 'Cancel', ja: 'キャンセル', zh: '取消' })}
              </button>
              <button
                type="button"
                disabled={!missingPathPrompt.canCreate || saving}
                onClick={() => {
                  setMissingPathPrompt(null);
                  void handleSave(true);
                }}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t({ ko: '예', en: 'Yes', ja: 'はい', zh: '是' })}
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
                {t({ ko: '앱 내 폴더 탐색', en: 'In-App Folder Browser', ja: 'アプリ内フォルダ閲覧', zh: '应用内文件夹浏览' })}
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
                  {t({ ko: '현재 위치', en: 'Current Location', ja: '現在位置', zh: '当前位置' })}
                </p>
                <p className="break-all text-xs text-slate-200">{manualPathCurrent || '-'}</p>
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
                  {t({ ko: '상위 폴더', en: 'Up', ja: '上位フォルダ', zh: '上级目录' })}
                </button>
                <button
                  type="button"
                  disabled={manualPathLoading}
                  onClick={() => void loadManualPathEntries(manualPathCurrent || undefined)}
                  className="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t({ ko: '새로고침', en: 'Refresh', ja: '更新', zh: '刷新' })}
                </button>
              </div>
              <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50">
                {manualPathLoading ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {t({
                      ko: '폴더 목록을 불러오는 중...',
                      en: 'Loading directories...',
                      ja: 'フォルダ一覧を読み込み中...',
                      zh: '正在加载目录...',
                    })}
                  </p>
                ) : manualPathError ? (
                  <p className="px-3 py-2 text-xs text-rose-300">{manualPathError}</p>
                ) : manualPathEntries.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {t({
                      ko: '선택 가능한 하위 폴더가 없습니다.',
                      en: 'No selectable subdirectories.',
                      ja: '選択可能なサブディレクトリがありません。',
                      zh: '没有可选的子目录。',
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
                    ko: '항목이 많아 상위 300개 폴더만 표시했습니다.',
                    en: 'Only the first 300 directories are shown.',
                    ja: '項目数が多いため先頭300件のみ表示しています。',
                    zh: '目录过多，仅显示前300个。',
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
                {t({ ko: '취소', en: 'Cancel', ja: 'キャンセル', zh: '取消' })}
              </button>
              <button
                type="button"
                disabled={!manualPathCurrent}
                onClick={() => {
                  if (!manualPathCurrent) return;
                  setProjectPath(manualPathCurrent);
                  setMissingPathPrompt(null);
                  setPathSuggestionsOpen(false);
                  setFormFeedback(null);
                  setManualPathPickerOpen(false);
                }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t({ ko: '현재 폴더 선택', en: 'Select Current Folder', ja: '現在フォルダを選択', zh: '选择当前文件夹' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
