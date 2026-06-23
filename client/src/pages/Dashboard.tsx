import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from 'react';
import { useRoomStatus } from '../hooks/useRoomStatus';
import { useSocket } from '../hooks/useSocket';
import { Socket } from 'socket.io-client';
import RoomGrid from '../components/RoomGrid';
import { FloorplanIcon, GridIcon } from '../components/ViewIcons';
import TTSControlPanel from '../components/TTSControlPanel';
import RoomConfigEditor from '../components/RoomConfigEditor';
import AdvancedSettings from '../components/AdvancedSettings';
import SchedulePanel from '../components/SchedulePanel';
import { useNextScheduleCountdown } from '../hooks/useNextScheduleCountdown';

const FloorplanView = lazy(() => import('../components/FloorplanView'));

type ViewMode = 'grid' | 'floorplan';

type OidConnections = Record<string, { clinician: boolean; patient: boolean }>;

export default function Dashboard() {
  const { rooms, loading, error, activeCount, startRoom, stopRoom, refetch } = useRoomStatus();
  const { countdown, isRunning: scheduleRunning } = useNextScheduleCountdown();

  // Single shared socket on dashboard mode — receives messages from ALL rooms
  const { connected } = useSocket({
    roomId: 'dashboard',
    audioEnabled: false,
    dashboard: true,
  });

  // OID machine connection tracking
  const [oidConns, setOidConns] = useState<OidConnections>({});
  const [startingAll, setStartingAll] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const socket = (window as unknown as Record<string, unknown>).__socket as
      | Socket
      | undefined;
    if (!socket) return;

    const onConnect = () => socket.emit('get_oid_status');
    const onOidConnected = ({
      roomId,
      role,
    }: {
      roomId: string;
      role: string;
    }) => {
      setOidConns((prev) => ({
        ...prev,
        [roomId]: { ...prev[roomId], [role]: true },
      }));
    };
    const onOidDisconnected = ({
      roomId,
      role,
    }: {
      roomId: string;
      role: string;
    }) =>
      setOidConns((prev) => ({
        ...prev,
        [roomId]: { ...prev[roomId], [role]: false },
      }));
    const onSnapshot = (snapshot: OidConnections) => {
      setOidConns(snapshot);
    };

    socket.emit('get_oid_status');
    console.log(
      '[OID] get_oid_status emitted, socket connected:',
      socket.connected,
    ); // ← add
    socket.on('connect', onConnect);
    socket.on('oid_connected', onOidConnected);
    socket.on('oid_disconnected', onOidDisconnected);
    socket.on('oid_status_snapshot', onSnapshot);

    return () => {
      socket.off('connect', onConnect);
      socket.off('oid_connected', onOidConnected);
      socket.off('oid_disconnected', onOidDisconnected);
      socket.off('oid_status_snapshot', onSnapshot);
    };
  }, [connected]);

  const toggleRoom = useCallback((roomId: string) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedRooms(new Set(rooms.map((r) => r.roomId)));
  }, [rooms]);

  const unselectAll = useCallback(() => {
    setSelectedRooms(new Set());
  }, []);

  const selectedArray = rooms.filter((r) => selectedRooms.has(r.roomId));
  const selectedReady = selectedArray.filter(
    (r) =>
      (oidConns[r.roomId]?.clinician || oidConns[r.roomId]?.clinician) &&
      oidConns[r.roomId]?.patient &&
      r.status !== 'active',
  );
  const selectedActive = selectedArray.filter((r) => r.status === 'active');

  const handleStartSelected = useCallback(async () => {
    if (selectedReady.length === 0) return;
    setStartingAll(true);
    try {
      const results = await Promise.allSettled(
        selectedReady.map((r) =>
          fetch(`/api/simulation/start/${r.roomId}`, { method: 'POST' }).then(
            async (res) => {
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `${r.roomId}: failed to start`);
              }
            },
          ),
        ),
      );
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason?.message ?? 'Unknown error');
      if (errors.length > 0) {
        alert(errors.join('\n'));
      }
    } finally {
      setStartingAll(false);
    }
  }, [selectedReady]);

  const handleStopSelected = useCallback(async () => {
    if (selectedActive.length === 0) return;
    setStoppingAll(true);
    try {
      await Promise.all(
        selectedActive.map((r) =>
          fetch(`/api/simulation/stop/${r.roomId}`, { method: 'POST' }),
        ),
      );
      // After sessions are stopped, register each encounter with Nebo for EHR note generation.
      // Fire-and-forget: failures are logged server-side and do not block the UI.
      void Promise.allSettled(
        selectedActive.map((r) =>
          fetch(`/api/nebo/register/${r.roomId}`, { method: 'POST' }),
        ),
      );
    } finally {
      setStoppingAll(false);
    }
  }, [selectedActive]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-text-muted text-sm">
        Connecting to server...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-status-red text-sm">
        {error} — is the server running?
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pt-16 pb-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-text-primary">
              Sunrise Longterm Care
            </h1>
            {(() => {
              const env = (import.meta.env.VITE_APP_ENV ?? 'unknown').toLowerCase();
              const isLive = env === 'live';
              return (
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                    isLive
                      ? 'bg-red-500/10 text-red-500 border-red-500/30'
                      : 'bg-yellow-400/10 text-yellow-500 border-yellow-400/30'
                  }`}
                >
                  {isLive ? 'Live' : 'Stage'}
                </span>
              );
            })()}
            {(() => {
              const instance = (import.meta.env.VITE_INSTANCE_NAME ?? '').toLowerCase();
              if (!instance) return null;
              const isDemo = instance === 'demo';
              return (
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                    isDemo
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                      : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                  }`}
                >
                  {instance}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Stats bar + Start All */}
        <div className="flex items-center gap-5">
          <div className="bg-bg-section rounded-xl shadow-sm px-4 py-2 text-center">
            <div className="text-lg font-semibold text-primary">
              {activeCount}
            </div>
            <div className="text-xs text-text-muted">Active</div>
          </div>
          <div className="bg-bg-section rounded-xl shadow-sm px-4 py-2 text-center">
            <div className="text-lg font-semibold text-text-primary">
              {rooms.length - activeCount}
            </div>
            <div className="text-xs text-text-muted">Idle</div>
          </div>
          <div className="flex items-center gap-2 bg-bg-section rounded-xl shadow-sm px-4 py-2.5">
            <div
              className={`w-2 h-2 rounded-full transition-colors duration-300 ${connected ? 'bg-status-green animate-pulse2' : 'bg-text-muted'}`}
            />
            <span
              className={`text-xs font-medium ${connected ? 'text-status-green' : 'text-text-muted'}`}
            >
              {connected ? 'Socket Live' : 'Disconnected'}
            </span>
          </div>
          {countdown !== null && (
            <div
              className="bg-bg-section rounded-xl shadow-sm px-4 py-2 text-center cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all"
              title="Time until next scheduled session"
              onClick={() => setShowSchedule(true)}
            >
              <div
                className={`text-lg font-semibold tabular-nums ${
                  scheduleRunning ? 'text-status-green' : 'text-primary'
                }`}
              >
                {countdown}
              </div>
              <div className="text-xs text-text-muted">Next Session</div>
            </div>
          )}
          <div className="relative">
            <div className="flex items-center gap-2">
              <button
                onClick={
                  selectedReady.length > 0
                    ? handleStartSelected
                    : () => {
                        setShowTooltip(true);
                        clearTimeout(tooltipTimer.current);
                        tooltipTimer.current = setTimeout(
                          () => setShowTooltip(false),
                          3000,
                        );
                      }
                }
                disabled={startingAll}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium
                  bg-primary text-white
                  hover:bg-primary-dark
                  transition-colors
                  ${selectedReady.length === 0 && !startingAll ? 'opacity-50 cursor-not-allowed' : ''}
                  ${startingAll ? 'opacity-30 cursor-not-allowed' : ''}
                `}
              >
                {startingAll ? 'Starting…' : `Start (${selectedReady.length})`}
              </button>
              <button
                onClick={handleStopSelected}
                disabled={stoppingAll || selectedActive.length === 0}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium
                  bg-status-red text-white
                  hover:bg-red-700
                  transition-colors
                  ${selectedActive.length === 0 && !stoppingAll ? 'opacity-50 cursor-not-allowed' : ''}
                  ${stoppingAll ? 'opacity-30 cursor-not-allowed' : ''}
                `}
              >
                {stoppingAll ? 'Stopping…' : `Stop (${selectedActive.length})`}
              </button>
            </div>
            {showTooltip && selectedReady.length === 0 && (
              <div className="absolute right-0 bottom-full mb-3 w-60 bg-[#1e293b] text-white rounded-lg shadow-xl px-3 py-2.5 text-xs z-[100] animate-fadein">
                Select rooms with both OIDs connected to start.
                <div className="absolute right-4 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#1e293b]" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selection toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedRooms.size === rooms.length && rooms.length > 0}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    selectedRooms.size > 0 && selectedRooms.size < rooms.length;
              }}
              onChange={() =>
                selectedRooms.size === rooms.length
                  ? unselectAll()
                  : selectAll()
              }
              className="w-4 h-4 accent-primary rounded cursor-pointer"
            />
            {selectedRooms.size === rooms.length
              ? 'Unselect All'
              : 'Select All'}
          </label>
          {selectedRooms.size > 0 && (
            <span className="text-xs text-text-muted">
              {selectedRooms.size} of {rooms.length} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`flex items-center justify-center p-1.5 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-section'
              }`}
            >
              <GridIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('floorplan')}
              title="Floorplan view"
              className={`flex items-center justify-center p-1.5 transition-colors ${
                viewMode === 'floorplan'
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-section'
              }`}
            >
              <FloorplanIcon className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setShowSchedule(true)}
            title="Auto-Schedule"
            className="flex items-center justify-center p-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          <button
            onClick={() => setShowAdvanced(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          >
            <span>⚙</span> GREX Mapper
          </button>
        </div>
      </div>

      {/* Room view — grid or floorplan */}
      {viewMode === 'grid' ? (
        <RoomGrid
          rooms={rooms}
          oidConns={oidConns}
          selectedRooms={selectedRooms}
          onToggleSelect={toggleRoom}
          onEditConfig={setEditingRoomId}
          onStart={startRoom}
          onStop={stopRoom}
        />
      ) : (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[60vh] text-text-muted text-sm">
              Loading floorplan…
            </div>
          }
        >
          <FloorplanView rooms={rooms} />
        </Suspense>
      )}

      {/* TTS Control Panel */}
      <div className="mt-6">
        <TTSControlPanel />
      </div>

      {/* Room Config Editor Drawer */}
      {editingRoomId && (
        <RoomConfigEditor
          roomId={editingRoomId}
          onClose={() => setEditingRoomId(null)}
          onSaved={() => {
            setEditingRoomId(null);
            refetch();
          }}
        />
      )}

      {/* Advanced Settings Drawer */}
      {showAdvanced && (
        <AdvancedSettings
          rooms={rooms}
          onClose={() => setShowAdvanced(false)}
          onChanged={() => refetch()}
        />
      )}

      {/* Schedule Drawer */}
      {showSchedule && <SchedulePanel onClose={() => setShowSchedule(false)} />}
    </div>
  );
}
