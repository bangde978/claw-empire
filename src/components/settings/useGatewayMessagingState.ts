import { useCallback, useEffect, useState } from "react";
import * as api from "../../api";
import type { GatewayStateBundle, SettingsTab, TFunction } from "./types";

const LAST_TARGET_KEY = "climpire.gateway.lastTarget";

export function useGatewayMessagingState({ tab, t }: { tab: SettingsTab; t: TFunction }): GatewayStateBundle {
  const [gwTargets, setGwTargets] = useState<Awaited<ReturnType<typeof api.getGatewayTargets>>>([]);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwSelected, setGwSelected] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem(LAST_TARGET_KEY) ?? "") : "",
  );
  const [gwText, setGwText] = useState("");
  const [gwSending, setGwSending] = useState(false);
  const [gwStatus, setGwStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadGwTargets = useCallback(async () => {
    setGwLoading(true);
    setGwStatus(null);
    try {
      const targets = await api.getGatewayTargets();
      setGwTargets(targets);
      if (targets.length > 0 && !targets.find((target) => target.sessionKey === gwSelected)) {
        const fallback = targets[0].sessionKey;
        setGwSelected(fallback);
        localStorage.setItem(LAST_TARGET_KEY, fallback);
      }
    } catch (error) {
      setGwStatus({ ok: false, msg: String(error) });
    } finally {
      setGwLoading(false);
    }
  }, [gwSelected]);

  useEffect(() => {
    if (tab === "gateway" && gwTargets.length === 0 && !gwLoading) {
      void loadGwTargets();
    }
  }, [gwLoading, gwTargets.length, loadGwTargets, tab]);

  const handleGwSend = useCallback(async () => {
    if (!gwSelected || !gwText.trim()) return;
    setGwSending(true);
    setGwStatus(null);
    try {
      const result = await api.sendGatewayMessage(gwSelected, gwText.trim());
      if (result.ok) {
        setGwStatus({ ok: true, msg: t({ ko: "전송 완료!", en: "Sent!", ja: "送信完了!", zh: "发送成功!" }) });
        setGwText("");
      } else {
        setGwStatus({ ok: false, msg: result.error || "Send failed" });
      }
    } catch (error) {
      setGwStatus({ ok: false, msg: String(error) });
    } finally {
      setGwSending(false);
    }
  }, [gwSelected, gwText, t]);

  return {
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
  };
}
