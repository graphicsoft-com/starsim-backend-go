import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface Session {
  _id: string;
  sessionId: string;
  roomId: string;
  startTime: string;
  endTime?: string;
  status: string;
  patientProfile: string;
  messageCount: number;
}

interface Message {
  _id: string;
  role: 'clinician' | 'patient';
  text: string;
  timestamp: string;
}

export default function Transcripts() {
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Incremented each time a session is opened to force the <audio> element to reload
  const [audioKey, setAudioKey] = useState(0);
  // null = unknown (loading), true = audio exists, false = no recording
  const [audioAvailable, setAudioAvailable] = useState<boolean | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [sessionPage, setSessionPage] = useState(1);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const sessionListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    axios
      .get(`${SERVER_URL}/api/room-config`)
      .then(({ data }) => {
        const ids = data.data.map((r: { roomId: string }) => r.roomId).sort();
        setRoomIds(ids);
        if (ids.length > 0) setSelectedRoom(ids[0]);
      })
      .catch(() => setRoomIds([]));
  }, []);

  // Fetch sessions when room changes
  useEffect(() => {
    async function fetchSessions() {
      setLoadingSessions(true);
      setSelectedSession(null);
      setMessages([]);
      setSessionPage(1);
      setHasMoreSessions(false);
      try {
        const { data } = await axios.get(
          `${SERVER_URL}/api/transcripts/${selectedRoom}?page=1&limit=10`,
        );
        setSessions(data.data.sessions);
        setHasMoreSessions(data.data.pagination.hasMore);
      } catch {
        setSessions([]);
      } finally {
        setLoadingSessions(false);
      }
    }
    fetchSessions();
  }, [selectedRoom]);

  async function loadMoreSessions() {
    if (!selectedRoom || loadingMoreSessions || !hasMoreSessions) return;
    const nextPage = sessionPage + 1;
    setLoadingMoreSessions(true);
    try {
      const { data } = await axios.get(
        `${SERVER_URL}/api/transcripts/${selectedRoom}?page=${nextPage}&limit=10`,
      );
      setSessions((prev) => [...prev, ...data.data.sessions]);
      setSessionPage(nextPage);
      setHasMoreSessions(data.data.pagination.hasMore);
    } catch {
      // leave existing sessions intact
    } finally {
      setLoadingMoreSessions(false);
    }
  }

  function handleSessionScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
      loadMoreSessions();
    }
  }

  // Fetch messages when session is selected
  async function openSession(session: Session) {
    setSelectedSession(session);
    setAudioKey((k) => k + 1);
    setAudioAvailable(null);
    setLoadingMessages(true);
    setMessagePage(1);
    setHasMoreMessages(false);
    try {
      const { data } = await axios.get(
        `${SERVER_URL}/api/transcripts/${session._id}/messages?page=1&limit=100`,
      );
      setMessages(data.data.messages);
      setHasMoreMessages(data.data.pagination.hasMore);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function loadMoreMessages() {
    if (!selectedSession || loadingMore) return;
    const nextPage = messagePage + 1;
    setLoadingMore(true);
    try {
      const { data } = await axios.get(
        `${SERVER_URL}/api/transcripts/${selectedSession._id}/messages?page=${nextPage}&limit=100`,
      );
      setMessages((prev) => [...prev, ...data.data.messages]);
      setMessagePage(nextPage);
      setHasMoreMessages(data.data.pagination.hasMore);
    } catch {
      // leave existing messages intact
    } finally {
      setLoadingMore(false);
    }
  }

  function formatDuration(start: string, end?: string) {
    if (!end) return 'ongoing';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const m = Math.floor(ms / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pt-16 pb-6 h-screen flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-text-primary">Transcripts</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Session history and conversation logs
        </p>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Left panel — room selector + session list */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-3">
          {/* Room filter */}
          <div className="flex flex-col gap-1.5">
            {roomIds.map((roomId) => (
              <button
                key={roomId}
                onClick={() => setSelectedRoom(roomId)}
                className={`px-4 py-2 rounded-lg border text-left text-sm transition-all duration-200 ${
                  selectedRoom === roomId
                    ? 'border-primary bg-primary-light text-primary font-semibold shadow-sm'
                    : 'border-border/50 bg-bg-section text-text-muted hover:border-border hover:text-text-primary hover:shadow-sm'
                }`}
              >
                <span className="font-semibold">{roomId}</span>
              </button>
            ))}
          </div>

          {/* Session list */}
          <div ref={sessionListRef} onScroll={handleSessionScroll} className="flex-1 overflow-y-auto flex flex-col gap-1.5">
            {loadingSessions ? (
              <div className="text-text-muted text-sm text-center py-6">
                Loading...
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-text-muted text-sm text-center py-6">
                No sessions yet
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session._id}
                  onClick={() => openSession(session)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg border transition-all duration-200 ${
                    selectedSession?._id === session._id
                      ? 'border-primary bg-primary-light shadow-sm'
                      : session.status === 'active'
                        ? 'border-status-green bg-bg-section shadow-sm hover:shadow-md'
                        : 'border-border/50 bg-bg-section hover:border-border hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-text-muted">
                      {session.messageCount} msgs
                    </span>
                  </div>
                  <div className="text-xs text-text-primary">
                    <span className="text-text-muted">Start: </span>
                    {new Date(session.startTime).toLocaleDateString('en-US', {
                      timeZone: 'America/Denver',
                    })}{' '}
                    ·{' '}
                    {new Date(session.startTime).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'America/Denver',
                    })}{' '}
                    <span className="text-text-muted font-medium">MT</span>
                  </div>
                  <div className="text-xs text-text-primary mt-0.5">
                    <span className="text-text-muted">End: </span>
                    {session.endTime ? (
                      <>
                        {new Date(session.endTime).toLocaleDateString('en-US', {
                          timeZone: 'America/Denver',
                        })}{' '}
                        ·{' '}
                        {new Date(session.endTime).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'America/Denver',
                        })}{' '}
                        <span className="text-text-muted font-medium">MT</span>
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </div>
                </button>
              ))
            )}
            {loadingMoreSessions && (
              <div className="text-text-muted text-xs text-center py-3">
                Loading…
              </div>
            )}
          </div>
        </div>

        {/* Right panel — transcript view */}
        <div className="flex-1 flex flex-col rounded-xl bg-bg-section shadow-sm overflow-hidden">
          {!selectedSession ? (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
              Select a session to view transcript
            </div>
          ) : (
            <>
              {/* Session meta */}
              <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between">
                <div>
                  <div className="text-sm text-text-primary font-semibold">
                    {selectedSession.roomId} ·{' '}
                    {new Date(selectedSession.startTime).toLocaleString(
                      'en-US',
                      { timeZone: 'America/Denver' },
                    )}{' '}
                    <span className="text-xs font-medium text-text-muted">
                      MT
                    </span>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5 line-clamp-1">
                    {selectedSession.patientProfile !== 'PENDING'
                      ? selectedSession.patientProfile
                      : 'Profile pending'}
                  </div>
                </div>
                <div className="text-right text-xs text-text-muted">
                  <div>{selectedSession.messageCount} messages</div>
                  <div>
                    {formatDuration(
                      selectedSession.startTime,
                      selectedSession.endTime,
                    )}
                  </div>
                </div>
              </div>

              {/* Session recordings — single merged WAV (both voices) */}
              {audioAvailable !== false && (
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
                    Session Record
                    {audioAvailable === true && (
                      <a
                        href={`${SERVER_URL}/api/audio/session/${encodeURIComponent(selectedSession!.roomId)}/${encodeURIComponent(selectedSession!.sessionId)}/merged`}
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
                    src={`${SERVER_URL}/api/audio/session/${encodeURIComponent(selectedSession!.roomId)}/${encodeURIComponent(selectedSession!.sessionId)}/merged`}
                    className={`w-full${audioAvailable === null ? ' hidden' : ''}`}
                    onCanPlay={() => setAudioAvailable(true)}
                    onError={() => setAudioAvailable(false)}
                  />
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {loadingMessages ? (
                  <div className="text-text-muted text-sm text-center py-8">
                    Loading transcript...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-text-muted text-sm text-center py-8">
                    No messages in this session
                  </div>
                ) : (
                  <>
                    {messages.map((m, i) => (
                      <div key={i} className="flex gap-3">
                        <div
                          className={`flex-shrink-0 w-14 pt-1 text-xs font-semibold ${
                            m.role === 'clinician'
                              ? 'text-primary'
                              : 'text-status-green'
                          }`}
                        >
                          {m.role === 'clinician' ? 'Cl.  ' : 'Pt.'}
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
                            {new Date(m.timestamp).toLocaleTimeString('en-US', {
                              timeZone: 'America/Denver',
                            })}
                            {' MT'}
                          </div>
                        </div>
                      </div>
                    ))}
                    {hasMoreMessages && (
                      <button
                        onClick={loadMoreMessages}
                        disabled={loadingMore}
                        className="self-center px-4 py-2 text-xs text-primary border border-primary/30 rounded-lg hover:bg-primary-light transition-all duration-200 disabled:opacity-50"
                      >
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
