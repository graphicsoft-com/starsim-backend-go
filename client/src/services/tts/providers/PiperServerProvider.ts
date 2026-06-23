/**
 * Server-proxied TTS provider using the native Piper binary.
 *
 * Flow: browser → POST /api/tts/piper (Express) → piper binary on server.
 * No browser WASM involved — no synthesis budget, no _wasmDead flag,
 * no idx=144 crash from espeak-ng phoneme IDs, no memory leak.
 *
 * Includes a prefetch cache so audio is pre-fetched from the server during
 * the previous turn and plays instantly on speak_now — same latency
 * elimination strategy as VitsProvider.preSynthesize().
 */

import type {
  ITTSProvider,
  TTSProviderName,
  TTSSpeakOptions,
} from '../ITTSProvider';
import { SessionAudioRecorder } from '../SessionAudioRecorder';

export class PiperServerProvider implements ITTSProvider {
  readonly name: TTSProviderName = 'piper';
  readonly displayName: string = 'Piper (Server)';
  readonly isBrowserBased: boolean = false;

  private _currentAudio: HTMLAudioElement | null = null;
  private _currentBlobUrl: string | null = null;
  private _isSpeaking = false;

  // Prefetch cache: cacheKey ("roomId:turnNumber") → ArrayBuffer of WAV audio
  private static _audioCache = new Map<string, ArrayBuffer>();
  private static _prefetchPromises = new Map<string, Promise<void>>();
  private static readonly _MAX_CACHE_SIZE = 5;

  // ── Private helpers ─────────────────────────────────────────────────

  private _cleanupAudio(): void {
    if (this._currentAudio !== null) {
      this._currentAudio.onended = null;
      this._currentAudio.onerror = null;
      this._currentAudio.pause();
      this._currentAudio = null;
    }
    if (this._currentBlobUrl !== null) {
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }
    this._isSpeaking = false;
  }

  private _createAudioFromBuffer(buffer: ArrayBuffer): HTMLAudioElement {
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    this._currentBlobUrl = url;
    const audio = new Audio(url);
    this._currentAudio = audio;
    return audio;
  }

  private static _evictOldestCache(): void {
    if (
      PiperServerProvider._audioCache.size < PiperServerProvider._MAX_CACHE_SIZE
    )
      return;
    const oldest = PiperServerProvider._audioCache.keys().next().value;
    if (oldest) PiperServerProvider._audioCache.delete(oldest);
  }

  private static async _fetchFromServer(
    text: string,
    speakerName: string,
    gender: string,
    roomId: string,
    turnNumber: number,
  ): Promise<ArrayBuffer> {
    const response = await fetch('/api/tts/piper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speakerName, gender, roomId, turnNumber }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[Piper][${roomId}] Server returned ${response.status}: ${errorText}`,
      );
    }

    return response.arrayBuffer();
  }

  // ── Prefetch API ─────────────────────────────────────────────────────

  /**
   * Pre-fetch audio from the server for a future turn and cache it.
   * Called on prefetch_audio socket event so audio is ready before speak_now.
   * Mirrors VitsProvider.preSynthesize() but moves synthesis to the server.
   */
  static async preFetch(
    text: string,
    speakerName: string,
    gender: 'male' | 'female',
    cacheKey: string,
    roomId: string,
    turnNumber: number,
  ): Promise<void> {
    if (PiperServerProvider._audioCache.has(cacheKey)) return;
    if (PiperServerProvider._prefetchPromises.has(cacheKey)) {
      return PiperServerProvider._prefetchPromises.get(cacheKey)!;
    }

    const promise = (async () => {
      try {
        if (!text.trim()) return;
        const buffer = await PiperServerProvider._fetchFromServer(
          text,
          speakerName,
          gender,
          roomId,
          turnNumber,
        );
        PiperServerProvider._evictOldestCache();
        PiperServerProvider._audioCache.set(cacheKey, buffer);
        console.log(
          `[PiperServerProvider] Pre-fetched cached — key=${cacheKey}`,
        );
      } catch (err) {
        console.warn(
          `[PiperServerProvider] Pre-fetch failed — key=${cacheKey}`,
          err,
        );
      } finally {
        PiperServerProvider._prefetchPromises.delete(cacheKey);
      }
    })();

    PiperServerProvider._prefetchPromises.set(cacheKey, promise);
    return promise;
  }

  /** Clear prefetch cache (e.g. on catch_up). */
  static clearCache(): void {
    PiperServerProvider._audioCache.clear();
    PiperServerProvider._prefetchPromises.clear();
    console.log('[PiperServerProvider] Cache cleared');
  }

  // ── ITTSProvider interface ───────────────────────────────────────────

  /** Fetch audio from the Piper server proxy and play it. Always resolves. */
  async speak(options: TTSSpeakOptions): Promise<void> {
    const { text, speakerName, speakerGender, roomId, turnNumber } = options;

    if (this._isSpeaking) {
      console.warn(
        `[Piper][${roomId}] Already speaking — skipping turn ${turnNumber}`,
      );
      return;
    }

    if (!text || text.trim().length === 0) {
      console.warn(
        `[Piper][${roomId}] Empty text — skipping turn ${turnNumber}`,
      );
      return;
    }

    this._isSpeaking = true;
    const cacheKey = `${roomId}:${turnNumber}`;

    try {
      let buffer: ArrayBuffer;

      // Cache HIT — audio was pre-fetched during the previous turn
      const cached = PiperServerProvider._audioCache.get(cacheKey);
      if (cached) {
        PiperServerProvider._audioCache.delete(cacheKey);
        console.log(`[Piper][${roomId}] Cache HIT — turn=${turnNumber}`);
        buffer = cached;
      } else {
        // Wait for an in-flight prefetch before issuing a second request
        if (PiperServerProvider._prefetchPromises.has(cacheKey)) {
          await PiperServerProvider._prefetchPromises.get(cacheKey);
          const lateCached = PiperServerProvider._audioCache.get(cacheKey);
          if (lateCached) {
            PiperServerProvider._audioCache.delete(cacheKey);
            console.log(
              `[Piper][${roomId}] Cache HIT (late) — turn=${turnNumber}`,
            );
            buffer = lateCached;
          } else {
            // Prefetch failed — fall back to fresh fetch
            console.log(
              `[Piper][${roomId}] Cache MISS (prefetch failed) — fetching fresh — turn=${turnNumber}`,
            );
            buffer = await PiperServerProvider._fetchFromServer(
              text,
              speakerName,
              speakerGender,
              roomId,
              turnNumber,
            );
          }
        } else {
          console.log(
            `[Piper][${roomId}] Cache MISS — fetching fresh — turn=${turnNumber}`,
          );
          buffer = await PiperServerProvider._fetchFromServer(
            text,
            speakerName,
            speakerGender,
            roomId,
            turnNumber,
          );
        }
      }

      console.log(`[Piper][${roomId}] Audio received — turn=${turnNumber}`);

      // Record for session playback
      SessionAudioRecorder.addTurn(roomId, {
        turnNumber,
        speakerName,
        blob: new Blob([buffer], { type: 'audio/wav' }),
      });

      const audio = this._createAudioFromBuffer(buffer);

      await new Promise<void>((resolve) => {
        audio.onended = () => {
          console.log(`[Piper][${roomId}] Turn ${turnNumber} complete`);
          this._cleanupAudio();
          resolve();
        };

        audio.onerror = (event) => {
          console.warn(
            `[Piper][${roomId}] Turn ${turnNumber} playback error`,
            event,
          );
          this._cleanupAudio();
          resolve();
        };

        audio.play().catch((err) => {
          console.warn(
            `[Piper][${roomId}] Turn ${turnNumber} play() rejected — ${err}`,
          );
          this._cleanupAudio();
          resolve();
        });
      });
    } catch (err) {
      console.error(`[Piper][${roomId}] Turn ${turnNumber} failed —`, err);
      this._cleanupAudio();
    }
  }

  stop(): void {
    this._cleanupAudio();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch('/api/tts/piper/health');
      if (!res.ok) return false;
      const data = (await res.json()) as { available?: boolean };
      return data.available === true;
    } catch {
      return false;
    }
  }
}
