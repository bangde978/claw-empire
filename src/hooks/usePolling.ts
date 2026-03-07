import { useEffect, useRef, useCallback, useState } from "react";

const EMPTY_DEPS: unknown[] = [];

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number = 3000, deps: unknown[] = EMPTY_DEPS) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, intervalMs);

    function handleVisibility() {
      clearInterval(timerRef.current);
      if (!document.hidden) {
        refresh();
        timerRef.current = setInterval(refresh, intervalMs);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, intervalMs, deps]);

  return { data, loading, error, refresh };
}
