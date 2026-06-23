import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  PARTICIPANT_ROLES,
  type ParticipantRole,
  type SpeakNowPayload,
  type TTSDonePayload,
  type SpeakerGender,
} from '@org/shared-types';
import { useRoomStatus } from '../hooks/useRoomStatus';
import { getRoomTTS } from '../services/tts/RoomTTS';
import { ClientTTSConfigStore } from '../services/tts/TTSConfigStore';
import type { TTSSpeakOptions } from '../services/tts/ITTSProvider';
import WebSpeechProvider from '../services/tts/providers/WebSpeechProvider';
import { VitsProvider } from '../services/tts/providers/VitsProvider';
import { PiperServerProvider } from '../services/tts/providers/PiperServerProvider';
import { SessionAudioRecorder } from '../services/tts/SessionAudioRecorder';
import { uploadExistingAudioFile } from '../services/audioUploadService';
import EHRLayout, { type ChatMessage } from '../components/oid/EHRLayout';
import {
  buildTenantProfile,
  getFallbackTenantProfile,
} from '../components/oid/mockData';
import type { SessionRecord } from '../components/oid/types';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface RoomConfigData {
  roomId: string;
  caregiverName: string;
  caregiverGender: 'male' | 'female';
  caregiverProfile: string;
  patientName: string;
  patientGender: 'male' | 'female';
  patientAge: number;
  patientProfile: string;
}

function isParticipantRole(value: string | null): value is ParticipantRole {
  return value !== null && PARTICIPANT_ROLES.includes(value as ParticipantRole);
}

type OidStatus = 'IDLE' | 'SPEAKING' | 'WAITING';
type RoleConnection = Partial<Record<ParticipantRole, { connected: boolean }>>;

// ── Main Component ─────────────────────────────────────────────────────────

export default function OidPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const roomId = params.get('room') ?? '';
  const urlRoleParam = params.get('role');
  const urlRole = isParticipantRole(urlRoleParam) ? urlRoleParam : null;
  const { rooms, startRoom, stopRoom } = useRoomStatus();

  const [selectedRole, setSelectedRole] = useState<ParticipantRole | null>(
    urlRole,
  );
  const socketRef = useRef<Socket | null>(null);
  const [_connected, setConnected] = useState(false);
  const [_status, setStatus] = useState<OidStatus>('IDLE');
  const [_currentText, setCurrentText] = useState('');
  const [roleConnections, setRoleConnections] = useState<RoleConnection>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatIdRef = useRef(0);
  // All roles require an explicit Start/Join click to unlock audio on this machine.
  // This satisfies the browser autoplay policy and lets each OID opt in independently.
  const [sessionUnlocked, setSessionUnlocked] = useState(false);
  const sessionUnlockedRef = useRef(sessionUnlocked);
  const [previewMode, setPreviewMode] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [voiceReady, setVoiceReady] = useState(false);
  const voiceReadyRef = useRef(false);
  const vitsRef = useRef<VitsProvider>(new VitsProvider());
  const [recordedTurns, setRecordedTurns] = useState(0);
  const [isDownloadingAudio, setIsDownloadingAudio] = useState(false);
  const [audioUploadStatus, setAudioUploadStatus] = useState<
    'idle' | 'uploading' | 'done' | 'error'
  >('idle');
  // Tracks the active sessionId so the upload call includes it
  const currentSessionIdRef = useRef<string>('');
  // Guard: prevent uploading the same session twice (exit + room_update both fire)
  const audioUploadedRef = useRef(false);
  // Stores a speak_now payload that arrived before the voice model was ready.
  // Flushed as soon as voiceReady becomes true.
  const pendingSpeakRef = useRef<TTSSpeakOptions | null>(null);

  const role = selectedRole;
  const room = rooms.find((entry) => entry.roomId === roomId);
  const isSessionActive = room?.status === 'active';
  const sessionStartTime = room?.startTime ?? null;
  const patientConnected = !!roleConnections.patient?.connected;

  // ── Fetch room config from DB ────────────────────────────────────────
  const [roomConfig, setRoomConfig] = useState<RoomConfigData | null>(null);

  useEffect(() => {
    if (!roomId) return;
    fetch(`${SERVER_URL}/api/room-config/${roomId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data) setRoomConfig(res.data);
      })
      .catch(() => {
        // Non-critical — falls back to generic defaults
      });
  }, [roomId]);

  // ── Fetch real sessions from DB ──────────────────────────────────────
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    if (!roomId) return;
    fetch(`${SERVER_URL}/api/transcripts/${roomId}?limit=20`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data?.sessions) {
          setSessions(
            res.data.sessions.map(
              (s: {
                _id: string;
                sessionId?: string;
                startTime: string;
                endTime?: string;
                status: string;
              }) => {
                const start = new Date(s.startTime);
                const end = s.endTime ? new Date(s.endTime) : null;
                const durationMs = end ? end.getTime() - start.getTime() : null;
                const duration = durationMs
                  ? `${Math.round(durationMs / 60000)} min`
                  : '—';
                return {
                  id: s._id,
                  date: start.toLocaleString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  }),
                  duration,
                  status:
                    s.status === 'active'
                      ? 'In Progress'
                      : s.status === 'stopped'
                        ? 'Completed'
                        : 'Failed',
                  startTime: s.startTime,
                  endTime: s.endTime,
                  roomId: roomId,
                  sessionId: s.sessionId,
                } satisfies SessionRecord;
              },
            ),
          );
        }
      })
      .catch(() => {
        // Non-critical — session table will be empty
      });
  }, [roomId]);

  // Derive tenant profile from DB config, with clinical defaults as fallback
  const clinicianName = roomConfig?.caregiverName ?? 'Unknown';
  const tenant = roomConfig
    ? buildTenantProfile(roomId, roomConfig)
    : getFallbackTenantProfile(roomId);

  const speakerName =
    role === 'clinician' ? clinicianName : role ? tenant.name : '';

  const stopCurrentPlayback = useCallback(() => {
    if (roomId) {
      getRoomTTS(roomId).stop();
    }
  }, [roomId]);

  /**
   * Upload each turn as its own WAV to MinIO — both tabs (caregiver + patient)
   * do this independently. The server merges all turns sorted by turn number
   * to produce a single conversation WAV with both voices interleaved.
   */
  const uploadSessionAudio = useCallback(async () => {
    if (audioUploadedRef.current) return;
    const turnCount = SessionAudioRecorder.getTurnCount(roomId);
    if (turnCount === 0) return;

    audioUploadedRef.current = true;
    setAudioUploadStatus('uploading');
    console.log(
      `[OidPage][${roomId}] Uploading ${turnCount} turn(s) — role=${role ?? 'unknown'}`,
    );

    try {
      const turns = await SessionAudioRecorder.buildIndividualWavBlobs(roomId);
      if (!turns || turns.length === 0) {
        setAudioUploadStatus('idle');
        audioUploadedRef.current = false;
        return;
      }

      const sessionId = currentSessionIdRef.current || 'unknown';
      const results = await Promise.allSettled(
        turns.map((t) =>
          uploadExistingAudioFile({
            audioFile: t.wavBlob,
            roomId,
            sessionId,
            role: role ?? 'unknown',
            speakerName: t.speakerName || speakerName || undefined,
            turnNumber: t.turnNumber,
            mimeType: 'audio/wav',
          }),
        ),
      );

      const failed = results.filter(
        (r) =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && !r.value.success),
      );

      if (failed.length > 0) {
        console.error(
          `[OidPage][${roomId}] ${failed.length}/${turns.length} turn(s) failed to upload`,
        );
        socketRef.current?.emit('upload_failed', {
          roomId,
          sessionId,
          role: role ?? 'unknown',
        });
        setAudioUploadStatus('error');
        audioUploadedRef.current = false;
      } else {
        console.log(
          `[OidPage][${roomId}] All ${turns.length} turn(s) uploaded — role=${role ?? 'unknown'}`,
        );
        setAudioUploadStatus('done');
        // Signal the server so it can merge once both tabs are done
        socketRef.current?.emit('turns_uploaded', {
          roomId,
          sessionId,
          role: role ?? 'unknown',
        });
      }
    } catch (err) {
      console.error(`[OidPage][${roomId}] Audio upload error:`, err);
      socketRef.current?.emit('upload_failed', {
        roomId,
        sessionId: currentSessionIdRef.current || 'unknown',
        role: role ?? 'unknown',
      });
      setAudioUploadStatus('error');
      audioUploadedRef.current = false;
    }
  }, [roomId, role, speakerName]);

  useEffect(() => {
    sessionUnlockedRef.current = sessionUnlocked;
  }, [sessionUnlocked]);

  useEffect(() => {
    voiceReadyRef.current = voiceReady;
    // Flush any speak_now that arrived before the voice model finished loading
    if (voiceReady && pendingSpeakRef.current) {
      const opts = pendingSpeakRef.current;
      pendingSpeakRef.current = null;
      console.log(
        `[OidPage][${roomId}] Voice ready — flushing pending speak for turn ${opts.turnNumber}`,
      );
      setStatus('SPEAKING');
      getRoomTTS(roomId)
        .speak(opts)
        .then(() => setStatus('WAITING'));
    }
  }, [voiceReady]);

  // Unlock browser autoplay on first user interaction.
  // Covers the case where the patient tab loads via URL with ?role=patient
  // (skipping the lobby) — without a user gesture, audio.play() is blocked.
  useEffect(() => {
    if (!roomId || !role) return;
    const unlock = () => {
      getRoomTTS(roomId).unlockAudio();
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [roomId, role]);

  // Voice diagnostics — dev only, runs once on mount
  useEffect(() => {
    if (import.meta.env.DEV) {
      new WebSpeechProvider().logVoiceDiagnostics();
    }
  }, []);

  // Preload Piper VITS voice model on role selection (only when vits is active)
  useEffect(() => {
    if (!speakerName || !role || !roomId) return;

    const provider = ClientTTSConfigStore.getInstance().getProvider(roomId);
    if (provider !== 'vits') {
      setVoiceReady(true);
      setDownloadProgress(null);
      return;
    }

    setVoiceReady(false);
    setDownloadProgress(0);
    vitsRef.current
      .preloadVoiceForCharacter(speakerName, undefined, (_voiceId, pct) => {
        setDownloadProgress(pct);
      })
      .then(() => {
        setDownloadProgress(null);
        setVoiceReady(true);
      })
      .catch(() => {
        setDownloadProgress(null);
        setVoiceReady(true);
      });
  }, [speakerName, role, roomId]);

  // Warn on tab close if there are unuploaded turns
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (
        SessionAudioRecorder.getTurnCount(roomId) > 0 &&
        !audioUploadedRef.current
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [roomId]);

  // Reset upload guard when a new session becomes active
  useEffect(() => {
    if (isSessionActive) {
      audioUploadedRef.current = false;
      setAudioUploadStatus('idle');
    }
  }, [isSessionActive]);

  // Notify server when voice model is ready so conversation can begin
  useEffect(() => {
    if (voiceReady && isSessionActive && socketRef.current) {
      socketRef.current.emit('voice_ready', { roomId });
    }
  }, [voiceReady, isSessionActive, roomId]);
  const handleSelectRole = useCallback(
    (r: ParticipantRole) => {
      setSelectedRole(r);
      setPreviewMode(false);
      setParams({ room: roomId, role: r });
      // Pre-warm the audio context on this user gesture so autoplay is ready
      // when the operator clicks Start/Join. Don't set sessionUnlocked yet —
      // that requires an explicit Start or Join click.
      getRoomTTS(roomId).unlockAudio();
    },
    [roomId, setParams],
  );

  const _handleStartSession = useCallback(async () => {
    if (!roomId) return;

    // Unlock browser autoplay policy on this machine
    const roomTTS = getRoomTTS(roomId);
    await roomTTS.unlockAudio();
    setSessionUnlocked(true);
    setStatus('WAITING');
    console.log(`[OidPage][${roomId}] Session unlocked — ready for audio`);

    // If the session is already running, just unlock locally (join the running session)
    if (isSessionActive) return;

    try {
      await startRoom(roomId);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? 'Failed to start session';
      // 409 "already running" is a race condition — another OID started first, that's fine
      if (!msg.includes('already running')) {
        alert(msg);
        setSessionUnlocked(false);
        setStatus('IDLE');
      }
    }
  }, [isSessionActive, roomId, startRoom]);

  const _handlePreviewSession = useCallback(() => {
    setPreviewMode(true);
  }, []);

  const handleExit = useCallback(async () => {
    // Snapshot before stopping — stopCurrentPlayback() resets the recorder
    const turnsToDownload = SessionAudioRecorder.getTurnCount(roomId);
    setRecordedTurns(turnsToDownload);

    // Upload session audio before stopping (which resets the recorder)
    await uploadSessionAudio();

    stopCurrentPlayback();

    if (roomId && isSessionActive) {
      try {
        await stopRoom(roomId);
      } catch {
        // Disconnect handling on the server is the fallback when stop fails.
      }
    }

    socketRef.current?.disconnect();
    setSelectedRole(null);
    setPreviewMode(false);
    setParams({ room: roomId });
  }, [
    isSessionActive,
    roomId,
    setParams,
    stopCurrentPlayback,
    stopRoom,
    uploadSessionAudio,
  ]);

  useEffect(() => {
    if (!roomId || !role) return;

    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    // Subscribe to tts_config_updated so provider changes from
    // TTSControlPanel propagate to this tab's RoomTTS instance.
    ClientTTSConfigStore.getInstance().init(socket);

    // Inject socket into RoomTTS so it can emit tts_done after each turn.
    getRoomTTS(roomId).init(socket);

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('register_oid', { roomId, role });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on(
      'oid_status_update',
      (data: { roomId: string; participants: RoleConnection }) => {
        if (data.roomId === roomId) {
          setRoleConnections(data.participants ?? {});
        }
      },
    );

    // ── Chat transcript: receive ALL messages from both roles ──
    socket.on(
      'chat_message',
      (data: {
        roomId: string;
        role: ParticipantRole;
        text: string;
        speakerName: string;
        timestamp: Date;
      }) => {
        if (data.roomId !== roomId) return;
        setChatMessages((prev) => [
          ...prev,
          {
            id: ++chatIdRef.current,
            role: data.role,
            speakerName:
              data.speakerName ||
              (data.role === 'clinician' ? 'Clinician' : 'Patient'),
            text: data.text,
            timestamp: Date.now(),
          },
        ]);
      },
    );

    socket.on('speak_now', (payload: SpeakNowPayload) => {
      if (payload.roomId !== roomId) return;

      // Track the active sessionId so auto-upload has it
      if (payload.sessionId) currentSessionIdRef.current = payload.sessionId;

      if (payload.role === role) {
        if (!sessionUnlockedRef.current) {
          console.warn(
            `[OidPage][${roomId}] speak_now received but session not unlocked — ` +
              `operator must click Start Session first`,
          );
          // Alert the server about this TTS error

          socket.emit('tts_error', {
            roomId,
            role: payload.role,
            error:
              'speak_now received but session not unlocked — operator must click Start Session first',
          });
          // Still emit tts_done so server does not hang waiting
          const donePayload: TTSDonePayload = {
            roomId,
            turnNumber: payload.turnNumber ?? 0,
            role: payload.role,
          };
          socket.emit('tts_done', donePayload);
          return;
        }

        const speakOptions: TTSSpeakOptions = {
          text: payload.text,
          role: payload.role,
          tone: payload.tone ?? 'neutral',
          roomId: payload.roomId,
          sessionId: payload.sessionId,
          turnNumber: payload.turnNumber ?? 0,
          speakerName: payload.speakerName ?? '',
          speakerGender: payload.speakerGender ?? 'male',
        };

        setCurrentText(payload.text);

        // If the voice model is still loading, store the options and return.
        // The voiceReady useEffect will flush this as soon as the model is ready.
        // This keeps the socket handler synchronous and prevents multiple
        // concurrent speak() calls from stacking up in the queue.
        if (!voiceReadyRef.current) {
          console.log(
            `[OidPage][${roomId}] speak_now received but voice not ready — ` +
              `stored for turn ${speakOptions.turnNumber}`,
          );
          pendingSpeakRef.current = speakOptions;
          return;
        }

        setStatus('SPEAKING');
        getRoomTTS(roomId)
          .speak(speakOptions)
          .then(() => setStatus('WAITING'));
      }
    });

    socket.on(
      'wait_turn',
      (data: { roomId: string; activeRole: ParticipantRole }) => {
        if (data.roomId === roomId) {
          setStatus('WAITING');
        }
      },
    );

    // Server detected that this client is behind (safety timeout fired and the
    // server already advanced). Stop stale playback immediately and re-sync.
    socket.on('catch_up', (data: { roomId: string; currentTurn: number }) => {
      if (data.roomId !== roomId) return;
      console.warn(
        `[OidPage][${roomId}] catch_up received — stopping stale playback, ` +
          `server is at turn ${data.currentTurn}`,
      );
      pendingSpeakRef.current = null;
      getRoomTTS(roomId).stop();
      setStatus('WAITING');
      setCurrentText('');
    });

    socket.on('room_update', (data: { roomId: string; status: string }) => {
      if (data.roomId !== roomId) return;
      if (data.status === 'idle') {
        // Guard: if a turn is currently being played, this idle event is
        // from a previous session that ended server-side. Applying it would
        // interrupt live speech and discard recorded turns.
        if (getRoomTTS(roomId).isProcessing) return;
        // Session ended server-side — must await upload before resetting the
        // recorder (stopCurrentPlayback calls reset, which discards the turns).
        void (async () => {
          await uploadSessionAudio();
          stopCurrentPlayback();
          setStatus('IDLE');
          setCurrentText('');
          if (role === 'clinician') setSessionUnlocked(false);
        })();
      } else if (data.status === 'active') {
        // Session started (by this OID or another) — unlock audio on ALL roles
        // so speak_now events are not silently dropped.
        getRoomTTS(roomId).unlockAudio();
        setSessionUnlocked(true);
      }
    });

    // ── Prefetch: pre-synthesize audio for the NEXT turn in background ──
    socket.on(
      'prefetch_audio',
      (data: {
        roomId: string;
        text: string;
        speakerName: string;
        speakerGender: SpeakerGender;
        turnNumber: number;
      }) => {
        if (data.roomId !== roomId) return;
        const cacheKey = `${data.roomId}:${data.turnNumber}`;
        console.log(
          `[OidPage][${roomId}] prefetch_audio received — turn ${data.turnNumber}, synthesizing...`,
        );
        VitsProvider.preSynthesize(
          data.text,
          data.speakerName,
          data.speakerGender,
          cacheKey,
        );
        PiperServerProvider.preFetch(
          data.text,
          data.speakerName,
          data.speakerGender,
          cacheKey,
          data.roomId,
          data.turnNumber,
        );
      },
    );

    return () => {
      stopCurrentPlayback();
      socket.disconnect();
    };
  }, [roomId, role, stopCurrentPlayback]);

  // ── Missing room guard ───────────────────────────────────────────────────
  if (!roomId) {
    return (
      <div className="h-screen w-screen bg-bg-page flex items-center justify-center text-status-red text-sm font-mono">
        Missing ?room= URL parameter
      </div>
    );
  }

  // ── Always render EHR Layout — role selection is embedded inside ───────

  return (
    <EHRLayout
      tenant={tenant}
      sessions={sessions}
      clinicianName={clinicianName}
      clinicianProfile={roomConfig?.caregiverProfile}
      session={{
        role,
        connected: _connected,
        status: _status,
        currentText: _currentText,
        isSessionActive,
        sessionUnlocked,
        previewMode,
        clinicianConnected: !!roleConnections.clinician?.connected,
        patientConnected,
        voiceReady,
        downloadProgress,
        chatMessages,
        startTime: sessionStartTime,
        recordedTurns,
        audioUploadStatus,
      }}
      actions={{
        onSelectRole: handleSelectRole,
        onStartSession: _handleStartSession,
        onPreviewSession: _handlePreviewSession,
        onExit: handleExit,
        onGoHome: () => navigate('/'),
        onDownloadRecording: async () => {
          if (isDownloadingAudio) return;
          setIsDownloadingAudio(true);
          try {
            await SessionAudioRecorder.download(
              roomId,
              `session-${roomId}-${new Date().toISOString().slice(0, 16).replace('T', '_')}-${role ?? 'unknown'}.wav`,
            );
          } finally {
            setIsDownloadingAudio(false);
          }
        },
      }}
    />
  );
}
