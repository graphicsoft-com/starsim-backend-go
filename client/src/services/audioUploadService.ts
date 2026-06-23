/**
 * audioUploadService — upload an existing audio Blob/File to the server,
 * which stores it in MinIO/S3 and returns the permanent key + URL.
 *
 * No audio processing is done here. The blob is sent as-is.
 */

const SERVER_URL = import.meta.env.VITE_API_URL || '';

export interface UploadExistingAudioParams {
  audioFile: Blob | File;
  roomId: string;
  sessionId: string;
  role: string;
  speakerName?: string;
  turnNumber?: number;
  fileName?: string;
  mimeType?: string;
}

export interface UploadAudioResult {
  success: boolean;
  key?: string;
  url?: string;
  sizeMb?: string;
  error?: string;
}

export async function uploadExistingAudioFile(
  params: UploadExistingAudioParams,
): Promise<UploadAudioResult> {
  const {
    audioFile,
    roomId,
    sessionId,
    role,
    speakerName,
    turnNumber,
    fileName,
    mimeType,
  } = params;

  try {
    const form = new FormData();

    // Wrap plain Blob in a File so the server sees a proper filename
    const name =
      fileName ?? `${roomId}-${role}-${turnNumber ?? Date.now()}.wav`;
    const type = mimeType ?? (audioFile.type || 'audio/wav');
    const file =
      audioFile instanceof File
        ? audioFile
        : new File([audioFile], name, { type });

    form.append('file', file, file.name);
    form.append('roomId', roomId);
    form.append('sessionId', sessionId);
    form.append('role', role);
    if (speakerName) form.append('speakerName', speakerName);
    if (turnNumber != null) form.append('turnNumber', String(turnNumber));

    const res = await fetch(`${SERVER_URL}/api/audio/upload`, {
      method: 'POST',
      body: form,
      // Do NOT set Content-Type — browser sets it with the correct boundary
    });

    const json = (await res.json()) as UploadAudioResult;

    if (!res.ok || !json.success) {
      return {
        success: false,
        error: json.error ?? `HTTP ${res.status}`,
      };
    }

    return json;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[audioUploadService] Upload failed:', message);
    return { success: false, error: message };
  }
}
