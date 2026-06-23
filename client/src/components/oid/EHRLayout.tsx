import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';
import type { TenantProfile, SessionRecord } from './types';
import type { ParticipantRole } from '@org/shared-types';
import PatientSummary from './PatientSummary';
import AlertRow from './AlertRow';
import TabBar, { type EHRTab } from './TabBar';
import SessionTable from './SessionTable';

export interface ChatMessage {
  id: number;
  role: ParticipantRole;
  speakerName: string;
  text: string;
  timestamp: number;
}

export interface EHRSessionState {
  role: ParticipantRole | null;
  connected: boolean;
  status: 'IDLE' | 'SPEAKING' | 'WAITING';
  currentText: string;
  isSessionActive: boolean;
  /** Whether this OID has explicitly unlocked audio (Start/Join clicked). */
  sessionUnlocked: boolean;
  /** Whether this OID is in preview/observer mode (no audio, just transcript). */
  previewMode: boolean;
  clinicianConnected: boolean;
  patientConnected: boolean;
  voiceReady: boolean;
  downloadProgress: number | null;
  chatMessages: ChatMessage[];
  startTime: string | null;
  recordedTurns: number;
  audioUploadStatus: 'idle' | 'uploading' | 'done' | 'error';
}

export interface EHRActions {
  onSelectRole: (role: ParticipantRole) => void;
  onStartSession: () => void;
  onPreviewSession: () => void;
  onExit: () => void;
  onGoHome: () => void;
  onDownloadRecording?: () => void;
}

function ChatTranscript({
  messages,
  status,
}: {
  messages: ChatMessage[];
  status: 'IDLE' | 'SPEAKING' | 'WAITING';
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="bg-bg-section rounded-xl shadow-sm p-4 flex flex-col">
      <h3 className="text-sm font-semibold text-text-muted pb-2 mb-3 border-b border-border/50 flex items-center gap-2">
        <span>Live Transcript</span>
        {status === 'SPEAKING' && (
          <span className="audio-wave">
            <span className="bg-status-green" />
            <span className="bg-status-green" />
            <span className="bg-status-green" />
            <span className="bg-status-green" />
            <span className="bg-status-green" />
          </span>
        )}
        {status === 'WAITING' && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="w-4 h-4 text-status-yellow"
          >
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        )}
      </h3>
      <div className="flex-1 max-h-72 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-text-muted text-center py-8">
            Waiting for conversation to begin...
          </p>
        )}
        {messages.map((msg) => {
          const isClinician = msg.role === 'clinician';
          return (
            <div
              key={msg.id}
              className={`flex ${isClinician ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 transition-all duration-200 ${
                  isClinician
                    ? 'bg-primary-light/60 border border-primary/20'
                    : 'bg-bg-page border border-border/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-semibold ${
                      isClinician ? 'text-primary-dark' : 'text-text-muted'
                    }`}
                  >
                    {msg.speakerName}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-sm text-text-primary leading-relaxed">
                  {msg.text}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default function EHRLayout({
  tenant,
  sessions,
  clinicianName,
  clinicianProfile,
  session,
  actions,
}: {
  tenant: TenantProfile;
  sessions: SessionRecord[];
  clinicianName: string;
  clinicianProfile?: string;
  session: EHRSessionState;
  actions: EHRActions;
}) {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<EHRTab>('Overview');
  const elapsed = useElapsedTimer(
    session.isSessionActive ? session.startTime : null,
  );

  const statusLabel = session.isSessionActive
    ? 'Active'
    : session.role
      ? 'Connected'
      : 'Not Joined';

  return (
    <div className="min-h-screen bg-bg-page flex flex-col">
      {/* SECTION A: Top System Bar */}
      <header className="flex items-center px-4 bg-primary text-white h-11 w-full shadow-md">
        <button
          onClick={actions.onGoHome}
          className="flex items-center gap-2 hover:opacity-80 transition-all duration-200"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="text-sm font-bold tracking-wide">Home</span>
        </button>
        <span className="text-xs mx-auto font-medium opacity-90">
          Room: {tenant.roomId}
          {elapsed && (
            <span className="ml-2 font-mono bg-green-800 text-white px-2 py-0.5 rounded text-xs">
              {elapsed}
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          {session.role && (
            <span className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full transition-colors duration-300 ${session.connected ? 'bg-white animate-pulse2' : 'bg-white/40'}`}
              />
              <span className="text-xs font-medium tracking-wide">
                {session.connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </span>
          )}
          {session.isSessionActive && (
            <span className="audio-wave">
              <span className="bg-white" />
              <span className="bg-white" />
              <span className="bg-white" />
              <span className="bg-white" />
              <span className="bg-white" />
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
      </header>

      {/* SECTION B: Patient Summary Strip */}
      <PatientSummary tenant={tenant} />

      {/* SECTION C: Alert Row */}
      <AlertRow tenant={tenant} />

      {/* SECTION D: Tab Bar */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* SECTION E / F: Content */}
      {activeTab === 'Overview' ? (
        <div className="flex flex-row p-4 gap-4 flex-1">
          {/* Left Panel */}
          <div className="w-1/3 bg-bg-section rounded-xl shadow-sm p-4">
            {(() => {
              const isClinicianRole = session.role === 'clinician';
              const displayName = isClinicianRole ? clinicianName : tenant.name;
              const displayImage = isClinicianRole
                ? `/characters/${clinicianName}.webp`
                : tenant.image;
              const displayDesc = isClinicianRole
                ? clinicianProfile ||
                  `${clinicianName} — Clinician assigned to ${tenant.name} in ${tenant.roomId}.`
                : tenant.description;
              const initials = displayName
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return (
                <>
                  <div className="relative w-full aspect-auto rounded-lg border border-border/30 overflow-hidden bg-bg-page">
                    {displayImage ? (
                      <img
                        src={displayImage}
                        alt={displayName}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            'none';
                          const fallback = e.currentTarget
                            .nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className="absolute inset-0 items-center justify-center bg-primary/10 text-primary text-4xl font-bold"
                      style={{ display: displayImage ? 'none' : 'flex' }}
                    >
                      {initials}
                    </div>
                  </div>
                  <p className="text-base text-text-primary mt-3 font-semibold">
                    {displayName}
                  </p>
                  <p className="text-xs text-primary font-medium mt-0.5">
                    {session.role
                      ? isClinicianRole
                        ? 'Clinician'
                        : 'Patient'
                      : ''}
                  </p>
                  <p className="text-sm text-text-muted mt-2 leading-relaxed">
                    {displayDesc}
                  </p>
                </>
              );
            })()}
          </div>

          {/* Right Panel */}
          <div className="w-2/3 flex flex-col gap-4">
            {/* Session Control / Join Panel */}
            <div className="bg-bg-section rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-text-muted pb-2 mb-4 border-b border-border/50">
                Session Control
              </h3>

              {!session.role ? (
                /* ── No role: show join buttons ── */
                <div>
                  <div className="grid grid-cols-2 gap-y-2 mb-4">
                    <span className="text-xs text-text-muted">Status</span>
                    <span className="text-sm text-text-muted">Not Joined</span>
                    <span className="text-xs text-text-muted">Room</span>
                    <span className="text-sm text-text-primary font-medium">
                      {tenant.roomId}
                    </span>
                  </div>
                  <div className="border-t border-border/50 pt-4">
                    <div className="text-xs text-text-muted font-semibold tracking-wide mb-3">
                      Join Session As
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => actions.onSelectRole('clinician')}
                        className="flex-1 py-2.5 rounded-lg border border-primary bg-primary-light text-primary text-sm font-semibold hover:bg-primary hover:text-white transition-all duration-200 shadow-sm"
                      >
                        Clinician
                      </button>
                      <button
                        onClick={() => actions.onSelectRole('patient')}
                        className="flex-1 py-2.5 rounded-lg border border-border bg-bg-section text-text-primary text-sm font-semibold hover:bg-primary-light hover:border-primary transition-all duration-200 shadow-sm"
                      >
                        Patient
                      </button>
                    </div>
                    <p className="text-xs text-text-muted mt-2">
                      Each machine should choose a different role
                    </p>
                  </div>
                </div>
              ) : (
                /* ── Role selected: show session state + controls ── */
                <div>
                  <div className="grid grid-cols-2 gap-y-2 mb-4">
                    <span className="text-xs text-text-muted">Role</span>
                    <span className="text-sm text-primary font-semibold">
                      {session.role === 'clinician' ? 'Clinician' : 'Patient'}
                    </span>
                    <span className="text-xs text-text-muted">Status</span>
                    <span
                      className={`text-sm font-semibold ${session.isSessionActive ? 'text-status-green' : 'text-text-primary'}`}
                    >
                      {statusLabel}
                    </span>
                    <span className="text-xs text-text-muted">Session ID</span>
                    <span className="text-sm text-text-primary">
                      {sessions[sessions.length - 1]?.id ?? '—'}
                    </span>
                    <span className="text-xs text-text-muted">Room</span>
                    <span className="text-sm text-text-primary">
                      {tenant.roomId}
                    </span>
                  </div>

                  {/* Connection status */}
                  <div className="border-t border-border/50 pt-3 mb-4">
                    <div className="text-xs text-text-muted font-semibold tracking-wide mb-2">
                      Connections
                    </div>
                    <div className="flex gap-5 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full transition-colors duration-300 ${session.clinicianConnected ? 'bg-status-green' : 'bg-text-muted/40'}`}
                        />
                        <span
                          className={
                            session.clinicianConnected
                              ? 'text-status-green font-medium'
                              : 'text-text-muted'
                          }
                        >
                          Clinician
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full transition-colors duration-300 ${session.patientConnected ? 'bg-status-green' : 'bg-text-muted/40'}`}
                        />
                        <span
                          className={
                            session.patientConnected
                              ? 'text-status-green font-medium'
                              : 'text-text-muted'
                          }
                        >
                          Patient
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="border-t border-border/50 pt-3 flex flex-col gap-3">
                    {/* Session not active — show status message + start button */}
                    {!session.isSessionActive && (
                      <>
                        <div className="rounded-lg border border-border/50 bg-bg-page px-3 py-2.5 text-center">
                          <span className="text-xs text-text-muted">Session hasn't started yet</span>
                        </div>
                        <button
                          onClick={actions.onStartSession}
                          className="w-full py-2.5 rounded-lg border border-status-green bg-bg-section text-status-green text-sm font-semibold hover:bg-status-green hover:text-white transition-all duration-200 shadow-sm"
                        >
                          Start Session
                        </button>
                      </>
                    )}
                    {/* Session is running but this OID hasn't joined — offer Join or Preview */}
                    {session.isSessionActive && !session.sessionUnlocked && !session.previewMode && (
                      <>
                        <button
                          onClick={actions.onStartSession}
                          className="w-full py-2.5 rounded-lg border border-primary bg-bg-section text-primary text-sm font-semibold hover:bg-primary hover:text-white transition-all duration-200 shadow-sm"
                        >
                          Join Session
                        </button>
                        <button
                          onClick={actions.onPreviewSession}
                          className="w-full py-2.5 rounded-lg border border-border bg-bg-section text-text-muted text-sm font-semibold hover:bg-bg-page hover:text-text-primary transition-all duration-200 shadow-sm"
                        >
                          Preview (Observer)
                        </button>
                      </>
                    )}
                    {/* Preview mode — watching without audio */}
                    {session.isSessionActive && session.previewMode && !session.sessionUnlocked && (
                      <div className="w-full">
                        <div className="w-full py-2.5 rounded-lg border border-border bg-bg-page text-text-muted text-sm font-semibold text-center mb-2">
                          Previewing Session
                        </div>
                        <button
                          onClick={actions.onStartSession}
                          className="w-full py-2 rounded-lg border border-primary bg-bg-section text-primary text-xs font-semibold hover:bg-primary hover:text-white transition-all duration-200 shadow-sm"
                        >
                          Join with Audio
                        </button>
                      </div>
                    )}
                    {session.isSessionActive && session.sessionUnlocked && !session.voiceReady && (
                      <div className="w-full">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-primary">
                            Preparing Voice Model...
                          </span>
                          <span className="text-xs text-text-muted font-medium">
                            {session.downloadProgress != null
                              ? `${session.downloadProgress}%`
                              : '...'}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-border/30 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                            style={{
                              width: `${session.downloadProgress ?? 0}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-text-muted mt-1.5">
                          Conversation is running — audio will start once the
                          voice model is ready
                        </p>
                      </div>
                    )}
                    {session.isSessionActive && session.sessionUnlocked && session.voiceReady && (
                      <div className="w-full py-2.5 rounded-lg bg-status-green text-white text-sm font-semibold text-center flex items-center justify-center gap-2 shadow-sm">
                        <span className="audio-wave">
                          <span className="bg-white" />
                          <span className="bg-white" />
                          <span className="bg-white" />
                          <span className="bg-white" />
                          <span className="bg-white" />
                        </span>
                        Session Running
                      </div>
                    )}
                    <button
                      onClick={actions.onExit}
                      className="py-2.5 px-4 rounded-lg border border-border text-text-muted text-sm font-semibold hover:border-status-red hover:text-status-red hover:bg-status-red/5 transition-all duration-200"
                    >
                      Exit
                    </button>
                    {/* Upload status indicator */}
                    {session.audioUploadStatus === 'uploading' && (
                      <div className="flex items-center gap-2 text-xs text-primary animate-pulse">
                        <svg
                          className="w-3.5 h-3.5 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                          />
                        </svg>
                        Uploading audio...
                      </div>
                    )}
                    {session.audioUploadStatus === 'done' && (
                      <div className="flex items-center gap-2 text-xs text-status-green">
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Audio saved to cloud
                      </div>
                    )}
                    {session.audioUploadStatus === 'error' && (
                      <div className="flex items-center gap-2 text-xs text-status-red">
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                        Upload failed
                      </div>
                    )}
                    {!session.isSessionActive &&
                      session.recordedTurns > 0 &&
                      actions.onDownloadRecording && (
                        <button
                          onClick={actions.onDownloadRecording}
                          className="py-2.5 px-4 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-primary-light transition-all duration-200 flex items-center justify-center gap-2"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="w-4 h-4"
                          >
                            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                          </svg>
                          Download Audio ({session.recordedTurns}{' '}
                          {session.recordedTurns === 1 ? 'turn' : 'turns'})
                        </button>
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* Live Chat Transcript — only when session is active */}
            {session.role && session.isSessionActive && (
              <ChatTranscript
                messages={session.chatMessages}
                status={session.status}
              />
            )}
          </div>
        </div>
      ) : (
        /* Sessions Tab — Section F */
        <SessionTable sessions={sessions} />
      )}
    </div>
  );
}
