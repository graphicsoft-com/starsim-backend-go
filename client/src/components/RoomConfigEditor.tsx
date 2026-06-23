import { useState, useEffect, useCallback } from 'react';

interface RoomConfigData {
  roomId: string;
  roomName: string;
  machineLabel: string;
  noteType: string;
  caregiverName: string;
  caregiverGender: 'male' | 'female';
  caregiverEmail: string;
  caregiverMachine: string;
  caregiverProfile: string;
  caregiverPrompt: string;
  patientName: string;
  patientGender: 'male' | 'female';
  patientAge: number;
  patientMachine: string;
  patientProfile: string;
  patientPrompt: string;
  neboFormId: number;
  updatedAt: string;
  updatedBy: string;
}

interface CharacterData {
  _id: string;
  name: string;
  role: 'clinician' | 'patient';
  gender: 'male' | 'female';
  age: number | null;
  email: string;
  profile: string;
  prompt: string;
}

interface Props {
  roomId: string | null;
  onClose: () => void;
  onSaved: (config: RoomConfigData) => void;
}

const SERVER_URL = import.meta.env.VITE_API_URL || '';

export default function RoomConfigEditor({ roomId, onClose, onSaved }: Props) {
  const [form, setForm] = useState<RoomConfigData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Character lists
  const [caregivers, setCaregivers] = useState<CharacterData[]>([]);
  const [patients, setPatients] = useState<CharacterData[]>([]);

  // "Add new" inline form state
  const [addingCaregiver, setAddingCaregiver] = useState(false);
  const [addingPatient, setAddingPatient] = useState(false);

  // Load room config
  useEffect(() => {
    if (!roomId) return;
    setLoading(true);
    setDirty(false);
    setError(null);
    fetch(`${SERVER_URL}/api/room-config/${roomId}`)
      .then((r) => r.json())
      .then((res) => {
        setForm(res.data);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load config');
        setLoading(false);
      });
  }, [roomId]);

  // Load character lists
  const fetchCharacters = useCallback(async () => {
    try {
      const [cgRes, ptRes] = await Promise.all([
        fetch(`${SERVER_URL}/api/characters?role=clinician`).then((r) =>
          r.json(),
        ),
        fetch(`${SERVER_URL}/api/characters?role=patient`).then((r) =>
          r.json(),
        ),
      ]);
      if (cgRes.success) setCaregivers(cgRes.data);
      if (ptRes.success) setPatients(ptRes.data);
    } catch {
      // non-critical — fields still work manually
    }
  }, []);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  const handleChange = useCallback(
    (field: keyof RoomConfigData, value: string | number) => {
      setForm((prev) => (prev ? { ...prev, [field]: value } : null));
      setDirty(true);
    },
    [],
  );

  const selectCaregiver = useCallback((char: CharacterData) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            caregiverName: char.name,
            caregiverGender: char.gender,
            caregiverEmail: char.email,
            caregiverProfile: char.profile,
            caregiverPrompt: char.prompt,
          }
        : null,
    );
    setDirty(true);
  }, []);

  const selectPatient = useCallback((char: CharacterData) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            patientName: char.name,
            patientGender: char.gender,
            patientAge: char.age ?? prev.patientAge,
            patientProfile: char.profile,
            patientPrompt: char.prompt,
          }
        : null,
    );
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!form || !roomId) return;
    setSaving(true);
    setError(null);
    try {
      // If the caregiver email was edited, save it to the caregiver character
      const selectedCg = caregivers.find((c) => c.name === form.caregiverName);
      if (selectedCg && form.caregiverEmail !== selectedCg.email) {
        const cgRes = await fetch(
          `${SERVER_URL}/api/characters/${selectedCg._id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: form.caregiverEmail }),
          },
        );
        const cgData = await cgRes.json();
        if (!cgData.success) throw new Error(cgData.error);
        // Update local caregivers list with new email
        setCaregivers((prev) =>
          prev.map((c) =>
            c._id === selectedCg._id ? { ...c, email: form.caregiverEmail } : c,
          ),
        );
      }

      const res = await fetch(`${SERVER_URL}/api/room-config/${roomId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, updatedBy: 'John Wright' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setDirty(false);
      onSaved(data.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty && !window.confirm('You have unsaved changes. Close anyway?')) {
      return;
    }
    onClose();
  };

  if (!roomId) return null;

  return (
    <>
      {/* Overlay backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={handleClose} />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-section border-l border-border shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-text-primary font-semibold text-lg">
              Edit Room Configuration
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs text-status-yellow font-medium">
                Unsaved changes
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={handleClose}
              className="text-text-muted hover:text-text-primary p-1 text-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          {loading && (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading configuration...
            </div>
          )}

          {error && (
            <div className="bg-status-red/10 text-status-red px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {!loading && form && (
            <>
              {/* Room Info */}
              <Section title="Room">
                <Field
                  label="Room ID"
                  value={form.roomId}
                  onChange={(v) => handleChange('roomId', v)}
                  type="text"
                  placeholder="e.g. room1, room-101"
                />
                {form.roomId !== roomId && (
                  <p className="text-xs text-status-yellow mt-1">
                    ⚠ Changing the Room ID will rename it everywhere. The room
                    must not be active.
                  </p>
                )}
                <Field
                  label="Room Name"
                  value={form.roomName}
                  onChange={(v) => handleChange('roomName', v)}
                  type="text"
                  placeholder="e.g. Garden Suite, Room 101"
                />
                <NoteTypeSelect
                  value={form.noteType ?? ''}
                  onChange={(v) => handleChange('noteType', v)}
                />

                <Field
                  label="Notes / Label"
                  value={form.machineLabel}
                  onChange={(v) => handleChange('machineLabel', v)}
                  type="text"
                />
                <Field
                  label="Nebo Form ID"
                  value={String(form.neboFormId)}
                  onChange={(v) => handleChange('neboFormId', Number(v))}
                  type="number"
                  min={1}
                  placeholder="e.g. 1"
                />
              </Section>

              {/* Clinician */}
              <Section title="Clinician">
                <CharacterPicker
                  label="Select Clinician"
                  characters={caregivers}
                  selectedName={form.caregiverName}
                  onSelect={selectCaregiver}
                  onAddNew={() => setAddingCaregiver(true)}
                />
                {addingCaregiver && (
                  <AddCharacterForm
                    role="clinician"
                    onCreated={(char) => {
                      setCaregivers((prev) =>
                        [...prev, char].sort((a, b) =>
                          a.name.localeCompare(b.name),
                        ),
                      );
                      selectCaregiver(char);
                      setAddingCaregiver(false);
                    }}
                    onCancel={() => setAddingCaregiver(false)}
                  />
                )}
                <Field
                  label="Email"
                  value={form.caregiverEmail}
                  onChange={(v) => handleChange('caregiverEmail', v)}
                  type="text"
                />
                <Field
                  label="Machine"
                  value={form.caregiverMachine}
                  onChange={(v) => handleChange('caregiverMachine', v)}
                  type="text"
                  placeholder="e.g. Q-04, Q-62"
                />
                <TextareaField
                  label="Profile / Background"
                  value={form.caregiverProfile}
                  onChange={(v) => handleChange('caregiverProfile', v)}
                  rows={3}
                  hint="Describe who this caregiver is — personality, experience, background."
                />
                <TextareaField
                  label="System Prompt"
                  value={form.caregiverPrompt}
                  onChange={(v) => handleChange('caregiverPrompt', v)}
                  rows={8}
                  hint="The full LLM prompt used to generate the clinician's responses."
                  mono
                />
              </Section>

              {/* Patient */}
              <Section title="Patient">
                <CharacterPicker
                  label="Select Patient"
                  characters={patients}
                  selectedName={form.patientName}
                  onSelect={selectPatient}
                  onAddNew={() => setAddingPatient(true)}
                  showAge
                />
                {addingPatient && (
                  <AddCharacterForm
                    role="patient"
                    onCreated={(char) => {
                      setPatients((prev) =>
                        [...prev, char].sort((a, b) =>
                          a.name.localeCompare(b.name),
                        ),
                      );
                      selectPatient(char);
                      setAddingPatient(false);
                    }}
                    onCancel={() => setAddingPatient(false)}
                  />
                )}
                <Field
                  label="Machine"
                  value={form.patientMachine}
                  onChange={(v) => handleChange('patientMachine', v)}
                  type="text"
                  placeholder="e.g. Q-04, Q-62"
                />
                <TextareaField
                  label="Profile / Background"
                  value={form.patientProfile}
                  onChange={(v) => handleChange('patientProfile', v)}
                  rows={4}
                  hint="Describe the patient — medical history, personality, family, hobbies."
                />
                <TextareaField
                  label="System Prompt"
                  value={form.patientPrompt}
                  onChange={(v) => handleChange('patientPrompt', v)}
                  rows={8}
                  hint="The full LLM prompt used to generate the patient's responses."
                  mono
                />
              </Section>

              {/* Footer Info */}
              {form.updatedAt && (
                <p className="text-xs text-text-muted">
                  Last updated {new Date(form.updatedAt).toLocaleString()} by{' '}
                  {form.updatedBy}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Helper Components ──────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-text-primary font-semibold text-base mb-4 pb-2 border-b border-border">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-lg text-sm bg-bg-page border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors';

function Field({
  label,
  value,
  onChange,
  type,
  min,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: 'text' | 'number';
  min?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-muted mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-muted mb-1.5">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows ?? 4}
        className={`${INPUT_CLASS} resize-y ${mono ? 'font-mono text-xs' : ''}`}
      />
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
    </div>
  );
}

// ── Note Type Select ──────────────────────────────────────────────────────

const NOTE_TYPE_OPTIONS = [
  'Admission Note',
  'SOAP Note',
  'Shift Report Note',
  'Daily Activity Report (DAR) Note',
  'Progress Notes',
  'Medication Follow up',
  'Change in Condition Note',
  'Behavior Note',
  'Incident/Event Note',
  'Wound Care',
  'SBAR Note',
  'Discharge Note',
];

function NoteTypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-muted mb-1.5">
        Note Type
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      >
        <option value="">— None (not assigned to resident journey) —</option>
        {NOTE_TYPE_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <p className="text-xs text-text-muted mt-1">
        The type of clinical note this room generates for resident journeys
      </p>
    </div>
  );
}

// ── Character Picker ───────────────────────────────────────────────────────

function CharacterPicker({
  label,
  characters,
  selectedName,
  onSelect,
  onAddNew,
  showAge,
}: {
  label: string;
  characters: CharacterData[];
  selectedName: string;
  onSelect: (char: CharacterData) => void;
  onAddNew: () => void;
  showAge?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__add_new__') {
      onAddNew();
      return;
    }
    const char = characters.find((c) => c._id === val);
    if (char) onSelect(char);
  };

  const selected = characters.find((c) => c.name === selectedName);

  return (
    <div>
      <label className="block text-sm font-medium text-text-muted mb-1.5">
        {label}
      </label>
      <select
        value={selected?._id ?? ''}
        onChange={handleChange}
        className={INPUT_CLASS}
      >
        <option value="" disabled>
          — Choose a character —
        </option>
        {characters.map((char) => (
          <option key={char._id} value={char._id}>
            {char.name} · {char.gender}
            {showAge && char.age ? ` · ${char.age}y` : ''}
          </option>
        ))}
        <option value="__add_new__">+ Add New Character…</option>
      </select>
    </div>
  );
}

// ── Add Character Form ─────────────────────────────────────────────────────

function AddCharacterForm({
  role,
  onCreated,
  onCancel,
}: {
  role: 'clinician' | 'patient';
  onCreated: (char: CharacterData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>(
    role === 'clinician' ? 'female' : 'male',
  );
  const [age, setAge] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim() || !profile.trim() || !prompt.trim()) {
      setError('Name, profile, and prompt are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          role,
          gender,
          age: age ? Number(age) : null,
          email: email.trim(),
          profile: profile.trim(),
          prompt: prompt.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onCreated(data.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes('duplicate key')
          ? 'A character with this name already exists.'
          : message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-bg-page border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">
          New {role === 'clinician' ? 'Clinician' : 'Patient'}
        </h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-text-muted hover:text-text-primary text-sm"
        >
          ✕
        </button>
      </div>
      {error && <div className="text-status-red text-xs">{error}</div>}
      <div
        className={`grid ${role === 'patient' ? 'grid-cols-4' : 'grid-cols-2'} gap-3`}
      >
        <div className={role === 'patient' ? 'col-span-2' : ''}>
          <input
            placeholder="Full Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as 'male' | 'female')}
          className={INPUT_CLASS}
        >
          <option value="female">female</option>
          <option value="male">male</option>
        </select>
        {role === 'patient' && (
          <input
            type="number"
            placeholder="Age"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={1}
            className={INPUT_CLASS}
          />
        )}
      </div>
      {role === 'clinician' && (
        <input
          type="email"
          placeholder="Email (e.g. brooke@clinic.org)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT_CLASS}
        />
      )}
      <textarea
        placeholder="Profile / Background"
        value={profile}
        onChange={(e) => setProfile(e.target.value)}
        rows={2}
        className={`${INPUT_CLASS} resize-y`}
      />
      <textarea
        placeholder="System Prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        className={`${INPUT_CLASS} resize-y font-mono text-xs`}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-muted hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary-dark disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving...' : 'Create & Select'}
        </button>
      </div>
    </div>
  );
}
