import * as vits from '@diffusionstudio/vits-web';
import type { VoiceId } from '@diffusionstudio/vits-web';
import type {
  ITTSProvider,
  TTSProviderName,
  TTSSpeakOptions,
} from '../ITTSProvider';
import { SessionAudioRecorder } from '../SessionAudioRecorder';
import { WebSpeechProvider } from './WebSpeechProvider';

const CHARACTER_VOICE_MAP: Record<string, string> = {
  'Emily Carter': 'en_US-lessac-medium',
  'Sarah Martinez': 'en_US-hfc_female-medium',
  'Daniel Brooks': 'en_US-ryan-high',
  'Lisa Nguyen': 'en_US-kathleen-low',
  'Marcus Thompson': 'en_US-danny-low',
  'Rachel Adams': 'en_US-ljspeech-medium',
  'Patricia Davis': 'en_US-kathleen-low',
  'Barbara Miller': 'en_US-ljspeech-medium',
  'James Anderson': 'en_US-ryan-low',
  'John Brown': 'en_US-joe-medium',
  'David Davis': 'en_US-danny-low',
  'Robert Jones': 'en_US-arctic-medium',
};
const DEFAULT_FEMALE_VOICE = 'en_US-hfc_female-medium';
const DEFAULT_MALE_VOICE = 'en_US-ryan-high';

export class VitsProvider implements ITTSProvider {
  readonly name: TTSProviderName = 'vits';
  readonly displayName: string = 'Vits';
  readonly isBrowserBased: boolean = true;

  private _isSpeaking = false;
  private _currentAudio: HTMLAudioElement | null = null;
  // Tracks the pending play() Promise so stop() can defer pause() until it
  // resolves — calling pause() on a pending play() throws AbortError.
  private _playPromise: Promise<void> | null = null;
  // Shared across all instances in the same browser tab.
  // OidPage preloads using one instance while RoomTTS may speak with another.
  private static _downloadedVoices = new Set<string>();
  private static _downloadPromises = new Map<string, Promise<void>>();
  // Pre-synthesized audio cache: cacheKey → blob URL
  private static _audioCache = new Map<string, string>();
  // Parallel blob store for recording: cacheKey → original Blob (consumed in speak())
  private static _blobCache = new Map<string, Blob>();
  private static _prefetchPromises = new Map<string, Promise<void>>();
  // WASM crash guard: once ONNX Runtime aborts, it cannot recover
  private static _wasmDead = false;
  // Synthesis budget: each vits.predict() allocates ~63 MB of WASM memory
  // that can never be freed. Cap total calls to prevent exhaustion.
  private static _synthCount = 0;
  private static readonly _MAX_SYNTH_CALLS = 60;
  // Sliding-window cache: only keep the N most recent pre-synth blobs
  private static readonly _MAX_CACHE_SIZE = 5;

  /**
   * Normalize LLM-generated text to ASCII-safe characters.
   *
   * Root cause: the Piper ONNX model's Gather_6 embedding layer only has 130
   * rows (valid indices 0-129), but the model config's phoneme_id_map maps
   * the IPA syllabic diacritic ̩ (U+0329) to ID 144 and other symbols to
   * IDs 130-153.  Espeak-ng emits ̩ for syllabic consonants in common English
   * words ("bottle", "button", "little", …) and also processes curly quotes
   * in a way that can produce out-of-range IDs.
   *
   * Sanitising the text input cannot fully prevent espeak-ng from producing
   * ID 144, but it eliminates the most common trigger (curly/smart quotes and
   * other non-ASCII characters).
   */
  private static _sanitizeText(text: string): string {
    return (
      text
        .replace(/[\u2018\u2019\u201A]/g, "'")
        .replace(/[\u201C\u201D\u201E]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[\u2022\u00B7]/g, '-')
        .replace(/[\u00A0]/g, ' ')
        // Only keep characters that are within the Piper VITS phoneme vocabulary
        // (indices 0-129). Printable ASCII chars outside this set — such as
        // *, #, @, [, ], {, |, }, ~, ^, `, \ — can produce out-of-bounds
        // phoneme indices (e.g. idx=144) that crash the ONNX Gather node and
        // permanently corrupt the WASM runtime.
        .replace(/[^a-zA-Z0-9 .,!?'"()\-:;\n]/g, '')
    );
  }

  /** Returns true if synthesis is still possible. */
  private static _canSynthesize(): boolean {
    if (VitsProvider._wasmDead) return false;
    if (VitsProvider._synthCount >= VitsProvider._MAX_SYNTH_CALLS) {
      console.warn(
        `[VitsProvider] Synthesis budget exceeded (${VitsProvider._synthCount}/${VitsProvider._MAX_SYNTH_CALLS}) — skipping`,
      );
      return false;
    }
    return true;
  }

  /** Detect fatal WASM errors and set the dead flag. */
  private static _handleSynthError(err: unknown): void {
    if (!(err instanceof Error)) {
      console.warn('[VitsProvider] Non-Error thrown from WASM synthesis:', err);
      return;
    }
    if (
      err instanceof Error &&
      (err.message.includes('Aborted') ||
        err.message.includes('indices element out of data bounds') ||
        err.message.includes('failed to allocate'))
    ) {
      console.error(
        '[VitsProvider] WASM runtime crashed — disabling VITS synthesis',
      );
      VitsProvider._wasmDead = true;
    }
  }

  /** Evict the oldest cache entry if at capacity. */
  private static _evictOldestCache(): void {
    if (VitsProvider._audioCache.size < VitsProvider._MAX_CACHE_SIZE) return;
    const oldest = VitsProvider._audioCache.keys().next().value;
    if (oldest) {
      URL.revokeObjectURL(VitsProvider._audioCache.get(oldest)!);
      VitsProvider._audioCache.delete(oldest);
      VitsProvider._blobCache.delete(oldest);
    }
  }

  /** Revoke all cached blob URLs and reset synthesis state. */
  static clearCache(): void {
    for (const url of VitsProvider._audioCache.values()) {
      URL.revokeObjectURL(url);
    }
    VitsProvider._audioCache.clear();
    VitsProvider._blobCache.clear();
    VitsProvider._prefetchPromises.clear();
    VitsProvider._synthCount = 0;
    console.log('[VitsProvider] Cache cleared');
  }

  private _resolveVoiceId(
    speakerName?: string,
    gender?: 'male' | 'female',
  ): string {
    if (speakerName && CHARACTER_VOICE_MAP[speakerName])
      return CHARACTER_VOICE_MAP[speakerName];
    if (gender === 'female') return DEFAULT_FEMALE_VOICE;
    return DEFAULT_MALE_VOICE;
  }

  async prepareVoice(
    voiceId: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    if (VitsProvider._downloadedVoices.has(voiceId)) return;
    if (VitsProvider._downloadPromises.has(voiceId))
      return VitsProvider._downloadPromises.get(voiceId)!;

    const downloadPromise = vits
      .download(voiceId as VoiceId, (progress) => {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        onProgress?.(percent);
      })
      .then(() => {
        VitsProvider._downloadedVoices.add(voiceId);
        VitsProvider._downloadPromises.delete(voiceId);
      });

    VitsProvider._downloadPromises.set(voiceId, downloadPromise);
    return downloadPromise;
  }

  async preloadVoiceForCharacter(
    speakerName: string,
    gender?: 'male' | 'female',
    onProgress?: (voiceId: string, percent: number) => void,
  ): Promise<void> {
    const voiceId = this._resolveVoiceId(speakerName, gender);
    await this.prepareVoice(voiceId, (pct) => onProgress?.(voiceId, pct));
  }

  /**
   * Pre-synthesize audio for a future turn and cache the blob URL.
   * Called when the server sends prefetch_audio so the audio is ready
   * before speak_now arrives — eliminating synthesis latency.
   */
  static async preSynthesize(
    text: string,
    speakerName: string,
    gender: 'male' | 'female',
    cacheKey: string,
  ): Promise<void> {
    if (!VitsProvider._canSynthesize()) return;
    if (VitsProvider._audioCache.has(cacheKey)) return;
    if (VitsProvider._prefetchPromises.has(cacheKey)) {
      return VitsProvider._prefetchPromises.get(cacheKey)!;
    }

    const promise = (async () => {
      try {
        const safeText = VitsProvider._sanitizeText(text);
        if (!safeText.trim()) return;

        const instance = new VitsProvider();
        const voiceId = instance._resolveVoiceId(speakerName, gender);

        // Wait for voice model download if needed
        if (!VitsProvider._downloadedVoices.has(voiceId)) {
          await instance.prepareVoice(voiceId);
        }

        if (!VitsProvider._canSynthesize()) return;

        VitsProvider._synthCount++;
        const blob = await vits.predict({
          text: safeText,
          voiceId: voiceId as VoiceId,
        });
        VitsProvider._evictOldestCache();
        VitsProvider._blobCache.set(cacheKey, blob);
        const url = URL.createObjectURL(blob);
        VitsProvider._audioCache.set(cacheKey, url);
        console.log(
          `[VitsProvider] Pre-synthesized cached — key=${cacheKey} (synth #${VitsProvider._synthCount})`,
        );
      } catch (err) {
        VitsProvider._handleSynthError(err);
        const safeText = VitsProvider._sanitizeText(text);
        console.warn(
          `[VitsProvider] Pre-synthesis failed — key=${cacheKey} text=${JSON.stringify(safeText.slice(0, 120))}`,
          err,
        );
      } finally {
        VitsProvider._prefetchPromises.delete(cacheKey);
      }
    })();

    VitsProvider._prefetchPromises.set(cacheKey, promise);
    return promise;
  }

  async speak(options: TTSSpeakOptions): Promise<void> {
    const { text } = options;
    const speakerName = options.speakerName;
    const gender = options.speakerGender;

    if (this._isSpeaking && this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio.src = '';
      this._currentAudio = null;
      this._isSpeaking = false;
    }

    if (!text || text.trim().length === 0) return;

    const voiceId = this._resolveVoiceId(speakerName, gender);
    const cacheKey = `${options.roomId}:${options.turnNumber}`;
    this._isSpeaking = true;

    // Check prefetch cache first — instant playback if available
    const cachedUrl = VitsProvider._audioCache.get(cacheKey);
    if (cachedUrl) {
      VitsProvider._audioCache.delete(cacheKey);
      const cachedBlob = VitsProvider._blobCache.get(cacheKey);
      VitsProvider._blobCache.delete(cacheKey);
      if (cachedBlob) {
        SessionAudioRecorder.addTurn(options.roomId, {
          turnNumber: options.turnNumber,
          speakerName: options.speakerName,
          blob: cachedBlob,
        });
      }
      console.log(`[VitsProvider] Cache HIT — key=${cacheKey}`);
      return new Promise<void>((resolve) => {
        const audio = new Audio(cachedUrl);
        this._currentAudio = audio;

        audio.onended = () => {
          this._isSpeaking = false;
          this._currentAudio = null;
          URL.revokeObjectURL(cachedUrl);
          resolve();
        };
        audio.onerror = () => {
          this._isSpeaking = false;
          this._currentAudio = null;
          URL.revokeObjectURL(cachedUrl);
          resolve();
        };
        audio.play().catch(() => {
          this._isSpeaking = false;
          this._currentAudio = null;
          URL.revokeObjectURL(cachedUrl);
          resolve();
        });
      });
    }

    // Wait for any in-flight prefetch for this key before synthesizing fresh
    if (VitsProvider._prefetchPromises.has(cacheKey)) {
      await VitsProvider._prefetchPromises.get(cacheKey);
      const lateCachedUrl = VitsProvider._audioCache.get(cacheKey);
      if (lateCachedUrl) {
        VitsProvider._audioCache.delete(cacheKey);
        const lateCachedBlob = VitsProvider._blobCache.get(cacheKey);
        VitsProvider._blobCache.delete(cacheKey);
        if (lateCachedBlob) {
          SessionAudioRecorder.addTurn(options.roomId, {
            turnNumber: options.turnNumber,
            speakerName: options.speakerName,
            blob: lateCachedBlob,
          });
        }
        console.log(`[VitsProvider] Cache HIT (late) — key=${cacheKey}`);
        return new Promise<void>((resolve) => {
          const audio = new Audio(lateCachedUrl);
          this._currentAudio = audio;

          audio.onended = () => {
            this._isSpeaking = false;
            this._currentAudio = null;
            URL.revokeObjectURL(lateCachedUrl);
            resolve();
          };
          audio.onerror = () => {
            this._isSpeaking = false;
            this._currentAudio = null;
            URL.revokeObjectURL(lateCachedUrl);
            resolve();
          };
          audio.play().catch(() => {
            this._isSpeaking = false;
            this._currentAudio = null;
            URL.revokeObjectURL(lateCachedUrl);
            resolve();
          });
        });
      }
    }

    console.log(
      `[VitsProvider] Cache MISS — synthesizing fresh — key=${cacheKey}`,
    );

    return new Promise<void>((resolve) => {
      const doSpeak = async () => {
        try {
          if (!VitsProvider._canSynthesize()) {
            const reason = VitsProvider._wasmDead
              ? 'VITS WASM runtime crashed — synthesis disabled'
              : `VITS synthesis budget exceeded (${VitsProvider._synthCount}/${VitsProvider._MAX_SYNTH_CALLS})`;
            console.warn(
              `[VitsProvider] ${reason} — falling back to WebSpeech`,
            );
            this._isSpeaking = false;
            this._currentAudio = null;
            // Fall back to Web Speech API so the turn is still spoken aloud
            // rather than silently skipped (which would confuse the server ack).
            const fallback = new WebSpeechProvider();
            return fallback.speak(options).then(resolve);
          }

          if (!VitsProvider._downloadedVoices.has(voiceId)) {
            await this.prepareVoice(voiceId);
          }

          const safeText = VitsProvider._sanitizeText(text);
          if (!safeText.trim()) {
            this._isSpeaking = false;
            this._currentAudio = null;
            resolve();
            return;
          }

          VitsProvider._synthCount++;
          const blob = await vits.predict({
            text: safeText,
            voiceId: voiceId as VoiceId,
          });
          SessionAudioRecorder.addTurn(options.roomId, {
            turnNumber: options.turnNumber,
            speakerName: options.speakerName,
            blob,
          });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          this._currentAudio = audio;

          audio.onended = () => {
            this._isSpeaking = false;
            this._currentAudio = null;
            URL.revokeObjectURL(url);
            resolve();
          };

          audio.onerror = () => {
            this._isSpeaking = false;
            this._currentAudio = null;
            this._playPromise = null;
            URL.revokeObjectURL(url);
            resolve();
          };

          const pp = audio.play();
          this._playPromise = pp
            .then(() => {
              this._playPromise = null;
            })
            .catch(() => {
              this._playPromise = null;
            });
          await pp;
        } catch (err) {
          VitsProvider._handleSynthError(err);
          const msg = err instanceof Error ? err.message : String(err);
          // AbortError means stop() interrupted play() — expected, not a failure.
          // Don't emit tts_error to the server for deliberate interrupts.
          const isAbort = err instanceof Error && err.name === 'AbortError';
          if (!isAbort) {
            console.warn(
              `[VitsProvider] speak() synthesis failed — text=${JSON.stringify(text.slice(0, 120))}`,
              err,
            );
            options.onError?.(msg);
          }
          this._isSpeaking = false;
          this._currentAudio = null;
          this._playPromise = null;
          resolve();
        }
      };
      doSpeak();
    });
  }

  stop(): void {
    this._isSpeaking = false;
    if (this._currentAudio) {
      const audio = this._currentAudio;
      this._currentAudio = null;
      const pending = this._playPromise;
      this._playPromise = null;
      if (pending) {
        // play() is mid-flight — defer pause until it settles to avoid AbortError.
        pending
          .then(() => {
            audio.pause();
            audio.src = '';
          })
          .catch(() => {
            audio.src = '';
          });
      } else {
        audio.pause();
        audio.src = '';
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      return typeof WebAssembly !== 'undefined';
    } catch {
      return false;
    }
  }
}
