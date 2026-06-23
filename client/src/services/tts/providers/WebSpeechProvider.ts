import type { ParticipantRole } from '@org/shared-types';
import type {
  ITTSProvider,
  TTSProviderName,
  TTSSpeakOptions,
} from '../ITTSProvider';

export class WebSpeechProvider implements ITTSProvider {
  readonly name: TTSProviderName = 'webspeech';
  readonly displayName: string = 'Web Speech API';
  readonly isBrowserBased: boolean = true;

  private _isSpeaking = false;
  private _currentUtterance: SpeechSynthesisUtterance | null = null;
  private _voiceCache: SpeechSynthesisVoice[] | null = null;
  private _keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private _safetyTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Private helpers ────────────────────────────────────────────────────

  private async _loadVoices(): Promise<SpeechSynthesisVoice[]> {
    if (this._voiceCache !== null) return this._voiceCache;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      this._voiceCache = voices;
      return this._voiceCache;
    }

    // Chrome loads voices asynchronously — wait for the event.
    return new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[WebSpeech] voiceschanged timed out after 3 s');
        resolve([]);
      }, 3000);

      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          clearTimeout(timeout);
          this._voiceCache = window.speechSynthesis.getVoices();
          resolve(this._voiceCache);
        },
        { once: true },
      );
    });
  }

  private async _selectVoice(
    role: ParticipantRole,
    gender: 'male' | 'female',
  ): Promise<SpeechSynthesisVoice | null> {
    const voices = await this._loadVoices();
    if (voices.length === 0) return null;

    const find = (pred: (v: SpeechSynthesisVoice) => boolean) =>
      voices.find(pred) ?? null;

    if (gender === 'female') {
      return (
        find((v) => v.name.includes('Jenny')) ?? // Microsoft neural female (best)
        find((v) => v.name.includes('Aria')) ?? // Microsoft neural female
        find((v) => v.name.includes('Samantha')) ?? // Apple female
        find((v) => v.name.includes('Victoria')) ?? // Apple female
        find((v) => v.name.includes('Zira')) ?? // Microsoft female (older)
        find((v) => v.name === 'Google US English') ?? // Chrome Linux (default, female)
        find((v) => v.lang === 'en-US' && !/\bmale\b/i.test(v.name)) ??
        find((v) => /\bfemale\b/i.test(v.name)) ??
        find(
          (v) =>
            !v.name.toLowerCase().includes('david') &&
            !v.name.toLowerCase().includes('mark') &&
            !v.name.toLowerCase().includes('guy') &&
            !v.name.toLowerCase().includes('alex'),
        ) ??
        voices[1] ??
        voices[0] ??
        null
      );
    }

    // male
    return (
      find((v) => v.name.includes('Guy')) ?? // Microsoft neural male (best)
      find((v) => v.name.includes('Davis')) ?? // Microsoft neural male
      find((v) => v.name.includes('Alex')) ?? // Apple male
      find((v) => v.name.includes('David')) ?? // Microsoft male (older)
      find((v) => v.name.includes('Mark')) ?? // Microsoft male
      find((v) => v.name.includes('Fred')) ?? // Apple male
      find((v) => v.name === 'Google UK English Male') ?? // Chrome Linux
      find(
        (v) =>
          v.lang === 'en-US' &&
          !v.name.toLowerCase().includes('zira') &&
          !v.name.toLowerCase().includes('jenny') &&
          !v.name.toLowerCase().includes('samantha') &&
          !/\bfemale\b/i.test(v.name),
      ) ??
      find((v) => /\bmale\b/i.test(v.name)) ??
      voices[0] ??
      null
    );
  }

  private _mapToneToRate(tone: string): number {
    const map: Record<string, number> = {
      neutral: 1.0,
      cheerful: 1.08,
      tired: 0.85,
      nostalgic: 0.9,
      anxious: 1.12,
      content: 0.93,
      frustrated: 1.1,
      lonely: 0.88,
    };
    return map[tone] ?? 1.0;
  }

  private _mapGenderToPitch(
    gender: 'male' | 'female',
    role: ParticipantRole,
  ): number {
    if (gender === 'female') {
      return role === 'patient' ? 1.05 : 1.1; // patient female slightly lower than caregiver
    }
    return role === 'patient' ? 0.85 : 0.95; // elderly patient lower, male caregiver neutral
  }

  /** Clear keep-alive and safety timers. */
  private _clearTimers(): void {
    if (this._keepAliveTimer !== null) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
    if (this._safetyTimer !== null) {
      clearTimeout(this._safetyTimer);
      this._safetyTimer = null;
    }
  }

  // ── Public interface ───────────────────────────────────────────────────

  /** Speak text via the browser Speech Synthesis API. Always resolves. */
  async speak(options: TTSSpeakOptions): Promise<void> {
    const { text, role, tone, roomId, turnNumber } = options;

    if (!('speechSynthesis' in window)) {
      console.error(`[WebSpeech][${roomId}] Speech synthesis not supported`);
      return;
    }

    // If something is currently speaking, stop it cleanly first.
    // A new speak_now means the server has decided to advance — respect it.
    if (this._isSpeaking) {
      console.warn(
        `[WebSpeech][${roomId}] Cancelling stuck/active speech before turn ${turnNumber}`,
      );
      this._clearTimers();
      this._isSpeaking = false;
      if (this._currentUtterance !== null) {
        this._currentUtterance.onend = null;
        this._currentUtterance.onerror = null;
        this._currentUtterance = null;
      }
      window.speechSynthesis.cancel();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    this._isSpeaking = true;

    return new Promise<void>(async (resolve) => {
      // ── Local safety timeout ─────────────────────────────────────
      // Chrome can silently stall and never fire onend/onerror.
      // Estimate how long the text should take plus a generous buffer,
      // then force-resolve if the browser goes silent.
      const words = text.trim().split(/\s+/).length;
      const estimatedMs = Math.round((words / 150) * 60 * 1000);
      const safetyMs = Math.max(12_000, estimatedMs + 6_000);

      const cleanup = () => {
        this._clearTimers();
        this._isSpeaking = false;
        this._currentUtterance = null;
      };

      this._safetyTimer = setTimeout(() => {
        if (!this._isSpeaking) return; // already resolved
        const msg = `Safety timeout (${safetyMs}ms) — browser stalled on turn ${turnNumber}`;
        console.warn(`[WebSpeech][${roomId}] ${msg}`);
        options.onError?.(msg);
        cleanup();
        window.speechSynthesis.cancel();
        resolve();
      }, safetyMs);

      const utterance = new SpeechSynthesisUtterance(text);
      this._currentUtterance = utterance;

      // Voice selection — use speakerGender if available, fall back to role
      const gender: 'male' | 'female' =
        (options as any).speakerGender ??
        (role === 'caregiver' ? 'female' : 'male');
      const voice = await this._selectVoice(role, gender);
      if (voice) utterance.voice = voice;

      utterance.rate = this._mapToneToRate(tone);
      utterance.pitch = this._mapGenderToPitch(gender, role);
      utterance.lang = 'en-US';
      utterance.volume = 1.0;

      utterance.onend = () => {
        cleanup();
        console.log(
          `[WebSpeech][${roomId}] Turn ${turnNumber} complete — role=${role}`,
        );
        resolve();
      };

      utterance.onerror = (event) => {
        cleanup();
        const msg = `SpeechSynthesisUtterance error on turn ${turnNumber}: ${event.error}`;
        console.warn(`[WebSpeech][${roomId}] ${msg}`);
        options.onError?.(msg);
        resolve();
      };

      window.speechSynthesis.speak(utterance);

      // ── Chrome keep-alive ────────────────────────────────────────
      // Chrome pauses speechSynthesis after ~15s of continuous speech.
      // Cycling pause/resume every 10s prevents the stall.
      this._keepAliveTimer = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 10_000);

      console.log(
        `[WebSpeech][${roomId}] Speaking turn ${turnNumber} — ` +
          `role=${role} tone=${tone} rate=${utterance.rate} ` +
          `safetyMs=${safetyMs}`,
      );
    });
  }

  /** Stop playback immediately, including any queued utterances. */
  stop(): void {
    this._clearTimers();
    this._isSpeaking = false;

    if (this._currentUtterance !== null) {
      this._currentUtterance.onend = null;
      this._currentUtterance.onerror = null;
      this._currentUtterance = null;
    }

    // Cancel the current utterance so stale speech does not keep playing after
    // the server has advanced to the next turn. Each browser tab owns its own
    // speechSynthesis queue, so this does not affect other tabs.
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /** Returns `true` if the browser supports speech synthesis and has voices. */
  async isAvailable(): Promise<boolean> {
    try {
      if (!('speechSynthesis' in window)) return false;
      const voices = await this._loadVoices();
      if (voices.length > 0) return true;
      console.warn('[WebSpeech] No voices available in this browser');
      return false;
    } catch {
      return false;
    }
  }

  /** Logs available voices and per-character voice assignments to the console. */
  async logVoiceDiagnostics(): Promise<void> {
    const voices = await this._loadVoices();
    console.group('[WebSpeech] Available voices on this machine:');
    voices.forEach((v, i) => {
      console.log(`  [${i}] ${v.name} (${v.lang}) local=${v.localService}`);
    });
    console.groupEnd();

    const characters: Array<{
      name: string;
      gender: 'male' | 'female';
      role: ParticipantRole;
    }> = [
      { name: 'Emily Carter', gender: 'female', role: 'caregiver' },
      { name: 'Daniel Brooks', gender: 'male', role: 'caregiver' },
      { name: 'Sarah Martinez', gender: 'female', role: 'caregiver' },
      { name: 'Lisa Nguyen', gender: 'female', role: 'caregiver' },
      { name: 'Marcus Thompson', gender: 'male', role: 'caregiver' },
      { name: 'Rachel Adams', gender: 'female', role: 'caregiver' },
      { name: 'James Anderson', gender: 'male', role: 'patient' },
      { name: 'Patricia Davis', gender: 'female', role: 'patient' },
      { name: 'Barbara Miller', gender: 'female', role: 'patient' },
    ];

    console.group('[WebSpeech] Voice assignments per character:');
    for (const char of characters) {
      const voice = await this._selectVoice(char.role, char.gender);
      console.log(
        `  ${char.name.padEnd(18)} (${char.gender}) → ${voice?.name ?? 'NO VOICE FOUND'}`,
      );
    }
    console.groupEnd();
  }
}

export default WebSpeechProvider;
