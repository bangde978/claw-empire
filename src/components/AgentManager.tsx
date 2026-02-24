import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent, Department, AgentRole, CliProvider } from '../types';
import { useI18n } from '../i18n';
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

interface FormData {
  name: string;
  name_ko: string;
  department_id: string;
  role: AgentRole;
  cli_provider: CliProvider;
  avatar_emoji: string;
  sprite_number: number | null;
  personality: string;
}

const BLANK: FormData = {
  name: '', name_ko: '', department_id: '', role: 'junior',
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
      return a.name.toLowerCase().includes(q) || a.name_ko.toLowerCase().includes(q);
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
    setForm({
      name: agent.name, name_ko: agent.name_ko,
      department_id: agent.department_id || '',
      role: agent.role, cli_provider: agent.cli_provider,
      avatar_emoji: agent.avatar_emoji, sprite_number: agent.sprite_number ?? null,
      personality: agent.personality || '',
    });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setModalAgent(null); };

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !form.name_ko.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), name_ko: form.name_ko.trim(),
        department_id: form.department_id || null,
        role: form.role, cli_provider: form.cli_provider,
        avatar_emoji: form.avatar_emoji || '🤖',
        sprite_number: form.sprite_number,
        personality: form.personality.trim() || null,
      };
      if (modalAgent) {
        await api.updateAgent(modalAgent.id, payload);
      } else {
        await api.createAgent(payload);
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

  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--th-text-heading)' }}>
          👥 {tr('직원 관리', 'Agent Manager')}
        </h2>
        <button
          onClick={openCreate}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm shadow-blue-600/20"
        >
          + {tr('신규 채용', 'Hire Agent')}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: tr('전체 인원', 'Total'), value: agents.length, icon: '👥', accent: 'blue' },
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
              className={`flex items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
                deptTab === d.id ? 'text-blue-400 border-b-2 border-blue-400' : 'hover:text-slate-200'
              }`}
              style={deptTab !== d.id ? { color: 'var(--th-text-muted)' } : undefined}
            >
              <span>{d.icon}</span>
              <span className="hidden sm:inline">{isKo ? d.name_ko || d.name : d.name}</span>
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

      {/* Modal */}
      {showModal && (
        <AgentFormModal
          isKo={isKo}
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
    </div>
  );
}

/* ═══════════════════════════════════════ Agent Card ═══════════════════════════════════════ */

function AgentCard({ agent, spriteMap, isKo, tr, departments, onEdit, confirmDeleteId, onDeleteClick, onDeleteConfirm, onDeleteCancel, saving }: {
  agent: Agent;
  spriteMap: Map<string, number>;
  isKo: boolean;
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
              {isKo ? agent.name_ko : agent.name}
            </span>
            <span className="text-[10px] shrink-0" style={{ color: 'var(--th-text-muted)' }}>
              {isKo ? agent.name : agent.name_ko}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${ROLE_BADGE[agent.role] || ''}`}>
              {isKo ? ROLE_LABEL[agent.role]?.ko : ROLE_LABEL[agent.role]?.en}
            </span>
            {dept && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--th-bg-surface)', color: 'var(--th-text-muted)' }}>
                {dept.icon} {isKo ? dept.name_ko || dept.name : dept.name}
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

function AgentFormModal({ isKo, tr, form, setForm, departments, isEdit, saving, onSave, onClose }: {
  isKo: boolean;
  tr: (ko: string, en: string) => string;
  form: FormData;
  setForm: (f: FormData) => void;
  departments: Department[];
  isEdit: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
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
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('영문 이름', 'Name')} <span className="text-red-400">*</span>
              </label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="DORO" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                {tr('한글 이름', 'Korean Name')} <span className="text-red-400">*</span>
              </label>
              <input type="text" value={form.name_ko} onChange={(e) => setForm({ ...form, name_ko: e.target.value })}
                placeholder="도로롱" className={inputCls} style={inputStyle} />
            </div>
            <div className="grid grid-cols-[72px_1fr] gap-2">
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {tr('이모지', 'Emoji')}
                </label>
                <input type="text" value={form.avatar_emoji} onChange={(e) => setForm({ ...form, avatar_emoji: e.target.value })}
                  className={`${inputCls} text-center text-lg`} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--th-text-secondary)' }}>
                  {tr('소속 부서', 'Department')}
                </label>
                <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                  className={`${inputCls} cursor-pointer`} style={inputStyle}>
                  <option value="">{tr('— 미배정 —', '— Unassigned —')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.icon} {isKo ? d.name_ko || d.name : d.name}</option>
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
          <button onClick={onSave} disabled={saving || !form.name.trim() || !form.name_ko.trim()}
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
