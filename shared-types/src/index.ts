// ─────────────────────────────────────────────
//  RHA Simulation — Shared TypeScript Interfaces
//  Therapy Session context
//  clinician = therapist, patient = therapy patient
// ─────────────────────────────────────────────

export type IAgentRole = 'clinician' | 'patient';
export type IRoomStatus = 'active' | 'idle' | 'stopped';

export interface IRoom {
  roomId: string;
  name: string;
  status: IRoomStatus;
  activeSessionId?: string;
  messageCount?: number;
  lastSpeaker?: IAgentRole;
  lastMessageAt?: Date;
  clinicianId: string;
  patientName: string;
}

export type SpeakerGender = 'male' | 'female';

// Maps every character name to their gender.
// Used by WebSpeechProvider to select the correct voice.
export const SPEAKER_GENDERS: Record<string, SpeakerGender> = {
  // Clinicians
  'Emily Carter': 'female',
  'Daniel Brooks': 'male',
  'Sarah Martinez': 'female',
  // Patients
  'James Anderson': 'male',
  'John Brown': 'male',
  'David Davis': 'male',
  'Patricia Davis': 'female',
  'Robert Jones': 'male',
  'Barbara Miller': 'female',
};

export interface ISession {
  _id?: string;
  sessionId?: string;
  roomId: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'stopped';
  patientProfile: string;
  clinicianName: string;
  patientName: string;
  messageCount: number;
  scheduledStart: boolean;
  instanceName: string;
}

export interface IMessage {
  _id?: string;
  sessionId: string;
  roomId: string;
  role: IAgentRole;
  text: string;
  timestamp: Date;
}

export interface ISocketNewMessage {
  roomId: string;
  sessionId: string;
  role: IAgentRole;
  text: string;
  tone?: string;
  timestamp: Date;
}

export interface ISocketRoomUpdate {
  roomId: string;
  status: IRoomStatus;
  messageCount: number;
}

export interface IApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Oid Machine Types ──────────────────────────────────────────────────────

export const PARTICIPANT_ROLES = [
  'clinician',
  'patient',
  'family',
  'visitor',
  'nurse',
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export interface OidRegistration {
  roomId: string;
  role: ParticipantRole;
  name?: string;
}

export interface SpeakNowPayload {
  roomId: string;
  sessionId: string;
  role: ParticipantRole;
  text: string;
  tone?: string;
  timestamp: Date;
  turnNumber?: number;
  speakerName: string;
  speakerGender: SpeakerGender;
}

export interface TTSDonePayload {
  roomId: string;
  turnNumber: number;
  role: ParticipantRole;
}

export interface PrefetchAudioPayload {
  roomId: string;
  text: string;
  role: IAgentRole;
  speakerName: string;
  speakerGender: SpeakerGender;
  turnNumber: number;
}

export interface RoomParticipant {
  socketId: string;
  role: ParticipantRole;
  name: string;
  connected: boolean;
}

export interface OidRoomState {
  roomId: string;
  participants: Partial<Record<ParticipantRole, RoomParticipant>>;
  activeRole: ParticipantRole | null;
}

// ── TTS Provider Types ─────────────────────────────────────────────────────

/**
 * String union of all known TTS provider identifiers.
 * New providers must be added here when introduced.
 * Used by: TTSConfigStore, TTSProviderFactory, tts.config.json validation.
 */
export type TTSProviderName = 'webspeech' | 'xtts' | 'vits' | 'piper' | 'disabled';
