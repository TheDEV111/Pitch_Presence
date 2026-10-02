'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '@pitchpresence/shared';
import { api } from '@/lib/api';

export function useResource<T>(path: string | null, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const generation = useRef(0);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (!path) return;
      const request = ++generation.current;
      try {
        const value = await api<T>(path, { signal });
        if (request === generation.current) {
          setData(value);
          setError(null);
        }
      } catch (error) {
        if (request === generation.current && (error as Error).name !== 'AbortError')
          setError((error as Error).message);
      } finally {
        if (request === generation.current) setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(!!path);
    setError(null);
    void reload(controller.signal);
    const timer =
      path && interval
        ? setInterval(() => {
            if (document.visibilityState === 'visible' && navigator.onLine) void reload();
          }, interval)
        : undefined;
    return () => {
      generation.current++;
      controller.abort();
      clearInterval(timer);
    };
  }, [path, interval, reload]);
  return { data, error, loading, reload: () => reload() };
}
export function useCollection<T>(path: string) {
  const resource = useResource<Page<T>>(path);
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPath = useRef(path);
  currentPath.current = path;
  useEffect(() => {
    setExtra([]);
    setCursor(undefined);
    setError(null);
  }, [resource.data, path]);
  const nextCursor = cursor === undefined ? resource.data?.nextCursor : cursor;
  async function more() {
    if (!nextCursor || busy) return;
    setBusy(true);
    const requestedPath = path;
    try {
      const page = await api<Page<T>>(
        `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (requestedPath !== currentPath.current) return;
      setExtra((old) => [...old, ...page.items]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      if (requestedPath === currentPath.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    ...resource,
    items: [...(resource.data?.items ?? []), ...extra],
    nextCursor,
    more,
    busy,
    error: error ?? resource.error,
  };
}
