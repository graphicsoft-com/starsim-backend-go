import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { RoomStatus } from '../hooks/useRoomStatus';
import { ClientTTSConfigStore } from '../services/tts/TTSConfigStore';
import { useElapsedTimer } from '../hooks/useElapsedTimer';

interface RoomCardProps {
  room: RoomStatus;
  caregiverConnected?: boolean;
  patientConnected?: boolean;
  selected?: boolean;
  onToggleSelect?: (roomId: string) => void;
  onEditConfig?: (roomId: string) => void;
  onStart?: (roomId: string) => Promise<void>;
  onStop?: (roomId: string) => Promise<void>;
}

const PROVIDER_LABELS: Record<string, string> = {
  xtts: 'XTTS',
  webspeech: 'Web Speech',
};

const AUDIO_SERVER_URL =
  import.meta.env.VITE_AUDIO_SERVER_URL ||
  import.meta.env.VITE_SONO_SERVER_URL ||
  'http://localhost:3003';

const LIVE_LISTEN_FALLBACK_MESSAGE =
  'Having problems listening, Please Make sure Sona is Online and you can listen to it on rhasona.com';

interface LiveStreamInfoResponse {
  error?: string;
  message?: string;
  sensor?: {
    isOnline?: boolean;
  };
  stream?: {
    socket?: {
      url?: string | null;
      path?: string;
    };
    subscription?: {
      subscribeEvent?: string;
      unsubscribeEvent?: string;
      audioEvent?: string;
      subscribedEvent?: string;
      unsubscribedEvent?: string;
    };
    audioFormat?: {
      sampleRate?: number;
    };
  };
}

function getSensorIdFromRoomId(roomId: string): number | null {
  const direct = Number(roomId);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const extracted = roomId.match(/\d+/);
  if (!extracted) {
    return null;
  }
  const parsed = Number(extracted[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function RoomCard({
  room,
  caregiverConnected = false,
  patientConnected = false,
  selected = false,
  onToggleSelect,
  onEditConfig,
  onStart,
  onStop,
}: RoomCardProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<string>(() =>
    ClientTTSConfigStore.getInstance().getProvider(room.roomId),
  );
  const [isListeningLive, setIsListeningLive] = useState(false);
  const [isListenBusy, setIsListenBusy] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  const [isSensorOffline, setIsSensorOffline] = useState(false);
  const isListeningRef = useRef(false);
  const liveSocketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const unsubscribeEventRef = useRef('leave-live');

  useEffect(() => {
    const store = ClientTTSConfigStore.getInstance();
    setTtsProvider(store.getProvider(room.roomId));
    return store.onChange((roomId, provider) => {
      if (roomId === room.roomId) setTtsProvider(provider);
    });
  }, [room.roomId]);

  const isActive = room.status === 'active';
  const elapsed = useElapsedTimer(isActive ? room.startTime : null);
  const liveSensorId = getSensorIdFromRoomId(room.roomId);

  const isConfigured = !!(room.caregiverName && room.patientName);

  async function handleStartAndNavigate() {
    setLoading(true);
    try {
      navigate(`/oid?room=${room.roomId}`);
    } finally {
      setLoading(false);
    }
  }

  function stopLiveListening() {
    const socket = liveSocketRef.current;
    if (socket && liveSensorId != null) {
      socket.emit(unsubscribeEventRef.current, liveSensorId);
      socket.disconnect();
    }
    liveSocketRef.current = null;

    const ctx = audioContextRef.current;
    if (ctx) {
      void ctx.close();
    }
    audioContextRef.current = null;
    nextPlayTimeRef.current = 0;
    isListeningRef.current = false;
    setIsListeningLive(false);
    setIsListenBusy(false);
    setIsSensorOffline(false);
    setListenError(null);
  }

  function playLiveChunk(chunk: unknown) {
    const ctx = audioContextRef.current;
    if (!ctx || !isListeningRef.current) {
      return;
    }

    let arrayBuffer: ArrayBuffer | null = null;

    if (chunk instanceof ArrayBuffer) {
      arrayBuffer = chunk;
    } else if (ArrayBuffer.isView(chunk)) {
      const typed = new Uint8Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength,
      );
      arrayBuffer = new Uint8Array(typed).buffer;
    } else if (
      typeof chunk === 'object' &&
      chunk !== null &&
      'type' in chunk &&
      'data' in chunk &&
      (chunk as { type: string }).type === 'Buffer' &&
      Array.isArray((chunk as { data: unknown[] }).data)
    ) {
      const asUint8 = new Uint8Array((chunk as { data: number[] }).data);
      arrayBuffer = asUint8.buffer;
    }

    if (!arrayBuffer) {
      return;
    }

    const int16 = new Int16Array(arrayBuffer);
    if (int16.length === 0) {
      return;
    }

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i += 1) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now + 0.05) {
      nextPlayTimeRef.current = now + 0.1;
    }
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
  }

  async function startLiveListening() {
    if (isListeningLive || isListenBusy) {
      return;
    }
    if (liveSensorId == null) {
      setListenError('Invalid room id for sensor mapping.');
      return;
    }

    setIsListenBusy(true);
    setIsSensorOffline(false);
    setListenError(null);

    try {
      const response = await fetch(
        `${AUDIO_SERVER_URL}/audio/api/live/${liveSensorId}`,
      );
      const payload = (await response.json()) as LiveStreamInfoResponse;
      if (!response.ok) {
        throw new Error(
          payload.error || payload.message || LIVE_LISTEN_FALLBACK_MESSAGE,
        );
      }
      if (payload.sensor?.isOnline === false) {
        setIsSensorOffline(true);
        setListenError('Sona Offline');
        setIsListenBusy(false);
        return;
      }

      const stream = payload.stream;
      const socketUrl = stream?.socket?.url || AUDIO_SERVER_URL;
      const socketPath = stream?.socket?.path || '/socket.io/';
      const subscribeEvent =
        stream?.subscription?.subscribeEvent || 'join-live';
      unsubscribeEventRef.current =
        stream?.subscription?.unsubscribeEvent || 'leave-live';
      const audioEvent = stream?.subscription?.audioEvent || 'audio-chunk';
      const subscribedEvent =
        stream?.subscription?.subscribedEvent || 'live-subscribed';
      const sampleRate = stream?.audioFormat?.sampleRate || 16000;

      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('Web Audio is not supported in this browser.');
      }
      const context = new AudioContextCtor({ sampleRate });
      if (context.state === 'suspended') {
        await context.resume();
      }

      audioContextRef.current = context;
      nextPlayTimeRef.current = context.currentTime + 0.2;

      const socket = io(socketUrl, {
        transports: ['websocket'],
        path: socketPath,
        reconnectionAttempts: 5,
      });

      liveSocketRef.current = socket;

      socket.on('connect', () => {
        socket.emit(subscribeEvent, liveSensorId);
      });

      socket.on(subscribedEvent, () => {
        isListeningRef.current = true;
        setIsListeningLive(true);
        setIsSensorOffline(false);
        setListenError(null);
        setIsListenBusy(false);
      });

      socket.on('live-error', (err: { error?: string; code?: string }) => {
        const message = err?.error || 'Live audio error';
        setListenError(message);
        setIsSensorOffline(
          err?.code === 'SENSOR_OFFLINE' || message === 'Sona Offline',
        );
        isListeningRef.current = false;
        setIsListeningLive(false);
        setIsListenBusy(false);
        const ctx = audioContextRef.current;
        if (ctx) {
          void ctx.close();
        }
        audioContextRef.current = null;
        nextPlayTimeRef.current = 0;
        socket.disconnect();
        liveSocketRef.current = null;
      });

      socket.on(audioEvent, playLiveChunk);
      socket.on('disconnect', () => {
        isListeningRef.current = false;
        setIsListeningLive(false);
      });
    } catch (error) {
      stopLiveListening();
      const message = error instanceof Error ? error.message : '';
      setListenError(message || LIVE_LISTEN_FALLBACK_MESSAGE);
      setIsListenBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      stopLiveListening();
    };
  }, []);

  return (
    <div
      className={`flex flex-col bg-bg-section rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all duration-200 ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(room.roomId)}
              className="w-4 h-4 accent-primary rounded cursor-pointer"
            />
          )}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-primary capitalize">
                {room.roomName || room.roomId}
              </span>
            </div>
            {room.machineLabel && (
              <span className="text-[11px] text-text-muted ml-4 italic">
                {room.machineLabel}
              </span>
            )}
            {isConfigured && (
              <div className="flex justify-start gap-1 ml-4 mt-1 flex-wrap">
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] bg-bg-page border border-border/50 rounded-md px-1.5 py-0.5"
                  title="Clinician OID"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300 ${
                      caregiverConnected
                        ? 'bg-green-500 animate-pulse2'
                        : 'bg-gray-400'
                    }`}
                  />
                  <span className="text-text-secondary font-medium">
                    {room.caregiverName}
                  </span>
                  {room.caregiverMachine && (
                    <span className="text-text-muted/60 text-[10px] ml-0.5 font-normal">
                      · {room.caregiverMachine}
                    </span>
                  )}
                </span>
                <span className="text-text-muted/40 text-[10px]">·</span>
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] bg-bg-page border border-border/50 rounded-md px-1.5 py-0.5"
                  title="Agent OID"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300 ${
                      patientConnected
                        ? 'bg-green-500 animate-pulse2'
                        : 'bg-gray-400'
                    }`}
                  />

                  <span className="text-text-secondary font-medium">
                    {room.patientName}
                  </span>
                  {room.patientMachine && (
                    <span className="text-text-muted/60 text-[10px] ml-0.5 font-normal">
                      · {room.patientMachine}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col h-full justify-between content-between gap-1">
          <div className="text-right flex flex-col items-end gap-1">
            <div
              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${isActive ? 'text-status-green' : 'text-text-muted'}`}
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-green-500 animate-pulse2' : 'bg-text-muted/40'}`}
              />
              {isActive ? 'Live' : 'Idle'}
            </div>
            {isActive && (
              <div className="text-xs text-text-muted mt-0.5">
                {room.messageCount} msgs
              </div>
            )}
            {isActive && elapsed && (
              <div className="font-mono bg-green-800 text-white px-2 py-0.5 rounded text-xs mt-0.5 inline-block">
                {elapsed}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Not-configured banner */}
      {!isConfigured && (
        <div className="mx-4 mb-2 flex items-center gap-2 bg-status-yellow/10 border border-status-yellow/30 text-status-yellow rounded-lg px-3 py-2 text-xs">
          <span>⚠</span>
          <span>
            Configure a caregiver &amp; tenant before opening.{' '}
            {onEditConfig && (
              <button
                onClick={() => onEditConfig(room.roomId)}
                className="underline font-semibold hover:text-text-primary transition-colors"
              >
                Edit now
              </button>
            )}
          </span>
        </div>
      )}

      {/* CTA */}
      <div className="px-4 pb-4 pt-1 flex gap-2">
        <button
          onClick={handleStartAndNavigate}
          disabled={loading || !isConfigured}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
            isActive
              ? 'bg-primary-light text-primary hover:bg-primary hover:text-white'
              : 'bg-bg-page text-status-green border border-border/50 hover:bg-status-green hover:text-white hover:border-status-green'
          }`}
        >
          {loading ? 'Opening...' : 'Open Room'}
        </button>
        {(onStart || onStop) && (
          <button
            onClick={async () => {
              setSimLoading(true);
              try {
                if (isActive) {
                  await onStop?.(room.roomId);
                } else {
                  await onStart?.(room.roomId);
                }
              } catch (err: unknown) {
                alert(err instanceof Error ? err.message : String(err));
              } finally {
                setSimLoading(false);
              }
            }}
            disabled={simLoading || (!isActive && !isConfigured)}
            className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
              isActive
                ? 'border-status-red text-status-red bg-status-red/10 hover:bg-status-red hover:text-white'
                : 'border-status-green text-status-green bg-status-green/10 hover:bg-status-green hover:text-white'
            }`}
            title={isActive ? 'Stop simulation' : 'Start simulation'}
          >
            {simLoading ? '…' : isActive ? '⏹ Stop' : '▶ Start'}
          </button>
        )}
        <button
          onClick={isListeningLive ? stopLiveListening : startLiveListening}
          disabled={isListenBusy || liveSensorId == null}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isListeningLive
              ? 'border-status-red text-status-red bg-status-red/10 hover:bg-status-red/20'
              : 'border-primary text-primary bg-primary-light hover:bg-primary hover:text-white'
          }`}
          title={
            liveSensorId == null
              ? 'Room id cannot be mapped to a sensor id'
              : `Listen to sensor ${liveSensorId}`
          }
        >
          {isListenBusy
            ? 'Connecting...'
            : isListeningLive
              ? 'Stop Live'
              : isSensorOffline
                ? '⚠️ Sona Offline'
                : `🎧 Listen Live`}
        </button>
        {onEditConfig && (
          <button
            onClick={() => onEditConfig(room.roomId)}
            className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
              !isConfigured
                ? 'border-status-yellow text-status-yellow bg-status-yellow/10 hover:bg-status-yellow/20 animate-pulse'
                : 'border-border text-text-muted hover:bg-bg-page hover:text-text-primary'
            }`}
            title="Edit room configuration"
          >
            Edit
          </button>
        )}
      </div>
      {listenError && !isSensorOffline && (
        <div className="px-4 pb-4 text-[11px] text-status-red">
          {listenError}
        </div>
      )}
    </div>
  );
}
