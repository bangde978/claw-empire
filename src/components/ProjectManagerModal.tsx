import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Project } from '../types';
import {
  createProject,
  deleteProject,
  getProjectDetail,
  getProjects,
  getTaskReportDetail,
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
  };

  const startEditSelected = () => {
    if (!viewedProject) return;
    setIsCreating(false);
    setEditingProjectId(viewedProject.id);
    setName(viewedProject.name);
    setProjectPath(viewedProject.project_path);
    setCoreGoal(viewedProject.core_goal);
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (editingProjectId) {
        const updated = await updateProject(editingProjectId, {
          name: name.trim(),
          project_path: projectPath.trim(),
          core_goal: coreGoal.trim(),
        });
        setSelectedProjectId(updated.id);
      } else {
        const created = await createProject({
          name: name.trim(),
          project_path: projectPath.trim(),
          core_goal: coreGoal.trim(),
        });
        setSelectedProjectId(created.id);
      }
      await loadProjects(1, search);
      setEditingProjectId(null);
      setIsCreating(false);
    } catch (err) {
      console.error('Failed to save project:', err);
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
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isCreating && !editingProjectId}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                {t({ ko: '프로젝트 경로', en: 'Project Path', ja: 'プロジェクトパス', zh: '项目路径' })}
                <input
                  type="text"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  disabled={!isCreating && !editingProjectId}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>
              <label className="block text-xs text-slate-400">
                {t({ ko: '핵심 목표', en: 'Core Goal', ja: 'コア目標', zh: '核心目标' })}
                <textarea
                  rows={5}
                  value={coreGoal}
                  onChange={(e) => setCoreGoal(e.target.value)}
                  disabled={!isCreating && !editingProjectId}
                  className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                {(isCreating || !!editingProjectId) && (
                  <button
                    type="button"
                    onClick={handleSave}
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
    </div>
  );
}
