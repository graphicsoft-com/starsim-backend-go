import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useSocket } from '../hooks/useSocket';
import { useRoomStatus } from '../hooks/useRoomStatus';
import {
  TENANT_NAMES,
  CLINICIAN_ASSIGNMENTS,
  CLINICIAN_NAMES,
  type ParticipantRole,
} from '@org/shared-types';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

type RoleConnection = Partial<Record<ParticipantRole, { connected: boolean }>>;

function formatElapsedTime(startTime: string | null, now: number): string {
  if (!startTime) return '00h 00m';

  const elapsedMs = Math.max(0, now - new Date(startTime).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

export default function RoomDetail() {
  const { id: roomId = 'room1' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { rooms } = useRoomStatus();
  const room = rooms.find((r) => r.roomId === roomId);
  const isActive = room?.status === 'active';

  // Dashboard socket feed is read-only for monitoring room transcript
  const { messages, connected } = useSocket({
    roomId: 'dashboard',
    audioEnabled: false,
    dashboard: true,
  });

  const [roleConnections, setRoleConnections] = useState<RoleConnection>({});
  const [now, setNow] = useState(() => Date.now());
  const roomMessages = useMemo(
    () => messages.filter((m) => m.roomId === roomId),
    [messages, roomId],
  );
  const latestMessage =
    roomMessages.length > 0 ? roomMessages[roomMessages.length - 1] : null;
  const elapsedTime = useMemo(
    () => formatElapsedTime(room?.startTime ?? null, now),
    [room?.startTime, now],
  );

  const clinicianConnected = !!roleConnections.clinician?.connected;
  const patientConnected = !!roleConnections.patient?.connected;

  const clinicianName =
    CLINICIAN_NAMES[CLINICIAN_ASSIGNMENTS[roomId] ?? ''] ?? 'clinician';
  const patientName = TENANT_NAMES[roomId] ?? 'Patient';

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      socket.emit('join_dashboard');
    });

    socket.on(
      'oid_status_update',
      (data: { roomId: string; participants: RoleConnection }) => {
        if (data.roomId === roomId) {
          setRoleConnections(data.participants ?? {});
        }
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 pt-20 pb-8 min-h-screen">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="text-muted hover:text-text text-xs tracking-widest transition-colors"
        >
          {'<- BACK'}
        </button>
        <div className="w-px h-4 bg-border" />
        <div>
          <div className="font-display text-xl text-white tracking-wide">
            {roomId}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-lg border border-border bg-surface p-5">
          <div className="text-[10px] text-muted tracking-widest uppercase mb-3">
            Room Brief
          </div>
          <h2 className="text-lg text-white font-display mb-3">
            Daily Wellness Check Simulation
          </h2>
          <p className="text-sm text-text/90 leading-relaxed mb-4">
            This room runs an autonomous clinician-tenant conversation. The
            clinician performs a routine check-in and the tenant responds
            naturally based on their profile.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-border bg-background/40 p-3">
              <div className="text-[10px] text-muted tracking-widest uppercase mb-1">
                Clinician
              </div>
              <div className="text-cyan">{clinicianName}</div>
            </div>
            <div className="rounded border border-border bg-background/40 p-3">
              <div className="text-[10px] text-muted tracking-widest uppercase mb-1">
                Tenant
              </div>
              <div className="text-green">{patientName}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="text-[10px] text-muted tracking-widest uppercase mb-3">
            Machine Join
          </div>
          <div className="flex flex-col gap-2 mb-4">
            <a
              href={`/oid?room=${roomId}&role=caregiver`}
              target="_blank"
              rel="noreferrer"
              className="text-center px-3 py-2 rounded border border-cyan/40 bg-cyan/5 text-cyan text-xs font-600 tracking-widest uppercase hover:bg-cyan/10"
            >
              Join As Caregiver
            </a>
            <a
              href={`/oid?room=${roomId}&role=patient`}
              target="_blank"
              rel="noreferrer"
              className="text-center px-3 py-2 rounded border border-green/40 bg-green/5 text-green text-xs font-600 tracking-widest uppercase hover:bg-green/10"
            >
              Join As Tenant
            </a>
          </div>
          <div className="text-[10px] text-muted tracking-widest uppercase mb-2">
            Connection Status
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Clinician machine</span>
              <span
                className={clinicianConnected ? 'text-green' : 'text-muted'}
              >
                {clinicianConnected ? 'CONNECTED' : 'NOT CONNECTED'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Tenant machine</span>
              <span className={patientConnected ? 'text-green' : 'text-muted'}>
                {patientConnected ? 'CONNECTED' : 'NOT CONNECTED'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
              <span className="text-muted">Socket</span>
              <span className={connected ? 'text-green' : 'text-red'}>
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 mb-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <div className="text-[10px] text-muted tracking-widest uppercase mb-1">
              Session Status
            </div>
            <div className="text-sm text-text">
              {isActive
                ? 'The conversation is currently running between the clinician and tenant machines.'
                : 'Start the session from the clinician OID page after both machines join.'}
            </div>
          </div>
          <div className="min-w-[220px] rounded border border-border bg-background/40 px-4 py-3 text-right">
            <div className="text-[10px] text-muted tracking-widest uppercase mb-1">
              Runtime
            </div>
            <div
              className={
                isActive
                  ? 'text-green text-base font-600'
                  : 'text-muted text-base font-600'
              }
            >
              {isActive ? elapsedTime : 'Not Running'}
            </div>
            <div className="text-[11px] text-muted mt-1">
              {isActive
                ? 'Hours and minutes since session start'
                : 'Waiting for clinician start'}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="text-[10px] text-muted tracking-widest uppercase mb-3">
          Ongoing Conversation Brief
        </div>

        {latestMessage ? (
          <div className="rounded border border-border bg-background/40 p-4">
            <div className="flex items-center gap-2 mb-2 text-[10px] tracking-widest uppercase">
              <span
                className={
                  latestMessage.role === 'clinician'
                    ? 'text-cyan'
                    : 'text-green'
                }
              >
                {latestMessage.role === 'clinician' ? 'Clinician' : 'Patient'}
              </span>
              <span className="text-muted">
                {new Date(latestMessage.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-sm text-text leading-relaxed">
              {latestMessage.text}
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted">
            No conversation yet. Join both roles and start the session.
          </div>
        )}
      </div>
    </div>
  );
}
