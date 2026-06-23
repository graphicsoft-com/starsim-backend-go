import React, { useState } from 'react';
import {
  useTTSProviderHealth,
  type ProviderHealthEntry,
} from '../hooks/useTTSProviderHealth';
import {
  useTTSRoomConfig,
  type RoomConfigEntry,
} from '../hooks/useTTSRoomConfig';
import { useTTSChangeLog, type ChangeLogEntry } from '../hooks/useTTSChangeLog';
import { TTSProviderFactory } from '../services/tts/TTSProviderFactory';
import { ClientTTSConfigStore } from '../services/tts/TTSConfigStore';
import type { TTSProviderName } from '../services/tts/ITTSProvider';

export interface TTSControlPanelProps {
  className?: string;
}

const TTSControlPanel: React.FC<TTSControlPanelProps> = ({ className }) => {
  const { providers, isChecking, lastChecked, refresh } =
    useTTSProviderHealth();
  const { rooms, setProvider, setAllRooms, refetchRooms } = useTTSRoomConfig();
  const { log, clearLog } = useTTSChangeLog();
  const [logExpanded, setLogExpanded] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);

  const registeredNames = TTSProviderFactory.getRegisteredNames();

  // Build a quick lookup: provider name → available
  const availabilityMap = new Map<string, boolean>();
  for (const p of providers) {
    availabilityMap.set(p.name, p.available);
  }

  const configVersion = ClientTTSConfigStore.getInstance().getVersion();

  return (
    <div
      className={`bg-bg-section rounded-xl shadow-sm overflow-hidden ${className ?? ''}`}
    >
      {/* ── Section 1: Header ──────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 cursor-pointer select-none hover:bg-bg-page/50 transition-colors duration-200"
        onClick={() => setPanelExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">
            {panelExpanded ? '▾' : '▸'}
          </span>
          <span className="text-sm font-semibold text-text-primary">
            TTS Provider Control
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            refresh();
            refetchRooms();
          }}
          disabled={isChecking}
          className="text-xs text-text-muted hover:text-primary disabled:opacity-50
                     flex items-center gap-1 transition-colors duration-200 px-3 py-1 rounded-lg hover:bg-primary-light"
        >
          {isChecking ? 'checking...' : 'refresh'}
        </button>
      </div>

      {/* ── Collapsible body ───────────────────────────────────────── */}
      {panelExpanded && (
        <>
          {/* ── Section 2: Provider Health ─────────────────────────────── */}
          <div className="px-5 py-3 border-t border-border/30">
            <div className="text-xs text-text-muted font-medium mb-3">
              Provider Health
            </div>
            {providers.length === 0 ? (
              <div className="text-sm text-text-muted">
                Checking providers...
              </div>
            ) : (
              <div className="flex items-center gap-6 flex-wrap">
                {providers.map((p) => (
                  <ProviderHealthBadge
                    key={p.name}
                    entry={p}
                    isChecking={isChecking}
                  />
                ))}
              </div>
            )}
            {lastChecked && (
              <div className="text-xs text-text-muted mt-2">
                Last checked: {lastChecked.toLocaleTimeString()}
              </div>
            )}
          </div>

          {/* ── Section 3: Room Configuration ──────────────────────────── */}
          <div className="px-5 py-3 border-t border-border/30">
            <div className="text-xs text-text-muted font-medium mb-3">
              Room Configuration
            </div>
            {rooms.length === 0 ? (
              <div className="text-sm text-text-muted">No rooms configured</div>
            ) : (
              <div className="space-y-2">
                {rooms.map((room) => (
                  <RoomRow
                    key={room.roomId}
                    room={room}
                    registeredNames={registeredNames}
                    availabilityMap={availabilityMap}
                    onSetProvider={setProvider}
                  />
                ))}
              </div>
            )}

            {/* Bulk actions */}
            <div className="flex gap-2 mt-4">
              {registeredNames.map((name) => {
                const isDisabledOption = name === 'disabled';
                const canUse = isDisabledOption || (availabilityMap.get(name) ?? false);
                return (
                  <button
                    key={name}
                    onClick={() => setAllRooms(name)}
                    disabled={!canUse}
                    className={`text-sm px-4 py-2 rounded border transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed
                           ${
                             isDisabledOption
                               ? 'bg-status-red/10 hover:bg-status-red/20 border-status-red/40 text-status-red/80 hover:text-status-red'
                               : 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-300'
                           }`}
                  >
                    All → {isDisabledOption ? 'off' : name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Section 4: Change Log ──────────────────────────────────── */}
          <div className="px-5 py-3 border-t border-border/30">
            <button
              onClick={() => setLogExpanded((v) => !v)}
              className="flex items-center gap-2 text-xs text-text-muted
                     font-medium hover:text-text-primary transition-colors duration-200 w-full"
            >
              <span>{logExpanded ? '▾' : '▸'}</span>
              <span>Change Log ({log.length})</span>
            </button>

            {logExpanded && (
              <div className="mt-2">
                {log.length === 0 ? (
                  <div className="text-xs text-text-muted">
                    No changes recorded
                  </div>
                ) : (
                  <div className="space-y-0">
                    {log.slice(0, 10).map((entry, i) => (
                      <LogRow
                        key={`${entry.roomId}-${entry.timestamp.getTime()}-${i}`}
                        entry={entry}
                      />
                    ))}
                  </div>
                )}
                {log.length > 0 && (
                  <button
                    onClick={clearLog}
                    className="text-[10px] text-text-muted hover:text-text-primary
                           mt-2 transition-colors"
                  >
                    Clear Log
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ── Sub-components ──────────────────────────────────────────────────

function ProviderHealthBadge({
  entry,
  isChecking,
}: {
  entry: ProviderHealthEntry;
  isChecking: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={isChecking ? 'animate-pulse' : ''}>
        {entry.available ? '🟢' : '🔴'}
      </span>
      <span className="text-text-primary">{entry.displayName}</span>
      <span className="text-text-muted">
        {entry.latencyMs != null ? `${entry.latencyMs}ms` : '—'}
      </span>
    </div>
  );
}

function RoomRow({
  room,
  registeredNames,
  availabilityMap,
  onSetProvider,
}: {
  room: RoomConfigEntry;
  registeredNames: TTSProviderName[];
  availabilityMap: Map<string, boolean>;
  onSetProvider: (roomId: string, provider: TTSProviderName) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-text-primary w-28 shrink-0 font-medium">
        {room.roomId}
      </span>

      <div className="flex gap-1.5">
        {registeredNames.map((name) => {
          const isActive = room.currentProvider === name;
          const isDisabledOption = name === 'disabled';
          const isAvailable = isDisabledOption || (availabilityMap.get(name) ?? false);
          return (
            <button
              key={name}
              onClick={() => onSetProvider(room.roomId, name)}
              disabled={!isAvailable}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                isActive && isDisabledOption
                  ? 'border-status-red text-status-red bg-status-red/10 shadow-sm'
                  : isActive
                  ? 'border-primary text-primary bg-primary-light shadow-sm'
                  : isDisabledOption
                  ? 'border-status-red/40 text-status-red/70 hover:text-status-red hover:border-status-red/60 hover:bg-status-red/10'
                  : 'border-border/50 text-text-muted hover:text-text-primary hover:border-border hover:bg-bg-page'
              } ${!isAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isDisabledOption ? 'off' : name}
            </button>
          );
        })}
      </div>

      <div className="w-40 text-right text-xs">
        {room.pendingProvider ? (
          <span className="text-status-yellow animate-pulse">
            switching to {room.pendingProvider}...
          </span>
        ) : (
          <span className="text-text-muted">idle</span>
        )}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: ChangeLogEntry }) {
  return (
    <div className="flex gap-3 text-xs text-text-muted font-mono py-1">
      <span className="text-text-muted">
        {entry.timestamp.toLocaleTimeString()}
      </span>
      <span className="text-text-primary w-24">{entry.roomId}</span>
      <span className="text-status-red">{entry.from}</span>
      <span className="text-text-muted">→</span>
      <span className="text-status-green">{entry.to}</span>
      <span className="text-text-muted">({entry.changedBy})</span>
    </div>
  );
}

export default TTSControlPanel;
export type { TTSControlPanelProps as TTSControlPanelPropsExport };
