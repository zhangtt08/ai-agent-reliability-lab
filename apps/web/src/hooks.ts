import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** 极简数据获取 hook：只做「加载一次 + 错误透出」，不引入 react-query */
export function useData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** 轮询 hook（run 进行中的进度条用） */
export function usePolling<T>(path: string | null, intervalMs: number, enabled: boolean) {
  const { data, error, reload } = useData<T>(path);
  useEffect(() => {
    if (!enabled || !path) return;
    const timer = setInterval(reload, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, path, intervalMs, reload]);
  return { data, error, reload };
}
