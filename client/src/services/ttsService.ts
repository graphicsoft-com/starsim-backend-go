/**
 * ttsService.ts — Backward Compatibility Shim
 *
 * This file maintains the old flat-function API surface while routing
 * all calls through the new TTS provider architecture (RoomTTS + ITTSProvider).
 *
 * MIGRATION STATUS: All functions are @deprecated.
 * Migrate call sites to use getRoomTTS(roomId) directly, then delete this file.
 *
 * Architecture: Facade Pattern
 * Hides: RoomTTS, ClientTTSConfigStore, TTSProviderFactory
 * Exposes: Legacy flat-function API
 *
 * DO NOT add new functions to this file.
 * DO NOT use this file in new code.
 * New code should import from:
 *   apps/client/src/services/tts/RoomTTS.ts
 */

import type { Socket } from 'socket.io-client';
import type { ParticipantRole } from '@org/shared-types';
import type { TTSSpeakOptions } from './tts/ITTSProvider';
import { getRoomTTS } from './tts/RoomTTS';
import { ClientTTSConfigStore } from './tts/TTSConfigStore';
import { TTSProviderFactory } from './tts/TTSProviderFactory';

/**
 * @deprecated Use getRoomTTS(roomId).init(socket, isDashboard) directly.
 * Also call ClientTTSConfigStore.getInstance().init(socket) once per tab.
 */
export function initTTS(
  socket: Socket,
  roomId: string,
  isDashboard = false,
): void {
  ClientTTSConfigStore.getInstance().init(socket);
  getRoomTTS(roomId).init(socket, isDashboard);
  console.log(
    `[ttsService shim] initTTS called — room=${roomId} ` +
      `isDashboard=${isDashboard} (migrate to getRoomTTS)`,
  );
}

/**
 * @deprecated Use getRoomTTS(roomId).speak(options) directly.
 * The options object provides richer context for logging and providers.
 */
export async function speak(
  text: string,
  role: ParticipantRole,
  roomId: string,
  tone = 'neutral',
): Promise<void> {
  const options: TTSSpeakOptions = {
    text,
    role,
    tone,
    roomId,
    sessionId: '', // unknown at shim level — migrate to pass real value
    turnNumber: 0, // unknown at shim level — migrate to pass real value
    speakerName: '', // unknown at shim level — migrate to pass real value
    speakerGender: 'male', // default fallback — migrate to pass real value
  };
  return getRoomTTS(roomId).speak(options);
}

/**
 * @deprecated
 * With roomId:    Use getRoomTTS(roomId).stop() directly.
 * Without roomId: Use destroyAllRoomTTS() or stop each room individually.
 */
export function stopSpeaking(roomId?: string): void {
  if (roomId) {
    getRoomTTS(roomId).stop();
  } else {
    const ALL_ROOMS = ['room1', 'room2', 'room3', 'room4', 'room5', 'room6'];
    ALL_ROOMS.forEach((id) => {
      try {
        getRoomTTS(id).stop();
      } catch {
        /* room may not be initialized */
      }
    });
  }
}

/**
 * @deprecated Use TTSProviderFactory.isRegistered('webspeech')
 * or provider.isAvailable() for async health checking.
 */
export function isTTSSupported(): boolean {
  // The new architecture always has at least WebSpeechProvider available.
  // For real availability checking use provider.isAvailable() (async).
  // This sync shim always returns true for backward compatibility.
  return true;
}

/**
 * @deprecated Use TTSProviderFactory.getAvailableProviders() instead.
 * That method checks all registered providers, not just WebSpeech voices.
 */
export async function logAvailableVoices(): Promise<void> {
  const providers = await TTSProviderFactory.getAvailableProviders();
  console.log('🔊  Available TTS providers:');
  providers.forEach((p) => {
    console.log(`  ${p.available ? '✅' : '❌'}  ${p.displayName} (${p.name})`);
  });
}

/**
 * @deprecated Import getRoomTTS directly from './tts/RoomTTS'
 * This re-export exists only for call sites that used the old pattern.
 */
export function getRoomTTSInstance(roomId: string) {
  return getRoomTTS(roomId);
}

// ── Re-exports for gradual migration ───────────────────────────────────────

export type { TTSSpeakOptions } from './tts/ITTSProvider';
export type { TTSProviderName } from './tts/ITTSProvider';
export { getRoomTTS } from './tts/RoomTTS';
export { destroyRoomTTS } from './tts/RoomTTS';
export { destroyAllRoomTTS } from './tts/RoomTTS';
export { ClientTTSConfigStore } from './tts/TTSConfigStore';

/*
 * ═══════════════════════════════════════════════════════════════
 *  MIGRATION GUIDE — How to update a call site
 * ═══════════════════════════════════════════════════════════════
 *
 *  BEFORE (old pattern):
 *    import { initTTS, speak, stopSpeaking } from '../services/ttsService'
 *    initTTS(socket, roomId)
 *    await speak(text, role, roomId, tone)
 *    stopSpeaking(roomId)
 *
 *  AFTER (new pattern):
 *    import { getRoomTTS } from '../services/tts/RoomTTS'
 *    getRoomTTS(roomId).init(socket)
 *    await getRoomTTS(roomId).speak({ text, role, tone, roomId,
 *                                     sessionId, turnNumber })
 *    getRoomTTS(roomId).stop()
 *
 *  COMPONENT LIFECYCLE:
 *    On mount:   getRoomTTS(roomId).init(socket)
 *    On unmount: getRoomTTS(roomId).destroy()  ← IMPORTANT — prevents leaks
 *
 *  AUDIO UNLOCK (XTTSProvider only):
 *    On user gesture: await getRoomTTS(roomId).unlockAudio()
 *
 *  When all call sites are migrated, delete ttsService.ts entirely.
 * ═══════════════════════════════════════════════════════════════
 */
