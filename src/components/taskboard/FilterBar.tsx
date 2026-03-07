import type { Agent, Department } from "../../types";
import { useI18n } from "../../i18n";
import AgentSelect from "../AgentSelect";
import { TASK_TYPE_OPTIONS, taskTypeLabel } from "./constants";

interface FilterBarProps {
  agents: Agent[];
  departments: Department[];
  filterDept: string;
  filterAgent: string;
  filterType: string;
  filterProject: string;
  search: string;
  onFilterDept: (value: string) => void;
  onFilterAgent: (value: string) => void;
  onFilterType: (value: string) => void;
  onFilterProject: (value: string) => void;
  onSearch: (value: string) => void;
}

export default function FilterBar({
  agents,
  departments,
  filterDept,
  filterAgent,
  filterType,
  filterProject,
  search,
  onFilterDept,
  onFilterAgent,
  onFilterType,
  onFilterProject,
  onSearch,
}: FilterBarProps) {
  const { t, language: locale } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[140px] flex-1 sm:min-w-[180px]">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔎</span>
        <input
          type="text"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t({ ko: "업무 검색...", en: "Search tasks...", ja: "タスク検索...", zh: "搜索任务..." })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <select
        value={filterDept}
        onChange={(event) => onFilterDept(event.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 outline-none transition focus:border-blue-500"
      >
        <option value="">{t({ ko: "전체 부서", en: "All Departments", ja: "全部署", zh: "全部门" })}</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.icon} {locale === "ko" ? department.name_ko : department.name}
          </option>
        ))}
      </select>

      <AgentSelect
        agents={agents}
        departments={departments}
        value={filterAgent}
        onChange={onFilterAgent}
        placeholder={t({ ko: "전체 에이전트", en: "All Agents", ja: "全エージェント", zh: "全部代理" })}
        size="md"
      />

      <select
        value={filterType}
        onChange={(event) => onFilterType(event.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 outline-none transition focus:border-blue-500"
      >
        <option value="">{t({ ko: "전체 유형", en: "All Types", ja: "全タイプ", zh: "全部类型" })}</option>
        {TASK_TYPE_OPTIONS.map((typeOption) => (
          <option key={typeOption.value} value={typeOption.value}>
            {taskTypeLabel(typeOption.value, t)}
          </option>
        ))}
      </select>

      <div className="relative min-w-[180px] flex-1 sm:max-w-[320px]">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">🗂</span>
        <input
          type="text"
          value={filterProject}
          onChange={(event) => onFilterProject(event.target.value)}
          placeholder={t({ ko: "프로젝트 경로...", en: "Project path...", ja: "プロジェクトパス...", zh: "项目路径..." })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
