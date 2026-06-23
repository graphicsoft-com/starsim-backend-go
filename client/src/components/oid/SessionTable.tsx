import { useState, useEffect } from 'react';
import axios from 'axios';
import type { SessionRecord } from './types';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

const STATUS_CLASSES: Record<SessionRecord['status'], string> = {
  Completed: 'bg-status-green/10 text-status-green',
  'In Progress': 'bg-status-yellow/10 text-status-yellow',
  Failed: 'bg-status-red/10 text-status-red',
};

interface Message {
  _id: string;
  role: 'clinician' | 'patient';
  text: string;
  timestamp: string;
}

function SessionPreviewModal({
  session,
  onClose,
}: {
  session: SessionRecord;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [audioAvailable, setAudioAvailable] = useState<boolean | null>(null);
  const [audioKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setAudioAvailable(null);
    axios
      .get(`${SERVER_URL}/api/transcripts/${session.id}/messages`)
      .then(({ data }) => setMessages(data.data.messages))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [session.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-section rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/30 flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              Session{' '}
              <span className="font-mono text-xs text-text-muted">
                {session.id.slice(-10)}
              </span>
            </div>
            <div className="text-xs text-text-muted mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
              <span>
                <span className="font-semibold">Start:</span>{' '}
                {session.startTime
                  ? new Date(session.startTime).toLocaleString()
                  : session.date}
              </span>
              <span>
                <span className="font-semibold">End:</span>{' '}
                {session.endTime
                  ? new Date(session.endTime).toLocaleString()
                  : '—'}
              </span>
            </div>
            <div className="mt-2">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${STATUS_CLASSES[session.status]}`}
              >
                {session.status}
              </span>
              <span className="ml-3 text-xs text-text-muted">
                {session.duration}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors ml-4 mt-0.5 flex-shrink-0"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Audio recording */}
        {audioAvailable !== false && session.roomId && session.sessionId && (
          <div className="px-5 py-3 border-b border-border/30 bg-bg-page/50">
            <div className="text-xs font-semibold text-text-muted mb-2 flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3.5 h-3.5 text-primary"
              >
                <path d="M15.547 7.547a.75.75 0 0 0-1.094-1.025 6.5 6.5 0 0 1 0 8.956.75.75 0 1 0 1.094 1.025 8 8 0 0 0 0-10.956ZM10.485 4.485a.75.75 0 0 0-1.07-1.05 10 10 0 0 0 0 13.13.75.75 0 1 0 1.07-1.05 8.5 8.5 0 0 1 0-11.03ZM7.625 7.21a.75.75 0 0 0-1.06-1.06 5 5 0 0 0 0 7.07.75.75 0 1 0 1.06-1.06 3.5 3.5 0 0 1 0-4.95ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
              </svg>
              Session Recording
              {audioAvailable === true && (
                <a
                  href={`${SERVER_URL}/api/audio/session/${encodeURIComponent(session.roomId)}/${encodeURIComponent(session.sessionId)}/merged`}
                  download="session-combined.wav"
                  className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3.5 h-3.5"
                  >
                    <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                    <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                  </svg>
                  Download
                </a>
              )}
            </div>
            {audioAvailable === null && (
              <div className="text-xs text-text-muted py-1">
                Checking for recording…
              </div>
            )}
            <audio
              key={audioKey}
              controls
              preload="metadata"
              src={`${SERVER_URL}/api/audio/session/${encodeURIComponent(session.roomId)}/${encodeURIComponent(session.sessionId)}/merged`}
              className={`w-full${audioAvailable === null ? ' hidden' : ''}`}
              onCanPlay={() => setAudioAvailable(true)}
              onError={() => setAudioAvailable(false)}
            />
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {loading ? (
            <div className="text-text-muted text-sm text-center py-8">
              Loading transcript...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-text-muted text-sm text-center py-8">
              No messages in this session
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className="flex gap-3">
                <div
                  className={`flex-shrink-0 w-14 pt-1 text-xs font-semibold ${
                    m.role === 'clinician'
                      ? 'text-primary'
                      : 'text-status-green'
                  }`}
                >
                  {m.role === 'clinician' ? 'Cl.' : 'Pt.'}
                </div>
                <div
                  className={`flex-1 rounded-lg px-4 py-2.5 border transition-all duration-200 ${
                    m.role === 'clinician'
                      ? 'border-primary/20 bg-primary-light/60'
                      : 'border-border/30 bg-bg-page'
                  }`}
                >
                  <p className="text-sm text-text-primary leading-relaxed">
                    {m.text}
                  </p>
                  <div className="text-xs text-text-muted mt-1">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function SessionTable({
  sessions,
}: {
  sessions: SessionRecord[];
}) {
  const [previewSession, setPreviewSession] = useState<SessionRecord | null>(
    null,
  );

  return (
    <>
      <div className="bg-bg-section rounded-xl shadow-sm m-4 overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-xs font-semibold text-text-muted border-b border-border/50">
              <th className="px-5 py-3 text-left">Session ID</th>
              <th className="px-5 py-3 text-left">Start Time MT</th>
              <th className="px-5 py-3 text-left">End Time MT</th>
              <th className="px-5 py-3 text-left">Duration</th>
              <th className="px-5 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr
                key={s.id}
                className="text-sm border-b border-border/30 last:border-b-0 hover:bg-bg-page transition-colors duration-150"
              >
                <td className="px-5 py-3 text-text-primary font-medium font-mono text-xs">
                  {s.id.slice(-10)}
                </td>
                <td className="px-5 py-3 text-text-primary">
                  {s.startTime
                    ? new Date(s.startTime).toLocaleString()
                    : s.date}
                </td>
                <td className="px-5 py-3 text-text-primary">
                  {s.endTime ? new Date(s.endTime).toLocaleString() : '—'}
                </td>
                <td className="px-5 py-3 text-text-primary">{s.duration}</td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => setPreviewSession(s)}
                    className="text-xs text-primary font-medium hover:text-primary-dark transition-colors duration-200"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewSession && (
        <SessionPreviewModal
          session={previewSession}
          onClose={() => setPreviewSession(null)}
        />
      )}
    </>
  );
}
