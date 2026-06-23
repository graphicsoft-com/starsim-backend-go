import RoomCard from './RoomCard';
import { RoomStatus } from '../hooks/useRoomStatus';

type OidConnections = Record<string, { clinician?: boolean; caregiver?: boolean; patient: boolean }>;

interface RoomGridProps {
  rooms: RoomStatus[];
  oidConns: OidConnections;
  selectedRooms: Set<string>;
  onToggleSelect: (roomId: string) => void;
  onEditConfig: (roomId: string) => void;
  onStart?: (roomId: string) => Promise<void>;
  onStop?: (roomId: string) => Promise<void>;
}

export default function RoomGrid({
  rooms,
  oidConns,
  selectedRooms,
  onToggleSelect,
  onEditConfig,
  onStart,
  onStop,
}: RoomGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {rooms.map((room) => (
        <RoomCard
          key={room.roomId}
          room={room}
          caregiverConnected={(oidConns[room.roomId]?.clinician || oidConns[room.roomId]?.caregiver) ?? false}
          patientConnected={oidConns[room.roomId]?.patient ?? false}
          selected={selectedRooms.has(room.roomId)}
          onToggleSelect={onToggleSelect}
          onEditConfig={onEditConfig}
          onStart={onStart}
          onStop={onStop}
        />
      ))}
    </div>
  );
}
