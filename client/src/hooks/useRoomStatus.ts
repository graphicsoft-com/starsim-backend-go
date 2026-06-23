import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

export interface RoomStatus {
  roomId: string;
  roomName: string;
  status: 'active' | 'idle';
  activeSessionId: string | null;
  startTime: string | null;
  messageCount: number;
  machineLabel: string;
  caregiverName: string;
  caregiverMachine: string;
  patientName: string;
  patientMachine: string;
}

export function useRoomStatus() {
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(`${SERVER_URL}/api/simulation/status`);
      setRooms(data.data.rooms);
      setError(null);
    } catch {
      setError('Failed to fetch room status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000); // poll every 10s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const startRoom = async (roomId: string) => {
    await axios.post(`${SERVER_URL}/api/simulation/start/${roomId}`);
    await fetchStatus();
  };

  const stopRoom = async (roomId: string) => {
    await axios.post(`${SERVER_URL}/api/simulation/stop/${roomId}`);
    await fetchStatus();
  };

  const activeCount = rooms.filter((r) => r.status === 'active').length;

  const updateRoomConfig = async (
    roomId: string,
    config: { machineLabel?: string },
  ) => {
    await axios.patch(
      `${SERVER_URL}/api/simulation/room-config/${roomId}`,
      config,
    );
    await fetchStatus();
  };

  return {
    rooms,
    loading,
    error,
    startRoom,
    stopRoom,
    activeCount,
    refetch: fetchStatus,
    updateRoomConfig,
  };
}
