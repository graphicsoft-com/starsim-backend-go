import { NavLink } from 'react-router-dom';
import { useRoomStatus } from '../hooks/useRoomStatus';
import { useTheme } from '../hooks/useTheme';

export default function Navbar() {
  const { activeCount } = useRoomStatus();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-primary flex items-center px-4 shadow-md pt-1">
      <div className="max-w-7xl pb-1 mx-auto w-full flex items-center justify-between">
        {/* Logo */}
        <img src="/nebo-logo.png" alt="Nebo" className="h-10 w-auto" />

        {/* Nav Links */}
        <div className="flex items-center gap-1 bg-primary-dark/30 rounded-lg p-0.5">
          {[
            { to: '/', label: 'Rooms' },
            { to: '/transcripts', label: 'Transcripts' },
            { to: '/residents', label: 'Residents' },
            { to: '/note-sequence', label: 'Note Sequence' },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-6 py-3 text-xs font-medium cursor-pointer rounded-md transition-all duration-200 ${
                  isActive
                    ? 'bg-white text-primary font-semibold shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Right: live counter + theme toggle */}
        <div className="flex items-center gap-4 text-xs text-white">
          {activeCount > 0 ? (
            <span className="flex items-center gap-2 bg-white/15 rounded-lg px-3 py-1">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="font-semibold">{activeCount}/6 Live</span>
            </span>
          ) : (
            <span className="text-white/60 bg-white/10 rounded-lg px-3 py-1">
              0/6 Live
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/15 transition-all duration-200"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
