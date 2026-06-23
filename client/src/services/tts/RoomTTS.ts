/**
 * Per-room TTS orchestrator.
 *
 * One instance per room (6 rooms = 6 RoomTTS instances). Manages the
 * active provider, pending provider swaps, speech lifecycle, and
 * tts_done emission. Providers handle audio only — RoomTTS handles
 * session turn advancement.
 */

import type { Socket } from 'socket.io-client';
import type {
  ITTSProvider,
  TTSSpeakOptions,
  TTSProviderName,
} from './ITTSProvider';
import type { TTSDonePayload } from '@org/shared-types';
import { TTSProviderFactory } from './TTSProviderFactory';
import { ClientTTSConfigStore } from './TTSConfigStore';
import { VitsProvider } from './providers/VitsProvider';
import { SessionAudioRecorder } from './SessionAudioRecorder';

export class RoomTTS {
  private _roomId: string;
  private _socket: Socket | null = null;
  private _provider: ITTSProvider;
  private _pendingProvider: ITTSProvider | null = null;
  private _isSpeaking = false;
  private _isDashboard = false;
  private _unsubscribeConfig: (() => void) | null = null;
  private _queue: TTSSpeakOptions[] = [];
  private _processing = false;
  // Track the turn number currently being processed so incoming speak_now
  // events with a higher turn number can evict stale queued turns.
  private _currentTurnNumber = 0;

  constructor(roomId: string) {
    this._roomId = roomId;

    const configStore = ClientTTSConfigStore.getInstance();
    const providerName = configStore.getProvider(roomId);
    this._provider = TTSProviderFactory.create(providerName);

    this._unsubscribeConfig = configStore.onChange(
      (changedRoomId, newProviderName) => {
        this._handleConfigChange(changedRoomId, newProviderName);
      },
    );

    console.log(
      `[RoomTTS][${roomId}] Initialized with provider: ${this._provider.displayName}`,
    );
  }

  // ── Private methods ────────────────────────────────────────────────

  private _handleConfigChange(
    changedRoomId: string,
    newProviderName: TTSProviderName,
  ): void {
    if (changedRoomId !== this._roomId) return;
    if (newProviderName === this._provider.name) return;

    const newProvider = TTSProviderFactory.createForRoom(
      this._roomId,
      newProviderName,
    );

    if (this._isSpeaking) {
      this._pendingProvider = newProvider;
      console.log(
        `[RoomTTS][${this._roomId}] Provider swap PENDING ` +
          `(mid-speech) — will apply after current turn: ` +
          `${this._provider.name} → ${newProviderName}`,
      );
      return;
    }

    const previous = this._provider.name;
    this._provider = newProvider;
    console.log(
      `[RoomTTS][${this._roomId}] Provider swapped: ${previous} → ${newProviderName}`,
    );
  }

  private _applyPendingSwap(): void {
    if (!this._pendingProvider) return;
    const previous = this._provider.name;
    this._provider = this._pendingProvider;
    this._pendingProvider = null;
    console.log(
      `[RoomTTS][${this._roomId}] Pending provider swap applied: ` +
        `${previous} → ${this._provider.name}`,
    );
  }

  private _emitTTSError(role: string, error: string): void {
    if (!this._socket || this._isDashboard) return;
    this._socket.emit('tts_error', { roomId: this._roomId, role, error });
    console.warn(
      `[RoomTTS][${this._roomId}] tts_error emitted — role=${role} error=${error}`,
    );
  }

  private _emitTTSDone(payload: TTSDonePayload): void {
    if (!this._socket) {
      console.warn(
        `[RoomTTS][${this._roomId}] Cannot emit tts_done — no socket`,
      );
      return;
    }
    if (this._isDashboard) return;

    this._socket.emit('tts_done', payload);
    console.log(
      `[RoomTTS][${this._roomId}] tts_done emitted — turn=${payload.turnNumber} role=${payload.role}`,
    );
  }

  // ── Public methods ─────────────────────────────────────────────────

  /** True while a turn is actively being synthesised or played. */
  get isProcessing(): boolean {
    return this._processing;
  }

  /** Inject socket and dashboard flag after construction. */
  init(socket: Socket, isDashboard = false): void {
    this._socket = socket;
    this._isDashboard = isDashboard;
    console.log(
      `[RoomTTS][${this._roomId}] Socket attached — ` +
        `isDashboard=${isDashboard} provider=${this._provider.displayName}`,
    );
  }

  /** Orchestrate speech for one turn. Queues if already speaking. Emits tts_done after each turn. */
  async speak(options: TTSSpeakOptions): Promise<void> {
    // If a newer turn arrives while we are still processing, evict everything
    // queued so far — those turns are stale and the server has already moved on.
    if (this._processing && options.turnNumber > this._currentTurnNumber) {
      console.warn(
        `[RoomTTS][${this._roomId}] Stale queue evicted — ` +
          `current=${this._currentTurnNumber} incoming=${options.turnNumber}`,
      );
      this._queue.length = 0;
      this._processing = false;
      this._isSpeaking = false;
      this._provider.stop();
    }

    this._queue.push(options);

    if (this._processing) {
      console.log(
        `[RoomTTS][${this._roomId}] Turn ${options.turnNumber} QUEUED — ` +
          `queue depth=${this._queue.length}`,
      );
      return;
    }

    this._processing = true;

    while (this._queue.length > 0) {
      const current = this._queue.shift()!;
      this._currentTurnNumber = current.turnNumber;
      this._isSpeaking = true;

      console.log(
        `[RoomTTS][${this._roomId}] Turn ${current.turnNumber} START — ` +
          `role=${current.role} provider=${this._provider.name} ` +
          `tone=${current.tone} chars=${current.text.length} ` +
          `remaining=${this._queue.length}`,
      );

      try {
        if (this._socket && !this._isDashboard) {
          this._socket.emit('room_tts_state', {
            roomId: this._roomId,
            currentProvider: this._provider.name,
            pendingProvider: this._pendingProvider?.name ?? null,
            isSpeaking: true,
          });
        }

        await this._provider.speak({
          ...current,
          onError: (error) => this._emitTTSError(current.role, error),
        });

        this._emitTTSDone({
          roomId: this._roomId,
          turnNumber: current.turnNumber,
          role: current.role,
        });

        console.log(
          `[RoomTTS][${this._roomId}] tts_done emitted — ` +
            `room=${this._roomId} turn=${current.turnNumber}`,
        );
      } catch (err: any) {
        console.error(
          `[RoomTTS][${this._roomId}] speak() error — turn=${current.turnNumber}:`,
          err?.message ?? err,
        );

        console.warn(
          `[RoomTTS][${this._roomId}] Emitting tts_done after error — ` +
            `room=${this._roomId} turn=${current.turnNumber}`,
        );
        this._emitTTSDone({
          roomId: this._roomId,
          turnNumber: current.turnNumber,
          role: current.role,
        });
      }

      this._isSpeaking = false;
      this._applyPendingSwap();

      if (this._socket && !this._isDashboard) {
        this._socket.emit('room_tts_state', {
          roomId: this._roomId,
          currentProvider: this._provider.name,
          pendingProvider: this._pendingProvider?.name ?? null,
          isSpeaking: false,
        });
      }

      console.log(
        `[RoomTTS][${this._roomId}] Turn ${current.turnNumber} END — ` +
          `provider=${this._provider.name}`,
      );
    }

    this._processing = false;
  }

  /** Immediately stop current audio and flush the queue. */
  stop(): void {
    this._queue.length = 0;
    this._processing = false;
    this._currentTurnNumber = 0;
    this._provider.stop();
    this._isSpeaking = false;
    this._pendingProvider = null;
    // Release any unconsumed pre-synthesized audio blobs
    VitsProvider.clearCache();
    // Clear per-session recording buffer so the next session starts fresh
    SessionAudioRecorder.reset(this._roomId);
    console.log(`[RoomTTS][${this._roomId}] Stopped — queue flushed`);
  }

  /**
   * Unlock browser autoplay policy via a user gesture.
   * Delegates to the provider if it supports unlockAudio().
   * Safe to call on any provider — no-op if not supported.
   */
  async unlockAudio(): Promise<void> {
    if (
      'unlockAudio' in this._provider &&
      typeof (this._provider as Record<string, unknown>).unlockAudio ===
        'function'
    ) {
      await (
        this._provider as { unlockAudio: () => Promise<void> }
      ).unlockAudio();
    }
  }

  /** Direct provider override (e.g. for testing). Respects pending swap logic. */
  setProvider(providerName: TTSProviderName): void {
    this._handleConfigChange(this._roomId, providerName);
  }

  /** Returns the name of the currently active provider. */
  getCurrentProviderName(): TTSProviderName {
    return this._provider.name as TTSProviderName;
  }

  /** Returns pending provider name if a swap is queued, else null. */
  getPendingProviderName(): TTSProviderName | null {
    return (this._pendingProvider?.name as TTSProviderName) ?? null;
  }

  /**
   * Clean up all resources. Must be called on component unmount to
   * prevent memory leaks from orphaned config store listeners.
   */
  destroy(): void {
    this.stop();
    if (this._unsubscribeConfig) {
      this._unsubscribeConfig();
      this._unsubscribeConfig = null;
    }
    this._socket = null;
    console.log(`[RoomTTS][${this._roomId}] Destroyed`);
  }
}

export default RoomTTS;

// ── Per-room instance registry ──────────────────────────────
// One RoomTTS instance per room, created on demand, cached.
// This mirrors the old getRoomTTS() pattern for compatibility.

const _instances: Map<string, RoomTTS> = new Map();

export function getRoomTTS(roomId: string): RoomTTS {
  let instance = _instances.get(roomId);
  if (!instance) {
    instance = new RoomTTS(roomId);
    _instances.set(roomId, instance);
  }
  return instance;
}

export function destroyRoomTTS(roomId: string): void {
  const instance = _instances.get(roomId);
  if (instance) {
    instance.destroy();
    _instances.delete(roomId);
  }
}

export function destroyAllRoomTTS(): void {
  _instances.forEach((instance) => instance.destroy());
  _instances.clear();
}
