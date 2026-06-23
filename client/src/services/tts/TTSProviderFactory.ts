/**
 * Maps provider name strings to concrete ITTSProvider instances.
 *
 * Implements the Factory Pattern and the Open/Closed Principle:
 * adding a new provider requires only an import and a registry entry —
 * no existing code changes. The private constructor prevents instantiation;
 * all methods are static.
 *
 * To add a new provider:
 *   1. Import the concrete class below.
 *   2. Add an entry to `_registry`.
 *   3. Done — everything else uses ITTSProvider.
 */

import type { ITTSProvider, TTSProviderName } from './ITTSProvider';

// ── Concrete provider imports ──────────────────────────────────────
// TTSProviderFactory is the ONLY file that imports concrete classes.
// All consumers (RoomTTS, ConfigStore, Dashboard) import ITTSProvider only.
// Adding a new provider means: add import here, add entry to _registry.
// Nothing else in the codebase changes.
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { XTTSProvider } from './providers/XTTSProvider';
import { VitsProvider } from './providers/VitsProvider';
import { PiperServerProvider } from './providers/PiperServerProvider';
import { NullProvider } from './providers/NullProvider';

// ── Config Types ───────────────────────────────────────────────────

/**
 * Configuration passed to XTTSProvider at creation time.
 * Enables pointing the provider at different server routes for testing
 * or multi-environment deployments without modifying provider code.
 */
export interface XTTSProviderConfig {
  proxyRoute?: string;
  healthRoute?: string;
}

// ── Factory ────────────────────────────────────────────────────────

export class TTSProviderFactory {
  // Factory classes are never instantiated.
  // All methods are static. This private constructor enforces that.
  private constructor() {
    // Intentionally empty — prevents instantiation.
  }

  private static readonly _registry: Record<
    TTSProviderName,
    () => ITTSProvider
  > = {
    webspeech: () => new WebSpeechProvider(),
    xtts: () => new XTTSProvider(),
    vits: () => new VitsProvider(),
    piper: () => new PiperServerProvider(),
    disabled: () => new NullProvider(),
  };

  private static readonly _default: TTSProviderName = 'xtts';

  /** Map a provider name to a concrete instance. Never throws. */
  static create(
    name: TTSProviderName | string,
    config?: XTTSProviderConfig,
  ): ITTSProvider {
    const normalized = name?.trim().toLowerCase() as TTSProviderName;
    const factory = TTSProviderFactory._registry[normalized];

    if (factory) {
      const provider = factory();
      console.log(`[TTSFactory] Created provider: ${provider.displayName}`);
      return provider;
    }

    if (normalized === TTSProviderFactory._default) {
      // Default itself is unknown — emergency fallback to WebSpeech
      console.error(
        `[TTSFactory] Default provider "${TTSProviderFactory._default}" ` +
          `not found in registry — using WebSpeech as emergency fallback`,
      );
      return new WebSpeechProvider();
    }

    console.warn(
      `[TTSFactory] Unknown provider "${name}" — ` +
        `falling back to "${TTSProviderFactory._default}"`,
    );
    return TTSProviderFactory.create(TTSProviderFactory._default, config);
  }

  /** Create a provider for a specific room, logging room context. */
  static createForRoom(
    roomId: string,
    providerName: TTSProviderName | string,
  ): ITTSProvider {
    console.log(
      `[TTSFactory] Creating provider for ${roomId}: "${providerName}"`,
    );
    return TTSProviderFactory.create(providerName);
  }

  /** Check if a provider name exists in the registry. */
  static isRegistered(name: string): boolean {
    return name in TTSProviderFactory._registry;
  }

  /** Returns all known provider names. */
  static getRegisteredNames(): TTSProviderName[] {
    return Object.keys(TTSProviderFactory._registry) as TTSProviderName[];
  }

  /**
   * Run isAvailable() on all registered providers in parallel.
   *
   * Uses Promise.allSettled (not Promise.all) because one unavailable
   * provider should not prevent results from the rest.
   * Reuses cached instances to avoid creating throwaway providers.
   */
  private static readonly _availabilityCache = new Map<
    TTSProviderName,
    ITTSProvider
  >();

  static async getAvailableProviders(): Promise<
    Array<{ name: TTSProviderName; displayName: string; available: boolean }>
  > {
    const names = TTSProviderFactory.getRegisteredNames();

    const results = await Promise.allSettled(
      names.map(async (name) => {
        let provider = TTSProviderFactory._availabilityCache.get(name);
        if (!provider) {
          provider = TTSProviderFactory.create(name);
          TTSProviderFactory._availabilityCache.set(name, provider);
        }
        const available = await provider.isAvailable();
        return { name, displayName: provider.displayName, available };
      }),
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      console.warn(
        `[TTSFactory] Availability check failed for "${names[index]}":`,
        result.reason,
      );
      return {
        name: names[index],
        displayName: names[index],
        available: false,
      };
    });
  }
}

export default TTSProviderFactory;
