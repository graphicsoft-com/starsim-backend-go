import type { TenantProfile } from './types';

export default function AlertRow({ tenant }: { tenant: TenantProfile }) {
  return (
    <div className="flex items-center gap-3 bg-status-red/5 border-y border-status-red/15 px-4 py-1.5 w-full">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5 text-status-red shrink-0"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="text-xs text-status-red font-semibold">Allergies</span>
      <div className="flex items-center gap-1.5">
        {tenant.allergies.map((a) => (
          <span
            key={a}
            className="text-xs bg-status-red/10 text-status-red font-medium px-2 py-0.5 rounded-md"
          >
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}
