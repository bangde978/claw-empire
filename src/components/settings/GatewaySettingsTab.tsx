import { useEffect, useMemo, useState } from "react";
import * as api from "../../api";
import AgentAvatar, { useSpriteMap } from "../AgentAvatar";
import AgentSelect from "../AgentSelect";
import {
  MESSENGER_CHANNELS,
  WORKFLOW_PACK_KEYS,
  type Agent,
  type MessengerChannelConfig,
  type MessengerChannelType,
  type MessengerChannelsConfig,
  type MessengerSessionConfig,
  type WorkflowPackKey,
} from "../../types";
import type { ChannelSettingsTabProps } from "./types";

const CHANNEL_META: Record<
  MessengerChannelType,
  {
    label: string;
    targetHint: string;
    transportReady: boolean;
  }
> = {
  telegram: { label: "Telegram", targetHint: "chat_id", transportReady: true },
  whatsapp: {
    label: "WhatsApp",
    targetHint: "phone_number_id:recipient (예: 1234567890:+8210...)",
    transportReady: true,
  },
  discord: { label: "Discord", targetHint: "channel_id", transportReady: true },
  googlechat: {
    label: "Google Chat",
    targetHint: "spaces/AAA... (token은 webhook URL 또는 key|token)",
    transportReady: true,
  },
  slack: { label: "Slack", targetHint: "channel_id", transportReady: true },
  signal: { label: "Signal", targetHint: "+8210..., group:<id>, username:<id>", transportReady: true },
  imessage: { label: "iMessage", targetHint: "전화번호/이메일 (macOS Messages)", transportReady: true },
};

const WORKFLOW_PACK_KEY_SET = new Set<string>(WORKFLOW_PACK_KEYS as readonly string[]);

function isWorkflowPackKey(value: unknown): value is WorkflowPackKey {
  return typeof value === "string" && WORKFLOW_PACK_KEY_SET.has(value);
}

function createSessionId(channel: MessengerChannelType): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${channel}-${crypto.randomUUID()}`;
  }
  return `${channel}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyChannelConfig(channel: MessengerChannelType): MessengerChannelConfig {
  return {
    token: "",
    sessions: [],
    receiveEnabled: channel === "telegram",
  };
}

function defaultChannelsConfig(): MessengerChannelsConfig {
  return MESSENGER_CHANNELS.reduce((acc, channel) => {
    acc[channel] = emptyChannelConfig(channel);
    return acc;
  }, {} as MessengerChannelsConfig);
}

function normalizeSession(
  session: MessengerSessionConfig,
  channel: MessengerChannelType,
  index: number,
): MessengerSessionConfig {
  const id = (session.id || "").trim() || `${channel}-${index + 1}`;
  const agentId = session.agentId?.trim() || "";
  const token = session.token?.trim() || "";
  const workflowPackKey = isWorkflowPackKey(session.workflowPackKey) ? session.workflowPackKey : "development";
  return {
    id,
    name: session.name?.trim() || `${CHANNEL_META[channel].label} Session ${index + 1}`,
    targetId: session.targetId?.trim() || "",
    enabled: session.enabled !== false,
    token: token || undefined,
    agentId: agentId || undefined,
    workflowPackKey,
  };
}

function normalizeChannelsConfig(config: MessengerChannelsConfig): MessengerChannelsConfig {
  return MESSENGER_CHANNELS.reduce((acc, channel) => {
    const channelConfig = config[channel] ?? emptyChannelConfig(channel);
    acc[channel] = {
      token: channelConfig.token?.trim?.() ?? "",
      receiveEnabled:
        channel === "telegram" ? channelConfig.receiveEnabled !== false : channelConfig.receiveEnabled === true,
      sessions: (channelConfig.sessions ?? []).map((session, idx) => normalizeSession(session, channel, idx)),
    };
    return acc;
  }, {} as MessengerChannelsConfig);
}

function resolveChannelsConfig(raw: ChannelSettingsTabProps["form"]["messengerChannels"]): MessengerChannelsConfig {
  const defaults = defaultChannelsConfig();
  return MESSENGER_CHANNELS.reduce((acc, channel) => {
    acc[channel] = {
      ...defaults[channel],
      ...(raw?.[channel] ?? {}),
      sessions: raw?.[channel]?.sessions ?? defaults[channel].sessions,
    };
    return acc;
  }, {} as MessengerChannelsConfig);
}

type ChatRow = {
  key: string;
  channel: MessengerChannelType;
  token: string;
  receiveEnabled: boolean;
  session: MessengerSessionConfig;
};

type ChatEditorRef = { channel: MessengerChannelType; sessionId: string } | null;

type ChatEditorState = {
  open: boolean;
  mode: "create" | "edit";
  ref: ChatEditorRef;
  channel: MessengerChannelType;
  token: string;
  name: string;
  targetId: string;
  enabled: boolean;
  agentId: string;
  workflowPackKey: WorkflowPackKey;
  receiveEnabled: boolean;
};

function createEditorState(channelsConfig: MessengerChannelsConfig): ChatEditorState {
  return {
    open: false,
    mode: "create",
    ref: null,
    channel: "telegram",
    token: channelsConfig.telegram.token ?? "",
    name: "",
    targetId: "",
    enabled: true,
    agentId: "",
    workflowPackKey: "development",
    receiveEnabled: channelsConfig.telegram.receiveEnabled !== false,
  };
}

function channelTargetHint(channel: MessengerChannelType): string {
  return CHANNEL_META[channel].targetHint;
}

function defaultWorkflowPackLabel(t: ChannelSettingsTabProps["t"], key: WorkflowPackKey): string {
  switch (key) {
    case "development":
      return t({ ko: "개발", en: "Development", ja: "開発", zh: "开发" });
    case "novel":
      return t({ ko: "소설", en: "Novel", ja: "小説", zh: "小说" });
    case "report":
      return t({ ko: "보고서", en: "Report", ja: "レポート", zh: "报告" });
    case "video_preprod":
      return t({ ko: "영상기획", en: "Video Preprod", ja: "映像企画", zh: "视频策划" });
    case "web_research_report":
      return t({ ko: "웹서치+리포트", en: "Web Research", ja: "Web調査", zh: "网页调研" });
    case "roleplay":
      return t({ ko: "롤플레이", en: "Roleplay", ja: "ロールプレイ", zh: "角色扮演" });
    default:
      return key;
  }
}

export default function GatewaySettingsTab({ t, form, setForm, persistSettings }: ChannelSettingsTabProps) {
  const channelsConfig = resolveChannelsConfig(form.messengerChannels);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; msg: string } | null>(null);

  const [sending, setSending] = useState(false);
  const [sendText, setSendText] = useState("");
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeSessions, setRuntimeSessions] = useState<Awaited<ReturnType<typeof api.getMessengerRuntimeSessions>>>(
    [],
  );
  const [receiverLoading, setReceiverLoading] = useState(false);
  const [telegramReceiverStatus, setTelegramReceiverStatus] = useState<Awaited<
    ReturnType<typeof api.getTelegramReceiverStatus>
  > | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflowPacksLoading, setWorkflowPacksLoading] = useState(false);
  const [workflowPacks, setWorkflowPacks] = useState<Awaited<ReturnType<typeof api.getWorkflowPacks>>["packs"]>([]);
  const spriteMap = useSpriteMap(agents);

  const [editor, setEditor] = useState<ChatEditorState>(() => createEditorState(channelsConfig));
  const [editorError, setEditorError] = useState<string | null>(null);

  const chatRows = useMemo<ChatRow[]>(() => {
    return MESSENGER_CHANNELS.flatMap((channel) => {
      const channelConfig = channelsConfig[channel];
      return (channelConfig.sessions ?? [])
        .map((session) => ({
          key: `${channel}:${session.id}`,
          channel,
          token: (session.token ?? "").trim() || (channelConfig.token ?? ""),
          receiveEnabled: channelConfig.receiveEnabled !== false,
          session,
        }))
        .filter((entry) => entry.session.targetId.trim().length > 0);
    });
  }, [channelsConfig]);

  const [selectedChatKey, setSelectedChatKey] = useState<string>("");

  useEffect(() => {
    if (chatRows.length === 0) {
      setSelectedChatKey("");
      return;
    }
    const exists = chatRows.some((row) => row.key === selectedChatKey);
    if (!exists) {
      setSelectedChatKey(chatRows[0].key);
    }
  }, [chatRows, selectedChatKey]);

  const selectedChat = chatRows.find((row) => row.key === selectedChatKey) ?? null;

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  const workflowPackOptions = useMemo(() => {
    const map = new Map<WorkflowPackKey, { key: WorkflowPackKey; name: string; enabled: boolean }>();
    for (const key of WORKFLOW_PACK_KEYS) {
      map.set(key, { key, name: defaultWorkflowPackLabel(t, key), enabled: true });
    }
    for (const pack of workflowPacks) {
      if (!isWorkflowPackKey(pack.key)) continue;
      const existing = map.get(pack.key);
      map.set(pack.key, {
        key: pack.key,
        name: typeof pack.name === "string" && pack.name.trim() ? pack.name.trim() : existing?.name ?? pack.key,
        enabled: pack.enabled !== false,
      });
    }
    return Array.from(map.values());
  }, [workflowPacks, t]);

  const workflowPackNameByKey = useMemo(() => {
    const map = new Map<WorkflowPackKey, string>();
    for (const option of workflowPackOptions) {
      map.set(option.key, option.name);
    }
    return map;
  }, [workflowPackOptions]);

  const persistChannelsForm = (nextChannels: MessengerChannelsConfig, successMsg?: string) => {
    const normalized = normalizeChannelsConfig(nextChannels);
    const nextForm = { ...form, messengerChannels: normalized };
    setForm(nextForm);
    setSaving(true);
    setSaved(null);
    try {
      persistSettings(nextForm);
      setSaved({
        ok: true,
        msg:
          successMsg ??
          t({
            ko: "채널 설정 저장 완료",
            en: "Channel settings saved",
            ja: "チャネル設定を保存しました",
            zh: "频道设置已保存",
          }),
      });
      setTimeout(() => setSaved(null), 2500);
      return true;
    } catch (error) {
      setSaved({ ok: false, msg: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const removeChat = (row: ChatRow) => {
    const next = resolveChannelsConfig(form.messengerChannels);
    next[row.channel] = {
      ...next[row.channel],
      sessions: next[row.channel].sessions.filter((session) => session.id !== row.session.id),
    };
    persistChannelsForm(
      next,
      t({
        ko: "채팅 삭제 완료",
        en: "Chat deleted",
        ja: "チャットを削除しました",
        zh: "聊天已删除",
      }),
    );
    setSendStatus(null);
  };

  const openCreateModal = () => {
    setEditor({
      ...createEditorState(channelsConfig),
      open: true,
      mode: "create",
    });
    setEditorError(null);
  };

  const openEditModal = (row: ChatRow) => {
    setEditor({
      open: true,
      mode: "edit",
      ref: { channel: row.channel, sessionId: row.session.id },
      channel: row.channel,
      token: row.session.token?.trim() || (channelsConfig[row.channel].token ?? ""),
      name: row.session.name ?? "",
      targetId: row.session.targetId ?? "",
      enabled: row.session.enabled !== false,
      agentId: row.session.agentId ?? "",
      workflowPackKey: isWorkflowPackKey(row.session.workflowPackKey) ? row.session.workflowPackKey : "development",
      receiveEnabled: channelsConfig[row.channel].receiveEnabled !== false,
    });
    setEditorError(null);
  };

  const closeEditorModal = () => {
    setEditor((prev) => ({ ...prev, open: false, ref: null }));
    setEditorError(null);
  };

  const handleSaveEditor = () => {
    const token = editor.token.trim();
    const name = editor.name.trim();
    const targetId = editor.targetId.trim();
    const agentId = editor.agentId.trim();

    if (!token) {
      setEditorError(
        t({
          ko: "토큰을 입력해주세요.",
          en: "Please enter a token.",
          ja: "トークンを入力してください。",
          zh: "请输入令牌。",
        }),
      );
      return;
    }
    if (!name) {
      setEditorError(
        t({
          ko: "채팅 이름을 입력해주세요.",
          en: "Please enter a chat name.",
          ja: "チャット名を入力してください。",
          zh: "请输入聊天名称。",
        }),
      );
      return;
    }
    if (!targetId) {
      setEditorError(
        t({
          ko: "채널/대상 ID를 입력해주세요.",
          en: "Please enter a channel/target ID.",
          ja: "チャンネル/対象 ID を入力してください。",
          zh: "请输入频道/目标 ID。",
        }),
      );
      return;
    }

    const next = resolveChannelsConfig(form.messengerChannels);

    next[editor.channel] = {
      ...next[editor.channel],
      receiveEnabled: editor.channel === "telegram" ? editor.receiveEnabled : next[editor.channel].receiveEnabled,
    };

    const nextSession: MessengerSessionConfig = {
      id: editor.ref?.sessionId || createSessionId(editor.channel),
      name,
      targetId,
      enabled: editor.enabled,
      token,
      agentId: agentId || undefined,
      workflowPackKey: editor.workflowPackKey,
    };

    let insertIndex: number | null = null;
    if (editor.ref) {
      const sourceChannel = editor.ref.channel;
      const sourceSessions = [...next[sourceChannel].sessions];
      const sourceIndex = sourceSessions.findIndex((session) => session.id === editor.ref?.sessionId);
      if (sourceIndex >= 0) {
        sourceSessions.splice(sourceIndex, 1);
        next[sourceChannel] = { ...next[sourceChannel], sessions: sourceSessions };
        if (sourceChannel === editor.channel) {
          insertIndex = sourceIndex;
        }
      }
    }

    const targetSessions = [...next[editor.channel].sessions];
    if (insertIndex !== null && insertIndex >= 0 && insertIndex <= targetSessions.length) {
      targetSessions.splice(insertIndex, 0, nextSession);
    } else {
      targetSessions.push(nextSession);
    }

    next[editor.channel] = {
      ...next[editor.channel],
      sessions: targetSessions,
    };

    const savedOk = persistChannelsForm(
      next,
      t({
        ko: "채팅 설정 저장 완료",
        en: "Chat saved",
        ja: "チャット設定を保存しました",
        zh: "聊天设置已保存",
      }),
    );
    if (!savedOk) {
      setEditorError(
        t({
          ko: "채팅 저장에 실패했습니다. 다시 시도해주세요.",
          en: "Failed to save chat. Please try again.",
          ja: "チャット保存に失敗しました。再試行してください。",
          zh: "聊天保存失败，请重试。",
        }),
      );
      return;
    }
    setSelectedChatKey(`${editor.channel}:${nextSession.id}`);
    closeEditorModal();
  };

  const handleSendMessage = async () => {
    if (!selectedChat || !sendText.trim()) {
      return;
    }

    setSending(true);
    setSendStatus(null);
    try {
      const result = await api.sendMessengerRuntimeMessage({
        sessionKey: selectedChat.key,
        text: sendText.trim(),
      });
      if (!result.ok) {
        setSendStatus({ ok: false, msg: result.error || "send_failed" });
        return;
      }
      setSendStatus({
        ok: true,
        msg: t({
          ko: "메시지 전송 완료",
          en: "Message sent",
          ja: "メッセージを送信しました",
          zh: "消息已发送",
        }),
      });
      setSendText("");
    } catch (error) {
      setSendStatus({ ok: false, msg: error instanceof Error ? error.message : String(error) });
    } finally {
      setSending(false);
    }
  };

  const loadRuntimeSessions = async () => {
    setRuntimeLoading(true);
    try {
      const sessions = await api.getMessengerRuntimeSessions();
      setRuntimeSessions(sessions);
    } catch {
      setRuntimeSessions([]);
    } finally {
      setRuntimeLoading(false);
    }
  };

  const loadAgents = async () => {
    setAgentsLoading(true);
    try {
      const rows = await api.getAgents();
      setAgents(rows);
    } catch {
      setAgents([]);
    } finally {
      setAgentsLoading(false);
    }
  };

  const loadWorkflowPacks = async () => {
    setWorkflowPacksLoading(true);
    try {
      const result = await api.getWorkflowPacks();
      setWorkflowPacks(result.packs ?? []);
    } catch {
      setWorkflowPacks([]);
    } finally {
      setWorkflowPacksLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
    void loadWorkflowPacks();
  }, []);

  const loadTelegramReceiverStatus = async () => {
    setReceiverLoading(true);
    try {
      const status = await api.getTelegramReceiverStatus();
      setTelegramReceiverStatus(status);
    } catch {
      setTelegramReceiverStatus(null);
    } finally {
      setReceiverLoading(false);
    }
  };

  const selectedChatTransportReady = selectedChat ? CHANNEL_META[selectedChat.channel].transportReady : false;

  return (
    <section className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {t({ ko: "채널 메시지 설정", en: "Channel Messaging", ja: "チャネルメッセージ設定", zh: "频道消息设置" })}
        </h3>
        {saved && <span className={`text-xs ${saved.ok ? "text-emerald-400" : "text-red-400"}`}>{saved.msg}</span>}
      </div>

      <p className="text-xs text-slate-400">
        {t({
          ko: "이 탭에서 메신저 채널을 직접 설정할 수 있습니다. '새 채팅 추가'로 메신저/토큰/대상 ID/대화 Agent를 등록하세요.",
          en: "You can configure messenger channels directly in this tab. Use 'Add Chat' to register messenger/token/target ID/conversation agent.",
          ja: "このタブでメッセンジャーチャネルを直接設定できます。'チャット追加'からメッセンジャー/トークン/対象ID/担当Agentを登録してください。",
          zh: "可在此标签页直接配置消息渠道。通过“新增聊天”注册消息渠道/令牌/目标ID/对话 Agent。",
        })}
      </p>

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-200">
            {t({ ko: "채팅 세션", en: "Chat Sessions", ja: "チャットセッション", zh: "聊天会话" })}
          </div>
          <button
            onClick={openCreateModal}
            className="text-xs px-3 py-1 rounded-md bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/40"
          >
            + {t({ ko: "새 채팅 추가", en: "Add Chat", ja: "チャット追加", zh: "新增聊天" })}
          </button>
        </div>

        {chatRows.length === 0 ? (
          <div className="text-xs text-slate-500 py-2">
            {t({
              ko: "등록된 채팅이 없습니다. '새 채팅 추가'로 메신저/토큰/채널을 등록하세요.",
              en: "No chats yet. Use 'Add Chat' to register messenger/token/channel.",
              ja: "チャットがありません。'チャット追加'でメッセンジャー/トークン/チャネルを登録してください。",
              zh: "暂无聊天。请通过“新增聊天”注册消息渠道/令牌/频道。",
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {chatRows.map((row) => {
              const meta = CHANNEL_META[row.channel];
              const assignedAgent = row.session.agentId ? agentById.get(row.session.agentId) : undefined;
              const assignedAgentName = assignedAgent
                ? assignedAgent.name_ko || assignedAgent.name
                : row.session.agentId || "";
              const workflowPackKey = isWorkflowPackKey(row.session.workflowPackKey)
                ? row.session.workflowPackKey
                : "development";
              const workflowPackLabel =
                workflowPackNameByKey.get(workflowPackKey) ?? defaultWorkflowPackLabel(t, workflowPackKey);
              const tokenReady = row.token.trim().length > 0;
              return (
                <div key={row.key} className="rounded-md border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-100">{row.session.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 uppercase">
                          {meta.label}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${meta.transportReady ? "bg-emerald-600/20 text-emerald-300" : "bg-amber-600/20 text-amber-300"}`}
                        >
                          {meta.transportReady
                            ? t({ ko: "직접연동", en: "Native", ja: "直接連携", zh: "直连" })
                            : t({ ko: "호환설정", en: "Compat", ja: "互換設定", zh: "兼容配置" })}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-300">
                          {workflowPackLabel}
                        </span>
                        {!tokenReady && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/20 text-red-300">
                            {t({ ko: "토큰 없음", en: "No token", ja: "トークンなし", zh: "无令牌" })}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400 font-mono break-all">{row.session.targetId}</div>
                      <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1.5">
                        {assignedAgentName ? (
                          <>
                            <span>{t({ ko: "대화 Agent", en: "Agent", ja: "担当Agent", zh: "对话 Agent" })}:</span>
                            {assignedAgent && (
                              <AgentAvatar agent={assignedAgent} spriteMap={spriteMap} size={14} rounded="xl" />
                            )}
                            <span className="truncate">{assignedAgentName}</span>
                          </>
                        ) : (
                          <span>
                            {t({
                              ko: "대화 Agent 미지정",
                              en: "No agent assigned",
                              ja: "Agent未指定",
                              zh: "未指定 Agent",
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEditModal(row)}
                        className="px-2 py-1 rounded text-[11px] bg-slate-700/70 border border-slate-600 text-slate-200 hover:bg-slate-700"
                      >
                        {t({ ko: "편집", en: "Edit", ja: "編集", zh: "编辑" })}
                      </button>
                      <button
                        onClick={() => removeChat(row)}
                        className="px-2 py-1 rounded text-[11px] bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30"
                      >
                        {t({ ko: "삭제", en: "Delete", ja: "削除", zh: "删除" })}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[11px] text-slate-500">
          {t({
            ko: "$로 시작하면 전사공지, 일반 메시지는 선택된 Agent에게 1:1 대화로 전달됩니다.",
            en: "Messages starting with $ become company directives; normal messages go 1:1 to the selected agent.",
            ja: "$ で始まると全社通知、通常メッセージは選択 Agent との 1:1 会話になります。",
            zh: "以 $ 开头为公司指令，普通消息会进入所选 Agent 的 1:1 对话。",
          })}
        </div>
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-200">
            {t({ ko: "세션 테스트 전송", en: "Test Send", ja: "送信テスト", zh: "发送测试" })}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadTelegramReceiverStatus()}
              disabled={receiverLoading}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-60"
            >
              {t({ ko: "수신상태", en: "Receiver", ja: "受信状態", zh: "接收状态" })}
            </button>
            <button
              onClick={() => void loadRuntimeSessions()}
              disabled={runtimeLoading}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-60"
            >
              {t({ ko: "실행중 세션", en: "Runtime", ja: "実行セッション", zh: "运行会话" })}
            </button>
          </div>
        </div>

        {telegramReceiverStatus && (
          <div className="rounded-md border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 space-y-1">
            <div>
              {t({ ko: "텔레그램 수신기", en: "Telegram Receiver", ja: "Telegram 受信機", zh: "Telegram 接收器" })}:{" "}
              <span className={telegramReceiverStatus.enabled ? "text-emerald-400" : "text-amber-300"}>
                {telegramReceiverStatus.enabled
                  ? t({ ko: "활성", en: "active", ja: "有効", zh: "已启用" })
                  : t({ ko: "비활성", en: "inactive", ja: "無効", zh: "未启用" })}
              </span>
            </div>
            <div>
              {t({ ko: "허용 chat 수", en: "Allowed chats", ja: "許可チャット数", zh: "允许聊天数" })}:{" "}
              {telegramReceiverStatus.allowedChatCount}
            </div>
            {telegramReceiverStatus.lastError && <div className="text-red-400">{telegramReceiverStatus.lastError}</div>}
          </div>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            {t({ ko: "전송 대상 세션", en: "Target Session", ja: "送信先セッション", zh: "目标会话" })}
          </label>
          {chatRows.length === 0 ? (
            <div className="text-xs text-slate-500 py-1">
              {t({
                ko: "저장된 세션이 없습니다. 먼저 채팅을 등록하세요.",
                en: "No saved session. Add a chat first.",
                ja: "保存済みセッションがありません。先にチャットを追加してください。",
                zh: "没有已保存会话，请先添加聊天。",
              })}
            </div>
          ) : (
            <select
              value={selectedChat?.key ?? ""}
              onChange={(e) => setSelectedChatKey(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            >
              {chatRows.map((row) => (
                <option key={row.key} value={row.key}>
                  {CHANNEL_META[row.channel].label} · {row.session.name} ({row.session.targetId})
                </option>
              ))}
            </select>
          )}
        </div>

        <textarea
          value={sendText}
          onChange={(e) => setSendText(e.target.value)}
          rows={3}
          placeholder={t({
            ko: "테스트 메시지를 입력하세요...",
            en: "Type a test message...",
            ja: "テストメッセージを入力...",
            zh: "输入测试消息...",
          })}
          className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-y"
        />

        {!selectedChatTransportReady && selectedChat && (
          <div className="text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300">
            {t({
              ko: "이 채널은 현재 설정 저장/매핑은 가능하지만, 직접 전송 런타임은 아직 준비되지 않았습니다.",
              en: "This channel can be configured and mapped, but direct transport runtime is not ready yet.",
              ja: "このチャネルは設定/マッピングは可能ですが、直接送信ランタイムは未対応です。",
              zh: "该渠道可配置和映射，但直连发送运行时暂未就绪。",
            })}
          </div>
        )}

        <button
          onClick={() => void handleSendMessage()}
          disabled={sending || !selectedChat || !sendText.trim() || !selectedChatTransportReady}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending
            ? t({ ko: "전송 중...", en: "Sending...", ja: "送信中...", zh: "发送中..." })
            : t({ ko: "메시지 전송", en: "Send", ja: "送信", zh: "发送" })}
        </button>

        {sendStatus && (
          <div
            className={`text-xs px-3 py-2 rounded-lg ${
              sendStatus.ok
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            {sendStatus.msg}
          </div>
        )}

        {runtimeSessions.length > 0 && (
          <div className="pt-1">
            <div className="text-xs text-slate-400 mb-1">
              {t({ ko: "런타임 세션", en: "Runtime Sessions", ja: "実行中セッション", zh: "运行时会话" })}
            </div>
            <div className="max-h-44 overflow-auto rounded-md border border-slate-700/60">
              {runtimeSessions.map((session) => (
                <div
                  key={session.sessionKey}
                  className="px-2.5 py-2 text-[11px] border-b last:border-b-0 border-slate-700/60 text-slate-300"
                >
                  <span className="font-semibold">{session.channel}</span> · {session.displayName} · {session.targetId}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {editor.open && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center px-4">
          <button className="absolute inset-0 bg-slate-950/70" onClick={closeEditorModal} aria-label="close modal" />
          <div className="relative w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-100">
                {editor.mode === "create"
                  ? t({ ko: "새 채팅 추가", en: "Add Chat", ja: "チャット追加", zh: "新增聊天" })
                  : t({ ko: "채팅 편집", en: "Edit Chat", ja: "チャット編集", zh: "编辑聊天" })}
              </h4>
              <button
                onClick={closeEditorModal}
                className="px-2 py-1 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                {t({ ko: "닫기", en: "Close", ja: "閉じる", zh: "关闭" })}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t({ ko: "메신저", en: "Messenger", ja: "メッセンジャー", zh: "消息渠道" })}
                </label>
                <select
                  value={editor.channel}
                  onChange={(e) => {
                    const nextChannel = e.target.value as MessengerChannelType;
                    setEditor((prev) => ({
                      ...prev,
                      channel: nextChannel,
                      token: channelsConfig[nextChannel].token ?? "",
                      receiveEnabled: channelsConfig[nextChannel].receiveEnabled !== false,
                    }));
                  }}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {MESSENGER_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_META[channel].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t({ ko: "활성 여부", en: "Enabled", ja: "有効", zh: "启用" })}
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 h-[38px]">
                  <input
                    type="checkbox"
                    checked={editor.enabled}
                    onChange={(e) => setEditor((prev) => ({ ...prev, enabled: e.target.checked }))}
                    className="accent-blue-500"
                  />
                  {editor.enabled
                    ? t({ ko: "활성", en: "Enabled", ja: "有効", zh: "启用" })
                    : t({ ko: "비활성", en: "Disabled", ja: "無効", zh: "禁用" })}
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t({ ko: "토큰", en: "Token", ja: "トークン", zh: "令牌" })}
              </label>
              <input
                type="password"
                value={editor.token}
                onChange={(e) => setEditor((prev) => ({ ...prev, token: e.target.value }))}
                placeholder={t({
                  ko: `${CHANNEL_META[editor.channel].label} 토큰 입력`,
                  en: `Enter ${CHANNEL_META[editor.channel].label} token`,
                  ja: `${CHANNEL_META[editor.channel].label} トークンを入力`,
                  zh: `输入 ${CHANNEL_META[editor.channel].label} 令牌`,
                })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t({ ko: "채팅 이름", en: "Chat Name", ja: "チャット名", zh: "聊天名称" })}
                </label>
                <input
                  value={editor.name}
                  onChange={(e) => setEditor((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t({
                    ko: "예: 디자인팀 알림",
                    en: "e.g. Design Alerts",
                    ja: "例: デザイン通知",
                    zh: "例如：设计组通知",
                  })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t({ ko: "채널/대상 ID", en: "Channel/Target ID", ja: "チャンネル/対象 ID", zh: "频道/目标 ID" })}
                </label>
                <input
                  value={editor.targetId}
                  onChange={(e) => setEditor((prev) => ({ ...prev, targetId: e.target.value }))}
                  placeholder={channelTargetHint(editor.channel)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t({ ko: "대화 Agent", en: "Conversation Agent", ja: "担当Agent", zh: "对话 Agent" })}
              </label>
              <AgentSelect
                agents={agents}
                value={editor.agentId}
                onChange={(agentId) => setEditor((prev) => ({ ...prev, agentId: agentId || "" }))}
                placeholder={t({
                  ko: "대화 Agent 선택",
                  en: "Select Agent",
                  ja: "担当エージェント選択",
                  zh: "选择对话 Agent",
                })}
                className={agentsLoading ? "pointer-events-none opacity-60" : ""}
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t({ ko: "워크플로우 팩", en: "Workflow Pack", ja: "ワークフローパック", zh: "工作流包" })}
              </label>
              <select
                value={editor.workflowPackKey}
                onChange={(e) =>
                  setEditor((prev) => ({
                    ...prev,
                    workflowPackKey: isWorkflowPackKey(e.target.value) ? e.target.value : "development",
                  }))
                }
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {workflowPackOptions.map((pack) => (
                  <option key={pack.key} value={pack.key} disabled={!pack.enabled && pack.key !== editor.workflowPackKey}>
                    {pack.name}
                    {!pack.enabled ? ` (${t({ ko: "비활성", en: "disabled", ja: "無効", zh: "禁用" })})` : ""}
                  </option>
                ))}
              </select>
              {workflowPacksLoading && (
                <div className="mt-1 text-[11px] text-slate-500">
                  {t({ ko: "팩 목록 불러오는 중...", en: "Loading packs...", ja: "パックを読み込み中...", zh: "正在加载工作流包..." })}
                </div>
              )}
            </div>

            {editor.channel === "telegram" && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={editor.receiveEnabled}
                  onChange={(e) => setEditor((prev) => ({ ...prev, receiveEnabled: e.target.checked }))}
                  className="accent-blue-500"
                />
                {t({
                  ko: "텔레그램 직접 수신 활성화",
                  en: "Enable direct Telegram receive",
                  ja: "Telegram 直接受信を有効化",
                  zh: "启用 Telegram 直接接收",
                })}
              </label>
            )}

            {editorError && <div className="text-xs text-red-400">{editorError}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={closeEditorModal}
                className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                onClick={handleSaveEditor}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500"
              >
                {t({ ko: "확인", en: "Confirm", ja: "確認", zh: "确认" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
