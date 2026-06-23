import { useState, useEffect } from 'react';

export interface ChangeLogEntry {
  timestamp: Date;
  roomId: string;
  from: string;
  to: string;
  changedBy: string;
}

export function useTTSChangeLog(maxEntries = 50): {
  log: ChangeLogEntry[];
  clearLog: () => void;
} {
  const [log, setLog] = useState<ChangeLogEntry[]>([]);

  useEffect(() => {
    const socket = (window as unknown as Record<string, unknown>).__socket as
      | {
          on: (e: string, h: (...args: unknown[]) => void) => void;
          off: (e: string, h: (...args: unknown[]) => void) => void;
        }
      | undefined;
    if (!socket) return;

    const handler = (payload: unknown) => {
      const p = payload as {
        roomId: string;
        provider: string;
        fullConfig: unknown;
        version: number;
        timestamp: string;
        previousProvider?: string;
      };

      if (p.roomId === 'all') return; // skip initial full sync events

      const entry: ChangeLogEntry = {
        timestamp: new Date(p.timestamp),
        roomId: p.roomId,
        from: p.previousProvider ?? 'unknown',
        to: p.provider,
        changedBy: 'operator',
      };

      setLog((prev) => [entry, ...prev].slice(0, maxEntries));
    };

    socket.on('tts_config_updated', handler);
    return () => socket.off('tts_config_updated', handler);
  }, [maxEntries]);

  return { log, clearLog: () => setLog([]) };
}
