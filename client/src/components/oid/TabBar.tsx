export type EHRTab = 'Overview' | 'Sessions';

export default function TabBar({
  active,
  onChange,
}: {
  active: EHRTab;
  onChange: (tab: EHRTab) => void;
}) {
  const tabs: EHRTab[] = ['Overview', 'Sessions'];

  return (
    <div className="flex flex-row bg-bg-page px-4 pt-3 gap-1">
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`px-5 py-2 text-sm font-medium cursor-pointer rounded-t-lg transition-all duration-200 ${
              isActive
                ? 'bg-bg-section text-primary font-semibold shadow-sm'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-section/50'
            }`}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
