/**
 * No-op TTS provider used when TTS is intentionally disabled.
 *
 * speak() resolves immediately without producing audio, causing
 * RoomTTS to emit tts_done right away so the server advances
 * to the next turn without any audio delay.
 */

import type {
  ITTSProvider,
  TTSProviderName,
  TTSSpeakOptions,
} from '../ITTSProvider';

export class NullProvider implements ITTSProvider {
  readonly name: TTSProviderName = 'disabled';
  readonly displayName: string = 'Disabled';
  readonly isBrowserBased: boolean = true;

  async speak(_options: TTSSpeakOptions): Promise<void> {
    // Intentional no-op — TTS is disabled for this room.
  }

  stop(): void {
    // Nothing to stop.
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

export default NullProvider;
