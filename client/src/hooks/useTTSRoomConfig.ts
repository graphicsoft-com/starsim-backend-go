import { useState, useEffect, useCallback } from 'react';
import { ClientTTSConfigStore } from '../services/tts/TTSConfigStore';
import type { TTSProviderName } from '../services/tts/ITTSProvider';
import axios from 'axios';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

export interface RoomConfigEntry {
  roomId: string;
  currentProvider: TTSProviderName;
  pendingProvider: TTSProviderName | null;
}

export function useTTSRoomConfig(): {
  rooms: RoomConfigEntry[];
  setProvider: (roomId: string, provider: TTSProviderName) => void;
  setAllRooms: (provider: TTSProviderName) => void;
  refetchRooms: () => void;
} {
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [roomConfigs, setRoomConfigs] = useState<RoomConfigEntry[]>([]);

  // Fetch room IDs from the status API so renamed/added/deleted rooms are included
  const fetchRoomIds = useCallback(() => {
    axios
      .get(`${SERVER_URL}/api/simulation/status`)
      .then(({ data }) => {
        const ids = (data.data.rooms as { roomId: string }[]).map(
          (r) => r.roomId,
        );
        setRoomIds(ids);
      })
      .catch(() => {
        // silent — TTS panel just won't show rooms until next poll
      });
  }, []);

  useEffect(() => {
    fetchRoomIds();
  }, [fetchRoomIds]);

  const buildEntries = useCallback((): RoomConfigEntry[] => {
    const store = ClientTTSConfigStore.getInstance();
    const providers = store.getAllProviders();
    return roomIds.map((roomId) => ({
      roomId,
      currentProvider: providers[roomId] ?? 'webspeech',
      pendingProvider: null,
    }));
  }, [roomIds]);

  // Subscribe to config store changes
  useEffect(() => {
    setRoomConfigs(buildEntries());
    const store = ClientTTSConfigStore.getInstance();
    const unsubscribe = store.onChange(() => {
      setRoomConfigs(buildEntries());
    });
    return () => unsubscribe();
  }, [buildEntries]);

  // Subscribe to room_tts_state events for pending provider tracking
  useEffect(() => {
    // __socket is set on window by useSocket hook for cross-component access.
    // In a larger app this would use React Context or Zustand.
    // For this app's scale, window.__socket is acceptable.
    // See useSocket.ts — it must set: (window as any).__socket = socket
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
        currentProvider: string;
        pendingProvider: string | null;
        isSpeaking: boolean;
      };
      setRoomConfigs((prev) =>
        prev.map((room) =>
          room.roomId === p.roomId
            ? {
                ...room,
                pendingProvider: p.pendingProvider as TTSProviderName | null,
              }
            : room,
        ),
      );
    };

    socket.on('room_tts_state', handler);
    return () => socket.off('room_tts_state', handler);
  }, []);

  const setProvider = useCallback(
    (roomId: string, provider: TTSProviderName) => {
      const socket = (window as unknown as Record<string, unknown>).__socket as
        | { emit: (e: string, d: unknown) => void }
        | undefined;
      if (socket) {
        socket.emit('tts_config_change', { roomId, provider });
      } else {
        console.warn(
          '[useTTSRoomConfig] No socket available for config change',
        );
      }
    },
    [],
  );

  const setAllRooms = useCallback(
    (provider: TTSProviderName) => {
      roomIds.forEach((roomId) => setProvider(roomId, provider));
    },
    [roomIds, setProvider],
  );

  return {
    rooms: roomConfigs,
    setProvider,
    setAllRooms,
    refetchRooms: fetchRoomIds,
  };
}
