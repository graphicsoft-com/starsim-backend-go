import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import EncounterDetailPanel from '../components/EncounterDetailPanel';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface ResidentProfile {
  _id: string;
  name: string;
  gender: 'male' | 'female';
  age: number;
  primaryDiagnosis: string;
  allergies: string;
  codeStatus: string;
  currentMedications: string;
  baselineSummary: string;
  admissionDate: string;
  patientUuid: string;
}

interface SimulationDay {
  _id: string;
  dayIndex: number;
  simulatedDate: string;
  runDate: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  noteSequence: string[];
  completedNotes: string[];
  triggeredNotes: string[];
  summary: string;
}

interface Encounter {
  _id: string;
  sequenceIndex: number;
  noteType: string;
  status: string;
  roomId: string;
  formId: number;
  neboStatus: string;
}

interface ScheduleSlot {
  slotIndex: number;
  scheduledTime: string;
  noteType: string;
  status: 'completed' | 'running' | 'upcoming' | 'no-note';
  encounterId?: string;
  completedAt?: string;
}

interface TodaySchedule {
  today: string;
  dayIndex: number;
  noteSequence: string[];
  slots: ScheduleSlot[];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const ampm = (h ?? 0) < 12 ? 'AM' : 'PM';
  const h12 = (h ?? 0) % 12 || 12;
  return `${h12}:${String(m ?? 0).padStart(2, '0')} ${ampm}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-status-green/10 text-status-green border-status-green/20',
    running: 'bg-status-yellow/10 text-status-yellow border-status-yellow/20',
    failed: 'bg-status-red/10 text-status-red border-status-red/20',
    pending: 'bg-bg-page text-text-muted border-border',
  };
  const cls = styles[status] ?? styles['pending'];
  return (
    <span
      className={`text-xs border font-medium px-2 py-0.5 rounded-full capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

// ── Today's Schedule ──────────────────────────────────────────────────────────

function SlotStatusIcon({ status }: { status: ScheduleSlot['status'] }) {
  if (status === 'completed') {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-status-green/15 text-status-green text-sm shrink-0">
        ✓
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-status-yellow/15 shrink-0">
        <span className="w-3 h-3 border-2 border-status-yellow border-t-transparent rounded-full animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-bg-page border border-border text-text-muted text-xs shrink-0">
      ·
    </span>
  );
}

function TodayScheduleSection({
  residentId,
  onEncounterClick,
}: {
  residentId: string;
  onEncounterClick: (id: string) => void;
}) {
  const [schedule, setSchedule] = useState<TodaySchedule | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSchedule = useCallback(() => {
    fetch(`${SERVER_URL}/api/residents/${residentId}/today-schedule`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setSchedule(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [residentId]);

  useEffect(() => {
    fetchSchedule();
    // Refresh every 30 seconds to pick up running → completed transitions
    const interval = setInterval(fetchSchedule, 30_000);
    return () => clearInterval(interval);
  }, [fetchSchedule]);

  if (loading) {
    return (
      <div className="bg-bg-section border border-border rounded-xl p-5">
        <p className="text-sm text-text-muted">Loading today's schedule...</p>
      </div>
    );
  }

  if (!schedule) return null;

  const hasAnyActivity = schedule.slots.some(
    (s) => s.status === 'completed' || s.status === 'running',
  );

  return (
    <div className="bg-bg-section border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">
            Today —{' '}
            {new Date(schedule.today + 'T12:00:00').toLocaleDateString(
              'en-US',
              { month: 'short', day: 'numeric', year: 'numeric' },
            )}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Day {schedule.dayIndex} of care
          </p>
        </div>
        {hasAnyActivity && (
          <span className="text-xs text-status-green bg-status-green/10 border border-status-green/20 px-2.5 py-1 rounded-full font-medium">
            Schedule active
          </span>
        )}
        {!hasAnyActivity && (
          <span className="text-xs text-text-muted bg-bg-page border border-border px-2.5 py-1 rounded-full">
            Waiting for first slot
          </span>
        )}
      </div>

      {/* Slot rows */}
      <div className="divide-y divide-border">
        {schedule.slots.map((slot) => {
          const isClickable = slot.status === 'completed' && slot.encounterId;
          return (
            <div
              key={slot.slotIndex}
              onClick={() => isClickable && onEncounterClick(slot.encounterId!)}
              className={`flex items-center gap-4 px-5 py-3.5 transition-colors ${
                isClickable
                  ? 'cursor-pointer hover:bg-primary/5 hover:border-primary/20'
                  : ''
              } ${slot.status === 'upcoming' || slot.status === 'no-note' ? 'opacity-50' : ''}`}
            >
              <SlotStatusIcon status={slot.status} />

              {/* Time */}
              <span className="text-xs font-mono text-text-muted w-16 shrink-0">
                {formatTime(slot.scheduledTime)}
              </span>

              {/* Note type */}
              <span
                className={`flex-1 text-sm font-medium ${slot.status === 'no-note' ? 'text-text-muted italic' : 'text-text-primary'}`}
              >
                {slot.noteType}
              </span>

              {/* Status label */}
              {slot.status === 'completed' && (
                <span className="text-xs text-status-green font-medium">
                  Completed
                </span>
              )}
              {slot.status === 'running' && (
                <span className="text-xs text-status-yellow font-medium">
                  Running now
                </span>
              )}
              {slot.status === 'upcoming' && (
                <span className="text-xs text-text-muted">Upcoming</span>
              )}
              {slot.status === 'no-note' && (
                <span className="text-xs text-text-muted">No note</span>
              )}

              {isClickable && (
                <span className="text-xs text-primary font-medium shrink-0">
                  View →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Past Day Row ──────────────────────────────────────────────────────────────

function DayRow({
  day,
  residentId,
  onEncounterClick,
}: {
  day: SimulationDay;
  residentId: string;
  onEncounterClick: (encounterId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [encounters, setEncounters] = useState<Encounter[] | null>(null);
  const [loadingEncounters, setLoadingEncounters] = useState(false);

  const handleToggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && encounters === null) {
        setLoadingEncounters(true);
        fetch(
          `${SERVER_URL}/api/residents/${residentId}/days/${day.dayIndex}/encounters`,
        )
          .then((r) => r.json())
          .then((res) => {
            if (res.success) setEncounters(res.data);
          })
          .catch(() => setEncounters([]))
          .finally(() => setLoadingEncounters(false));
      }
      return next;
    });
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Day header row */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-5 py-4 bg-bg-section hover:bg-bg-page transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <span className="text-text-primary font-bold text-base">
            Day {day.dayIndex}
          </span>
          <span className="text-sm text-text-muted">
            {formatDate(day.simulatedDate)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={day.status} />
          <span className="text-xs text-text-muted">
            {day.completedNotes.length}/{day.noteSequence.length} notes
          </span>
          <span className="text-text-muted text-sm">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-5 py-4 bg-bg-page space-y-4">
          {day.summary && (
            <p className="text-sm text-text-secondary">{day.summary}</p>
          )}

          {loadingEncounters && (
            <p className="text-sm text-text-muted py-2">Loading notes...</p>
          )}

          {encounters && encounters.length === 0 && (
            <p className="text-sm text-text-muted py-2">
              No encounters recorded.
            </p>
          )}

          {encounters && encounters.length > 0 && (
            <div className="space-y-2">
              {encounters.map((enc) => (
                <button
                  key={enc._id}
                  onClick={() => onEncounterClick(enc._id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-bg-section border border-border rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
                >
                  <span className="text-xs font-medium text-text-muted w-5 shrink-0">
                    {enc.sequenceIndex + 1}.
                  </span>
                  <span className="flex-1 text-sm font-medium text-text-primary">
                    {enc.noteType}
                  </span>
                  <span className="text-xs text-text-muted">{enc.roomId}</span>
                  <StatusBadge status={enc.status} />
                </button>
              ))}
            </div>
          )}

          {day.triggeredNotes.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              <span className="text-xs text-text-muted">Triggered:</span>
              {day.triggeredNotes.map((n, i) => (
                <span
                  key={`${n}-${i}`}
                  className="text-xs bg-status-yellow/10 text-status-yellow border border-status-yellow/20 px-2 py-0.5 rounded-full"
                >
                  {n}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ResidentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [resident, setResident] = useState<ResidentProfile | null>(null);
  const [days, setDays] = useState<SimulationDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | null>(
    null,
  );
  const [medsExpanded, setMedsExpanded] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    Promise.all([
      fetch(`${SERVER_URL}/api/residents/${id}`).then((r) => r.json()),
      fetch(`${SERVER_URL}/api/residents/${id}/days`).then((r) => r.json()),
    ])
      .then(([residentRes, daysRes]) => {
        if (residentRes.success) setResident(residentRes.data);
        else setError(residentRes.error ?? 'Failed to load resident');
        if (daysRes.success) setDays(daysRes.data);
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-page pt-20 flex items-center justify-center text-text-muted text-sm">
        Loading resident profile...
      </div>
    );
  }

  if (error || !resident) {
    return (
      <div className="min-h-screen bg-bg-page pt-20 flex items-center justify-center">
        <div className="bg-status-red/10 text-status-red rounded-lg px-5 py-4 text-sm">
          {error ?? 'Resident not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-page pt-20 pb-12">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        {/* SECTION 1 — Profile panel */}
        <div className="bg-bg-section border border-border rounded-xl p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-text-primary mb-3">
            {resident.name}
          </h1>

          {/* Info chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-xs bg-primary/10 text-primary font-medium px-3 py-1 rounded-full">
              {resident.age}y
            </span>
            <span className="text-xs bg-bg-page border border-border text-text-muted px-3 py-1 rounded-full capitalize">
              {resident.gender}
            </span>
            {resident.primaryDiagnosis && (
              <span className="text-xs bg-bg-page border border-border text-text-secondary px-3 py-1 rounded-full">
                {resident.primaryDiagnosis}
              </span>
            )}
            {resident.allergies && (
              <span className="text-xs bg-status-red/10 text-status-red border border-status-red/20 px-3 py-1 rounded-full">
                Allergies: {resident.allergies}
              </span>
            )}
            {resident.codeStatus && (
              <span className="text-xs bg-status-yellow/10 text-status-yellow border border-status-yellow/20 px-3 py-1 rounded-full">
                {resident.codeStatus}
              </span>
            )}
          </div>

          {resident.admissionDate && (
            <p className="text-xs text-text-muted mb-3">
              Admission: {formatDate(resident.admissionDate)}
            </p>
          )}

          {resident.currentMedications && (
            <div>
              <button
                onClick={() => setMedsExpanded((p) => !p)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {medsExpanded ? '▲ Hide' : '▼ Show'} medications
              </button>
              {medsExpanded && (
                <p className="text-sm text-text-secondary mt-2 bg-bg-page border border-border rounded-lg px-4 py-3">
                  {resident.currentMedications}
                </p>
              )}
            </div>
          )}
        </div>

        {/* SECTION 2 — Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* Left — Clinical History */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              Resident History
            </h2>
            {days.length > 0 ? (
              <div className="space-y-3">
                {days
                  .slice()
                  .reverse()
                  .map((day) => (
                    <DayRow
                      key={day._id}
                      day={day}
                      residentId={resident._id}
                      onEncounterClick={setSelectedEncounterId}
                    />
                  ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 border border-border rounded-xl bg-bg-section text-text-muted text-sm">
                No clinical records yet. Encounters will appear here after each
                scheduled session completes.
              </div>
            )}
          </div>

          {/* Right — Today's schedule */}
          <div className="lg:sticky lg:top-24">
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              Today's Schedule
            </h2>
            <TodayScheduleSection
              residentId={resident._id}
              onEncounterClick={setSelectedEncounterId}
            />
          </div>
        </div>
      </div>

      {/* Encounter detail panel */}
      <EncounterDetailPanel
        encounterId={selectedEncounterId}
        residentId={resident._id}
        onClose={() => setSelectedEncounterId(null)}
      />
    </div>
  );
}
