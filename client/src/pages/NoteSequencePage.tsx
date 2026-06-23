import { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface NoteType {
  _id: string;
  name: string;
  dayType: 'day1' | 'ongoing' | 'both';
  order: number;
  requiresHistory: boolean;
  historyLimit: number;
  neboFormId: number;
  notePrompt: string;
  patientNotePrompt: string;
  useNotePromptOnly: boolean;
  usePatientNotePromptOnly: boolean;
  enabled: boolean;
}

const DAY_TYPE_LABELS: Record<NoteType['dayType'], string> = {
  day1: 'Day 1 only',
  ongoing: 'Ongoing only',
  both: 'Every day',
};

const DAY_TYPE_COLORS: Record<NoteType['dayType'], string> = {
  day1: 'bg-primary/10 text-primary border-primary/20',
  ongoing: 'bg-status-green/10 text-status-green border-status-green/20',
  both: 'bg-status-yellow/10 text-status-yellow border-status-yellow/20',
};

// ── Sortable row ──────────────────────────────────────────────────────────────

function SortableNoteRow({
  note,
  index,
  allNotes,
  isExpanded,
  onToggle,
  onSave,
  onDelete,
}: {
  note: NoteType;
  index: number;
  allNotes: NoteType[];
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (updated: Partial<NoteType>) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const previousNotes = allNotes.filter((n) => n.order < note.order);

  const initSelectedIds = (limit: number) =>
    previousNotes.slice(0, limit).map((n) => n._id);

  const [form, setForm] = useState({
    name: note.name,
    dayType: note.dayType,
    requiresHistory: note.requiresHistory,
    neboFormId: note.neboFormId ?? 0,
    notePrompt: note.notePrompt,
    patientNotePrompt: note.patientNotePrompt ?? '',
    useNotePromptOnly: note.useNotePromptOnly ?? false,
    usePatientNotePromptOnly: note.usePatientNotePromptOnly ?? false,
    enabled: note.enabled,
  });
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>(() =>
    initSelectedIds(note.historyLimit ?? 0),
  );
  const [saving, setSaving] = useState(false);

  // Sync when note changes from parent
  useEffect(() => {
    setForm({
      name: note.name,
      dayType: note.dayType,
      requiresHistory: note.requiresHistory,
      neboFormId: note.neboFormId ?? 0,
      notePrompt: note.notePrompt,
      patientNotePrompt: note.patientNotePrompt ?? '',
      useNotePromptOnly: note.useNotePromptOnly ?? false,
      usePatientNotePromptOnly: note.usePatientNotePromptOnly ?? false,
      enabled: note.enabled,
    });
    setSelectedHistoryIds(
      allNotes
        .filter((n) => n.order < note.order)
        .slice(0, note.historyLimit ?? 0)
        .map((n) => n._id),
    );
  }, [note]); // note is the only dep that matters here — allNotes reference is stable within a render

  const toggleHistoryNote = (id: string) => {
    setSelectedHistoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSave = () => {
    setSaving(true);
    onSave({ ...form, historyLimit: selectedHistoryIds.length });
    setSaving(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-border rounded-xl overflow-hidden bg-bg-section"
    >
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing p-1 shrink-0 touch-none"
          title="Drag to reorder"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="4" r="1.5" />
            <circle cx="11" cy="4" r="1.5" />
            <circle cx="5" cy="8" r="1.5" />
            <circle cx="11" cy="8" r="1.5" />
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="11" cy="12" r="1.5" />
          </svg>
        </button>

        {/* Index */}
        <span className="text-xs text-text-muted font-mono w-5 shrink-0">
          {index + 1}.
        </span>

        {/* Name — click to expand */}
        <button
          onClick={onToggle}
          className="flex-1 text-left text-sm font-medium text-text-primary hover:text-primary transition-colors"
        >
          {note.name}
        </button>

        {/* Day type badge */}
        <span
          className={`text-xs border px-2 py-0.5 rounded-full font-medium shrink-0 ${DAY_TYPE_COLORS[note.dayType]}`}
        >
          {DAY_TYPE_LABELS[note.dayType]}
        </span>

        {/* History badge */}
        {note.requiresHistory && (
          <span className="text-xs bg-bg-page border border-border text-text-muted px-2 py-0.5 rounded-full shrink-0">
            history Injected
          </span>
        )}

        {/* Enabled toggle */}
        <button
          onClick={() => onSave({ enabled: !note.enabled })}
          className={`w-8 h-4 rounded-full transition-colors shrink-0 ${note.enabled ? 'bg-status-green' : 'bg-text-muted/30'}`}
          title={
            note.enabled
              ? 'Enabled — click to disable'
              : 'Disabled — click to enable'
          }
        >
          <span
            className={`block w-3 h-3 rounded-full bg-white shadow transition-transform mx-0.5 ${note.enabled ? 'translate-x-4' : 'translate-x-0'}`}
          />
        </button>

        <button
          onClick={onToggle}
          className="text-text-muted hover:text-text-primary text-xs px-1 shrink-0"
        >
          {isExpanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Expanded config panel */}
      {isExpanded && (
        <div className="border-t border-border px-5 py-5 bg-bg-page space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-1">
                Note Name
              </label>
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
                className="w-full text-sm bg-bg-section border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary"
              />
            </div>

            {/* Day type */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Applies to
              </label>
              <select
                value={form.dayType}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    dayType: e.target.value as NoteType['dayType'],
                  }))
                }
                className="w-full text-sm bg-bg-section border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary"
              >
                <option value="both">Every day</option>
                <option value="day1">Day 1 only (admission)</option>
                <option value="ongoing">Ongoing days only</option>
              </select>
            </div>

            {/* Nebo Form ID */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Nebo Form ID
              </label>
              <input
                type="number"
                min={0}
                value={form.neboFormId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, neboFormId: Number(e.target.value) }))
                }
                placeholder="e.g. 1"
                className="w-full text-sm bg-bg-section border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary"
              />
              <p className="text-xs text-text-muted mt-1">
                The Nebo form this note type registers to. Overrides the room's
                form ID.
              </p>
            </div>

            {/* Requires history */}
            <div className="flex flex-col justify-center">
              <label className="block text-xs font-medium text-text-muted mb-2">
                Requires previous encounter data
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requiresHistory}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      requiresHistory: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-text-secondary">
                  Inject history from prior notes into prompt
                </span>
              </label>
            </div>

            {/* History note selector — only visible when requiresHistory is on */}
            {form.requiresHistory && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-text-muted mb-2">
                  How many prior encounters to include — select notes to set the
                  count
                  {selectedHistoryIds.length > 0 && (
                    <span className="ml-2 text-primary font-semibold">
                      ({selectedHistoryIds.length} selected)
                    </span>
                  )}
                </label>
                {previousNotes.length === 0 ? (
                  <p className="text-xs text-text-muted italic">
                    No notes come before this one in the sequence.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {previousNotes.map((prev) => (
                      <label
                        key={prev._id}
                        className="flex items-center gap-2 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={selectedHistoryIds.includes(prev._id)}
                          onChange={() => toggleHistoryNote(prev._id)}
                          className="w-4 h-4 accent-primary shrink-0"
                        />
                        <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
                          {prev.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Note prompt */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Note Prompt
              <span className="ml-1 text-text-muted font-normal">
                (additional instructions appended to the caregiver prompt for
                this note type)
              </span>
            </label>
            <textarea
              value={form.notePrompt}
              onChange={(e) =>
                setForm((p) => ({ ...p, notePrompt: e.target.value }))
              }
              rows={5}
              placeholder="Enter the note prompt..."
              className="w-full text-sm font-mono bg-bg-section border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary resize-y"
            />
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={form.useNotePromptOnly}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    useNotePromptOnly: e.target.checked,
                  }))
                }
                className="w-4 h-4 accent-primary shrink-0"
              />
              <span className="text-xs text-text-secondary">
                Use this prompt as the full caregiver prompt — replaces the
                room's prompt
              </span>
            </label>
          </div>

          {/* Resident / patient prompt */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Resident Prompt
              <span className="ml-1 text-text-muted font-normal">
                (how the resident responds during this note type)
              </span>
            </label>
            <textarea
              value={form.patientNotePrompt}
              onChange={(e) =>
                setForm((p) => ({ ...p, patientNotePrompt: e.target.value }))
              }
              rows={5}
              placeholder={`e.g. You are {{RESIDENT_NAME}}, a resident at {{FACILITY_NAME}}.\n{{CAREGIVER_NAME}} is assessing you today.\nDescribe your symptoms naturally and respond to questions honestly.`}
              className="w-full text-sm font-mono bg-bg-section border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary resize-y"
            />
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={form.usePatientNotePromptOnly}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    usePatientNotePromptOnly: e.target.checked,
                  }))
                }
                className="w-4 h-4 accent-primary shrink-0"
              />
              <span className="text-xs text-text-secondary">
                Use this prompt as the full resident prompt — replaces the
                room's prompt
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={onDelete}
              className="text-xs text-status-red hover:underline"
            >
              Delete note type
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NoteSequencePage() {
  const [notes, setNotes] = useState<NoteType[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchNotes = useCallback(() => {
    fetch(`${SERVER_URL}/api/note-sequence`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setNotes(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/note-sequence/seed`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        success: boolean;
        data?: { notes: NoteType[] };
      };
      if (data.success && data.data) setNotes(data.data.notes);
    } finally {
      setSeeding(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = notes.findIndex((n) => n._id === active.id);
    const newIndex = notes.findIndex((n) => n._id === over.id);
    const reordered = arrayMove(notes, oldIndex, newIndex).map((n, i) => ({
      ...n,
      order: i,
    }));
    setNotes(reordered);

    await fetch(`${SERVER_URL}/api/note-sequence/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order: reordered.map((n) => ({ _id: n._id, order: n.order })),
      }),
    });
  };

  const handleSave = async (id: string, updated: Partial<NoteType>) => {
    setSaveError(null);
    const res = await fetch(`${SERVER_URL}/api/note-sequence/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    const data = (await res.json()) as {
      success: boolean;
      data?: NoteType;
      error?: string;
    };
    if (data.success && data.data) {
      setNotes((prev) =>
        prev.map((n) => (n._id === id ? { ...n, ...data.data! } : n)),
      );
    } else {
      setSaveError(data.error ?? 'Save failed');
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${SERVER_URL}/api/note-sequence/${id}`, { method: 'DELETE' });
    setNotes((prev) => prev.filter((n) => n._id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    const res = await fetch(`${SERVER_URL}/api/note-sequence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = (await res.json()) as { success: boolean; data?: NoteType };
    if (data.success && data.data) {
      setNotes((prev) => [...prev, data.data!]);
      setNewName('');
      setAddingNew(false);
      setExpandedId(data.data._id);
    }
  };

  const day1Notes = notes.filter(
    (n) => n.dayType === 'day1' || n.dayType === 'both',
  );
  const ongoingNotes = notes.filter(
    (n) => n.dayType === 'ongoing' || n.dayType === 'both',
  );

  return (
    <div className="min-h-screen bg-bg-page pt-20 pb-12">
      <div className="max-w-3xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              Note Sequence
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Drag to reorder · Click a note to configure · Toggle to
              enable/disable
            </p>
          </div>
          <div className="flex items-center gap-2">
            {notes.length === 0 && (
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors"
              >
                {seeding ? 'Seeding...' : 'Seed defaults'}
              </button>
            )}
            <button
              onClick={() => setAddingNew((p) => !p)}
              className="px-4 py-2 text-sm font-medium border border-border text-text-primary rounded-lg hover:bg-bg-section transition-colors"
            >
              + Add note type
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mb-4 bg-status-red/10 text-status-red border border-status-red/20 rounded-lg px-4 py-3 text-sm">
            {saveError}
          </div>
        )}

        {/* Add new */}
        {addingNew && (
          <div className="mb-4 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddNew()}
              placeholder="Note type name…"
              autoFocus
              className="flex-1 text-sm bg-bg-section border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-primary"
            />
            <button
              onClick={handleAddNew}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => {
                setAddingNew(false);
                setNewName('');
              }}
              className="px-3 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {loading && (
          <div className="py-24 text-center text-text-muted text-sm">
            Loading...
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div className="py-24 text-center border border-border rounded-xl bg-bg-section">
            <p className="text-text-muted text-sm mb-4">
              No note types configured yet.
            </p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40 transition-colors"
            >
              {seeding ? 'Seeding...' : 'Seed default 12 notes'}
            </button>
          </div>
        )}

        {!loading && notes.length > 0 && (
          <>
            {/* Summary badges */}
            <div className="flex items-center gap-3 mb-5 text-xs text-text-muted">
              <span>{notes.filter((n) => n.enabled).length} active</span>
              <span>·</span>
              <span>{day1Notes.length} on Day 1</span>
              <span>·</span>
              <span>{ongoingNotes.length} on ongoing days</span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={notes.map((n) => n._id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {notes.map((note, index) => (
                    <SortableNoteRow
                      key={note._id}
                      note={note}
                      index={index}
                      allNotes={notes}
                      isExpanded={expandedId === note._id}
                      onToggle={() =>
                        setExpandedId((prev) =>
                          prev === note._id ? null : note._id,
                        )
                      }
                      onSave={(updated) => handleSave(note._id, updated)}
                      onDelete={() => handleDelete(note._id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>
    </div>
  );
}
