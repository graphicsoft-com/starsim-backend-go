import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface ResidentSummary {
  _id: string;
  name: string;
  gender: 'male' | 'female';
  age: number;
  primaryDiagnosis: string;
  admissionDate: string;
  patientUuid: string;
  totalDays: number;
  lastRunDate: string | null;
  lastRunStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const AVATAR_PALETTES = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function ResidentAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const palette = AVATAR_PALETTES[name.charCodeAt(0) % AVATAR_PALETTES.length];
  return (
    <div
      className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${palette}`}
    >
      {initials}
    </div>
  );
}

function StatusPill({ status }: { status: ResidentSummary['lastRunStatus'] }) {
  if (!status) return <span className="text-xs text-text-muted">—</span>;
  const styles: Record<string, string> = {
    completed: 'bg-status-green/10 text-status-green border-status-green/20',
    running: 'bg-status-yellow/10 text-status-yellow border-status-yellow/20',
    failed: 'bg-status-red/10 text-status-red border-status-red/20',
    pending: 'bg-bg-page text-text-muted border-border',
  };
  return (
    <span
      className={`text-xs border font-medium px-2.5 py-0.5 rounded-full capitalize ${styles[status] ?? styles['pending']}`}
    >
      {status}
    </span>
  );
}

function ResidentRow({
  resident,
  onView,
}: {
  resident: ResidentSummary;
  onView: () => void;
}) {
  return (
    <tr
      onClick={onView}
      className="group cursor-pointer hover:bg-primary/5 transition-colors border-b border-border last:border-0"
    >
      {/* Avatar + name */}
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <ResidentAvatar name={resident.name} />
          <div>
            <p className="text-sm font-semibold text-text-primary leading-tight">
              {resident.name}
            </p>
            <p className="text-xs text-text-muted mt-0.5 capitalize">
              {resident.gender} · {resident.age}y
            </p>
          </div>
        </div>
      </td>

      {/* Diagnosis */}
      <td className="px-4 py-4 hidden md:table-cell max-w-xs">
        <p className="text-sm text-text-secondary truncate">
          {resident.primaryDiagnosis || (
            <span className="text-text-muted italic">No diagnosis</span>
          )}
        </p>
      </td>

      {/* Admission */}
      <td className="px-4 py-4 hidden lg:table-cell">
        <p className="text-xs text-text-muted whitespace-nowrap">
          {formatDate(resident.admissionDate)}
        </p>
      </td>

      {/* Days */}
      <td className="px-4 py-4 hidden sm:table-cell">
        <p className="text-xs text-text-muted whitespace-nowrap">
          {resident.totalDays > 0 ? `Day ${resident.totalDays}` : '—'}
        </p>
      </td>

      {/* Last run */}
      <td className="px-4 py-4 hidden lg:table-cell">
        <p className="text-xs text-text-muted whitespace-nowrap">
          {formatDate(resident.lastRunDate)}
        </p>
      </td>

      {/* Status */}
      <td className="px-4 py-4">
        <StatusPill status={resident.lastRunStatus} />
      </td>

      {/* Arrow */}
      <td className="pr-5 py-4 text-right">
        <span className="text-text-muted text-sm group-hover:text-primary transition-colors">
          →
        </span>
      </td>
    </tr>
  );
}

export default function ResidentsPage() {
  const navigate = useNavigate();
  const [residents, setResidents] = useState<ResidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${SERVER_URL}/api/residents`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setResidents(res.data);
        } else {
          setError(res.error ?? 'Failed to load residents');
        }
      })
      .catch(() => setError('Failed to load residents'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-bg-page pt-20 pb-12">
      <div className="max-w-5xl mx-auto px-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Residents</h1>
          <p className="text-sm text-text-muted mt-1">
            Long-term care resident profiles and clinical journey timelines
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24 text-text-muted text-sm">
            Loading residents...
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-status-red/10 text-status-red rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && residents.length === 0 && (
          <div className="flex items-center justify-center py-24 text-text-muted text-sm">
            No resident profiles found
          </div>
        )}

        {/* Sheet */}
        {!loading && !error && residents.length > 0 && (
          <div className="bg-bg-section border border-border rounded-xl overflow-hidden shadow-sm">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-bg-page">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide">
                    Resident
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide hidden md:table-cell">
                    Primary Diagnosis
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide hidden lg:table-cell">
                    Admitted
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide hidden sm:table-cell">
                    Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide hidden lg:table-cell">
                    Last Run
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wide">
                    Status
                  </th>
                  <th className="pr-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {residents.map((r) => (
                  <ResidentRow
                    key={r._id}
                    resident={r}
                    onView={() => navigate(`/residents/${r._id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
