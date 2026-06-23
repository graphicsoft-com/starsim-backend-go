/**
 * @file ITTSProvider.ts — Behavioral contract for all TTS providers.
 * New engines implement this interface to be usable platform-wide.
 */

import type {
  ParticipantRole,
  TTSProviderName,
  SpeakerGender,
} from '@org/shared-types';

export type { TTSProviderName };

// ── Supporting Types ───────────────────────────────────────────────────────

/** Options bag for {@link ITTSProvider.speak}. */
export interface TTSSpeakOptions {
  /** The text to be spoken aloud. */
  text: string;

  /** Agent role — affects voice selection (e.g. 'caregiver', 'patient'). */
  role: ParticipantRole;

  /** Emotional tone string from ConversationState — affects delivery style. */
  tone: string;

  /** Which room this speech is for — used for logging. */
  roomId: string;

  /** Which session — used for logging and metrics. */
  sessionId: string;

  /** Which turn — used for logging. */
  turnNumber: number;

  /** The speaker's character name, e.g. "Patricia Davis". */
  speakerName: string;

  /** The speaker's gender — determines voice selection. */
  speakerGender: SpeakerGender;

  /** Called when a recoverable error occurs during speech (e.g. safety timeout, onerror). */
  onError?: (error: string) => void;
}

// ── Provider Interface ─────────────────────────────────────────────────────

export interface ITTSProvider {
  /** Unique provider ID, e.g. `'xtts'`, `'webspeech'`. */
  readonly name: string;

  /** Human-readable name for UI display. */
  readonly displayName: string;

  /** `true` if browser-only (WebSpeech), `false` if server-based (XTTS, etc...). */
  readonly isBrowserBased: boolean;

  /** Dispatch speech. Resolves on dispatch, not playback end. Must never throw. */
  speak(options: TTSSpeakOptions): Promise<void>;

  /** Stop current audio immediately. Safe to call when idle. */
  stop(): void;

  /** Health check — returns `false` on error, never rejects. */
  isAvailable(): Promise<boolean>;
}
