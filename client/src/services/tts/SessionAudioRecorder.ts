/**
 * SessionAudioRecorder — per-room VITS audio recording.
 *
 * Collects one Blob per spoken turn (from VitsProvider) and,
 * on demand, concatenates them into a single WAV file and triggers
 * a browser download.
 *
 * Architecture notes:
 * - All state is static (one singleton per browser tab).
 * - Each tab records only its own role's audio (one role per OidPage tab).
 * - The recorder does NOT know about sessions — it just appends blobs.
 *   RoomTTS.stop() calls reset() to clear between sessions.
 */

export interface AudioTurn {
  turnNumber: number;
  speakerName: string;
  blob: Blob;
}

export class SessionAudioRecorder {
  private static _turns: Map<string, AudioTurn[]> = new Map();

  // ── Write ──────────────────────────────────────────────────────────

  /** Append a synthesised audio blob for a single conversation turn. */
  static addTurn(roomId: string, turn: AudioTurn): void {
    if (!this._turns.has(roomId)) this._turns.set(roomId, []);
    this._turns.get(roomId)!.push(turn);
    console.log(
      `[SessionAudioRecorder][${roomId}] Turn ${turn.turnNumber} recorded — ` +
        `speaker=${turn.speakerName} total=${this._turns.get(roomId)!.length}`,
    );
  }

  /** Clear all recorded turns for a room (call on session stop). */
  static reset(roomId: string): void {
    const count = this._turns.get(roomId)?.length ?? 0;
    this._turns.delete(roomId);
    console.log(
      `[SessionAudioRecorder][${roomId}] Reset — ${count} turn(s) discarded`,
    );
  }

  /** Number of recorded turns available for a room. */
  static getTurnCount(roomId: string): number {
    return this._turns.get(roomId)?.length ?? 0;
  }

  /**
   * Concatenate all recorded turns into a single WAV Blob without
   * triggering a download. Returns null if there are no turns.
   * Used for uploading to the server at session end.
   */
  /**
   * Concatenate all recorded turns (in turn-number order) into a single
   * WAV blob, inserting `silenceMs` milliseconds of silence between turns
   * so the result sounds like a natural conversation with pauses.
   * Returns null if there are no turns.
   */
  static async buildWavBlob(
    roomId: string,
    silenceMs = 5000,
  ): Promise<Blob | null> {
    const turns = this._turns.get(roomId);
    if (!turns || turns.length === 0) return null;

    const sorted = [...turns].sort((a, b) => a.turnNumber - b.turnNumber);
    const ctx = new AudioContext();
    try {
      const buffers: AudioBuffer[] = [];
      for (const turn of sorted) {
        const ab = await turn.blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab);
        buffers.push(decoded);
      }

      const sampleRate = buffers[0].sampleRate;
      const numChannels = buffers[0].numberOfChannels;
      const silenceSamples = Math.floor((sampleRate * silenceMs) / 1000);
      const audioLength = buffers.reduce((sum, b) => sum + b.length, 0);
      const gapLength = silenceSamples * Math.max(0, buffers.length - 1);
      const combined = ctx.createBuffer(
        numChannels,
        audioLength + gapLength,
        sampleRate,
      );

      let offset = 0;
      for (let i = 0; i < buffers.length; i++) {
        const buf = buffers[i];
        for (let ch = 0; ch < numChannels; ch++) {
          combined.copyToChannel(buf.getChannelData(ch), ch, offset);
        }
        offset += buf.length;
        if (i < buffers.length - 1) {
          // Silence is zeros — createBuffer initialises to zero so just advance
          offset += silenceSamples;
        }
      }

      return _encodeWav(combined);
    } finally {
      await ctx.close();
    }
  }

  /**
   * Encode each recorded turn as an individual WAV Blob.
   * Both tabs (caregiver + patient) call this and upload their own turns
   * independently; the server merges them by turn number to produce a
   * single conversation WAV with both voices.
   */
  static async buildIndividualWavBlobs(roomId: string): Promise<Array<{
    turnNumber: number;
    speakerName: string;
    wavBlob: Blob;
  }> | null> {
    const turns = this._turns.get(roomId);
    if (!turns || turns.length === 0) return null;

    const sorted = [...turns].sort((a, b) => a.turnNumber - b.turnNumber);
    const ctx = new AudioContext();
    try {
      const result: Array<{
        turnNumber: number;
        speakerName: string;
        wavBlob: Blob;
      }> = [];
      for (const turn of sorted) {
        const ab = await turn.blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab);
        result.push({
          turnNumber: turn.turnNumber,
          speakerName: turn.speakerName,
          wavBlob: _encodeWav(decoded),
        });
      }
      return result;
    } finally {
      await ctx.close();
    }
  }

  // ── Download ───────────────────────────────────────────────────────

  /**
   * Concatenate all recorded turns (in turn-number order) into a single
   * WAV file and trigger a browser download.
   *
   * Returns false if there is nothing to download.
   */
  static async download(roomId: string, filename?: string): Promise<boolean> {
    const turns = this._turns.get(roomId);
    if (!turns || turns.length === 0) {
      console.warn(
        `[SessionAudioRecorder][${roomId}] Nothing to download — no turns recorded`,
      );
      return false;
    }

    const wavBlob = await this.buildWavBlob(roomId);
    if (!wavBlob) return false;

    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 16).replace('T', '_');
    a.href = url;
    a.download = filename ?? `session-${roomId}-${dateStr}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(
      `[SessionAudioRecorder][${roomId}] Download triggered — ` +
        `${turns.length} turns, ${(wavBlob.size / 1024 / 1024).toFixed(1)} MB`,
    );
    return true;
  }
}

// ── WAV encoder ────────────────────────────────────────────────────────────

function _encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');

  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleaved PCM samples (clamped to [-1, 1] → int16)
  let byteOffset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(byteOffset, int16, true);
      byteOffset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
