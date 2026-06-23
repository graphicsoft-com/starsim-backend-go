import { useState, useEffect, useCallback, useRef } from 'react';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface SessionSchedule {
  startHour: number;
  startMinute: number;
  durationMinutes: number;
}

// 12 hourly sessions, 8 AM – 7 PM, each 5 minutes
const DEFAULT_SCHEDULE: SessionSchedule[] = Array.from({ length: 12 }, (_, i) => ({
  startHour: 8 + i,
  startMinute: 0,
  durationMinutes: 5,
}));

interface ScheduleInfo {
  sessions: SessionSchedule[];
  timezone: string;
  isRunning: boolean;
}

function fmt12(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function toTimeInput(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function fromTimeInput(value: string): {
  startHour: number;
  startMinute: number;
} {
  const [h, m] = value.split(':').map(Number);
  return { startHour: h ?? 0, startMinute: m ?? 0 };
}

function stopTime(s: SessionSchedule): { hour: number; minute: number } {
  const total = s.startHour * 60 + s.startMinute + s.durationMinutes;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

function tzLabel(tz: string): string {
  if (tz === 'America/Denver') return 'MT';
  if (tz === 'America/Chicago') return 'CT';
  if (tz === 'America/New_York') return 'ET';
  if (tz === 'America/Los_Angeles') return 'PT';
  return tz;
}

interface Props {
  onClose: () => void;
}

export default function SchedulePanel({ onClose }: Props) {
  const [info, setInfo] = useState<ScheduleInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SessionSchedule[]>([]);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/schedule`);
      if (!res.ok) throw new Error('Failed to load schedule');
      const data: ScheduleInfo = await res.json();
      setInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void fetchSchedule();
  }, [fetchSchedule]);

  const handleEdit = () => {
    if (!info) return;
    setDraft(info.sessions.map((s) => ({ ...s })));
    setError(null);
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setInfo(data.schedule as ScheduleInfo);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateDraftTime = (index: number, timeValue: string) => {
    const { startHour, startMinute } = fromTimeInput(timeValue);
    setDraft((prev) =>
      prev.map((s, i) => (i === index ? { ...s, startHour, startMinute } : s)),
    );
  };

  const updateDraftDuration = (index: number, value: number) => {
    setDraft((prev) =>
      prev.map((s, i) =>
        i === index
          ? { ...s, durationMinutes: Math.max(1, Math.min(120, value)) }
          : s,
      ),
    );
  };

  const addSession = () => {
    setDraft((prev) => [
      ...prev,
      { startHour: 12, startMinute: 0, durationMinutes: 15 },
    ]);
  };

  const removeSession = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/schedule/toggle`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Toggle failed');
      setInfo(data.schedule as ScheduleInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-bg-section border-l border-border shadow-xl z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <h2 className="text-text-primary font-semibold text-lg">
              GREX Schedule
            </h2>
            {info && (
              <span className="text-xs text-text-muted bg-bg-page border border-border rounded-full px-2 py-0.5">
                {tzLabel(info.timezone)}
              </span>
            )}
            {info && (
              <button
                onClick={handleToggle}
                disabled={toggling}
                title={info.isRunning ? 'Disable schedule' : 'Enable schedule'}
                className="flex items-center gap-2 group disabled:opacity-50"
              >
                {/* track */}
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
                    info.isRunning ? 'bg-status-green' : 'bg-text-muted/40'
                  }`}
                >
                  {/* thumb */}
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
                      info.isRunning ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </span>
                <span className={`text-xs font-medium ${info.isRunning ? 'text-status-green' : 'text-text-muted'}`}>
                  {toggling ? '…' : info.isRunning ? 'Enabled' : 'Disabled'}
                </span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {!info && !error && (
            <div className="text-sm text-text-muted">Loading schedule…</div>
          )}

          {error && (
            <div className="mb-3 bg-status-red/10 text-status-red px-3 py-2 rounded-lg text-xs">
              {error}
            </div>
          )}

          {/* Edit button */}
          {!editing && info && (
            <div className="flex justify-end mb-4">
              <button
                onClick={handleEdit}
                className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors font-medium"
              >
                Edit Schedule
              </button>
            </div>
          )}

          {/* Read-only view */}
          {!editing && info && (
            <div className="flex flex-col gap-2">
              {info.sessions.map((s, i) => {
                const stop = stopTime(s);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 justify-evenly bg-bg-page border border-border rounded-lg px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-primary tabular-nums">
                      {fmt12(s.startHour, s.startMinute)}
                    </span>
                    <span className="text-xs text-text-muted">→</span>
                    <span className="text-xs text-text-primary tabular-nums">
                      {fmt12(stop.hour, stop.minute)}
                    </span>
                    <span className="text-xs text-text-muted">
                      ({s.durationMinutes}m)
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Edit view */}
          {editing && (
            <div className="space-y-2">
              {draft.map((s, i) => {
                const stop = stopTime(s);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 bg-bg-page border border-border rounded-lg px-3 py-2.5"
                  >
                    <span className="text-xs text-text-muted w-5 text-right shrink-0">
                      {i + 1}.
                    </span>
                    <input
                      type="time"
                      value={toTimeInput(s.startHour, s.startMinute)}
                      onChange={(e) => updateDraftTime(i, e.target.value)}
                      className="text-xs bg-transparent border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-xs text-text-muted shrink-0">
                      for
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={s.durationMinutes}
                      onChange={(e) =>
                        updateDraftDuration(i, parseInt(e.target.value, 10))
                      }
                      className="w-16 text-xs bg-transparent border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary text-center"
                    />
                    <span className="text-xs text-text-muted shrink-0">
                      min
                    </span>
                    <span className="text-xs text-text-muted shrink-0">
                      → ends {fmt12(stop.hour, stop.minute)}
                    </span>
                    <button
                      onClick={() => removeSession(i)}
                      disabled={draft.length <= 1}
                      className="ml-auto text-xs text-status-red hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1"
                      title="Remove session"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}

              <div className="flex gap-2">
                <button
                  onClick={addSession}
                  disabled={draft.length >= 24}
                  className="flex-1 text-xs text-text-muted hover:text-text-primary border border-dashed border-border hover:border-text-muted rounded-lg py-2 transition-colors disabled:opacity-30"
                >
                  + Add session
                </button>
                <button
                  onClick={() => setDraft(DEFAULT_SCHEDULE.map((s) => ({ ...s })))}
                  className="text-xs text-text-muted hover:text-text-primary border border-dashed border-border hover:border-text-muted rounded-lg px-3 py-2 transition-colors"
                  title="12 sessions · 8 AM–7 PM · 5 min each"
                >
                  Use default
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleCancel}
                  className="text-xs px-4 py-1.5 rounded-lg border border-border text-text-muted hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || draft.length === 0}
                  className="text-xs px-4 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {saving ? 'Saving…' : 'Save Schedule'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
