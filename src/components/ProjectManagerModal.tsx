import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Department, Project, AssignmentMode } from '../types';
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
import GitHubImportPanel from './GitHubImportPanel';
import AgentAvatar, { useSpriteMap } from './AgentAvatar';

interface ProjectManagerModalProps {
  agents: Agent[];
  departments?: Department[];
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
type ManualAssignmentWarning = {
  reason: 'no_agents' | 'leaders_only';
  allowCreateMissingPath: boolean;
};

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ProjectManagerModal({ agents, departments = [], onClose }: ProjectManagerModalProps) {
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
  const [githubImportMode, setGithubImportMode] = useState(false);
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

  // 직원 직접선택 상태
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('auto');
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [agentFilterDept, setAgentFilterDept] = useState<string>('all');
  const [manualAssignmentWarning, setManualAssignmentWarning] = useState<ManualAssignmentWarning | null>(null);
  const spriteMap = useSpriteMap(agents);

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
          setAssignmentMode(res.project.assignment_mode || 'auto');
          setSelectedAgentIds(new Set(res.project.assigned_agent_ids || []));
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
  const getManualAssignmentWarning = useCallback((): ManualAssignmentWarning['reason'] | null => {
    const selectedAgents = agents.filter((agent) => selectedAgentIds.has(agent.id));
    if (selectedAgents.length === 0) return 'no_agents';
    const hasSubordinate = selectedAgents.some((agent) => agent.role !== 'team_leader');
    return hasSubordinate ? null : 'leaders_only';
  }, [agents, selectedAgentIds]);
  const manualSelectionStats = useMemo(() => {
    const selected = agents.filter((agent) => selectedAgentIds.has(agent.id));
    const leaders = selected.filter((agent) => agent.role === 'team_leader').length;
    const subordinates = selected.length - leaders;
    return {
      total: selected.length,
      leaders,
      subordinates,
    };
  }, [agents, selectedAgentIds]);

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

  const sortedDecisionEvents = useMemo(() => {
    if (!detail) return [];
    return [...(detail.decision_events ?? [])].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }, [detail]);

  const getDecisionEventLabel = useCallback((eventType: string) => {
    if (eventType === 'planning_summary') {
      return t({ ko: '기획팀장 분류', en: 'Planning Classification', ja: '企画リード分類', zh: '规划负责人分类' });
    }
    if (eventType === 'representative_pick') {
      return t({ ko: '대표 항목 선택', en: 'Representative Pick', ja: '代表項目選択', zh: '代表项选择' });
    }
    if (eventType === 'followup_request') {
      return t({ ko: '추가 요청', en: 'Follow-up Request', ja: '追加要請', zh: '追加请求' });
    }
    if (eventType === 'start_review_meeting') {
      return t({ ko: '팀장 회의 시작', en: 'Team-Lead Meeting Start', ja: 'チームリーダー会議開始', zh: '启动组长会议' });
    }
    return eventType;
  }, [t]);

  const startCreate = () => {
    setIsCreating(true);
    setEditingProjectId(null);
    setName('');
    setProjectPath('');
    setCoreGoal('');
    setAssignmentMode('auto');
    setSelectedAgentIds(new Set());
    setManualAssignmentWarning(null);
    resetPathHelperState();
  };

  const startEditSelected = () => {
    if (!viewedProject) return;
    setIsCreating(false);
    setEditingProjectId(viewedProject.id);
    setName(viewedProject.name);
    setProjectPath(viewedProject.project_path);
    setCoreGoal(viewedProject.core_goal);
    setAssignmentMode(viewedProject.assignment_mode || 'auto');
    setSelectedAgentIds(new Set(viewedProject.assigned_agent_ids || []));
    setManualAssignmentWarning(null);
    resetPathHelperState();
  };

  const handleSave = async (allowCreateMissingPath = false, bypassManualWarning = false) => {
    if (!canSave || saving) return;
    if (!bypassManualWarning && assignmentMode === 'manual') {
      const warningReason = getManualAssignmentWarning();
      if (warningReason) {
        setManualAssignmentWarning({ reason: warningReason, allowCreateMissingPath });
        return;
      }
    }
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
          assignment_mode: assignmentMode,
          agent_ids: assignmentMode === 'manual' ? Array.from(selectedAgentIds) : [],
        });
        setSelectedProjectId(updated.id);
      } else {
        const created = await createProject({
          name: name.trim(),
          project_path: savePath,
          core_goal: coreGoal.trim(),
          create_path_if_missing: createPathIfMissing,
          assignment_mode: assignmentMode,
          agent_ids: assignmentMode === 'manual' ? Array.from(selectedAgentIds) : [],
        });
        setSelectedProjectId(created.id);
      }
      await loadProjects(1, search);
      setEditingProjectId(null);
      setIsCreating(false);
      setManualAssignmentWarning(null);
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
      <div className="flex h-[86vh] w-[min(1180px,95vw)] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl md:flex-row">
        <aside className={`flex w-full flex-col border-r border-slate-700 bg-slate-900/70 md:w-[330px] ${(selectedProjectId || isCreating || githubImportMode) ? 'hidden md:flex' : 'flex'}`}>
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
              <button
                type="button"
                onClick={() => { setGithubImportMode(true); setIsCreating(false); setEditingProjectId(null); }}
                className="rounded-md bg-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-600"
              >
                {t({ ko: 'GitHub 가져오기', en: 'GitHub Import', ja: 'GitHub インポート', zh: 'GitHub 导入' })}
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
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
                      {p.name}
                      {p.github_repo && (
                        <svg className="inline-block h-3.5 w-3.5 shrink-0 text-slate-400" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                        </svg>
                      )}
                    </p>
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

        <section className={`flex min-w-0 flex-1 flex-col overflow-hidden ${(!selectedProjectId && !isCreating && !githubImportMode) ? 'hidden md:flex' : 'flex'}`}>
          {/* 모바일 뒤로가기 버튼 */}
          <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-2 md:hidden">
            <button
              type="button"
              onClick={() => { setSelectedProjectId(null); setIsCreating(false); setEditingProjectId(null); setGithubImportMode(false); }}
              className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              ← {t({ ko: '목록', en: 'List', ja: '一覧', zh: '列表' })}
            </button>
          </div>
          {githubImportMode ? (
            <GitHubImportPanel
              onComplete={(result) => {
                setGithubImportMode(false);
                void loadProjects(1, '');
                setSelectedProjectId(result.projectId);
                setIsCreating(false);
                setEditingProjectId(null);
              }}
              onCancel={() => setGithubImportMode(false)}
            />
          ) : (
          <>
          <div className="border-b border-slate-700 px-5 py-3">
            <h3 className="text-sm font-semibold text-white">{formTitle}</h3>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overflow-x-hidden p-5 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
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
                      ? 'border-rose-500/60 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                      : 'border-cyan-500/50 bg-cyan-500/10 text-cyan-800 dark:text-cyan-100'
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

              {/* 직원 할당 모드 */}
              {(isCreating || !!editingProjectId) && (
                <div className="space-y-3 mt-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-slate-400">
                      {t({ ko: '직원 할당 방식', en: 'Assignment Mode', ja: '割り当てモード', zh: '分配模式' })}
                    </span>
                    <div className="flex gap-1 p-0.5 rounded-lg bg-slate-800 border border-slate-700">
                      <button
                        type="button"
                        onClick={() => {
                          setAssignmentMode('auto');
                          setManualAssignmentWarning(null);
                        }}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                          assignmentMode === 'auto' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t({ ko: '자동 할당', en: 'Auto', ja: '自動', zh: '自动' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignmentMode('manual');
                          setManualAssignmentWarning(null);
                        }}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                          assignmentMode === 'manual' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t({ ko: '직접 선택', en: 'Manual', ja: '手動', zh: '手动' })}
                      </button>
                    </div>
                  </div>

                  {assignmentMode === 'manual' && (
                    <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">
                          {t({ ko: '참여 직원 선택', en: 'Select Agents', ja: 'エージェント選択', zh: '选择员工' })}
                          <span className="ml-2 text-blue-400 font-medium">{selectedAgentIds.size}{t({ ko: '명', en: ' selected', ja: '人', zh: '人' })}</span>
                        </span>
                        {departments.length > 0 && (
                          <select
                            value={agentFilterDept}
                            onChange={(e) => setAgentFilterDept(e.target.value)}
                            className="text-[11px] px-2 py-1 rounded border border-slate-700 bg-slate-800 text-slate-300 outline-none"
                          >
                            <option value="all">{t({ ko: '전체 부서', en: 'All Depts', ja: '全部署', zh: '所有部门' })}</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>{d.icon} {language === 'ko' ? d.name_ko || d.name : d.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-slate-300">
                          {t({ ko: '총', en: 'Total', ja: '合計', zh: '总计' })}: {manualSelectionStats.total}
                        </span>
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
                          {t({ ko: '팀장', en: 'Leaders', ja: 'リーダー', zh: '组长' })}: {manualSelectionStats.leaders}
                        </span>
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                          {t({ ko: '하위 직원', en: 'Subordinates', ja: 'サブ担当', zh: '下属成员' })}: {manualSelectionStats.subordinates}
                        </span>
                      </div>
                      {manualSelectionStats.subordinates === 0 && (
                        <p className="text-[11px] text-amber-300">
                          {t({
                            ko: '하위 직원이 없으면 실행 시 팀장이 직접(단독) 수행할 수 있습니다.',
                            en: 'Without subordinates, team leaders may execute tasks directly.',
                            ja: 'サブ担当がいない場合、実行時にチームリーダーが直接対応する可能性があります。',
                            zh: '若无下属成员，运行时可能由组长直接执行。',
                          })}
                        </p>
                      )}
                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {agents
                          .filter((a) => agentFilterDept === 'all' || a.department_id === agentFilterDept)
                          .sort((a, b) => {
                            const roleOrder: Record<string, number> = { team_leader: 0, senior: 1, junior: 2, intern: 3 };
                            return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || a.name.localeCompare(b.name);
                          })
                          .map((agent) => {
                            const checked = selectedAgentIds.has(agent.id);
                            const dept = departments.find((d) => d.id === agent.department_id);
                            return (
                              <label
                                key={agent.id}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all ${
                                  checked ? 'bg-blue-600/10 border border-blue-500/30' : 'hover:bg-slate-800 border border-transparent'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(selectedAgentIds);
                                    if (checked) next.delete(agent.id);
                                    else next.add(agent.id);
                                    setSelectedAgentIds(next);
                                    setManualAssignmentWarning(null);
                                  }}
                                  className="w-3.5 h-3.5 rounded border-slate-600 accent-blue-500"
                                />
                                <AgentAvatar agent={agent} spriteMap={spriteMap} size={24} />
                                <span className="text-xs font-medium text-slate-200">
                                  {language === 'ko' ? agent.name_ko || agent.name : agent.name}
                                </span>
                                {dept && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: dept.color + '22', color: dept.color }}>
                                    {language === 'ko' ? dept.name_ko || dept.name : dept.name}
                                  </span>
                                )}
                                <span className="text-[10px] ml-auto px-1.5 py-0.5 rounded" style={{ color: 'var(--th-text-muted)', background: 'rgba(255,255,255,0.05)' }}>
                                  {agent.role === 'team_leader'
                                    ? (language === 'ko' ? '팀장' : 'Leader')
                                    : agent.role === 'senior'
                                    ? (language === 'ko' ? '시니어' : 'Senior')
                                    : agent.role === 'junior'
                                    ? (language === 'ko' ? '주니어' : 'Junior')
                                    : agent.role === 'intern'
                                    ? (language === 'ko' ? '인턴' : 'Intern')
                                    : ''}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 읽기 전용에서 할당 모드 표시 */}
              {!isCreating && !editingProjectId && selectedProject && (selectedProject as any).assignment_mode === 'manual' && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-violet-600/10 border border-violet-500/20">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-violet-400">
                      {t({ ko: '직접 선택 모드', en: 'Manual Assignment', ja: '手動割り当て', zh: '手动分配' })}
                    </span>
                    <span className="text-xs text-slate-400">
                      {detail?.assigned_agents?.length ?? 0}{t({ ko: '명 지정', en: ' agents', ja: '人', zh: '人' })}
                    </span>
                  </div>
                  {detail?.assigned_agents && detail.assigned_agents.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {detail.assigned_agents.map((a: Agent) => (
                        <span key={a.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                          <AgentAvatar agent={a} spriteMap={spriteMap} size={16} />
                          {language === 'ko' ? (a as any).name_ko || a.name : a.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

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

            <div className="min-w-0 space-y-4">
              <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white">
                    {t({ ko: '프로젝트 정보', en: 'Project Info', ja: 'プロジェクト情報', zh: '项目信息' })}
                  </h4>
                  {selectedProject?.github_repo && (
                    <a
                      href={`https://github.com/${selectedProject.github_repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={selectedProject.github_repo}
                      className="flex items-center gap-1 rounded-md border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-blue-500 hover:text-white"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                      </svg>
                      {selectedProject.github_repo}
                    </a>
                  )}
                </div>
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

              <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
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

              <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <h4 className="text-sm font-semibold text-white">
                  {t({ ko: '보고서 이력(프로젝트 매핑)', en: 'Mapped Reports', ja: '紐づくレポート', zh: '映射报告' })}
                </h4>
                {!selectedProject ? (
                  <p className="mt-2 text-xs text-slate-500">-</p>
                ) : sortedReports.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">{t({ ko: '연결된 보고서가 없습니다', en: 'No mapped reports', ja: '紐づくレポートなし', zh: '没有映射报告' })}</p>
                ) : (
                  <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
                    {sortedReports.map((row) => (
                      <div key={row.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
                        <div className="min-w-0">
                          <p className="whitespace-pre-wrap break-all text-xs font-medium text-slate-100">{row.title}</p>
                          <p className="text-[11px] text-slate-400">{fmtTime(row.completed_at || row.created_at)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleOpenTaskDetail(row.id)}
                          className="shrink-0 rounded-md bg-emerald-700 px-2 py-1 text-[11px] text-white hover:bg-emerald-600"
                        >
                          {t({ ko: '열람', en: 'Open', ja: '表示', zh: '查看' })}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <h4 className="text-sm font-semibold text-white">
                  {t({ ko: '대표 선택사항', en: 'Representative Decisions', ja: '代表選択事項', zh: '代表选择事项' })}
                </h4>
                {!selectedProject ? (
                  <p className="mt-2 text-xs text-slate-500">-</p>
                ) : sortedDecisionEvents.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {t({
                      ko: '기록된 대표 의사결정이 없습니다',
                      en: 'No representative decision records',
                      ja: '代表意思決定の記録はありません',
                      zh: '暂无代表决策记录',
                    })}
                  </p>
                ) : (
                  <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
                    {sortedDecisionEvents.map((event) => {
                      let selectedLabels: string[] = [];
                      if (event.selected_options_json) {
                        try {
                          const parsed = JSON.parse(event.selected_options_json) as Array<{ label?: unknown }>;
                          selectedLabels = Array.isArray(parsed)
                            ? parsed
                              .map((row) => (typeof row?.label === 'string' ? row.label.trim() : ''))
                              .filter((label) => label.length > 0)
                            : [];
                        } catch {
                          selectedLabels = [];
                        }
                      }

                      return (
                        <div
                          key={`${event.id}-${event.created_at}`}
                          className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-xs font-semibold text-slate-100">{getDecisionEventLabel(event.event_type)}</p>
                            <p className="text-[11px] text-slate-400">{fmtTime(event.created_at)}</p>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-300">{event.summary}</p>
                          {selectedLabels.length > 0 && (
                            <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-blue-300">
                              {t({ ko: '선택 내용', en: 'Selected Items', ja: '選択内容', zh: '已选内容' })}: {selectedLabels.join(' / ')}
                            </p>
                          )}
                          {event.note && event.note.trim().length > 0 && (
                            <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-emerald-300">
                              {t({ ko: '추가 요청사항', en: 'Additional Request', ja: '追加要請事項', zh: '追加请求事项' })}: {event.note}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          </>
          )}
        </section>
      </div>

      {manualAssignmentWarning && (
        <div
          className="fixed inset-0 z-[61] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setManualAssignmentWarning(null)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-amber-500/40 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-amber-500/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-amber-200">
                {t({
                  ko: '수동 배정 확인',
                  en: 'Manual Assignment Check',
                  ja: '手動割り当て確認',
                  zh: '手动分配确认',
                })}
              </h3>
            </div>
            <div className="space-y-2 px-4 py-4">
              <p className="text-sm text-slate-100">
                {manualAssignmentWarning.reason === 'no_agents'
                  ? t({
                    ko: '직원이 선택되지 않았습니다. 이 상태로 저장하면 수동 모드 안전장치에 따라 팀장이 직접(단독) 실행할 수 있습니다. 계속 저장할까요?',
                    en: 'No agents are selected. If you save now, the manual-mode safeguard may let team leaders execute tasks directly. Continue?',
                    ja: 'エージェントが選択されていません。このまま保存すると実行時にチームリーダーが直接対応する可能性があります。続行しますか？',
                    zh: '当前未选择员工。若继续保存，运行时可能由组长直接执行。是否继续？',
                  })
                  : t({
                    ko: '팀장만 선택되어 있습니다. 하위 직원이 없으므로 수동 모드 안전장치에 따라 팀장이 직접(단독) 실행할 수 있습니다. 계속 저장할까요?',
                    en: 'Only team leaders are selected. Without subordinates, the manual-mode safeguard may let team leaders execute tasks directly. Continue?',
                    ja: 'チームリーダーのみ選択されています。サブ担当がいない場合、実行時にチームリーダーが直接対応する可能性があります。続行しますか？',
                    zh: '当前仅选择了组长。若无下属成员，运行时可能由组长直接执行。是否继续？',
                  })}
              </p>
              <div className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-300">
                <p>
                  {t({ ko: '선택 요약', en: 'Selection Summary', ja: '選択サマリー', zh: '选择摘要' })}: {manualSelectionStats.total}
                </p>
                <p>
                  {t({ ko: '팀장', en: 'Leaders', ja: 'リーダー', zh: '组长' })}: {manualSelectionStats.leaders} · {t({ ko: '하위 직원', en: 'Subordinates', ja: 'サブ担当', zh: '下属成员' })}: {manualSelectionStats.subordinates}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
              <button
                type="button"
                onClick={() => setManualAssignmentWarning(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {t({ ko: '취소', en: 'Cancel', ja: 'キャンセル', zh: '取消' })}
              </button>
              <button
                type="button"
                onClick={() => {
                  const pending = manualAssignmentWarning;
                  setManualAssignmentWarning(null);
                  if (!pending) return;
                  void handleSave(pending.allowCreateMissingPath, true);
                }}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
              >
                {t({ ko: '계속 저장', en: 'Save Anyway', ja: 'そのまま保存', zh: '仍然保存' })}
              </button>
            </div>
          </div>
        </div>
      )}

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
