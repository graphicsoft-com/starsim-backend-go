import { useState } from 'react';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

interface Room {
  roomId: string;
  status: string;
}

interface Props {
  rooms: Room[];
  onClose: () => void;
  onChanged: () => void;
}

export default function AdvancedSettings({ rooms, onClose, onChanged }: Props) {
  const [newRoomId, setNewRoomId] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const id = newRoomId.trim();
    if (!id) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/simulation/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setNewRoomId('');
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (roomId: string) => {
    if (
      !window.confirm(
        `Delete "${roomId}" and all its configuration? This cannot be undone.`,
      )
    )
      return;
    setDeletingId(roomId);
    setError(null);
    try {
      const res = await fetch(
        `${SERVER_URL}/api/simulation/delete-room/${roomId}`,
        {
          method: 'DELETE',
        },
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-bg-section border-l border-border shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-text-primary font-semibold text-lg">
            Nebo Mapper
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {error && (
            <div className="bg-status-red/10 text-status-red px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Add new room */}
          <div>
            <h3 className="text-text-primary font-semibold text-sm mb-3">
              Add New Room
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. room7"
                value={newRoomId}
                onChange={(e) => setNewRoomId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-page border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newRoomId.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>

          {/* Room list */}
          <div>
            <h3 className="text-text-primary font-semibold text-sm mb-3">
              Rooms ({rooms.length})
            </h3>
            <div className="space-y-2">
              {rooms.map((room) => (
                <div
                  key={room.roomId}
                  className="flex items-center justify-between bg-bg-page border border-border rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${room.status === 'active' ? 'bg-status-green' : 'bg-text-muted'}`}
                    />
                    <span className="text-sm font-medium text-text-primary">
                      {room.roomId}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(room.roomId)}
                    disabled={
                      deletingId === room.roomId || room.status === 'active'
                    }
                    title={
                      room.status === 'active'
                        ? 'Stop the room before deleting'
                        : `Delete ${room.roomId}`
                    }
                    className="text-xs px-3 py-1.5 rounded-lg font-medium border border-status-red/30 text-status-red hover:bg-status-red/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {deletingId === room.roomId ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
