/**
 * Service Worker — WASM & voice model cache
 *
 * Intercepts fetch() from all contexts (main thread, Web Workers, other tabs)
 * and serves cached responses for large, immutable assets used by
 * @diffusionstudio/vits-web:
 *   - piper_phonemize WASM runtime  (cdn.jsdelivr.net)
 *   - onnxruntime-web WASM          (cdnjs.cloudflare.com)
 *   - Piper voice model .onnx files (huggingface.co + cas-bridge CDN)
 *
 * Deduplicates concurrent requests: when multiple Web Workers request the
 * same large binary simultaneously (all cache-miss), only one network fetch
 * is issued — all other waiters receive a fresh clone from CacheStorage once
 * the first fetch completes.
 */

const CACHE_NAME = 'piper-wasm-v1';

const CACHEABLE_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm',
  'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web',
  'https://huggingface.co/diffusionstudio/piper-voices/resolve/main',
  'https://cas-bridge.xethub.hf.co/',
];

/**
 * In-flight deduplication map: cacheKey URL → Promise<void>.
 * Resolved once the network fetch has been stored in CacheStorage.
 * Waiters then re-read from cache to get their own fresh Response clone.
 */
const inflight = new Map();

/** CAS bridge URLs have short-lived signed query params — cache by pathname only */
function casBridgeCacheKey(request) {
  try {
    const pathname = new URL(request.url).pathname;
    return new Request('https://cas-bridge.xethub.hf.co' + pathname);
  } catch {
    return request;
  }
}

self.addEventListener('install', () => {
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all existing clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!CACHEABLE_PREFIXES.some((prefix) => url.startsWith(prefix))) return;
  event.respondWith(handleCacheable(event.request));
});

async function handleCacheable(request) {
  const url = request.url;
  const isCas = url.startsWith('https://cas-bridge.xethub.hf.co/');
  const cacheKey = isCas ? casBridgeCacheKey(request) : request;
  const cacheKeyUrl = cacheKey instanceof Request ? cacheKey.url : url;

  const cache = await caches.open(CACHE_NAME);

  // Fast path: already cached
  const cached = await cache.match(cacheKey);
  if (cached) {
    console.debug('[SW] Cache hit:', cacheKeyUrl);
    return cached;
  }

  // Another context is already fetching this URL — wait for it to finish
  // then serve from cache. This prevents N parallel Workers from each
  // issuing a full network fetch for the same large binary file.
  if (inflight.has(cacheKeyUrl)) {
    console.debug('[SW] Awaiting inflight:', cacheKeyUrl);
    await inflight.get(cacheKeyUrl);
    const cached2 = await cache.match(cacheKey);
    if (cached2) return cached2;
    // Cache write failed — fall through to a fresh fetch below
  }

  // This context is first — issue the network request and signal waiters when done.
  console.debug('[SW] Network fetch:', url);
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  inflight.set(cacheKeyUrl, done);

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Await cache.put so waiters re-reading the cache always find the entry.
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } finally {
    inflight.delete(cacheKeyUrl);
    resolveDone();
  }
}
