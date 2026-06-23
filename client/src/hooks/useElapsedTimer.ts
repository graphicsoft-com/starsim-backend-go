import { useState, useEffect } from 'react';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Returns a live HH:MM:SS string counting up from `startTime`.
 * Updates every second while `startTime` is non-null.
 * Returns `null` when `startTime` is null.
 */
export function useElapsedTimer(startTime: string | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null);

  useEffect(() => {
    if (!startTime) {
      setElapsed(null);
      return;
    }

    const origin = new Date(startTime).getTime();

    const tick = () => setElapsed(formatElapsed(Date.now() - origin));
    tick(); // immediate first render

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return elapsed;
}
