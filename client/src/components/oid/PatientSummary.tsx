import type { TenantProfile } from './types';

function isHighTemp(temp: number): boolean {
  return temp > 100.4;
}

function isHighBP(bp: string): boolean {
  const systolic = parseInt(bp.split('/')[0], 10);
  return systolic > 140;
}

export default function PatientSummary({ tenant }: { tenant: TenantProfile }) {
  const vitals = tenant.vitals;
  const bpHigh = isHighBP(vitals.bloodPressure);
  const tempHigh = isHighTemp(vitals.temperature);

  const rows = [
    { label: 'HR', value: `${vitals.heartRate} bpm`, alert: false },
    { label: 'BP', value: vitals.bloodPressure, alert: bpHigh },
    { label: 'Temp', value: `${vitals.temperature}°F`, alert: tempHigh },
    { label: 'Pulse', value: `${vitals.pulse}`, alert: false },
    { label: 'SpO2', value: `${vitals.spo2}%`, alert: false },
    { label: 'Resp', value: '18', alert: false },
  ];

  return (
    <div className="bg-bg-section shadow-sm px-4 py-3 w-full">
      <div className="flex items-start gap-6">
        {/* Patient identity column */}
        <div className="flex items-center gap-3 min-w-[220px]">
          {tenant.image ? (
            <img
              src={tenant.image}
              alt={tenant.name}
              className="w-11 h-11 rounded-full border-2 border-primary/30 object-cover"
            />
          ) : (
            <div className="w-11 h-11 rounded-full border-2 border-primary/30 bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
              {tenant.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary leading-tight">
              {tenant.name}
            </span>
            <span className="text-xs text-text-muted mt-0.5">
              {tenant.gender === 'male' ? 'Male' : 'Female'} &middot; Age{' '}
              {tenant.age}
            </span>
          </div>
        </div>

        {/* Details table */}
        <div className="flex-1 grid grid-cols-[auto_1fr_auto_1fr] gap-x-6 gap-y-1 text-xs items-center">
          <span className="text-text-muted">DOB</span>
          <span className="text-text-primary font-medium">{tenant.dob}</span>
          <span className="text-text-muted">Clinician</span>
          <span className="text-text-primary font-medium">
            {tenant.physician}
          </span>
          <span className="text-text-muted">Room</span>
          <span className="text-text-primary font-medium">{tenant.roomId}</span>
          <span className="text-text-muted">Code Status</span>
          <span className="text-text-primary font-medium">
            {tenant.codeStatus}
          </span>
        </div>

        {/* Vitals table */}
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              {rows.map((r) => (
                <th
                  key={r.label}
                  className="px-3 py-1 text-text-muted font-medium text-center border-b border-border/40"
                >
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rows.map((r) => (
                <td
                  key={r.label}
                  className={`px-3 py-1.5 text-center font-semibold text-sm ${
                    r.alert
                      ? 'text-status-red bg-status-red/8'
                      : 'text-text-primary'
                  }`}
                >
                  {r.value}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
