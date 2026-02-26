import { useEffect, useMemo, useState } from "react";
import * as api from "../../api";
import AgentSelect from "../AgentSelect";
import type {
  Agent,
  MessengerChannelConfig,
  MessengerChannelType,
  MessengerChannelsConfig,
  MessengerSessionConfig,
} from "../../types";
import type { ChannelSettingsTabProps } from "./types";

const CHANNEL_META: Array<{ channel: MessengerChannelType; label: string; hint: string }> = [
  { channel: "telegram", label: "Telegram", hint: "chat_id" },
  { channel: "discord", label: "Discord", hint: "channel_id" },
  { channel: "slack", label: "Slack", hint: "channel_id" },
];

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
  return {
    telegram: emptyChannelConfig("telegram"),
    discord: emptyChannelConfig("discord"),
    slack: emptyChannelConfig("slack"),
  };
}

function normalizeSession(session: MessengerSessionConfig, channel: MessengerChannelType, index: number): MessengerSessionConfig {
  const id = (session.id || "").trim() || `${channel}-${index}`;
  const agentId = session.agentId?.trim() || "";
  return {
    id,
    name: session.name?.trim() || `${channel.toUpperCase()} Session ${index + 1}`,
    targetId: session.targetId?.trim() || "",
    enabled: session.enabled !== false,
    agentId: agentId || undefined,
  };
}

function normalizeChannelsConfig(config: MessengerChannelsConfig): MessengerChannelsConfig {
  const next: MessengerChannelsConfig = {
    telegram: {
      token: config.telegram.token?.trim?.() ?? "",
      receiveEnabled: config.telegram.receiveEnabled !== false,
      sessions: (config.telegram.sessions ?? []).map((session, idx) => normalizeSession(session, "telegram", idx)),
    },
    discord: {
      token: config.discord.token?.trim?.() ?? "",
      receiveEnabled: config.discord.receiveEnabled === true,
      sessions: (config.discord.sessions ?? []).map((session, idx) => normalizeSession(session, "discord", idx)),
    },
    slack: {
      token: config.slack.token?.trim?.() ?? "",
      receiveEnabled: config.slack.receiveEnabled === true,
      sessions: (config.slack.sessions ?? []).map((session, idx) => normalizeSession(session, "slack", idx)),
    },
  };

  return next;
}

function resolveChannelsConfig(raw: ChannelSettingsTabProps["form"]["messengerChannels"]): MessengerChannelsConfig {
  const defaults = defaultChannelsConfig();
  return {
    telegram: {
      ...defaults.telegram,
      ...(raw?.telegram ?? {}),
      sessions: raw?.telegram?.sessions ?? defaults.telegram.sessions,
    },
    discord: {
      ...defaults.discord,
      ...(raw?.discord ?? {}),
      sessions: raw?.discord?.sessions ?? defaults.discord.sessions,
    },
    slack: {
      ...defaults.slack,
      ...(raw?.slack ?? {}),
      sessions: raw?.slack?.sessions ?? defaults.slack.sessions,
    },
  };
}

type DraftSessionRef = {
  key: string;
  channel: MessengerChannelType;
  session: MessengerSessionConfig;
};

export default function GatewaySettingsTab({ t, form, setForm, persistSettings }: ChannelSettingsTabProps) {
  const channelsConfig = resolveChannelsConfig(form.messengerChannels);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ok: boolean; msg: string } | null>(null);

  const [sending, setSending] = useState(false);
  const [sendText, setSendText] = useState("");
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeSessions, setRuntimeSessions] = useState<Awaited<ReturnType<typeof api.getMessengerRuntimeSessions>>>([]);
  const [receiverLoading, setReceiverLoading] = useState(false);
  const [telegramReceiverStatus, setTelegramReceiverStatus] =
    useState<Awaited<ReturnType<typeof api.getTelegramReceiverStatus>> | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);

  const draftSessions = useMemo<DraftSessionRef[]>(() => {
    return CHANNEL_META.flatMap(({ channel }) => {
      const sessions = channelsConfig[channel].sessions ?? [];
      return sessions.map((session) => ({
        key: `${channel}:${session.id}`,
        channel,
        session,
      }));
    }).filter((entry) => entry.session.targetId.trim().length > 0);
  }, [channelsConfig]);

  const [selectedDraftSessionKey, setSelectedDraftSessionKey] = useState<string>("");

  const selectedDraftSession = draftSessions.find((entry) => entry.key === selectedDraftSessionKey) ?? draftSessions[0];

  const updateChannels = (nextChannels: MessengerChannelsConfig) => {
    setForm({
      ...form,
      messengerChannels: nextChannels,
    });
  };

  const updateChannel = (channel: MessengerChannelType, updater: (prev: MessengerChannelConfig) => MessengerChannelConfig) => {
    const nextChannels: MessengerChannelsConfig = {
      ...channelsConfig,
      [channel]: updater(channelsConfig[channel]),
    };
    updateChannels(nextChannels);
  };

  const addSession = (channel: MessengerChannelType) => {
    updateChannel(channel, (prev) => ({
      ...prev,
      sessions: [
        ...prev.sessions,
        {
          id: createSessionId(channel),
          name: "",
          targetId: "",
          enabled: true,
        },
      ],
    }));
  };

  const updateSession = (
    channel: MessengerChannelType,
    index: number,
    patch: Partial<MessengerSessionConfig>,
  ) => {
    updateChannel(channel, (prev) => ({
      ...prev,
      sessions: prev.sessions.map((session, i) => (i === index ? { ...session, ...patch } : session)),
    }));
  };

  const removeSession = (channel: MessengerChannelType, index: number) => {
    updateChannel(channel, (prev) => ({
      ...prev,
      sessions: prev.sessions.filter((_, i) => i !== index),
    }));
  };

  const handleSaveChannels = () => {
    const normalized = normalizeChannelsConfig(channelsConfig);
    const nextForm = { ...form, messengerChannels: normalized };
    setForm(nextForm);
    setSaving(true);
    setSaved(null);
    try {
      persistSettings(nextForm);
      setSaved({
        ok: true,
        msg: t({
          ko: "채널 설정 저장 완료",
          en: "Channel settings saved",
          ja: "チャネル設定を保存しました",
          zh: "频道设置已保存",
        }),
      });
      setTimeout(() => setSaved(null), 2500);
    } catch (error) {
      setSaved({ ok: false, msg: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const handleSendMessage = async () => {
    const target = selectedDraftSession;
    if (!target || !sendText.trim()) {
      return;
    }

    setSending(true);
    setSendStatus(null);
    try {
      const result = await api.sendMessengerRuntimeMessage({
        channel: target.channel,
        targetId: target.session.targetId.trim(),
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

  useEffect(() => {
    void loadAgents();
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

  return (
    <section className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {t({ ko: "채널 메시지 설정", en: "Channel Messaging", ja: "チャネルメッセージ設定", zh: "频道消息设置" })}
        </h3>
        <div className="flex items-center gap-2">
          {saved && (
            <span className={`text-xs ${saved.ok ? "text-emerald-400" : "text-red-400"}`}>{saved.msg}</span>
          )}
          <button
            onClick={handleSaveChannels}
            disabled={saving}
            className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-60"
          >
            {saving
              ? t({ ko: "저장 중...", en: "Saving...", ja: "保存中...", zh: "保存中..." })
              : t({ ko: "설정 저장", en: "Save", ja: "保存", zh: "保存" })}
          </button>
        </div>
      </div>

      {CHANNEL_META.map(({ channel, label, hint }) => {
        const channelConfig = channelsConfig[channel];
        const channelSessions = channelConfig.sessions ?? [];
        return (
          <div key={channel} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-200">{label}</div>
              <button
                onClick={() => addSession(channel)}
                className="text-xs px-2.5 py-1 rounded-md bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/40"
              >
                + {t({ ko: "세션 추가", en: "Add Session", ja: "セッション追加", zh: "添加会话" })}
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t({ ko: "봇 토큰", en: "Bot Token", ja: "Bot トークン", zh: "机器人令牌" })}
              </label>
              <input
                type="password"
                value={channelConfig.token ?? ""}
                onChange={(e) => updateChannel(channel, (prev) => ({ ...prev, token: e.target.value }))}
                placeholder={t({
                  ko: `${label} 토큰 입력`,
                  en: `Enter ${label} token`,
                  ja: `${label} トークンを入力`,
                  zh: `输入 ${label} 令牌`,
                })}
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            {channel === "telegram" && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={channelConfig.receiveEnabled !== false}
                  onChange={(e) => updateChannel(channel, (prev) => ({ ...prev, receiveEnabled: e.target.checked }))}
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

            {channelSessions.length === 0 ? (
              <div className="text-xs text-slate-500 py-1">
                {t({
                  ko: "등록된 세션이 없습니다. 세션 추가로 대상 채널을 등록하세요.",
                  en: "No sessions yet. Add a session to register a destination channel.",
                  ja: "セッションがありません。セッションを追加して宛先を登録してください。",
                  zh: "暂无会话。请添加会话并注册目标频道。",
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {channelSessions.map((session, index) => (
                  <div key={session.id || `${channel}-${index}`} className="grid grid-cols-12 gap-2 items-center">
                    <label className="col-span-12 sm:col-span-1 flex items-center gap-2 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={session.enabled !== false}
                        onChange={(e) => updateSession(channel, index, { enabled: e.target.checked })}
                        className="accent-blue-500"
                      />
                      {t({ ko: "활성", en: "On", ja: "有効", zh: "启用" })}
                    </label>
                    <input
                      value={session.name ?? ""}
                      onChange={(e) => updateSession(channel, index, { name: e.target.value })}
                      placeholder={t({ ko: "세션 이름", en: "Session name", ja: "セッション名", zh: "会话名称" })}
                      className="col-span-12 sm:col-span-3 px-2.5 py-2 bg-slate-700/40 border border-slate-600 rounded-md text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <input
                      value={session.targetId ?? ""}
                      onChange={(e) => updateSession(channel, index, { targetId: e.target.value })}
                      placeholder={`${hint}`}
                      className="col-span-12 sm:col-span-4 px-2.5 py-2 bg-slate-700/40 border border-slate-600 rounded-md text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                    <AgentSelect
                      agents={agents}
                      value={session.agentId ?? ""}
                      onChange={(agentId) => updateSession(channel, index, { agentId: agentId || undefined })}
                      placeholder={t({
                        ko: "대화 Agent 선택",
                        en: "Select Agent",
                        ja: "担当エージェント選択",
                        zh: "选择对话 Agent",
                      })}
                      className={`col-span-12 sm:col-span-3 ${agentsLoading ? "pointer-events-none opacity-60" : ""}`}
                    />
                    <button
                      onClick={() => removeSession(channel, index)}
                      className="col-span-12 sm:col-span-1 px-2 py-2 rounded-md bg-red-600/20 border border-red-500/30 text-red-300 text-xs hover:bg-red-600/30"
                    >
                      {t({ ko: "삭제", en: "Del", ja: "削除", zh: "删" })}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              {t({
                ko: "$로 시작하면 전사공지, 일반 메시지는 선택된 Agent에게 1:1 대화로 전달됩니다.",
                en: "Messages starting with $ become company-wide directives; normal messages go 1:1 to the selected agent.",
                ja: "$ で始まると全社通知、通常メッセージは選択 Agent との 1:1 会話になります。",
                zh: "以 $ 开头为全员公告，普通消息会进入所选 Agent 的 1:1 对话。",
              })}
            </div>
          </div>
        );
      })}

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
              🔄 {t({ ko: "수신상태", en: "Receiver", ja: "受信状態", zh: "接收状态" })}
            </button>
            <button
              onClick={() => void loadRuntimeSessions()}
              disabled={runtimeLoading}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-60"
            >
              🔄 {t({ ko: "실행중 세션", en: "Runtime", ja: "実行セッション", zh: "运行会话" })}
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
            {telegramReceiverStatus.lastError && (
              <div className="text-red-400">{telegramReceiverStatus.lastError}</div>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            {t({ ko: "전송 대상 세션", en: "Target Session", ja: "送信先セッション", zh: "目标会话" })}
          </label>
          {draftSessions.length === 0 ? (
            <div className="text-xs text-slate-500 py-1">
              {t({
                ko: "저장할 세션이 없습니다. 위에서 세션을 먼저 등록하세요.",
                en: "No draft sessions. Add sessions above first.",
                ja: "下書きセッションがありません。先に上で登録してください。",
                zh: "没有草稿会话，请先在上方添加。",
              })}
            </div>
          ) : (
            <select
              value={selectedDraftSession?.key ?? ""}
              onChange={(e) => setSelectedDraftSessionKey(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            >
              {draftSessions.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.channel} · {entry.session.name || entry.session.targetId} ({entry.session.targetId})
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

        <button
          onClick={() => void handleSendMessage()}
          disabled={sending || !selectedDraftSession || !sendText.trim()}
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
    </section>
  );
}
