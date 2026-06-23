/**
 * Server-proxied TTS provider using the XTTS engine.
 *
 * Flow: browser → POST /api/tts (Express proxy) → mesa-xtts server.
 * The browser never calls XTTS directly. Voice identity comes from
 * reference WAV files hosted on the Express server.
 *
 * Requires unlockAudio() to be called once on a user gesture before
 * any audio can play (Chrome/Edge autoplay policy).
 */

import type {
  ITTSProvider,
  TTSProviderName,
  TTSSpeakOptions,
} from '../ITTSProvider';

export class XTTSProvider implements ITTSProvider {
  readonly name: TTSProviderName = 'xtts';
  readonly displayName: string = 'XTTS (Company Server)';
  readonly isBrowserBased: boolean = false;

  private readonly _proxyRoute: string;
  private readonly _healthRoute: string;
  private _currentAudio: HTMLAudioElement | null = null;
  private _currentBlobUrl: string | null = null;
  private _isSpeaking = false;
  private _audioUnlocked = false;

  /**
   * @param config Optional route overrides (dependency injection for
   *   testing or alternate deployments).
   */
  constructor(config?: { proxyRoute?: string; healthRoute?: string }) {
    this._proxyRoute = config?.proxyRoute ?? '/api/tts';
    this._healthRoute = config?.healthRoute ?? '/api/tts/health';
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private _mapToneToSpeed(tone: string): number {
    const map: Record<string, number> = {
      neutral: 1.0,
      cheerful: 1.05,
      tired: 0.88,
      nostalgic: 0.92,
      anxious: 1.12,
      content: 0.95,
      frustrated: 1.08,
      lonely: 0.9,
    };
    return map[tone] ?? 1.0;
  }

  private _revokeBlobUrl(): void {
    if (this._currentBlobUrl !== null) {
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }
  }

  private _cleanupAudio(): void {
    if (this._currentAudio !== null) {
      this._currentAudio.onended = null;
      this._currentAudio.onerror = null;
      this._currentAudio.pause();
      this._currentAudio = null;
    }
    this._revokeBlobUrl();
    this._isSpeaking = false;
  }

  private async _fetchAudio(options: TTSSpeakOptions): Promise<ArrayBuffer> {
    const { text, role, tone, roomId, turnNumber } = options;

    const response = await fetch(this._proxyRoute, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, role, tone, turnNumber, roomId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[XTTS][${roomId}] Proxy returned ${response.status}: ${errorText}`,
      );
    }

    return response.arrayBuffer();
  }

  private _createAudioFromBuffer(buffer: ArrayBuffer): HTMLAudioElement {
    // Explicit Blob construction ensures correct MIME type regardless
    // of server Content-Type headers. response.blob() may produce
    // type-less blobs that fail silently in some browsers.
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    this._currentBlobUrl = url;

    const audio = new Audio(url);
    this._currentAudio = audio;
    return audio;
  }

  // ── Public interface ───────────────────────────────────────────────────

  /**
   * Unlock browser autoplay policy with a user gesture.
   *
   * Must be called ONCE when the operator clicks "Start Session" on
   * OidPage. Chrome/Edge silently reject audio.play() without a prior
   * user gesture — without unlocking, tts_done is never emitted and
   * the server waits 30 s before advancing.
   */
  async unlockAudio(): Promise<void> {
    if (this._audioUnlocked) return;

    try {
      const silent = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAA' +
          'EAAQAArEQAACxEAAABAAgAZGF0YQQAAAAAAA==',
      );
      await silent.play();
      this._audioUnlocked = true;
      console.log('[XTTS] Audio context unlocked — autoplay enabled');
    } catch (err) {
      console.warn('[XTTS] Audio unlock failed:', err);
    }
  }

  /** Fetch audio from the XTTS proxy and play it. Always resolves. */
  async speak(options: TTSSpeakOptions): Promise<void> {
    const { text, role, tone, roomId, turnNumber } = options;

    if (this._isSpeaking) {
      console.warn(
        `[XTTS][${roomId}] Already speaking — skipping turn ${turnNumber}`,
      );
      return;
    }

    if (!text || text.trim().length === 0) {
      console.warn(
        `[XTTS][${roomId}] Empty text — skipping turn ${turnNumber}`,
      );
      return;
    }

    this._isSpeaking = true;

    console.log(
      `[XTTS][${roomId}] Requesting audio — turn=${turnNumber} role=${role} tone=${tone} chars=${text.length}`,
    );

    try {
      const buffer = await this._fetchAudio(options);
      console.log(`[XTTS][${roomId}] Audio received — turn=${turnNumber}`);

      const audio = this._createAudioFromBuffer(buffer);
      audio.playbackRate = this._mapToneToSpeed(tone);

      await new Promise<void>((resolve) => {
        audio.onended = () => {
          // tts_done is emitted by RoomTTS after speak() resolves.
          // Providers are responsible for audio only — not session turn advancement.
          console.log(
            `[XTTS][${roomId}] Turn ${turnNumber} complete — role=${role}`,
          );
          this._cleanupAudio();
          resolve();
        };

        audio.onerror = (event) => {
          console.warn(
            `[XTTS][${roomId}] Turn ${turnNumber} playback error`,
            event,
          );
          this._cleanupAudio();
          resolve();
        };

        audio.play().catch((err) => {
          console.warn(
            `[XTTS][${roomId}] Turn ${turnNumber} play() rejected — ${err}`,
          );
          this._cleanupAudio();
          resolve();
        });
      });
    } catch (err) {
      console.error(`[XTTS][${roomId}] Turn ${turnNumber} failed —`, err);
      this._cleanupAudio();
    }
  }

  /** Stop current audio and clean up resources. */
  stop(): void {
    this._cleanupAudio();
  }

  /** Ping the XTTS health endpoint. Returns false on any error. */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this._healthRoute, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default XTTSProvider;
