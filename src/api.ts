import type {
  Department, Agent, Task, TaskLog, Message,
  CliStatusMap, CompanyStats, CompanySettings,
  TaskStatus, TaskType, CliProvider, AgentRole,
  MessageType, ReceiverType, SubTask, MeetingMinute,
  MeetingPresence,
  CliModelInfo
} from './types';

const base = '';
const SESSION_BOOTSTRAP_PATH = '/api/auth/session';
const API_AUTH_TOKEN_SESSION_KEY = 'claw_api_auth_token';
const POST_RETRY_LIMIT = 2;
const POST_TIMEOUT_MS = 12_000;
const POST_BACKOFF_BASE_MS = 250;
const POST_BACKOFF_MAX_MS = 2_000;
let runtimeApiAuthToken: string | undefined;
let sessionBootstrapPromise: Promise<boolean> | null = null;

function normalizeApiAuthToken(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function readStoredApiAuthToken(): string {
  if (runtimeApiAuthToken !== undefined) return runtimeApiAuthToken;
  if (typeof window === 'undefined') {
    runtimeApiAuthToken = '';
    return runtimeApiAuthToken;
  }
  try {
    runtimeApiAuthToken = normalizeApiAuthToken(window.sessionStorage.getItem(API_AUTH_TOKEN_SESSION_KEY));
  } catch {
    runtimeApiAuthToken = '';
  }
  return runtimeApiAuthToken;
}

function writeStoredApiAuthToken(token: string): void {
  runtimeApiAuthToken = token;
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.sessionStorage.setItem(API_AUTH_TOKEN_SESSION_KEY, token);
    } else {
      window.sessionStorage.removeItem(API_AUTH_TOKEN_SESSION_KEY);
    }
  } catch {
    // ignore storage write errors
  }
}

function promptForApiAuthToken(hasExistingToken: boolean): string {
  if (typeof window === 'undefined') return '';
  const promptText = hasExistingToken
    ? 'Stored API token was rejected. Enter a new API token:'
    : 'Enter API token for this server:';
  return normalizeApiAuthToken(window.prompt(promptText));
}

export function setApiAuthToken(token?: string | null): void {
  writeStoredApiAuthToken(normalizeApiAuthToken(token));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeIdempotencyKey(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name?: string }).name === 'AbortError';
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function backoffDelayMs(attempt: number): number {
  const exponential = Math.min(POST_BACKOFF_BASE_MS * (2 ** attempt), POST_BACKOFF_MAX_MS);
  const jitter = Math.floor(Math.random() * 120);
  return exponential + jitter;
}

async function postWithIdempotency<T>(
  url: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  canRetryAuth = true,
): Promise<T> {
  const payload = { ...body, idempotency_key: idempotencyKey };
  const baseHeaders: HeadersInit = {
    'content-type': 'application/json',
    'x-idempotency-key': idempotencyKey,
  };

  for (let attempt = 0; attempt <= POST_RETRY_LIMIT; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);

    try {
      const headers = withAuthHeaders(baseHeaders);
      const r = await fetch(`${base}${url}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (r.status === 401 && canRetryAuth && url !== SESSION_BOOTSTRAP_PATH) {
        await bootstrapSession();
        return postWithIdempotency<T>(url, body, idempotencyKey, false);
      }
      if (r.ok) {
        return r.json();
      }

      const responseBody = await r.json().catch(() => null);
      const errMsg = responseBody?.error ?? responseBody?.message ?? `Request failed: ${r.status}`;
      if (attempt < POST_RETRY_LIMIT && shouldRetryStatus(r.status)) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw new Error(errMsg);
    } catch (err) {
      const retryableNetworkError = err instanceof TypeError || isAbortError(err);
      if (attempt < POST_RETRY_LIMIT && retryableNetworkError) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('unreachable_retry_loop');
}

function extractMessageId(payload: unknown): string {
  const maybePayload = payload as {
    id?: unknown;
    message?: { id?: unknown };
  } | null;
  if (maybePayload && typeof maybePayload.id === 'string' && maybePayload.id) {
    return maybePayload.id;
  }
  if (maybePayload?.message && typeof maybePayload.message.id === 'string' && maybePayload.message.id) {
    return maybePayload.message.id;
  }
  throw new Error('message_id_missing');
}

function withAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const runtimeToken = readStoredApiAuthToken();
  if (runtimeToken && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${runtimeToken}`);
  }
  return headers;
}

async function doBootstrapSession(promptOnUnauthorized: boolean): Promise<boolean> {
  try {
    const response = await fetch(`${base}${SESSION_BOOTSTRAP_PATH}`, {
      method: 'GET',
      headers: withAuthHeaders(),
      credentials: 'same-origin',
    });
    if (response.ok) return true;
    if (response.status === 401 && promptOnUnauthorized) {
      const nextToken = promptForApiAuthToken(Boolean(readStoredApiAuthToken()));
      if (nextToken) {
        writeStoredApiAuthToken(nextToken);
        return doBootstrapSession(false);
      }
    }
  } catch {
    // ignore bootstrap failures; main request will surface any errors
  }
  return false;
}

export async function bootstrapSession(options?: { promptOnUnauthorized?: boolean }): Promise<boolean> {
  const promptOnUnauthorized = options?.promptOnUnauthorized ?? true;
  if (!sessionBootstrapPromise) {
    sessionBootstrapPromise = doBootstrapSession(promptOnUnauthorized).finally(() => {
      sessionBootstrapPromise = null;
    });
  }
  return sessionBootstrapPromise;
}

async function request<T>(url: string, init?: RequestInit, canRetryAuth = true): Promise<T> {
  const headers = withAuthHeaders(init?.headers);
  const r = await fetch(`${base}${url}`, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  if (r.status === 401 && canRetryAuth && url !== SESSION_BOOTSTRAP_PATH) {
    await bootstrapSession();
    return request<T>(url, init, false);
  }
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error ?? body?.message ?? `Request failed: ${r.status}`);
  }
  return r.json();
}

function post(url: string, body?: unknown) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function patch(url: string, body: unknown) {
  return request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(url: string, body: unknown) {
  return request(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(url: string) {
  return request(url, { method: 'DELETE' });
}

// Departments
export async function getDepartments(): Promise<Department[]> {
  const j = await request<{ departments: Department[] }>('/api/departments');
  return j.departments;
}

export async function getDepartment(id: string): Promise<{ department: Department; agents: Agent[] }> {
  return request(`/api/departments/${id}`);
}

// Agents
export async function getAgents(): Promise<Agent[]> {
  const j = await request<{ agents: Agent[] }>('/api/agents');
  return j.agents;
}

export async function getAgent(id: string): Promise<Agent> {
  const j = await request<{ agent: Agent }>(`/api/agents/${id}`);
  return j.agent;
}

export async function getMeetingPresence(): Promise<MeetingPresence[]> {
  const j = await request<{ presence: MeetingPresence[] }>('/api/meeting-presence');
  return j.presence;
}

export async function updateAgent(
  id: string,
  data: Partial<Pick<Agent, 'status' | 'current_task_id' | 'department_id' | 'role' | 'cli_provider' | 'oauth_account_id' | 'personality'>>,
): Promise<void> {
  await patch(`/api/agents/${id}`, data);
}

// Tasks
export async function getTasks(filters?: { status?: TaskStatus; department_id?: string; agent_id?: string }): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.department_id) params.set('department_id', filters.department_id);
  if (filters?.agent_id) params.set('agent_id', filters.agent_id);
  const q = params.toString();
  const j = await request<{ tasks: Task[] }>(`/api/tasks${q ? '?' + q : ''}`);
  return j.tasks;
}

export async function getTask(id: string): Promise<{ task: Task; logs: TaskLog[]; subtasks: SubTask[] }> {
  return request(`/api/tasks/${id}`);
}

export async function createTask(input: {
  title: string;
  description?: string;
  department_id?: string;
  task_type?: TaskType;
  priority?: number;
  project_path?: string;
}): Promise<string> {
  const j = await post('/api/tasks', input) as { id: string };
  return j.id;
}

export async function updateTask(id: string, data: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'task_type' | 'department_id' | 'project_path'>>): Promise<void> {
  await patch(`/api/tasks/${id}`, data);
}

export async function deleteTask(id: string): Promise<void> {
  await del(`/api/tasks/${id}`);
}

export async function assignTask(id: string, agentId: string): Promise<void> {
  await post(`/api/tasks/${id}/assign`, { agent_id: agentId });
}

export async function runTask(id: string): Promise<void> {
  await post(`/api/tasks/${id}/run`);
}

export async function stopTask(id: string): Promise<void> {
  await post(`/api/tasks/${id}/stop`, { mode: 'cancel' });
}

export async function pauseTask(id: string): Promise<void> {
  await post(`/api/tasks/${id}/stop`, { mode: 'pause' });
}

export async function resumeTask(id: string): Promise<void> {
  await post(`/api/tasks/${id}/resume`);
}

// Messages
export async function getMessages(params: { receiver_type?: ReceiverType; receiver_id?: string; limit?: number }): Promise<Message[]> {
  const sp = new URLSearchParams();
  if (params.receiver_type) sp.set('receiver_type', params.receiver_type);
  if (params.receiver_id) sp.set('receiver_id', params.receiver_id);
  if (params.limit) sp.set('limit', String(params.limit));
  const q = sp.toString();
  const j = await request<{ messages: Message[] }>(`/api/messages${q ? '?' + q : ''}`);
  return j.messages;
}

export async function sendMessage(input: {
  receiver_type: ReceiverType;
  receiver_id?: string;
  content: string;
  message_type?: MessageType;
  task_id?: string;
}): Promise<string> {
  const idempotencyKey = makeIdempotencyKey('ceo-message');
  const j = await postWithIdempotency<{ id?: string; message?: { id?: string } }>(
    '/api/messages',
    { sender_type: 'ceo', ...input },
    idempotencyKey,
  );
  return extractMessageId(j);
}

export async function sendAnnouncement(content: string): Promise<string> {
  const idempotencyKey = makeIdempotencyKey('ceo-announcement');
  const j = await postWithIdempotency<{ id?: string; message?: { id?: string } }>(
    '/api/announcements',
    { content },
    idempotencyKey,
  );
  return extractMessageId(j);
}

export async function sendDirective(content: string): Promise<string> {
  const idempotencyKey = makeIdempotencyKey('ceo-directive');
  const j = await postWithIdempotency<{ id?: string; message?: { id?: string } }>(
    '/api/directives',
    { content },
    idempotencyKey,
  );
  return extractMessageId(j);
}

export async function clearMessages(agentId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (agentId) {
    params.set('agent_id', agentId);
  } else {
    params.set('scope', 'announcements');
  }
  await del(`/api/messages?${params.toString()}`);
}

// Terminal
export async function getTerminal(id: string, lines?: number, pretty?: boolean): Promise<{
  ok: boolean;
  exists: boolean;
  path: string;
  text: string;
  task_logs?: Array<{ id: number; kind: string; message: string; created_at: number }>;
}> {
  const params = new URLSearchParams();
  if (lines) params.set('lines', String(lines));
  if (pretty) params.set('pretty', '1');
  const q = params.toString();
  return request(`/api/tasks/${id}/terminal${q ? '?' + q : ''}`);
}

export async function getTaskMeetingMinutes(id: string): Promise<MeetingMinute[]> {
  const j = await request<{ meetings: MeetingMinute[] }>(`/api/tasks/${id}/meeting-minutes`);
  return j.meetings;
}

// CLI Status
export async function getCliStatus(refresh?: boolean): Promise<CliStatusMap> {
  const q = refresh ? '?refresh=1' : '';
  const j = await request<{ providers: CliStatusMap }>(`/api/cli-status${q}`);
  return j.providers;
}

// Stats
export async function getStats(): Promise<CompanyStats> {
  const j = await request<{ stats: CompanyStats }>('/api/stats');
  return j.stats;
}

// Settings
export async function getSettings(): Promise<CompanySettings> {
  const j = await request<{ settings: CompanySettings }>('/api/settings');
  return j.settings;
}

export async function saveSettings(settings: CompanySettings): Promise<void> {
  await put('/api/settings', settings);
}

// OAuth
export interface OAuthAccountInfo {
  id: string;
  label: string | null;
  email: string | null;
  source: string | null;
  scope: string | null;
  status: "active" | "disabled";
  priority: number;
  expires_at: number | null;
  hasRefreshToken: boolean;
  executionReady: boolean;
  active: boolean;
  modelOverride?: string | null;
  failureCount?: number;
  lastError?: string | null;
  lastErrorAt?: number | null;
  lastSuccessAt?: number | null;
  created_at: number;
  updated_at: number;
}

export interface OAuthProviderStatus {
  connected: boolean;
  detected?: boolean;
  executionReady?: boolean;
  requiresWebOAuth?: boolean;
  source: string | null;
  email: string | null;
  scope: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  webConnectable: boolean;
  hasRefreshToken?: boolean;
  refreshFailed?: boolean;
  lastRefreshed?: number | null;
  activeAccountId?: string | null;
  activeAccountIds?: string[];
  accounts?: OAuthAccountInfo[];
}

export type OAuthConnectProvider = "github-copilot" | "antigravity";

export interface OAuthStatus {
  storageReady: boolean;
  providers: Record<string, OAuthProviderStatus>;
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  return request<OAuthStatus>('/api/oauth/status');
}

export function getOAuthStartUrl(provider: OAuthConnectProvider, redirectTo: string): string {
  const params = new URLSearchParams({ provider, redirect_to: redirectTo });
  return `/api/oauth/start?${params.toString()}`;
}

export async function disconnectOAuth(provider: OAuthConnectProvider): Promise<void> {
  await post('/api/oauth/disconnect', { provider });
}

export interface OAuthRefreshResult {
  ok: boolean;
  expires_at: number | null;
  refreshed_at: number;
}

export async function refreshOAuthToken(provider: OAuthConnectProvider): Promise<OAuthRefreshResult> {
  return post('/api/oauth/refresh', { provider }) as Promise<OAuthRefreshResult>;
}

export async function activateOAuthAccount(
  provider: OAuthConnectProvider,
  accountId: string,
  mode: "exclusive" | "add" | "remove" | "toggle" = "exclusive",
): Promise<{ ok: boolean; activeAccountIds?: string[] }> {
  return post('/api/oauth/accounts/activate', { provider, account_id: accountId, mode }) as Promise<{ ok: boolean; activeAccountIds?: string[] }>;
}

export async function updateOAuthAccount(
  accountId: string,
  patch: { label?: string | null; model_override?: string | null; priority?: number; status?: "active" | "disabled" },
): Promise<{ ok: boolean }> {
  return put(`/api/oauth/accounts/${accountId}`, patch) as Promise<{ ok: boolean }>;
}

export async function deleteOAuthAccount(
  provider: OAuthConnectProvider,
  accountId: string,
): Promise<{ ok: boolean }> {
  return post('/api/oauth/disconnect', { provider, account_id: accountId }) as Promise<{ ok: boolean }>;
}

// GitHub Device Code Flow
export interface DeviceCodeStart {
  stateId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePollResult {
  status: "pending" | "complete" | "slow_down" | "expired" | "denied" | "error";
  email?: string | null;
  error?: string;
}

export async function startGitHubDeviceFlow(): Promise<DeviceCodeStart> {
  return post('/api/oauth/github-copilot/device-start') as Promise<DeviceCodeStart>;
}

export async function pollGitHubDevice(stateId: string): Promise<DevicePollResult> {
  return post('/api/oauth/github-copilot/device-poll', { stateId }) as Promise<DevicePollResult>;
}

// OAuth Models
export async function getOAuthModels(): Promise<Record<string, string[]>> {
  const j = await request<{ models: Record<string, string[]> }>('/api/oauth/models');
  return j.models;
}

// CLI Models (for CLI provider model selection)
export async function getCliModels(): Promise<Record<string, CliModelInfo[]>> {
  const j = await request<{ models: Record<string, CliModelInfo[]> }>('/api/cli-models');
  return j.models;
}

// Git Worktree management
export interface TaskDiffResult {
  ok: boolean;
  hasWorktree?: boolean;
  branchName?: string;
  stat?: string;
  diff?: string;
  error?: string;
}

export interface MergeResult {
  ok: boolean;
  message: string;
  conflicts?: string[];
}

export interface WorktreeEntry {
  taskId: string;
  branchName: string;
  worktreePath: string;
  projectPath: string;
}

export async function getTaskDiff(id: string): Promise<TaskDiffResult> {
  return request<TaskDiffResult>(`/api/tasks/${id}/diff`);
}

export async function mergeTask(id: string): Promise<MergeResult> {
  return post(`/api/tasks/${id}/merge`) as Promise<MergeResult>;
}

export async function discardTask(id: string): Promise<{ ok: boolean; message: string }> {
  return post(`/api/tasks/${id}/discard`) as Promise<{ ok: boolean; message: string }>;
}

export async function getWorktrees(): Promise<{ ok: boolean; worktrees: WorktreeEntry[] }> {
  return request<{ ok: boolean; worktrees: WorktreeEntry[] }>('/api/worktrees');
}

// CLI Usage
export interface CliUsageWindow {
  label: string;           // "5-hour", "7-day", "Primary", "2.5 Pro", etc.
  utilization: number;     // 0.0 – 1.0
  resetsAt: string | null; // ISO 8601
}

export interface CliUsageEntry {
  windows: CliUsageWindow[];
  error: string | null;    // "unauthenticated" | "unavailable" | "not_implemented" | null
}

export async function getCliUsage(): Promise<{ ok: boolean; usage: Record<string, CliUsageEntry> }> {
  return request<{ ok: boolean; usage: Record<string, CliUsageEntry> }>('/api/cli-usage');
}

export async function refreshCliUsage(): Promise<{ ok: boolean; usage: Record<string, CliUsageEntry> }> {
  return post('/api/cli-usage/refresh') as Promise<{ ok: boolean; usage: Record<string, CliUsageEntry> }>;
}

// Skills
export interface SkillEntry {
  rank: number;
  name: string;
  repo: string;
  installs: number;
}

export async function getSkills(): Promise<SkillEntry[]> {
  const j = await request<{ skills: SkillEntry[] }>('/api/skills');
  return j.skills;
}

// Gateway Channel Messaging
export type GatewayTarget = {
  sessionKey: string;
  displayName: string;
  channel: string;
  to: string;
};

export async function getGatewayTargets(): Promise<GatewayTarget[]> {
  try {
    const data = await request<{ targets?: GatewayTarget[] }>('/api/gateway/targets');
    return data?.targets ?? [];
  } catch {
    return [];
  }
}

export async function sendGatewayMessage(sessionKey: string, text: string): Promise<{ ok: boolean; error?: string }> {
  return post('/api/gateway/send', { sessionKey, text }) as Promise<{ ok: boolean; error?: string }>;
}

// SubTasks
export async function getActiveSubtasks(): Promise<SubTask[]> {
  const j = await request<{ subtasks: SubTask[] }>('/api/subtasks?active=1');
  return j.subtasks;
}

export async function createSubtask(taskId: string, input: {
  title: string;
  description?: string;
  assigned_agent_id?: string;
}): Promise<SubTask> {
  return post(`/api/tasks/${taskId}/subtasks`, input) as Promise<SubTask>;
}

export async function updateSubtask(id: string, data: Partial<Pick<SubTask, 'title' | 'description' | 'status' | 'assigned_agent_id' | 'blocked_reason'>>): Promise<SubTask> {
  return patch(`/api/subtasks/${id}`, data) as Promise<SubTask>;
}
