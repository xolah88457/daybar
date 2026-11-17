'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RadarConfig } from '@daybar/core/contracts';
import { getRadarClient } from './radarClient';
import type { Access, RadarClient, RadarItems, RadarStatus } from './radarClient';

function message(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.';
}

/** Items for the saved configuration, kept fresh: loads on mount, when the query changes and on native change events. */
export function useRadarItems(config: RadarConfig, client: RadarClient = getRadarClient()) {
  const [data, setData] = useState<RadarItems | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  // Only what shapes the native query reloads it; keywords and alerts are applied on this side.
  const key = JSON.stringify([
    config.calendars, config.reminderLists, config.includeReminders, config.daysAhead, config.overdueDaysBack
  ]);
  const refresh = useCallback(
    async (force = false) => {
      const id = ++latest.current;
      setLoading(true);
      try {
        const next = await client.items(force);
        if (id === latest.current) {
          setData(next);
          setError(next.error ?? '');
        }
      } catch (e) {
        if (id === latest.current) setError(message(e));
      } finally {
        if (id === latest.current) setLoading(false);
      }
    },
    [client]
  );
  useEffect(() => {
    void refresh();
  }, [refresh, key]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    client
      .subscribe(() => void refresh())
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [client, refresh]);
  useEffect(
    () => () => {
      latest.current = -1; // ignore answers that arrive after unmount
    },
    []
  );
  const requestAccess = useCallback(async () => {
    try {
      await client.requestAccess();
    } catch (e) {
      setError(message(e));
    }
    await refresh(true);
  }, [client, refresh]);
  return { data, error, loading, refresh, requestAccess };
}

/** The permission status alone (Settings needs no items). */
export function useRadarStatus(client: RadarClient = getRadarClient()) {
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const next = await client.status();
      if (alive.current) setStatus(next);
    } catch (e) {
      if (alive.current) setError(message(e));
    }
  }, [client]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    let stop: (() => void) | undefined;
    client
      .subscribe(() => void refresh())
      .then((fn) => {
        if (alive.current) stop = fn;
        else fn();
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
      stop?.();
    };
  }, [client, refresh]);
  const requestAccess = useCallback(async () => {
    try {
      const next = await client.requestAccess();
      if (alive.current) setStatus(next);
    } catch (e) {
      if (alive.current) setError(message(e));
    }
  }, [client]);
  return { status, error, refresh, requestAccess };
}

const asked = { events: false, reminders: false };
/** Forgets which prompts were already triggered (tests only). */
export function resetAutoRequest(): void {
  asked.events = false;
  asked.reminders = false;
}
/**
 * Turning Radar on asks macOS for access once: from the Settings panel or the page, whichever shows
 * first, while a kind is still `notDetermined`. A denied answer is never re-asked here.
 */
export function useAutoRequest(
  status: RadarStatus | null | undefined,
  includeReminders: boolean,
  request: () => Promise<unknown>
): void {
  const undetermined = (a: Access | undefined) => a === 'notDetermined';
  const needEvents = !!status?.supported && undetermined(status.events) && !asked.events;
  const needReminders = !!status?.supported && includeReminders && undetermined(status.reminders) && !asked.reminders;
  useEffect(() => {
    if (!needEvents && !needReminders) return;
    if (needEvents) asked.events = true;
    if (needReminders) asked.reminders = true;
    void request();
  }, [needEvents, needReminders, request]);
}
