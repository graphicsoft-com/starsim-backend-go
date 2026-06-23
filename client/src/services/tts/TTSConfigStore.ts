/**
 * Client-side TTS configuration store (singleton per browser tab).
 *
 * Does not read from disk — receives config from the server via socket.
 * Version numbers prevent stale updates from being applied.
 */

import type { Socket } from 'socket.io-client';
import type { TTSProviderName } from './ITTSProvider';

/** Minimal shape of the server config payload. */
interface ServerTTSConfig {
  default: string;
  version: number;
  rooms: Record<string, { roomId: string; provider: string }>;
}

export class ClientTTSConfigStore {
  private static _instance: ClientTTSConfigStore | null = null;

  private constructor() {
    // Intentionally empty — use getInstance().
  }

  static getInstance(): ClientTTSConfigStore {
    if (!ClientTTSConfigStore._instance) {
      ClientTTSConfigStore._instance = new ClientTTSConfigStore();
    }
    return ClientTTSConfigStore._instance;
  }

  private _config: Map<string, TTSProviderName> = new Map();
  private _defaultProvider: TTSProviderName = 'webspeech';
  private _version = 0;
  private _changeListeners: Array<
    (roomId: string, provider: TTSProviderName) => void
  > = [];

  /** Inject a socket and start listening for config updates. */
  init(socket: Socket): void {
    socket.on(
      'tts_config_updated',
      (payload: {
        roomId: string;
        provider: string;
        fullConfig: ServerTTSConfig;
        version: number;
      }) => {
        this._handleServerUpdate(payload);
      },
    );

    // Request current config snapshot immediately
    socket.emit('tts_config_request');
  }

  private _handleServerUpdate(payload: {
    roomId: string;
    provider: string;
    fullConfig: ServerTTSConfig;
    version: number;
  }): void {
    if (payload.version <= this._version) return;

    this._version = payload.version;

    for (const [roomId, roomCfg] of Object.entries(payload.fullConfig.rooms)) {
      this._config.set(roomId, roomCfg.provider as TTSProviderName);
    }

    this._defaultProvider = payload.fullConfig.default as TTSProviderName;

    // When roomId is 'all' (initial snapshot), notify each room individually
    // so RoomTTS instances can swap away from their construction-time default.
    const notifications: Array<[string, TTSProviderName]> =
      payload.roomId === 'all'
        ? [...this._config.entries()]
        : [[payload.roomId, payload.provider as TTSProviderName]];

    for (const [notifyRoomId, notifyProvider] of notifications) {
      for (const cb of this._changeListeners) {
        try {
          cb(notifyRoomId, notifyProvider);
        } catch (err) {
          console.error('[ClientTTSConfig] Listener error:', err);
        }
      }
    }

    console.log(
      `[ClientTTSConfig] Updated — rooms=${notifications.length} ` +
        `version=${payload.version}`,
    );
  }

  /** Returns the current config version number. */
  getVersion(): number {
    return this._version;
  }

  /** Returns the latest config snapshot received from the server. */
  getConfig(): {
    default: TTSProviderName;
    version: number;
    rooms: Record<string, { roomId: string; provider: TTSProviderName }>;
  } {
    const rooms: Record<string, { roomId: string; provider: TTSProviderName }> =
      {};

    for (const [roomId, provider] of this._config) {
      rooms[roomId] = { roomId, provider };
    }

    return {
      default: this._defaultProvider,
      version: this._version,
      rooms,
    };
  }

  /** Returns the provider for a room, falling back to default. */
  getProvider(roomId: string): TTSProviderName {
    return this._config.get(roomId) ?? this._defaultProvider;
  }

  /** Returns all room → provider mappings as a plain object. */
  getAllProviders(): Record<string, TTSProviderName> {
    const result: Record<string, TTSProviderName> = {};
    for (const [roomId, provider] of this._config) {
      result[roomId] = provider;
    }
    return result;
  }

  /**
   * Register a change listener. Returns an unsubscribe function.
   *
   * Used by RoomTTS to react to config changes and by the dashboard
   * to re-render on provider switches.
   */
  onChange(
    callback: (roomId: string, provider: TTSProviderName) => void,
  ): () => void {
    this._changeListeners.push(callback);
    return () => {
      this._changeListeners = this._changeListeners.filter(
        (cb) => cb !== callback,
      );
    };
  }
}

export default ClientTTSConfigStore;
