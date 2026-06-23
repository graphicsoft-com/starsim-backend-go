import { useEffect, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface HistoryContext {
  encountersUsed: number;
  summaryInjected: string;
  sourceEncounterIds: string[];
}

interface NoteField {
  key: string;
  label: string;
  content: string;
}

interface Obs {
  uuid: string;
  display: string;
  concept: string;
  value: string;
}

interface OpenMrsEncounterDetail {
  uuid: string;
  display: string;
  encounterDatetime: string;
  encounterType: string;
  obs: Obs[];
}

interface Encounter {
  _id: string;
  residentId: string;
  noteType: string;
  dayIndex: number;
  simulatedDate: string;
  roomId: string;
  formId: number;
  status: string;
  neboStatus: string;
  neboJobId: number;
  neboNoteLogId: number;
  wordCount: number;
  tokenCount: number;
  waitTime: number;
  noteFields: NoteField[];
  conversationTranscript: string;
  historyContext: HistoryContext;
  openMrsObs: Obs[];
  openMrsEncounterUuid: string;
  triggersDetected: string[];
  triggeredNoteTypes: string[];
}

type TabKey = 'note' | 'conversation' | 'history' | 'raw';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ConversationLine({ line }: { line: string }) {
  const isCaregiver = line.startsWith('Caregiver:');
  const isPatient = line.startsWith('Patient:');
  const base = 'text-sm py-1.5 px-3 rounded-lg max-w-[85%] whitespace-pre-wrap break-words';

  if (isCaregiver) {
    return (
      <div className="flex justify-end mb-2">
        <div className={`${base} bg-primary/10 text-text-primary`}>{line}</div>
      </div>
    );
  }
  if (isPatient) {
    return (
      <div className="flex justify-start mb-2">
        <div className={`${base} bg-bg-page border border-border text-text-secondary`}>
          {line}
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs text-text-muted py-1 text-center">{line}</div>
  );
}

export default function EncounterDetailPanel({
  encounterId,
  residentId,
  onClose,
}: {
  encounterId: string | null;
  residentId: string;
  onClose: () => void;
}) {
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [openMrsDetail, setOpenMrsDetail] = useState<OpenMrsEncounterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('note');

  useEffect(() => {
    if (!encounterId) {
      setEncounter(null);
      setOpenMrsDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    setActiveTab('note');
    setOpenMrsDetail(null);

    // Fetch encounter + OpenMRS details in parallel for every open — Today's Schedule and Clinical History
    Promise.all([
      fetch(`${SERVER_URL}/api/residents/${residentId}/encounters/${encounterId}`).then((r) => r.json()),
      fetch(`${SERVER_URL}/api/residents/${residentId}/encounters/openmrs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId }),
      }).then((r) => r.json()),
    ])
      .then(([res, omRes]) => {
        if (res.success) {
          setEncounter(res.data);
        } else {
          setError(res.error ?? 'Failed to load encounter');
        }
        if (omRes.success && omRes.encounter) {
          setOpenMrsDetail(omRes.encounter);
        }
      })
      .catch(() => setError('Failed to load encounter'))
      .finally(() => setLoading(false));
  }, [encounterId, residentId]);

  if (!encounterId) return null;

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'note', label: 'Note' },
    { key: 'conversation', label: 'Conversation' },
    { key: 'history', label: 'History' },
    { key: 'raw', label: 'Raw' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-section border-l border-border shadow-xl z-50 flex flex-col overflow-hidden animate-fadein">
        {/* Header */}
        {encounter && (
          <div className="px-6 py-4 border-b border-border">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-text-primary font-semibold text-lg leading-snug">
                  {encounter.noteType}
                </h2>
                <p className="text-xs text-text-muted mt-0.5">
                  Day {encounter.dayIndex} — {formatDate(encounter.simulatedDate)} ·{' '}
                  Room {encounter.roomId} · Form {encounter.formId}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-text-muted hover:text-text-primary p-1 text-lg shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4 bg-bg-page rounded-lg p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    activeTab === t.key
                      ? 'bg-bg-section text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-text-muted text-sm">
              Loading encounter...
            </div>
          )}

          {error && (
            <div className="bg-status-red/10 text-status-red rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && encounter && (
            <>
              {/* TAB: Note */}
              {activeTab === 'note' && (
                <div className="space-y-4">
                  {encounter.noteFields?.some((f) => f.content?.trim()) ? (
                    encounter.noteFields.map((f, i) => (
                      <div key={i} className="border-b border-border pb-4 last:border-0 last:pb-0">
                        <p className="text-sm font-semibold text-text-primary mb-1">{f.label}</p>
                        <p className="text-sm text-text-secondary whitespace-pre-wrap">{f.content}</p>
                      </div>
                    ))
                  ) : openMrsDetail && openMrsDetail.obs.length > 0 ? (
                    openMrsDetail.obs.map((obs, i) => {
                      const text = obs.value.replace(/^Notes\s*\n?NOTES\s*\n?/i, '').trim();
                      return (
                        <div key={i} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                              {obs.concept}
                            </span>
                            <span className="text-xs text-text-muted bg-bg-page border border-border px-2 py-0.5 rounded-full">
                              OpenMRS
                            </span>
                          </div>
                          <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                            {text}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-muted py-8 text-center">
                      Note content not yet available
                    </p>
                  )}
                </div>
              )}

              {/* TAB: Conversation */}
              {activeTab === 'conversation' && (
                <div>
                  {encounter.conversationTranscript ? (
                    encounter.conversationTranscript
                      .split('\n')
                      .filter((l) => l.trim())
                      .map((line, i) => <ConversationLine key={i} line={line} />)
                  ) : (
                    <p className="text-sm text-text-muted py-8 text-center">
                      Conversation transcript not available
                    </p>
                  )}
                </div>
              )}

              {/* TAB: History */}
              {activeTab === 'history' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-1">
                      Context Injected Into This Prompt
                    </p>
                    <p className="text-xs text-text-muted">
                      {encounter.historyContext?.encountersUsed ?? 0} previous encounter
                      {(encounter.historyContext?.encountersUsed ?? 0) !== 1 ? 's' : ''} used as context
                    </p>
                  </div>

                  {(encounter.historyContext?.encountersUsed ?? 0) === 0 ? (
                    <p className="text-sm text-text-muted bg-bg-page border border-border rounded-lg px-4 py-4">
                      No history was injected — this note type does not require previous context
                    </p>
                  ) : (
                    <>
                      <div className="bg-bg-page border border-border rounded-lg p-4">
                        <p className="text-xs text-text-muted mb-2 font-medium">
                          Exact text passed to both clinician and patient agents
                        </p>
                        <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono leading-relaxed">
                          {encounter.historyContext.summaryInjected}
                        </pre>
                      </div>

                      {encounter.historyContext.sourceEncounterIds?.length > 0 && (
                        <div>
                          <p className="text-xs text-text-muted font-medium mb-1">
                            Source encounters
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {encounter.historyContext.sourceEncounterIds.map((id) => (
                              <span
                                key={id}
                                className="text-xs font-mono bg-bg-page border border-border px-2 py-0.5 rounded text-text-muted"
                              >
                                {id}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* TAB: Raw */}
              {activeTab === 'raw' && (
                <div className="space-y-5">
                  {/* Nebo metadata */}
                  <div>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                      Nebo
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {[
                        ['Job ID', encounter.neboJobId],
                        ['Note Log ID', encounter.neboNoteLogId],
                        ['Word Count', encounter.wordCount],
                        ['Token Count', encounter.tokenCount],
                        ['Wait Time', encounter.waitTime ? `${encounter.waitTime}s` : '—'],
                        ['Status', encounter.neboStatus],
                      ].map(([label, val]) => (
                        <div key={String(label)} className="bg-bg-page border border-border rounded-lg px-3 py-2">
                          <p className="text-xs text-text-muted">{label}</p>
                          <p className="font-medium text-text-primary">{String(val || '—')}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* OpenMRS Obs */}
                  {encounter.openMrsObs && encounter.openMrsObs.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                        OpenMRS Observations
                      </p>
                      <div className="space-y-1.5">
                        {encounter.openMrsObs.map((obs, i) => (
                          <div key={i} className="flex gap-2 text-sm">
                            <span className="font-medium text-text-primary shrink-0">{obs.concept}</span>
                            <span className="text-text-muted">—</span>
                            <span className="text-text-secondary">{obs.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Triggers */}
                  {(encounter.triggersDetected?.length > 0 || encounter.triggeredNoteTypes?.length > 0) && (
                    <div>
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                        Triggers
                      </p>
                      {encounter.triggersDetected?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {encounter.triggersDetected.map((t) => (
                            <span key={t} className="text-xs bg-status-yellow/10 text-status-yellow border border-status-yellow/20 px-2 py-0.5 rounded-full font-medium">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {encounter.triggeredNoteTypes?.length > 0 && (
                        <p className="text-xs text-text-muted">
                          Added to queue: {encounter.triggeredNoteTypes.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
