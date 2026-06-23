import { useState, useEffect, useCallback } from 'react';
import { TTSProviderFactory } from '../services/tts/TTSProviderFactory';
import type { ITTSProvider } from '../services/tts/ITTSProvider';

export interface ProviderHealthEntry {
  name: TTSProviderName;
  displayName: string;
  available: boolean;
  latencyMs: number | null;
  checkedAt: Date | null;
}

// Module-level cache: reuse provider instances across health checks
// to avoid creating dozens of throwaway instances every poll cycle.
const _healthProviders = new Map<string, ITTSProvider>();

function getOrCreateProvider(name: TTSProviderName): ITTSProvider {
  let p = _healthProviders.get(name);
  if (!p) {
    p = TTSProviderFactory.create(name);
    _healthProviders.set(name, p);
  }
  return p;
}

export function useTTSProviderHealth(pollIntervalMs = 30_000): {
  providers: ProviderHealthEntry[];
  isChecking: boolean;
  lastChecked: Date | null;
  refresh: () => void;
} {
  const [providers, setProviders] = useState<ProviderHealthEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    setIsChecking(true);
    try {
      // Check health for ALL registered providers so operators can switch to any
      const namesToCheck = TTSProviderFactory.getRegisteredNames();

      const results = await Promise.allSettled(
        namesToCheck.map(async (name) => {
          const start = Date.now();
          const provider = getOrCreateProvider(name);
          const available = await provider.isAvailable();
          const latencyMs = Date.now() - start;
          return {
            name,
            displayName: provider.displayName,
            available,
            latencyMs: available ? latencyMs : null,
            checkedAt: new Date(),
          } satisfies ProviderHealthEntry;
        }),
      );

      const entries = results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : {
              name: namesToCheck[i],
              displayName: namesToCheck[i],
              available: false,
              latencyMs: null,
              checkedAt: new Date(),
            },
      );

      setProviders(entries);
      setLastChecked(new Date());
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, pollIntervalMs);
    return () => clearInterval(interval);
  }, [checkHealth, pollIntervalMs]);

  return { providers, isChecking, lastChecked, refresh: checkHealth };
}
