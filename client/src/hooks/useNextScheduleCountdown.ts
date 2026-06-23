import { useState, useEffect } from 'react';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface SessionSchedule {
  startHour: number;
  startMinute: number;
  durationMinutes: number;
}

interface ScheduleInfo {
  sessions: SessionSchedule[];
  timezone: string;
  isRunning: boolean;
}

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function getSecondsUntilNext(
  sessions: SessionSchedule[],
  timezone: string,
): number | null {
  if (!sessions.length) return null;

  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  // hour12: false can return "24" for midnight on some platforms
  const h = get('hour') % 24;
  const nowSecs = h * 3600 + get('minute') * 60 + get('second');

  let nearest = Infinity;
  for (const s of sessions) {
    const sessionStart = s.startHour * 3600 + s.startMinute * 60;
    let diff = sessionStart - nowSecs;
    if (diff <= 0) diff += 86400; // wrap to tomorrow
    if (diff < nearest) nearest = diff;
  }

  return nearest === Infinity ? null : nearest;
}

export interface NextScheduleCountdown {
  /** Formatted countdown string, e.g. "1:23:45" or "05:30". Null when no sessions. */
  countdown: string | null;
  /** Raw seconds until the next session, or null. */
  secondsUntil: number | null;
  /** Whether the schedule daemon is active. */
  isRunning: boolean;
}

/**
 * Fetches the schedule once and updates a live countdown every second
 * to the nearest upcoming session.
 */
export function useNextScheduleCountdown(): NextScheduleCountdown {
  const [info, setInfo] = useState<ScheduleInfo | null>(null);
  const [secondsUntil, setSecondsUntil] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/schedule`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ScheduleInfo | null) => {
        if (data) setInfo(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!info?.sessions.length) return;

    const tick = () => {
      setSecondsUntil(getSecondsUntilNext(info.sessions, info.timezone));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info]);

  return {
    countdown: secondsUntil !== null ? formatCountdown(secondsUntil) : null,
    secondsUntil,
    isRunning: info?.isRunning ?? false,
  };
}
