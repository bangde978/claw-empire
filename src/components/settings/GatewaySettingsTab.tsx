import type { GatewayStateBundle, TFunction } from "./types";

interface GatewaySettingsTabProps {
  t: TFunction;
  gateway: GatewayStateBundle;
}

export default function GatewaySettingsTab({ t, gateway }: GatewaySettingsTabProps) {
  const {
    gwTargets,
    gwLoading,
    gwSelected,
    setGwSelected,
    gwText,
    setGwText,
    gwSending,
    gwStatus,
    loadGwTargets,
    handleGwSend,
  } = gateway;

  return (
    <section className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {t({ ko: "채널 메시지 전송", en: "Channel Messaging", ja: "チャネルメッセージ", zh: "频道消息" })}
        </h3>
        <button
          onClick={() => void loadGwTargets()}
          disabled={gwLoading}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
        >
          🔄 {t({ ko: "새로고침", en: "Refresh", ja: "更新", zh: "刷新" })}
        </button>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">
          {t({ ko: "대상 채널", en: "Target Channel", ja: "対象チャネル", zh: "目标频道" })}
        </label>
        {gwLoading ? (
          <div className="text-xs text-slate-500 animate-pulse py-2">
            {t({
              ko: "채널 목록 로딩 중...",
              en: "Loading channels...",
              ja: "チャネル読み込み中...",
              zh: "正在加载频道...",
            })}
          </div>
        ) : gwTargets.length === 0 ? (
          <div className="text-xs text-slate-500 py-2">
            {t({
              ko: "채널이 없습니다. Gateway가 실행 중인지 확인하세요.",
              en: "No channels found. Make sure Gateway is running.",
              ja: "チャネルがありません。ゲートウェイが実行中か確認してください。",
              zh: "未找到频道。请确认网关正在运行。",
            })}
          </div>
        ) : (
          <select
            value={gwSelected}
            onChange={(e) => {
              setGwSelected(e.target.value);
              localStorage.setItem("climpire.gateway.lastTarget", e.target.value);
            }}
            className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {gwTargets.map((target) => (
              <option key={target.sessionKey} value={target.sessionKey}>
                {target.displayName} ({target.channel})
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">
          {t({ ko: "메시지", en: "Message", ja: "メッセージ", zh: "消息" })}
        </label>
        <textarea
          value={gwText}
          onChange={(e) => setGwText(e.target.value)}
          placeholder={t({
            ko: "메시지를 입력하세요...",
            en: "Type a message...",
            ja: "メッセージを入力...",
            zh: "输入消息...",
          })}
          rows={3}
          className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleGwSend();
            }
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void handleGwSend()}
          disabled={gwSending || !gwSelected || !gwText.trim()}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {gwSending
            ? t({ ko: "전송 중...", en: "Sending...", ja: "送信中...", zh: "发送中..." })
            : t({ ko: "전송", en: "Send", ja: "送信", zh: "发送" })}
        </button>
        <span className="text-xs text-slate-500">
          {t({ ko: "Ctrl+Enter로 전송", en: "Ctrl+Enter to send", ja: "Ctrl+Enterで送信", zh: "Ctrl+Enter 发送" })}
        </span>
      </div>

      {gwStatus && (
        <div
          className={`text-xs px-3 py-2 rounded-lg ${
            gwStatus.ok
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}
        >
          {gwStatus.msg}
        </div>
      )}
    </section>
  );
}
