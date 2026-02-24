import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent, Department, AgentRole, CliProvider } from '../types';
import { useI18n, localeName } from '../i18n';
import * as api from '../api';
import AgentAvatar, { buildSpriteMap } from './AgentAvatar';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface AgentManagerProps {
  agents: Agent[];
  departments: Department[];
  onAgentsChange: () => void;
}

const ROLES: AgentRole[] = ['team_leader', 'senior', 'junior', 'intern'];
const CLI_PROVIDERS: CliProvider[] = ['claude', 'codex', 'gemini', 'opencode', 'copilot', 'antigravity', 'api'];

const ROLE_LABEL: Record<string, { ko: string; en: string }> = {
  team_leader: { ko: '팀장', en: 'Leader' },
  senior: { ko: '시니어', en: 'Senior' },
  junior: { ko: '주니어', en: 'Junior' },
  intern: { ko: '인턴', en: 'Intern' },
};

const ROLE_BADGE: Record<string, string> = {
  team_leader: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  senior: 'bg-sky-500/15 text-sky-400 border-sky-500/25',
  junior: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  intern: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
};

const STATUS_DOT: Record<string, string> = {
  working: 'bg-emerald-400 shadow-emerald-400/50 shadow-sm',
  break: 'bg-amber-400',
  offline: 'bg-red-400',
  idle: 'bg-slate-500',
};

/* ═══════════════════════════════════════ Emoji Picker ═══════════════════════════════════════ */

const EMOJI_GROUPS: { label: string; labelEn: string; emojis: string[] }[] = [
  { label: '부서/업무', labelEn: 'Work', emojis: ['📊', '💻', '🎨', '🔍', '🛡️', '⚙️', '📁', '🏢', '📋', '📈', '💼', '🗂️', '📌', '🎯', '🔧', '🧪'] },
  { label: '사람/표정', labelEn: 'People', emojis: ['🤖', '👤', '👥', '😊', '😎', '🤓', '🧑‍💻', '👨‍🔬', '👩‍🎨', '🧑‍🏫', '🦸', '🦊', '🐱', '🐶', '🐻', '🐼'] },
  { label: '사물/기호', labelEn: 'Objects', emojis: ['💡', '🚀', '⚡', '🔥', '💎', '🏆', '🎵', '🎮', '📱', '💾', '🖥️', '📡', '🔑', '🛠️', '📦', '🧩'] },
  { label: '자연/색상', labelEn: 'Nature', emojis: ['🌟', '⭐', '🌈', '🌊', '🌸', '🍀', '🌙', '☀️', '❄️', '🔵', '🟢', '🟡', '🔴', '🟣', '🟠', '⚪'] },
];

function EmojiPicker({ value, onChange, size = 'md' }: { value: string; onChange: (emoji: string) => void; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const btnSize = size === 'sm' ? 'w-10 h-10 text-lg' : 'w-14 h-10 text-xl';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${btnSize} rounded-lg border flex items-center justify-center transition-all hover:scale-105 hover:shadow-md`}
        style={{ background: 'var(--th-input-bg)', borderColor: 'var(--th-input-border)' }}
      >
        {value || '❓'}
      </button>
      {open && (
        <div
          className="absolute z-[60] top-full mt-1 left-0 rounded-xl shadow-2xl p-3 w-72"
          style={{ background: 'var(--th-card-bg)', border: '1px solid var(--th-card-border)', backdropFilter: 'blur(20px)' }}
        >
          {EMOJI_GROUPS.map((g) => (
            <div key={g.label} className="mb-2 last:mb-0">
              <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--th-text-muted)' }}>
                {g.label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => { onChange(emoji); setOpen(false); }}
                    className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all hover:scale-125 hover:bg-[var(--th-bg-surface-hover)] ${
                      value === emoji ? 'ring-2 ring-blue-400 bg-blue-500/15' : ''
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FormData {
  name: string;
  name_ko: string;
  name_ja: string;
  name_zh: string;
  department_id: string;
  role: AgentRole;
  cli_provider: CliProvider;
  avatar_emoji: string;
  sprite_number: number | null;
  personality: string;
}

const BLANK: FormData = {
  name: '', name_ko: '', name_ja: '', name_zh: '', department_id: '', role: 'junior',
  cli_provider: 'claude', avatar_emoji: '🤖', sprite_number: null, personality: '',
};

export default function AgentManager({ agents, departments, onAgentsChange }: AgentManagerProps) {
  const { t, locale } = useI18n();
  const isKo = locale.startsWith('ko');
  const tr = (ko: string, en: string) => t({ ko, en, ja: en, zh: en });

  const [search, setSearch] = useState('');
  const [deptTab, setDeptTab] = useState('all');
  const [modalAgent, setModalAgent] = useState<Agent | null>(null); // null + showModal=true → 생성
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormData>({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 부서 관리 상태
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);

  const spriteMap = buildSpriteMap(agents);

  // 부서별 카운트
  const deptCounts = new Map<string, { total: number; working: number }>();
  for (const a of agents) {
    const key = a.department_id || '__none';
    const c = deptCounts.get(key) ?? { total: 0, working: 0 };
    c.total++;
    if (a.status === 'working') c.working++;
    deptCounts.set(key, c);
  }

  const filtered = agents.filter((a) => {
    if (deptTab !== 'all' && a.department_id !== deptTab) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.name.toLowerCase().includes(q) || a.name_ko.toLowerCase().includes(q)
        || (a.name_ja || '').toLowerCase().includes(q) || (a.name_zh || '').toLowerCase().includes(q);
    }
    return true;
  });

  // 직급 순서 정렬
  const roleOrder: Record<string, number> = { team_leader: 0, senior: 1, junior: 2, intern: 3 };
  const sorted = [...filtered].sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || a.name.localeCompare(b.name));

  const openCreate = () => {
    setModalAgent(null);
    setForm({ ...BLANK, department_id: deptTab !== 'all' ? deptTab : departments[0]?.id || '' });
    setShowModal(true);
  };

  const openEdit = (agent: Agent) => {
    setModalAgent(agent);
    // DB에 sprite_number가 없으면 buildSpriteMap에서 자동 할당된 번호 사용
    const computed = agent.sprite_number ?? buildSpriteMap(agents).get(agent.id) ?? null;
    setForm({
      name: agent.name, name_ko: agent.name_ko,
      name_ja: agent.name_ja || '', name_zh: agent.name_zh || '',
      department_id: agent.department_id || '',
      role: agent.role, cli_provider: agent.cli_provider,
      avatar_emoji: agent.avatar_emoji, sprite_number: computed,
      personality: agent.personality || '',
    });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setModalAgent(null); };

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const departmentId = form.department_id.trim();
      const basePayload = {
        name: form.name.trim(), name_ko: form.name_ko.trim(),
        name_ja: form.name_ja.trim(), name_zh: form.name_zh.trim(),
        role: form.role, cli_provider: form.cli_provider,
        avatar_emoji: form.avatar_emoji || '🤖',
        sprite_number: form.sprite_number,
        personality: form.personality.trim() || null,
      };
      if (modalAgent) {
        await api.updateAgent(modalAgent.id, {
          ...basePayload,
          department_id: departmentId || null,
        });
      } else {
        await api.createAgent({
          ...basePayload,
          department_id: departmentId || null,
        });
      }
      onAgentsChange();
      closeModal();
    } catch (e) { console.error('Save failed:', e); }
    finally { setSaving(false); }
  }, [form, modalAgent, onAgentsChange]);

  const handleDelete = useCallback(async (id: string) => {
    setSaving(true);
    try {
      await api.deleteAgent(id);
      onAgentsChange();
      setConfirmDeleteId(null);
      if (modalAgent?.id === id) closeModal();
    } catch (e) { console.error('Delete failed:', e); }
    finally { setSaving(false); }
  }, [modalAgent, onAgentsChange]);

  // 부서 관리
  const openCreateDept = () => { setEditDept(null); setShowDeptModal(true); };
  const openEditDept = (dept: Department) => { setEditDept(dept); setShowDeptModal(true); };
  const closeDeptModal = () => { setShowDeptModal(false); setEditDept(null); };

  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--th-text-heading)' }}>
          <span className="relative inline-flex items-center" style={{ width: 30, height: 22 }}>
            <img src="/sprites/8-D-1.png" alt="" className="absolute left-0 top-0 w-5 h-5 rounded-full object-cover" style={{ imageRendering: 'pixelated', opacity: 0.85 }} />
            <img src="/sprites/3-D-1.png" alt="" className="absolute left-2.5 top-0.5 w-5 h-5 rounded-full object-cover" style={{ imageRendering: 'pixelated', zIndex: 1 }} />
          </span>
          {tr('직원 관리', 'Agent Manager')}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={openCreateDept}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 active:opacity-80 shadow-sm"
            style={{ background: '#7c3aed', color: '#ffffff', boxShadow: '0 1px 3px rgba(124,58,237,0.3)' }}
          >
            + {tr('부서 추가', 'Add Dept')}
          </button>
          <button
            onClick={openCreate}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm shadow-blue-600/20"
          >
            + {tr('신규 채용', 'Hire Agent')}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: tr('전체 인원', 'Total'), value: agents.length, icon: (
            <span className="relative inline-flex items-center" style={{ width: 22, height: 16 }}>
              <img src="/sprites/8-D-1.png" alt="" className="absolute left-0 top-0 w-4 h-4 rounded-full object-cover" style={{ imageRendering: 'pixelated', opacity: 0.85 }} />
              <img src="/sprites/3-D-1.png" alt="" className="absolute left-1.5 top-px w-4 h-4 rounded-full object-cover" style={{ imageRendering: 'pixelated', zIndex: 1 }} />
            </span>
          ) as React.ReactNode, accent: 'blue' },
          { label: tr('근무 중', 'Working'), value: workingCount, icon: '💼', accent: 'emerald' },
          { label: tr('부서', 'Departments'), value: departments.length, icon: '🏢', accent: 'violet' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{ background: 'var(--th-card-bg)', border: '1px solid var(--th-card-border)' }}
          >
            <div className="text-xs mb-1" style={{ color: 'var(--th-text-muted)' }}>{s.icon} {s.label}</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--th-text-heading)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Department tabs + Search */}
      <div className="flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--th-card-border)' }}>
        <button
          onClick={() => setDeptTab('all')}
          className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
            deptTab === 'all' ? 'text-blue-400 border-b-2 border-blue-400' : 'hover:text-slate-200'
          }`}
          style={deptTab !== 'all' ? { color: 'var(--th-text-muted)' } : undefined}
        >
          {tr('전체', 'All')} <span className="opacity-60">{agents.length}</span>
        </button>
        {departments.map((d) => {
          const c = deptCounts.get(d.id);
          return (
            <button
              key={d.id}
              onClick={() => setDeptTab(d.id)}
              onDoubleClick={(e) => { e.preventDefault(); openEditDept(d); }}
              title={tr('더블클릭: 부서 편집', 'Double-click: edit dept')}
              className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
                deptTab === d.id ? 'text-blue-400 border-b-2 border-blue-400' : 'hover:text-slate-200'
              }`}
              style={deptTab !== d.id ? { color: 'var(--th-text-muted)' } : undefined}
            >
              <span>{d.icon}</span>
              <span className="hidden sm:inline">{localeName(locale, d)}</span>
              <span className="opacity-60">{c?.total ?? 0}</span>
            </button>
          );
        })}
        <div className="ml-auto pb-1">
          <input
            type="text"
            placeholder={`${tr('검색', 'Search')}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500/40 transition-shadow w-36"
            style={{ background: 'var(--th-input-bg)', border: '1px solid var(--th-input-border)', color: 'var(--th-text-primary)' }}
          />
        </div>
      </div>

      {/* Agent grid */}
      {sorted.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--th-text-muted)' }}>
          <div className="text-3xl mb-2">🔍</div>
          {tr('검색 결과 없음', 'No agents found')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              spriteMap={spriteMap}
              isKo={isKo}
              locale={locale}
              tr={tr}
              departments={departments}
              onEdit={() => openEdit(agent)}
              confirmDeleteId={confirmDeleteId}
              onDeleteClick={() => setConfirmDeleteId(agent.id)}
              onDeleteConfirm={() => handleDelete(agent.id)}
              onDeleteCancel={() => setConfirmDeleteId(null)}
              saving={saving}
            />
          ))}
        </div>
      )}

      {/* Agent Modal */}
      {showModal && (
        <AgentFormModal
          isKo={isKo}
          locale={locale}
          tr={tr}
          form={form}
          setForm={setForm}
          departments={departments}
          isEdit={!!modalAgent}
          saving={saving}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}

      {/* Department Modal */}
      {showDeptModal && (
        <DepartmentFormModal
          locale={locale}
          tr={tr}
          department={editDept}
          departments={departments}
          onSave={onAgentsChange}
          onClose={closeDeptModal}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════ Agent Card ═══════════════════════════════════════ */

function AgentCard({ agent, spriteMap, isKo, locale, tr, departments, onEdit, confirmDeleteId, onDeleteClick, onDeleteConfirm, onDeleteCancel, saving }: {
  agent: Agent;
  spriteMap: Map<string, number>;
  isKo: boolean;
  locale: string;
  tr: (ko: string, en: string) => string;
  departments: Department[];
  onEdit: () => void;
  confirmDeleteId: string | null;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  saving: boolean;
}) {
  const isDeleting = confirmDeleteId === agent.id;
  const dept = departments.find((d) => d.id === agent.department_id);

  return (
    <div
      onClick={onEdit}
      className="group rounded-xl p-4 cursor-pointer transition-all hover:scale-[1.01] hover:shadow-lg hover:shadow-black/10"
      style={{ background: 'var(--th-card-bg)', border: '1px solid var(--th-card-border)' }}
    >
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <AgentAvatar agent={agent} spriteMap={spriteMap} size={44} rounded="xl" />
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${STATUS_DOT[agent.status] ?? STATUS_DOT.idle}`}
            style={{ borderColor: 'var(--th-card-bg)' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--th-text-heading)' }}>
              {localeName(locale, agent)}
            </span>
            <span className="text-[10px] shrink-0" style={{ color: 'var(--th-text-muted)' }}>
              {(() => {
                const primary = localeName(locale, agent);
                const sub = locale === 'en' ? (agent.name_ko || '') : agent.name;
                return primary !== sub ? sub : '';
              })()}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${ROLE_BADGE[agent.role] || ''}`}>
              {isKo ? ROLE_LABEL[agent.role]?.ko : ROLE_LABEL[agent.role]?.en}
            </span>
            {dept && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--th-bg-surface)', color: 'var(--th-text-muted)' }}>
                {dept.icon} {localeName(locale, dept)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-3 pt-2.5" style={{ borderTop: '1px solid var(--th-card-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--th-bg-surface)', color: 'var(--th-text-muted)' }}>
            {agent.cli_provider}
          </span>
          {agent.personality && (
            <span className="text-[10px] truncate max-w-[120px]" style={{ color: 'var(--th-text-muted)' }} title={agent.personality}>
              {agent.personality}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {isDeleting ? (
            <>
              <button onClick={onDeleteConfirm} disabled={saving || agent.status === 'working'}
                className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 transition-colors">
                {tr('해고', 'Fire')}
              </button>
              <button onClick={onDeleteCancel} className="px-2 py-0.5 rounded text-[10px] transition-colors" style={{ color: 'var(--th-text-muted)' }}>
                {tr('취소', 'No')}
              </button>
            </>
          ) : (
            <button onClick={onDeleteClick} className="px-1.5 py-0.5 rounded text-xs hover:bg-red-500/15 hover:text-red-400 transition-colors"
              style={{ color: 'var(--th-text-muted)' }} title={tr('해고', 'Fire')}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ Form Modal ═══════════════════════════════════════ */

function AgentFormModal({ isKo, locale, tr, form, setForm, departments, isEdit, saving, onSave, onClose }: {
  isKo: boolean;
  locale: string;
  tr: (ko: string, en: string) => string;
  form: FormData;
  setForm: (f: FormData) => void;
  departments: Department[];
  isEdit: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string> | null>(null);
  const [spriteNum, setSpriteNum] = useState(form.sprite_number ?? 0);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const inputCls = "w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors";
  const inputStyle = { background: 'var(--th-input-bg)', borderColor: 'var(--th-input-border)', color: 'var(--th-text-primary)' };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--th-modal-overlay)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{ background: 'var(--th-card-bg)', border: '1px solid var(--th-card-border)', backdropFilter: 'blur(20px)' }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold" style={{ color: 'var(--th-text-heading)' }}>
            {isEdit ? tr('직원 정보 수정', 'Edit Agent') : tr('신규 직원 채용', 'Hire New Agent')}
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--th-bg-surface-hover)] transition-colors"
            style={{ color: 'var(--th-text-muted)' }}>
            ✕
          </button>
        </div>

        {/* 2-column layout */}
        <div className="grid grid-cols-2 gap-5">
          {/* ── Left column: 기본 정보 ── */}
          <div className="space-y-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--th-text-muted)' }}>
              {tr('기본 정보', 'Basic Info')}
            </div>
            {/* ── 스프라이트 얼굴 미리보기 + 위/아래 변경 ── */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1">
                <button type="button"
                  className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                  style={{ color: 'var(--th-text-muted)', border: '1px solid var(--th-input-border)' }}
                  onClick={() => {
                    const next = Math.max(1, spriteNum || 0) + 1;
                    setSpriteNum(next);
                    setForm({ ...form, sprite_number: next });
                  }}>▲</button>
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-700 flex items-center justify-center flex-shrink-0"
                  style={{ border: '2px solid var(--th-input-border)' }}>
                  {spriteNum > 0
                    ? <img src={`/sprites/${spriteNum}-D-1.png`} alt={`sprite ${spriteNum}`}
                        className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                    : <span className="text-2xl">{form.avatar_emoji || '🤖'}</span>}
                </div>
                <button type="button"
                  className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                  style={{ color: 'var(--th-text-muted)', border: '1px solid var(--th-input-border)' }}
                  onClick={() => {
                    const next = Math.max(1, (spriteNum || 1) - 1);
                    setSpriteNum(next);
                    setForm({ ...form, sprite_number: next });
                  }}>▼</button>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--th-text-muted)', background: 'var(--th-bg-surface-hover)' }}>
                  #{spriteNum || '—'}
                </span>
                <div className="mt-2">
                  <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                    {tr('영문 이름', 'Name')} <span className="text-red-400">*</span>
                  </label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="DORO" className={inputCls} style={inputStyle} />
                </div>
              </div>
            </div>
            {/* 로캘 기반 현지 이름 필드 */}
            {locale.startsWith('ko') && (
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {tr('한글 이름', 'Korean Name')}
                </label>
                <input type="text" value={form.name_ko} onChange={(e) => setForm({ ...form, name_ko: e.target.value })}
                  placeholder="도로롱" className={inputCls} style={inputStyle} />
              </div>
            )}
            {locale.startsWith('ja') && (
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {t({ ko: '일본어 이름', en: 'Japanese Name', ja: '日本語名', zh: '日语名' })}
                </label>
                <input type="text" value={form.name_ja} onChange={(e) => setForm({ ...form, name_ja: e.target.value })}
                  placeholder="ドロロン" className={inputCls} style={inputStyle} />
              </div>
            )}
            {locale.startsWith('zh') && (
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {t({ ko: '중국어 이름', en: 'Chinese Name', ja: '中国語名', zh: '中文名' })}
                </label>
                <input type="text" value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                  placeholder="多罗隆" className={inputCls} style={inputStyle} />
              </div>
            )}
            <div className="grid grid-cols-[72px_1fr] gap-2">
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {tr('이모지', 'Emoji')}
                </label>
                <EmojiPicker value={form.avatar_emoji} onChange={(emoji) => setForm({ ...form, avatar_emoji: emoji })} />
              </div>
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {tr('소속 부서', 'Department')}
                </label>
                <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                  className={`${inputCls} cursor-pointer`} style={inputStyle}>
                  <option value="">{tr('— 미배정 —', '— Unassigned —')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.icon} {localeName(locale, d)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Right column: 역할 설정 ── */}
          <div className="space-y-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--th-text-muted)' }}>
              {tr('역할 설정', 'Role Config')}
            </div>
            {/* 직급 */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('직급', 'Role')}
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {ROLES.map((r) => {
                  const active = form.role === r;
                  return (
                    <button key={r} onClick={() => setForm({ ...form, role: r })}
                      className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                        active ? ROLE_BADGE[r] : ''
                      }`}
                      style={!active ? { borderColor: 'var(--th-input-border)', color: 'var(--th-text-muted)' } : undefined}>
                      {isKo ? ROLE_LABEL[r].ko : ROLE_LABEL[r].en}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* CLI Provider */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('CLI 도구', 'CLI Provider')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CLI_PROVIDERS.map((p) => {
                  const active = form.cli_provider === p;
                  return (
                    <button key={p} onClick={() => setForm({ ...form, cli_provider: p })}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono border transition-all ${
                        active ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : ''
                      }`}
                      style={!active ? { borderColor: 'var(--th-input-border)', color: 'var(--th-text-muted)' } : undefined}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 성격/프롬프트 */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('성격 / 역할 프롬프트', 'Personality / Prompt')}
              </label>
              <textarea value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })}
                rows={3} placeholder={tr('전문 분야나 성격 설명...', 'Expertise or personality...')}
                className={`${inputCls} resize-none`} style={inputStyle} />
            </div>
          </div>
        </div>

        {/* ── Sprite Upload ── */}
        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--th-card-border)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--th-text-muted)' }}>
            {tr('캐릭터 스프라이트', 'Character Sprite')}
          </div>

          {!previews && !processing && (
            <label
              className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors hover:border-blue-500/50"
              style={{ borderColor: 'var(--th-input-border)', color: 'var(--th-text-muted)' }}
            >
              <span className="text-2xl">🖼️</span>
              <span className="text-xs">{tr('4방향 스프라이트 시트 업로드 (2x2 그리드)', 'Upload 4-direction sprite sheet (2x2 grid)')}</span>
              <span className="text-[10px]">{tr('앞 / 왼 / 뒤 / 오른 순서', 'Front / Left / Back / Right order')}</span>
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setSpriteFile(file);
                setProcessing(true);
                setPreviews(null);
                setRegistered(false);
                try {
                  const base64 = await fileToBase64(file);
                  const result = await api.processSprite(base64);
                  setPreviews(result.previews);
                  setSpriteNum(result.suggestedNumber);
                } catch (err) {
                  console.error('Sprite processing failed:', err);
                } finally {
                  setProcessing(false);
                }
              }} />
            </label>
          )}

          {processing && (
            <div className="flex items-center justify-center gap-2 py-8" style={{ color: 'var(--th-text-muted)' }}>
              <span className="animate-spin text-lg">⏳</span>
              <span className="text-sm">{tr('배경 제거 및 분할 처리 중...', 'Removing background & splitting...')}</span>
            </div>
          )}

          {previews && !processing && (
            <div className="space-y-3">
              {/* Preview grid */}
              <div className="grid grid-cols-3 gap-3">
                {(['D', 'L', 'R'] as const).map((dir) => (
                  <div key={dir} className="text-center">
                    <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--th-text-muted)' }}>
                      {dir === 'D' ? tr('정면', 'Front') : dir === 'L' ? tr('좌측', 'Left') : tr('우측', 'Right')}
                    </div>
                    <div className="rounded-lg p-2 flex items-center justify-center h-24"
                      style={{ background: 'var(--th-input-bg)', border: '1px solid var(--th-input-border)' }}>
                      {previews[dir] ? (
                        <img src={previews[dir]} alt={dir} className="max-h-20 object-contain" style={{ imageRendering: 'pixelated' }} />
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--th-text-muted)' }}>—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sprite number + register */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                    {tr('스프라이트 번호', 'Sprite #')}
                  </label>
                  <input type="number" value={spriteNum} onChange={(e) => setSpriteNum(Number(e.target.value))}
                    min={1} className="w-16 px-2 py-1 border rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    style={{ background: 'var(--th-input-bg)', borderColor: 'var(--th-input-border)', color: 'var(--th-text-primary)' }} />
                </div>
                <button
                  onClick={async () => {
                    if (!previews) return;
                    setRegistering(true);
                    try {
                      await api.registerSprite(previews, spriteNum);
                      setRegistered(true);
                      setForm({ ...form, sprite_number: spriteNum });
                    } catch (err) {
                      console.error('Sprite register failed:', err);
                    } finally {
                      setRegistering(false);
                    }
                  }}
                  disabled={registering || registered || !spriteNum}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    registered
                      ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  } disabled:opacity-50`}
                >
                  {registering ? tr('등록 중...', 'Registering...') : registered ? tr('등록 완료!', 'Registered!') : tr('스프라이트 등록', 'Register Sprite')}
                </button>
                {previews && (
                  <button onClick={() => { setPreviews(null); setSpriteFile(null); setRegistered(false); }}
                    className="text-xs px-2 py-1 rounded-lg hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                    style={{ color: 'var(--th-text-muted)' }}>
                    {tr('다시 업로드', 'Re-upload')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions — full width */}
        <div className="flex gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--th-card-border)' }}>
          <button onClick={onSave} disabled={saving || !form.name.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white disabled:opacity-40 shadow-sm shadow-blue-600/20">
            {saving ? tr('처리 중...', 'Saving...') : isEdit ? tr('변경사항 저장', 'Save Changes') : tr('채용 확정', 'Confirm Hire')}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:bg-[var(--th-bg-surface-hover)]"
            style={{ border: '1px solid var(--th-input-border)', color: 'var(--th-text-secondary)' }}>
            {tr('취소', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ Department Form Modal ═══════════════════════════════════════ */

const DEPT_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#f97316', '#ec4899', '#06b6d4', '#6b7280'];

interface DeptForm {
  id: string;
  name: string;
  name_ko: string;
  name_ja: string;
  name_zh: string;
  icon: string;
  color: string;
  description: string;
  prompt: string;
}

const DEPT_BLANK: DeptForm = { id: '', name: '', name_ko: '', name_ja: '', name_zh: '', icon: '📁', color: '#3b82f6', description: '', prompt: '' };

function DepartmentFormModal({ locale, tr, department, departments, onSave, onClose }: {
  locale: string;
  tr: (ko: string, en: string) => string;
  department: Department | null;
  departments: Department[];
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isEdit = !!department;
  const [form, setForm] = useState<DeptForm>(() => {
    if (department) {
      return {
        id: department.id,
        name: department.name,
        name_ko: department.name_ko || '',
        name_ja: department.name_ja || '',
        name_zh: department.name_zh || '',
        icon: department.icon,
        color: department.color,
        description: department.description || '',
        prompt: department.prompt || '',
      };
    }
    return { ...DEPT_BLANK };
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // sort_order 기반 다음 순번 계산
  const nextSortOrder = (() => {
    const orders = departments.map((d) => d.sort_order).filter((n) => typeof n === 'number' && !isNaN(n));
    return Math.max(0, ...orders) + 1;
  })();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateDepartment(department!.id, {
          name: form.name.trim(), name_ko: form.name_ko.trim(),
          name_ja: form.name_ja.trim(), name_zh: form.name_zh.trim(),
          icon: form.icon, color: form.color,
          description: form.description.trim() || null,
          prompt: form.prompt.trim() || null,
        });
      } else {
        // name 기반 slug 생성, 비라틴 문자만인 경우 dept-N fallback
        const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        let deptId = slug || `dept-${nextSortOrder}`;
        // 기존 ID와 충돌 시 숫자 접미사 추가
        const existingIds = new Set(departments.map((d) => d.id));
        let suffix = 2;
        while (existingIds.has(deptId)) { deptId = `${slug || 'dept'}-${suffix++}`; }
        await api.createDepartment({
          id: deptId, name: form.name.trim(), name_ko: form.name_ko.trim(),
          name_ja: form.name_ja.trim(), name_zh: form.name_zh.trim(),
          icon: form.icon, color: form.color,
          description: form.description.trim() || undefined,
          prompt: form.prompt.trim() || undefined,
        });
      }
      onSave();
      onClose();
    } catch (e: any) {
      console.error('Dept save failed:', e);
      if (api.isApiRequestError(e) && e.code === 'department_id_exists') {
        alert(tr('이미 존재하는 부서 ID입니다.', 'Department ID already exists.'));
      } else if (api.isApiRequestError(e) && e.code === 'sort_order_conflict') {
        alert(tr('부서 정렬 순서가 충돌합니다. 잠시 후 다시 시도해주세요.', 'Department sort order conflict. Please retry.'));
      }
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await api.deleteDepartment(department!.id);
      onSave();
      onClose();
    } catch (e: any) {
      console.error('Dept delete failed:', e);
      if (api.isApiRequestError(e) && e.code === 'department_has_agents') {
        alert(tr('소속 직원이 있어 삭제할 수 없습니다.', 'Cannot delete: department has agents.'));
      } else if (api.isApiRequestError(e) && e.code === 'department_has_tasks') {
        alert(tr('연결된 업무(Task)가 있어 삭제할 수 없습니다.', 'Cannot delete: department has tasks.'));
      } else if (api.isApiRequestError(e) && e.code === 'department_protected') {
        alert(tr('기본 시스템 부서는 삭제할 수 없습니다.', 'Cannot delete: protected system department.'));
      }
    } finally { setSaving(false); }
  };

  const inputCls = "w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors";
  const inputStyle = { background: 'var(--th-input-bg)', borderColor: 'var(--th-input-border)', color: 'var(--th-text-primary)' };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--th-modal-overlay)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto"
        style={{ background: 'var(--th-card-bg)', border: '1px solid var(--th-card-border)', backdropFilter: 'blur(20px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--th-text-heading)' }}>
            <span className="text-lg">{form.icon}</span>
            {isEdit ? tr('부서 정보 수정', 'Edit Department') : tr('신규 부서 추가', 'Add Department')}
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--th-bg-surface-hover)] transition-colors"
            style={{ color: 'var(--th-text-muted)' }}>✕</button>
        </div>

        <div className="space-y-4">
          {/* 아이콘 + 영문이름 */}
          <div className="flex items-start gap-3">
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('아이콘', 'Icon')}
              </label>
              <EmojiPicker value={form.icon} onChange={(emoji) => setForm({ ...form, icon: emoji })} />
            </div>
            <div className="flex-1">
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('영문 이름', 'Name')} <span className="text-red-400">*</span>
              </label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Development" className={inputCls} style={inputStyle} />
            </div>
          </div>

          {/* 색상 선택 */}
          <div>
            <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
              {tr('테마 색상', 'Theme Color')}
            </label>
            <div className="flex gap-2">
              {DEPT_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                  className="w-7 h-7 rounded-full transition-all hover:scale-110"
                  style={{
                    background: c,
                    outline: form.color === c ? `2px solid ${c}` : '2px solid transparent',
                    outlineOffset: '3px',
                  }} />
              ))}
            </div>
          </div>

          {/* 로캘 이름 */}
          {locale.startsWith('ko') && (
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('한글 이름', 'Korean Name')}
              </label>
              <input type="text" value={form.name_ko} onChange={(e) => setForm({ ...form, name_ko: e.target.value })}
                placeholder="개발팀" className={inputCls} style={inputStyle} />
            </div>
          )}
          {locale.startsWith('ja') && (
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {t({ ko: '일본어 이름', en: 'Japanese Name', ja: '日本語名', zh: '日语名' })}
              </label>
              <input type="text" value={form.name_ja} onChange={(e) => setForm({ ...form, name_ja: e.target.value })}
                placeholder="開発チーム" className={inputCls} style={inputStyle} />
            </div>
          )}
          {locale.startsWith('zh') && (
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {t({ ko: '중국어 이름', en: 'Chinese Name', ja: '中国語名', zh: '中文名' })}
              </label>
              <input type="text" value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                placeholder="开发部" className={inputCls} style={inputStyle} />
            </div>
          )}

          {/* 설명 */}
          <div>
            <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
              {tr('부서 설명', 'Description')}
            </label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={tr('부서의 역할 간단 설명', 'Brief description of the department')}
              className={inputCls} style={inputStyle} />
          </div>

          {/* 프롬프트 */}
          <div>
            <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
              {tr('부서 프롬프트', 'Department Prompt')}
            </label>
            <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              rows={4} placeholder={tr('이 부서 소속 에이전트의 공통 시스템 프롬프트...', 'Shared system prompt for agents in this department...')}
              className={`${inputCls} resize-none`} style={inputStyle} />
            <p className="text-[10px] mt-1" style={{ color: 'var(--th-text-muted)' }}>
              {tr('소속 에이전트의 작업 실행 시 공통으로 적용되는 시스템 프롬프트', 'Applied as shared system prompt when agents in this department execute tasks')}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-5 pt-4" style={{ borderTop: '1px solid var(--th-card-border)' }}>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white disabled:opacity-40 shadow-sm shadow-blue-600/20">
            {saving ? tr('처리 중...', 'Saving...') : isEdit ? tr('변경사항 저장', 'Save Changes') : tr('부서 추가', 'Add Department')}
          </button>
          {isEdit && (
            confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={handleDelete} disabled={saving}
                  className="px-3 py-2.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 transition-colors">
                  {tr('삭제 확인', 'Confirm')}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-2 py-2.5 rounded-lg text-xs transition-colors" style={{ color: 'var(--th-text-muted)' }}>
                  {tr('취소', 'No')}
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="px-3 py-2.5 rounded-lg text-sm font-medium transition-all hover:bg-red-500/15 hover:text-red-400"
                style={{ border: '1px solid var(--th-input-border)', color: 'var(--th-text-muted)' }}>
                {tr('삭제', 'Delete')}
              </button>
            )
          )}
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:bg-[var(--th-bg-surface-hover)]"
            style={{ border: '1px solid var(--th-input-border)', color: 'var(--th-text-secondary)' }}>
            {tr('취소', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
