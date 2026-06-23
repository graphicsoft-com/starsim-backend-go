// ─────────────────────────────────────────────
//  useSocket — connects to server Socket.io
//  Joins a room channel and relays messages.
//  TTS playback is handled by RoomTTS in OidPage.
// ─────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ISocketNewMessage } from '@org/shared-types';
import { ClientTTSConfigStore } from '../services/tts/TTSConfigStore';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

// Re-exported so components can type live messages
export type LiveMessage = ISocketNewMessage;

interface UseSocketOptions {
  roomId: string;
  audioEnabled?: boolean;
  /** When true, joins 'join_dashboard' instead of 'join_room' and accepts messages from ALL rooms */
  dashboard?: boolean;
}

export function useSocket({
  roomId,
  audioEnabled = true,
  dashboard = false,
}: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [messages, setMessages] = useState<ISocketNewMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    // Expose socket globally for cross-component access.
    // Used by useTTSRoomConfig and useTTSChangeLog hooks.
    // In a larger app this would use React Context or Zustand.
    (window as unknown as Record<string, unknown>).__socket = socket;

    // Initialize the client TTS config store with this socket so it can
    // receive 'tts_config_updated' broadcasts and request the initial snapshot.
    ClientTTSConfigStore.getInstance().init(socket);

    // ── Connection events ──────────────────────
    socket.on('connect', () => {
      console.log(`🔌  Socket connected for ${roomId}`);
      if (dashboard) {
        socket.emit('join_dashboard');
      } else {
        socket.emit('join_room', roomId);
      }
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.warn(`⚠️   Socket disconnected for ${roomId}`);
      setConnected(false);
    });

    // ── Room locked by another client ──────────
    socket.on(
      'room_locked',
      ({ message }: { roomId: string; message: string }) => {
        console.warn(`🔒  Room locked: ${message}`);
        setLocked(true);
        setLockMessage(message);
        setConnected(false);
        socket.disconnect();
      },
    );

    // ── Incoming message ───────────────────────
    socket.on('new_message', (data: ISocketNewMessage) => {
      // Dashboard accepts all rooms; dedicated room tab filters to its own roomId
      if (!dashboard && data.roomId !== roomId) return;

      // Keep last 50 messages
      setMessages((prev) => [...prev.slice(-49), data]);
    });

    // ── Room locked by another client ─────────────────
    socket.on(
      'room_locked',
      ({ message }: { roomId: string; message: string }) => {
        console.warn(`🔒  ${message}`);
        setLocked(true);
        setLockMessage(message);
        setConnected(false);
        socket.disconnect();
      },
    );

    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [roomId, dashboard]);

  return {
    messages,
    connected,
    locked,
    lockMessage,
    clearMessages: () => setMessages([]),
  };
}
